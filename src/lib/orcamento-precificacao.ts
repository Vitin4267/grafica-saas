import type { Prisma } from "@/generated/prisma/client";
import { calcularPreco } from "@/lib/orcamento";
import { precificar, ErroPrecificacao, type PedidoPrecificacao } from "@/lib/pricing";
import { carregarContextoPrecificacao, resolverConfigAcabamentos } from "@/lib/pricing/carregar";

type ModeloCalculoPrecificavel =
  | "SIMPLES"
  | "M2"
  | "OFFSET"
  | "FLEXOGRAFIA"
  | "DIGITAL"
  | "SERIGRAFIA"
  | "SUBLIMACAO"
  | "ESTAMPAGEM_QUENTE";

// Os 3 modelos de "setup por peça" — SERIGRAFIA/SUBLIMACAO/ESTAMPAGEM_QUENTE —
// e DIGITAL não têm nesting (sem largura/altura pro CUSTO em si), diferente de
// M2/OFFSET/FLEXOGRAFIA. Usado tanto pra pular a guarda de dimensão obrigatória
// quanto, na montagem do PedidoPrecificacao, pra escolher o branch certo.
const MODELOS_SEM_NESTING = new Set<ModeloCalculoPrecificavel>([
  "DIGITAL",
  "SERIGRAFIA",
  "SUBLIMACAO",
  "ESTAMPAGEM_QUENTE",
]);
const MODELOS_SETUP_POR_PECA = new Set<ModeloCalculoPrecificavel>([
  "SERIGRAFIA",
  "SUBLIMACAO",
  "ESTAMPAGEM_QUENTE",
]);

type ItemGraficaParaPrecificacao = {
  id: string;
  modeloCalculo: ModeloCalculoPrecificavel;
  precoVenda: Prisma.Decimal | null;
};

export type DadosItemOrcamento = {
  quantidade: number;
  larguraCm: number | null;
  alturaCm: number | null;
  corFrente: number | null;
  corVerso: number | null;
  // Só usado pelo motor avançado (M2/OFFSET) — SIMPLES continua com o campo de
  // texto livre OrcamentoItem.acabamento, sem custo (ver src/lib/orcamento.ts).
  acabamentoIds: string[];
  // Motor de clichê de etiqueta (só M2 com ConfiguracaoClicheEtiqueta) — papel
  // escolhido NESTE orçamento (matéria-prima) e quantidade de cores da arte.
  // custoFaca/custoFrete são R$ livres, por item, independentes do modelo.
  papelId: string | null;
  quantidadeCores: number | null;
  custoFaca: number | null;
  custoFrete: number | null;
  // Só usado por FLEXOGRAFIA — deliberadamente separado de corFrente/corVerso
  // (semânticos de frente/verso de folha do Offset, lidos em ~20 lugares fora
  // deste escopo).
  numeroCoresFlexo: number | null;
  // Só usado por DIGITAL — opcional (default 1 no motor se ausente).
  numeroCliques: number | null;
  // Só usado por SERIGRAFIA/SUBLIMACAO/ESTAMPAGEM_QUENTE (os 3 compartilham
  // este campo, mesma razão de compartilharem calcularSetupPorPeca).
  numeroSetups: number | null;
};

export type AcabamentoParaGravar = {
  itemGraficaId: string;
  qtdBase: string;
  custoCalculado: string;
};

export type ResultadoItemOrcamento =
  | {
      ok: true;
      precoUnitario: string;
      precoTotal: string;
      modeloCalculo: ModeloCalculoPrecificavel;
      corFrente: number | null;
      corVerso: number | null;
      numeroCoresFlexo: number | null;
      numeroCliques: number | null;
      numeroSetups: number | null;
      breakdown: Prisma.InputJsonValue | null;
      acabamentos: AcabamentoParaGravar[];
      precificacaoEtiqueta: {
        papelId: string;
        quantidadeCores: number;
        custoClicheCalculado: string;
        custoFaca: string | null;
        custoFrete: string | null;
      } | null;
    }
  | { ok: false; mensagem: string };

