import type { Prisma } from "@/generated/prisma/client";
import { calcularPreco } from "@/lib/orcamento";
import { precificar, ErroPrecificacao, type PedidoPrecificacao } from "@/lib/pricing";
import { carregarContextoPrecificacao, resolverConfigAcabamentos } from "@/lib/pricing/carregar";

type ItemGraficaParaPrecificacao = {
  id: string;
  modeloCalculo: "SIMPLES" | "M2" | "OFFSET";
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
      modeloCalculo: "SIMPLES" | "M2" | "OFFSET";
      corFrente: number | null;
      corVerso: number | null;
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
      breakdown: null,
      acabamentos: [],
      precificacaoEtiqueta: null,
    };
  }

  // Motor avançado (M2/OFFSET): exige dimensões reais da peça.
  if (!larguraCm || !alturaCm) {
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

    const pedido: PedidoPrecificacao =
      itemGrafica.modeloCalculo === "OFFSET"
        ? {
            tipo: "OFFSET",
            pedido: {
              larguraM: larguraCm / 100,
              alturaM: alturaCm / 100,
              quantidade,
              corFrente: corFrente!,
              corVerso: corVerso!,
            },
            acabamentos,
          }
        : {
            tipo: "M2",
            pedido: {
              larguraM: larguraCm / 100,
              alturaM: alturaCm / 100,
              quantidade,
            },
            acabamentos,
          };

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
      return { ok: false, mensagem: erro.message };
    }
    throw erro;
  }
}