// Único lugar que decide como um item de orçamento é precificado (SIMPLES via
// src/lib/orcamento.ts, M2/OFFSET via o motor avançado) — reaproveitado tanto
// por criarOrcamento quanto por editarOrcamento pra nunca divergir a lógica.
export async function calcularItemOrcamento(
  itemGrafica: ItemGraficaParaPrecificacao,
  graficaId: string,
  dados: DadosItemOrcamento
): Promise<ResultadoItemOrcamento> {
  const { quantidade, larguraCm, alturaCm, corFrente, corVerso } = dados;

  // Quantidade precisa ser um inteiro positivo finito. O motor avançado
  // (M2/OFFSET) valida isso de novo em validar.ts, mas o cálculo SIMPLES
  // (calcularPreco) não valida nada — sem essa guarda aqui, editarOrcamento/
  // adicionarItemOrcamento (que leem quantidade direto do form, sem zod,
  // diferente de criarOrcamento) deixavam passar quantidade fracionária ou
  // "Infinity"/"1e400" (Number() converte pra Infinity, que não é falsy nem
  // <= 0). Ponto único por onde todo item passa, mesma razão da guarda de
  // largura/altura abaixo.
  if (!Number.isInteger(quantidade) || quantidade <= 0) {
    return { ok: false, mensagem: "Informe uma quantidade válida (número inteiro maior que zero)." };
  }

  // Dimensões, quando informadas, precisam ser positivas e finitas. O motor
  // avançado (M2/OFFSET) já rejeita isso adiante em validar.ts, mas o cálculo
  // SIMPLES (calcularPreco) não valida nada — largura positiva com altura
  // negativa gera área e preço negativos. adicionarItem/editarOrcamento leem
  // esses campos direto do form (sem zod), então a guarda precisa morar
  // aqui, no ponto único por onde todo item passa.
  if (
    (larguraCm !== null && (!Number.isFinite(larguraCm) || larguraCm <= 0)) ||
    (alturaCm !== null && (!Number.isFinite(alturaCm) || alturaCm <= 0))
  ) {
    return { ok: false, mensagem: "Largura e altura precisam ser maiores que zero." };
  }

  // Guardas do motor de clichê de etiqueta / faca / frete — mesma razão das
  // duas guardas acima: editarOrcamento/adicionarItemOrcamento leem esses
  // campos direto do FormData, sem zod. Universal (roda pra SIMPLES também,
  // mesmo que nunca preencha esses campos na prática) pra não deixar o
  // branch SIMPLES abaixo devolver ok:true antes de checar.
  if (
    dados.quantidadeCores !== null &&
    (!Number.isInteger(dados.quantidadeCores) || dados.quantidadeCores < 1)
  ) {
    return { ok: false, mensagem: "Quantidade de cores inválida (mínimo 1)." };
  }
  if (dados.custoFaca !== null && (!Number.isFinite(dados.custoFaca) || dados.custoFaca < 0)) {
    return { ok: false, mensagem: "Custo de faca inválido." };
  }
  if (dados.custoFrete !== null && (!Number.isFinite(dados.custoFrete) || dados.custoFrete < 0)) {
    return { ok: false, mensagem: "Custo de frete inválido." };
  }

  // Guarda de FLEXOGRAFIA — mesmo cuidado das guardas acima: precisa vir ANTES
  // do branch SIMPLES e seu `return`, senão um item de cálculo flexografia sem
  // número de cores passava batido (mesmo bug que já aconteceu uma vez com as
  // guardas de etiqueta neste arquivo).
  if (itemGrafica.modeloCalculo === "FLEXOGRAFIA") {
    if (!Number.isInteger(dados.numeroCoresFlexo) || (dados.numeroCoresFlexo ?? 0) < 1) {
      return {
        ok: false,
        mensagem: "Informe o número de cores (mínimo 1) — item de cálculo flexografia.",
      };
    }
  }

  // Guarda de DIGITAL — nº de cliques é opcional (default 1 no motor), mas
  // quando informado precisa ser um inteiro válido. Mesmo cuidado das guardas
  // acima: precisa vir antes do branch SIMPLES.
  if (
    itemGrafica.modeloCalculo === "DIGITAL" &&
    dados.numeroCliques !== null &&
    (!Number.isInteger(dados.numeroCliques) || dados.numeroCliques < 1)
  ) {
    return { ok: false, mensagem: "Número de cliques inválido (mínimo 1)." };
  }

  // Guarda dos 3 modelos de setup por peça — mesmo padrão do guard de
  // numeroCoresFlexo acima, nº de setups é obrigatório (sem default).
  if (
    MODELOS_SETUP_POR_PECA.has(itemGrafica.modeloCalculo) &&
    (!Number.isInteger(dados.numeroSetups) || (dados.numeroSetups ?? 0) < 1)
  ) {
    return {
      ok: false,
      mensagem: "Informe o número de setups (telas/matrizes/artes, mínimo 1) — item deste modelo de cálculo.",
    };
  }

  if (itemGrafica.modeloCalculo === "SIMPLES") {
    // Number(null) é 0, não erro — sem esta guarda, um produto que ficou sem
    // preço no catálogo (ex: campo limpo por engano numa edição em lote)
    // gravava o item a R$ 0,00 em silêncio. criarOrcamento/adicionarItem já
    // filtram precoVenda:{not:null} na própria query antes de chegar aqui,
    // mas editarOrcamento lê o item de um `include` já carregado (sem esse
    // filtro) — este é o ponto único por onde os dois passam, então a guarda
    // mora aqui, não em cada chamador.
    if (itemGrafica.precoVenda === null) {
      return {
        ok: false,
        mensagem:
          "Este produto está sem preço de venda configurado no catálogo — configure o preço antes de usar em um orçamento.",
      };
    }
    const { precoUnitario, precoTotal } = calcularPreco({
      precoBase: Number(itemGrafica.precoVenda),
      quantidade,
      larguraCm,
      alturaCm,
    });

    return {
      ok: true,
      precoUnitario: precoUnitario.toString(),
      precoTotal: precoTotal.toString(),
      modeloCalculo: "SIMPLES",
      corFrente: null,
      corVerso: null,
      numeroCoresFlexo: null,
      numeroCliques: null,
      numeroSetups: null,
      breakdown: null,
      acabamentos: [],
      precificacaoEtiqueta: null,
    };
  }

  // Motor avançado M2/OFFSET/FLEXOGRAFIA exige dimensões reais da peça (usadas
  // pro nesting). DIGITAL e os 3 de setup-por-peça NÃO têm nesting — largura/
  // altura são opcionais pra eles (ver PedidoDigital/PedidoSetupPorPeca em
  // src/lib/pricing/tipos.ts), então pulam esta guarda.
  if (!MODELOS_SEM_NESTING.has(itemGrafica.modeloCalculo) && (!larguraCm || !alturaCm)) {
    return {
      ok: false,
      mensagem: "Informe largura e altura — este item usa o cálculo avançado por área.",
    };
  }

  if (itemGrafica.modeloCalculo === "OFFSET") {
    if (!Number.isInteger(corFrente) || (corFrente ?? 0) < 1) {
      return {
        ok: false,
        mensagem: "Informe o número de cores de frente (mínimo 1) — item de cálculo offset.",
      };
    }
    if (!Number.isInteger(corVerso) || (corVerso ?? -1) < 0) {
      return { ok: false, mensagem: "Número de cores de verso inválido." };
    }
  }

  try {
    const contexto = await carregarContextoPrecificacao(
      itemGrafica.id,
      graficaId,
      dados.papelId && dados.quantidadeCores
        ? { papelId: dados.papelId, quantidadeCores: dados.quantidadeCores }
        : undefined
    );
    if (dados.custoFrete !== null) contexto.custoFreteEstimado = dados.custoFrete;
    if (dados.custoFaca !== null) contexto.custoFaca = dados.custoFaca;

    const acabamentos =
      dados.acabamentoIds.length > 0
        ? await resolverConfigAcabamentos(dados.acabamentoIds, graficaId)
        : [];

    // DIGITAL e os 3 de setup-por-peça não exigem largura/altura (guarda
    // acima pulou essa checagem pra eles) — mas se o produto tiver um
    // acabamento anexado com baseCobranca=M2, esse acabamento precisa de
    // largura×altura pra não custar R$0 silenciosamente (calcularQtdBase
    // multiplicaria por 0). Bloqueia aqui, com mensagem clara, em vez de
    // deixar passar.
    if (
      MODELOS_SEM_NESTING.has(itemGrafica.modeloCalculo) &&
      (!larguraCm || !alturaCm) &&
      acabamentos.some((a) => a.baseCobranca === "M2")
    ) {
      return {
        ok: false,
        mensagem:
          "Este item tem um acabamento cobrado por m² — informe largura e altura pra calcular o custo desse acabamento corretamente.",
      };
    }

    // DIGITAL e os 3 de setup-por-peça: largura/altura são opcionais (guarda
    // acima já garantiu que, se ausentes, nenhum acabamento M2-based está
    // anexado) — undefined quando não informadas, nunca uma divisão por um
    // null.
    const larguraMOpcional = larguraCm !== null ? larguraCm / 100 : undefined;
    const alturaMOpcional = alturaCm !== null ? alturaCm / 100 : undefined;

    let pedido: PedidoPrecificacao;
    if (itemGrafica.modeloCalculo === "OFFSET") {
      pedido = {
        tipo: "OFFSET",
        pedido: {
          larguraM: larguraCm! / 100,
          alturaM: alturaCm! / 100,
          quantidade,
          corFrente: corFrente!,
          corVerso: corVerso!,
        },
        acabamentos,
      };
    } else if (itemGrafica.modeloCalculo === "FLEXOGRAFIA") {
      pedido = {
        tipo: "FLEXOGRAFIA",
        pedido: {
          larguraM: larguraCm! / 100,
          alturaM: alturaCm! / 100,
          quantidade,
          numeroCores: dados.numeroCoresFlexo!,
        },
        acabamentos,
      };
    } else if (itemGrafica.modeloCalculo === "DIGITAL") {
      pedido = {
        tipo: "DIGITAL",
        pedido: {
          quantidade,
          numeroCliques: dados.numeroCliques ?? undefined,
          larguraM: larguraMOpcional,
          alturaM: alturaMOpcional,
        },
        acabamentos,
      };
    } else if (itemGrafica.modeloCalculo === "SERIGRAFIA") {
      pedido = {
        tipo: "SERIGRAFIA",
        pedido: {
          quantidade,
          numeroSetups: dados.numeroSetups!,
          larguraM: larguraMOpcional,
          alturaM: alturaMOpcional,
        },
        acabamentos,
      };
    } else if (itemGrafica.modeloCalculo === "SUBLIMACAO") {
      pedido = {
        tipo: "SUBLIMACAO",
        pedido: {
          quantidade,
          numeroSetups: dados.numeroSetups!,
          larguraM: larguraMOpcional,
          alturaM: alturaMOpcional,
        },
        acabamentos,
      };
    } else if (itemGrafica.modeloCalculo === "ESTAMPAGEM_QUENTE") {
      pedido = {
        tipo: "ESTAMPAGEM_QUENTE",
        pedido: {
          quantidade,
          numeroSetups: dados.numeroSetups!,
          larguraM: larguraMOpcional,
          alturaM: alturaMOpcional,
        },
        acabamentos,
      };
    } else {
      pedido = {
        tipo: "M2",
        pedido: {
          larguraM: larguraCm! / 100,
          alturaM: alturaCm! / 100,
          quantidade,
        },
        acabamentos,
      };
    }

    const resultado = precificar(pedido, contexto);
    // decimal.js serializa via toJSON() -> string; o round-trip garante um objeto
    // 100% plano (sem instâncias de Decimal) antes de gravar na coluna Json.
    const breakdown = JSON.parse(JSON.stringify(resultado)) as Prisma.InputJsonValue;

    return {
      ok: true,
      precoUnitario: resultado.precoUnitario.toString(),
      precoTotal: resultado.precoFinal.toString(),
      modeloCalculo: itemGrafica.modeloCalculo,
      corFrente: itemGrafica.modeloCalculo === "OFFSET" ? corFrente! : null,
      corVerso: itemGrafica.modeloCalculo === "OFFSET" ? corVerso! : null,
      numeroCoresFlexo: itemGrafica.modeloCalculo === "FLEXOGRAFIA" ? dados.numeroCoresFlexo! : null,
      // Lido de volta do resultado (não de dados.numeroCliques) porque o
      // motor aplica um default (1) quando o pedido não informa — a coluna
      // snapshot precisa refletir o valor REALMENTE usado no cálculo.
      numeroCliques:
        itemGrafica.modeloCalculo === "DIGITAL" &&
        typeof resultado.metricas.numeroCliques === "number"
          ? resultado.metricas.numeroCliques
          : null,
      numeroSetups: MODELOS_SETUP_POR_PECA.has(itemGrafica.modeloCalculo) ? dados.numeroSetups! : null,
      breakdown,
      acabamentos: resultado.detalhes.acabamentos.map((a) => ({
        itemGraficaId: a.itemGraficaId,
        qtdBase: a.qtdBase.toString(),
        custoCalculado: a.custo.toString(),
      })),
      // Usa contexto.etiquetaCliche (nunca dados.papelId truthy sozinho) como
      // fonte de verdade — protege contra um papelId mandado por engano/
      // adulterado pra um produto M2 que não tem ConfiguracaoClicheEtiqueta:
      // se o motor não aplicou o clichê de verdade, não gravamos nada.
      precificacaoEtiqueta: contexto.etiquetaCliche
        ? {
            papelId: dados.papelId!,
            quantidadeCores: dados.quantidadeCores!,
            custoClicheCalculado: resultado.detalhes.cliche.toString(),
            custoFaca: dados.custoFaca !== null ? String(dados.custoFaca) : null,
            custoFrete: dados.custoFrete !== null ? String(dados.custoFrete) : null,
          }
        : null,
    };
  } catch (erro) {
    if (erro instanceof ErroPrecificacao) {
      // MATERIAL_SEM_BOBINA é resolvido só pelo Dono (Configurações do
      // produto ou o questionário de pendências pós-login) — um
      // vendedor ADMIN/OPERADOR batendo nesse erro no meio de um
      // orçamento não tem como resolver sozinho, então a mensagem crua
      // do motor ("Este material não tem nenhuma bobina cadastrada.")
      // vira instrução de quem procurar, não só a constatação do problema.
      if (erro.codigo === "MATERIAL_SEM_BOBINA") {
        return {
          ok: false,
          mensagem:
            "Este produto ainda não tem a largura da bobina configurada — peça pro Dono da gráfica configurar em Catálogo antes de usar em um orçamento.",
        };
      }
      return { ok: false, mensagem: erro.message };
    }
    throw erro;
  }
}
