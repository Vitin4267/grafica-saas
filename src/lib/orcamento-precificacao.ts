import type { Prisma } from "@/generated/prisma/client";
import { calcularPreco } from "@/lib/orcamento";
import { precificar, ErroPrecificacao, aplicarPisoDoPedido, type PedidoPrecificacao } from "@/lib/pricing";
import { carregarContextoPrecificacao, resolverConfigAcabamentos } from "@/lib/pricing/carregar";
import { paraDecimal, type Dec } from "@/lib/pricing/decimal";

type ModeloCalculoPrecificavel =
  | "SIMPLES"
  | "M2"
  | "OFFSET"
  | "FLEXOGRAFIA"
  | "DIGITAL"
  | "SERIGRAFIA"
  | "SUBLIMACAO"
  | "ESTAMPAGEM_QUENTE"
  | "PERSONALIZACAO"
  | "REVENDA"
  | "BORDADO"
  | "TEMPO_MAQUINA"
  | "DTF";

// Os 4 modelos de "setup por peça" — SERIGRAFIA/SUBLIMACAO/ESTAMPAGEM_QUENTE/
// PERSONALIZACAO (achado A3 da auditoria de abrangência: tampografia,
// gravação a laser, DTG, transfer e OUTRO) — REVENDA e os novos BORDADO/
// TEMPO_MAQUINA (achados A4/A6) não têm nesting (sem largura/altura pro
// CUSTO em si), diferente de M2/OFFSET/FLEXOGRAFIA. Usado tanto pra pular a
// guarda de dimensão obrigatória quanto, na montagem do PedidoPrecificacao,
// pra escolher o branch certo.
//
// Achado N4 da auditoria de código (2026-09-04) — DIGITAL SAIU deste
// conjunto: o motor agora faz imposição igual ao Offset (nUp por FormatoFolha
// do papel escolhido), então largura/altura viraram OBRIGATÓRIAS pro CUSTO
// em si, não só pra alimentar um acabamento M2 anexado.
const MODELOS_SEM_NESTING = new Set<ModeloCalculoPrecificavel>([
  "SERIGRAFIA",
  "SUBLIMACAO",
  "ESTAMPAGEM_QUENTE",
  "PERSONALIZACAO",
  "REVENDA",
  "BORDADO",
  "TEMPO_MAQUINA",
]);
const MODELOS_SETUP_POR_PECA = new Set<ModeloCalculoPrecificavel>([
  "SERIGRAFIA",
  "SUBLIMACAO",
  "ESTAMPAGEM_QUENTE",
  "PERSONALIZACAO",
]);

type ItemGraficaParaPrecificacao = {
  id: string;
  modeloCalculo: ModeloCalculoPrecificavel;
  precoVenda: Prisma.Decimal | null;
  // Achado N1 — só relevante pro branch SIMPLES abaixo (ver calcularPreco em
  // src/lib/orcamento.ts). Opcional (em vez de obrigatório) só pra não
  // quebrar os fixtures de teste que montam este objeto à mão sem tocar o
  // banco (orcamento-precificacao.test.ts) — ausente equivale a false, mesmo
  // default do schema.
  simplesCobraPorArea?: boolean;
};

export type DadosItemOrcamento = {
  quantidade: number;
  larguraCm: number | null;
  alturaCm: number | null;
  // Achado A11 da auditoria de abrangência — dimensão do DESENVOLVIMENTO DA
  // FACA (planificação da embalagem aberta), não do produto acabado fechado.
  // Só usadas pelos modelos que fazem nesting/imposição (M2/DTF/OFFSET/
  // FLEXOGRAFIA/DIGITAL) — quando presentes, SUBSTITUEM larguraCm/alturaCm
  // acima na montagem do pedido de nesting; ausentes = comportamento de
  // sempre (usa larguraCm/alturaCm do produto fechado). Nunca entram em
  // nenhum outro cálculo (SIMPLES, setup-por-peça, REVENDA, BORDADO,
  // TEMPO_MAQUINA) — só a geometria de aproveitamento de folha. Opcional
  // (em vez de obrigatório), mesmo padrão de
  // ItemGraficaParaPrecificacao.simplesCobraPorArea acima — só pra não
  // quebrar os fixtures de teste que montam este objeto à mão sem tocar o
  // banco (orcamento-precificacao.test.ts); ausente equivale a null.
  larguraPlanificadaCm?: number | null;
  alturaPlanificadaCm?: number | null;
  corFrente: number | null;
  corVerso: number | null;
  // Só usado pelo motor avançado (M2/OFFSET) — SIMPLES continua com o campo de
  // texto livre OrcamentoItem.acabamento, sem custo (ver src/lib/orcamento.ts).
  acabamentoIds: string[];
  // Papel (matéria-prima) escolhido NESTE orçamento — campo compartilhado por
  // dois motores: clichê de etiqueta (M2 com ConfiguracaoClicheEtiqueta, usa
  // junto com quantidadeCores) e Digital (achado N4, define os FormatoFolha
  // disponíveis pra imposição). custoFaca/custoFrete são R$ livres, por
  // item, independentes do modelo.
  papelId: string | null;
  quantidadeCores: number | null;
  custoFaca: number | null;
  custoFrete: number | null;
  // Achado N8 — só usado por OFFSET: gramatura escolhida NESTE orçamento,
  // sobrepondo ItemGrafica.gramaturaGm2 do produto quando preenchida. papelId
  // acima é reaproveitado como o mesmo override de papel do Offset (nunca
  // coexiste com Digital/etiqueta no mesmo item, modeloCalculo é mutuamente
  // exclusivo) — null = usa a gramatura fixa do produto, comportamento de
  // sempre.
  gramaturaGm2: number | null;
  // Só usado por FLEXOGRAFIA — deliberadamente separado de corFrente/corVerso
  // (semânticos de frente/verso de folha do Offset, lidos em ~20 lugares fora
  // deste escopo).
  numeroCoresFlexo: number | null;
  // Só usado por DIGITAL — override OPCIONAL de cliques POR FOLHA (achado
  // N4: default 1 no motor se ausente; deixe em branco pro sistema calcular
  // pela imposição).
  numeroCliques: number | null;
  // Só usado por SERIGRAFIA/SUBLIMACAO/ESTAMPAGEM_QUENTE/PERSONALIZACAO (os 4
  // compartilham este campo, mesma razão de compartilharem calcularSetupPorPeca).
  numeroSetups: number | null;
  // Só usado por BORDADO (achado A4) — nº de pontos da arte deste pedido,
  // driver de custo POR PEDIDO (diferente de numeroSetups acima, fixo na
  // máquina).
  numeroPontos: number | null;
  // Só usados por TEMPO_MAQUINA (achado A6) — a gráfica escolhe a base na
  // máquina (tempo, metro de corte, ou os dois somados); ambos opcionais e
  // independentes, mas ao menos um precisa estar preenchido (guarda abaixo).
  tempoEstimadoMin: number | null;
  metrosCorte: number | null;
  // Só usado quando o item tem um acabamento anexado com baseCobranca=HORA
  // (ex: instalação, criação de arte) — independente do modeloCalculo do
  // item, ao contrário de numeroSetups acima.
  horasEstimadas: number | null;
  // Só usado por REVENDA (achado A12) — override opcional, POR ORÇAMENTO, do
  // custo de aquisição do fornecedor; null = motor cai no
  // ItemGrafica.precoCompra do catálogo (ver src/lib/pricing/carregar.ts).
  custoAquisicaoUnitario: number | null;
  // Achado B7 (correção de regressão do A2) — quando true, o cliente já
  // trouxe a peça em branco e a gráfica só aplica a estampa/gravação/bordado:
  // zera ContextoDigital/ContextoSetupPorPeca/ContextoBordado.
  // custoSubstratoPorPeca pra este item. Só relevante pra DIGITAL/SERIGRAFIA/
  // SUBLIMACAO/ESTAMPAGEM_QUENTE/PERSONALIZACAO/BORDADO — ignorado (sem
  // efeito) em qualquer outro modelo.
  materialFornecidoPeloCliente: boolean;
  // Achado A7 da auditoria de abrangência — sobrescreve
  // ParametrosGrafica.margemPadrao com Cliente.margemPadraoOverride. Ao
  // contrário dos campos acima (por ITEM), esta é uma propriedade do
  // CLIENTE: constante em todos os itens de um mesmo orçamento, quem chama
  // busca uma vez por Server Action (não por item) e repassa o mesmo valor
  // pra cada calcularItemOrcamento. null = sem override (comportamento de
  // hoje, motor cai no padrão da gráfica — ver ContextoPrecificacao em
  // src/lib/pricing/precificar.ts).
  margemLucroOverride: number | null;
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
      numeroPontos: number | null;
      tempoEstimadoMin: number | null;
      metrosCorte: number | null;
      horasEstimadas: number | null;
      custoAquisicaoUnitario: number | null;
      // Achado N10 — ecoa o valor REALMENTE usado no cálculo
      // (contexto.custoFaca), mesmo padrão de custoAquisicaoUnitario acima.
      // Só populado pra OFFSET por enquanto (escopo do achado): os outros
      // modelos avançados já leem contexto.custoFaca no motor (ver
      // precificar.ts), mas ainda não têm UI/coluna própria — null aqui não
      // significa "não suportado pelo motor", só "não persistido ainda"
      // (ver OrcamentoItem.custoFaca no schema).
      custoFaca: number | null;
      materialFornecidoPeloCliente: boolean;
      breakdown: Prisma.InputJsonValue | null;
      acabamentos: AcabamentoParaGravar[];
      precificacaoEtiqueta: {
        papelId: string;
        quantidadeCores: number;
        custoClicheCalculado: string;
        custoFaca: string | null;
        custoFrete: string | null;
      } | null;
      // Achado N4 — papel (matéria-prima) escolhido pro motor Digital
      // realmente usado no cálculo (contexto.digital só existe quando o
      // motor resolveu o papel com sucesso, mesmo padrão de
      // precificacaoEtiqueta acima). null pra qualquer outro modeloCalculo.
      precificacaoDigital: { papelId: string } | null;
      // Achado N8 — papel/gramatura do motor Offset realmente OVERRIDDEN
      // neste orçamento (contexto.offset.papelIdOverride/gramaturaGm2Override,
      // nunca dados.papelId/dados.gramaturaGm2 crus — mesma proteção de
      // precificacaoEtiqueta/precificacaoDigital acima). null quando o item
      // não é OFFSET OU quando é OFFSET mas nenhum dos dois foi sobrescrito
      // (usa 100% os valores fixos do produto, comportamento de sempre).
      precificacaoOffset: { papelId: string | null; gramaturaGm2: number | null } | null;
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

  // Achado A11 — mesma guarda de largura/altura acima, pra dimensão
  // planificada (desenvolvimento da faca). editarOrcamento/
  // adicionarItemOrcamento leem este campo direto do form (sem zod), então a
  // guarda mora aqui, ponto único por onde todo item passa.
  const larguraPlanificadaCm = dados.larguraPlanificadaCm ?? null;
  const alturaPlanificadaCm = dados.alturaPlanificadaCm ?? null;
  if (
    (larguraPlanificadaCm !== null &&
      (!Number.isFinite(larguraPlanificadaCm) || larguraPlanificadaCm <= 0)) ||
    (alturaPlanificadaCm !== null &&
      (!Number.isFinite(alturaPlanificadaCm) || alturaPlanificadaCm <= 0))
  ) {
    return {
      ok: false,
      mensagem: "Largura e altura planificadas precisam ser maiores que zero.",
    };
  }
  // As duas vêm juntas ou nenhuma — largura planificada sem altura (ou
  // vice-versa) não dá pra montar a geometria de nesting.
  if ((larguraPlanificadaCm !== null) !== (alturaPlanificadaCm !== null)) {
    return {
      ok: false,
      mensagem: "Informe largura e altura planificadas juntas, ou deixe as duas em branco.",
    };
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
  if (
    dados.horasEstimadas !== null &&
    (!Number.isFinite(dados.horasEstimadas) || dados.horasEstimadas <= 0)
  ) {
    return { ok: false, mensagem: "Horas estimadas inválidas (deve ser maior que zero)." };
  }
  if (dados.custoFrete !== null && (!Number.isFinite(dados.custoFrete) || dados.custoFrete < 0)) {
    return { ok: false, mensagem: "Custo de frete inválido." };
  }
  // Achado N8 — mesma razão das guardas acima: editarOrcamento/
  // adicionarItemOrcamento leem este campo direto do FormData, sem zod.
  if (dados.gramaturaGm2 !== null && (!Number.isFinite(dados.gramaturaGm2) || dados.gramaturaGm2 <= 0)) {
    return { ok: false, mensagem: "Gramatura inválida (deve ser maior que zero)." };
  }
  if (
    dados.custoAquisicaoUnitario !== null &&
    (!Number.isFinite(dados.custoAquisicaoUnitario) || dados.custoAquisicaoUnitario < 0)
  ) {
    return { ok: false, mensagem: "Custo de aquisição inválido." };
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

  // Guarda de DIGITAL — nº de cliques (por folha, achado N4) é um override
  // opcional (default 1 no motor), mas quando informado precisa ser um
  // inteiro válido. Mesmo cuidado das guardas acima: precisa vir antes do
  // branch SIMPLES.
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

  // Guarda de BORDADO (achado A4) — nº de pontos é obrigatório (sem
  // default), mesmo padrão do guard de numeroSetups acima.
  if (
    itemGrafica.modeloCalculo === "BORDADO" &&
    (!Number.isInteger(dados.numeroPontos) || (dados.numeroPontos ?? 0) < 1)
  ) {
    return {
      ok: false,
      mensagem: "Informe o número de pontos da arte (mínimo 1) — item de cálculo bordado.",
    };
  }

  // Guarda de TEMPO_MAQUINA (achado A6) — a gráfica escolhe a base na
  // máquina (tempo, metro de corte, ou os dois somados), mas ao menos um
  // precisa estar preenchido, senão o item custaria só o setup/piso da
  // máquina em silêncio (mesmo espírito das guardas acima).
  if (itemGrafica.modeloCalculo === "TEMPO_MAQUINA") {
    if (dados.tempoEstimadoMin === null && dados.metrosCorte === null) {
      return {
        ok: false,
        mensagem:
          "Informe o tempo estimado de máquina (minutos) ou os metros de corte — item de cálculo tempo de máquina.",
      };
    }
    if (
      dados.tempoEstimadoMin !== null &&
      (!Number.isFinite(dados.tempoEstimadoMin) || dados.tempoEstimadoMin <= 0)
    ) {
      return { ok: false, mensagem: "Tempo estimado de máquina inválido (deve ser maior que zero)." };
    }
    if (dados.metrosCorte !== null && (!Number.isFinite(dados.metrosCorte) || dados.metrosCorte <= 0)) {
      return { ok: false, mensagem: "Metros de corte inválidos (deve ser maior que zero)." };
    }
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
      simplesCobraPorArea: itemGrafica.simplesCobraPorArea === true,
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
      numeroPontos: null,
      tempoEstimadoMin: null,
      metrosCorte: null,
      horasEstimadas: null,
      custoAquisicaoUnitario: null,
      custoFaca: null,
      materialFornecidoPeloCliente: false,
      breakdown: null,
      acabamentos: [],
      precificacaoEtiqueta: null,
      precificacaoDigital: null,
      precificacaoOffset: null,
    };
  }

  // Motor avançado M2/OFFSET/FLEXOGRAFIA/DIGITAL (achado N4) exige dimensões
  // reais da peça (usadas pro nesting/imposição). Os 3 de setup-por-peça,
  // REVENDA, BORDADO e TEMPO_MAQUINA NÃO têm nesting — largura/altura são
  // opcionais pra eles (ver PedidoSetupPorPeca etc. em
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
        : undefined,
      // Achado N4 — mesmo papelId acima, reaproveitado pro motor Digital
      // (não precisa de quantidadeCores, diferente da etiqueta).
      itemGrafica.modeloCalculo === "DIGITAL" && dados.papelId
        ? { papelId: dados.papelId }
        : undefined,
      // Achado N8 — mesmo papelId acima, reaproveitado pro motor Offset como
      // override opcional (o produto já tem papel/gramatura fixos em
      // Catálogo, exigidos como fallback dentro de carregarContextoPrecificacao
      // — nunca undefined ali). papelId e gramaturaGm2 são independentes um
      // do outro: só monta o objeto quando ao menos um dos dois veio.
      itemGrafica.modeloCalculo === "OFFSET" && (dados.papelId || dados.gramaturaGm2 !== null)
        ? {
            papelId: dados.papelId ?? undefined,
            gramaturaGm2: dados.gramaturaGm2 ?? undefined,
          }
        : undefined
    );
    if (dados.custoFrete !== null) contexto.custoFreteEstimado = dados.custoFrete;
    if (dados.custoFaca !== null) contexto.custoFaca = dados.custoFaca;
    if (dados.horasEstimadas !== null) contexto.horasEstimadas = dados.horasEstimadas;
    // REVENDA: carregarContextoPrecificacao já preencheu contexto.revenda a
    // partir do ItemGrafica.precoCompra (default do catálogo) — sobrescreve
    // aqui só quando o orçamento informou um custo de aquisição próprio
    // (mesmo padrão de horasEstimadas acima).
    if (dados.custoAquisicaoUnitario !== null) {
      contexto.revenda = { custoAquisicaoUnitario: dados.custoAquisicaoUnitario };
    }
    // Achado A7 — margem diferenciada do CLIENTE (não confundir com a
    // margem padrão da gráfica em contexto.parametros.margemPadrao, que
    // carregarContextoPrecificacao já preencheu). Mesmo padrão de
    // custoAquisicaoUnitario acima: só sobrescreve quando quem chamou
    // efetivamente resolveu um valor (Cliente.margemPadraoOverride
    // preenchido) — null preserva o comportamento de hoje.
    if (dados.margemLucroOverride !== null) contexto.margemLucroOverride = dados.margemLucroOverride;
    // Achado B7 (correção de regressão do A2) — "material fornecido pelo
    // cliente": o cliente já trouxe a peça em branco, a gráfica só aplica a
    // estampa/gravação/bordado. Zera o substrato do contexto que estiver
    // ativo (DIGITAL, um dos 4 de setup-por-peça, ou BORDADO — achado A4) —
    // nunca contexto.revenda, onde o "custo de aquisição" É o produto
    // inteiro, não um substrato aplicado; nunca contexto.tempoMaquina, que
    // não tem substrato nenhum (achado A6).
    if (dados.materialFornecidoPeloCliente) {
      if (contexto.digital) {
        contexto.digital = {
          ...contexto.digital,
          custoPorFolha: 0,
          materialFornecidoPeloCliente: true,
        };
      }
      if (contexto.setupPorPeca) {
        contexto.setupPorPeca = { ...contexto.setupPorPeca, custoSubstratoPorPeca: 0 };
      }
      if (contexto.bordado) {
        contexto.bordado = {
          ...contexto.bordado,
          custoSubstratoPorPeca: 0,
          materialFornecidoPeloCliente: true,
        };
      }
    }

    const acabamentos =
      dados.acabamentoIds.length > 0
        ? await resolverConfigAcabamentos(dados.acabamentoIds, graficaId)
        : [];

    // DIGITAL e os 3 de setup-por-peça não exigem largura/altura (guarda
    // acima pulou essa checagem pra eles) — mas se o produto tiver um
    // acabamento anexado com baseCobranca=M2 ou METRO_LINEAR, esse
    // acabamento precisa de largura×altura pra não custar R$0 silenciosamente
    // (calcularQtdBase multiplicaria por 0 — METRO_LINEAR deriva o perímetro
    // da mesma geometria que M2 usa, ver ctxAcabamentoExtra em
    // precificar.ts). Bloqueia aqui, com mensagem clara, em vez de deixar
    // passar.
    if (
      MODELOS_SEM_NESTING.has(itemGrafica.modeloCalculo) &&
      (!larguraCm || !alturaCm) &&
      acabamentos.some((a) => a.baseCobranca === "M2" || a.baseCobranca === "METRO_LINEAR")
    ) {
      return {
        ok: false,
        mensagem:
          "Este item tem um acabamento cobrado por m² ou por metro linear — informe largura e altura pra calcular o custo desse acabamento corretamente.",
      };
    }

    // Acabamento cobrado por HORA precisa de OrcamentoItem.horasEstimadas —
    // diferente de M2/METRO_LINEAR acima, não dá pra derivar de geometria
    // nenhuma, então a guarda aqui não depende de largura/altura.
    if (acabamentos.some((a) => a.baseCobranca === "HORA") && dados.horasEstimadas === null) {
      return {
        ok: false,
        mensagem:
          "Este item tem um acabamento cobrado por hora — informe a estimativa de horas pra calcular o custo desse acabamento.",
      };
    }

    // Os 3 de setup-por-peça/REVENDA/BORDADO/TEMPO_MAQUINA: largura/altura são
    // opcionais (guarda acima já garantiu que, se ausentes, nenhum acabamento
    // M2-based está anexado) — undefined quando não informadas, nunca uma
    // divisão por um null. DIGITAL (achado N4) NÃO usa isto — a guarda de
    // dimensão obrigatória já garantiu larguraCm/alturaCm presentes pra ele.
    const larguraMOpcional = larguraCm !== null ? larguraCm / 100 : undefined;
    const alturaMOpcional = alturaCm !== null ? alturaCm / 100 : undefined;

    // Achado A11 — os modelos com nesting/imposição (OFFSET/FLEXOGRAFIA/
    // DIGITAL/DTF/M2, únicos que chegam a este ponto do código usando
    // larguraCm!/alturaCm! puros) preferem a dimensão PLANIFICADA (o
    // desenvolvimento da faca, a peça aberta que de fato ocupa a folha)
    // quando o item informou — cai em larguraCm/alturaCm do produto acabado
    // fechado quando não. A guarda de dimensão obrigatória acima já garantiu
    // larguraCm/alturaCm não-nulos pra estes modelos, e a guarda logo acima
    // já garantiu que planificada vem com as duas ou nenhuma.
    const larguraNestingCm = larguraPlanificadaCm ?? larguraCm!;
    const alturaNestingCm = alturaPlanificadaCm ?? alturaCm!;

    let pedido: PedidoPrecificacao;
    if (itemGrafica.modeloCalculo === "OFFSET") {
      pedido = {
        tipo: "OFFSET",
        pedido: {
          larguraM: larguraNestingCm / 100,
          alturaM: alturaNestingCm / 100,
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
          larguraM: larguraNestingCm / 100,
          alturaM: alturaNestingCm / 100,
          quantidade,
          numeroCores: dados.numeroCoresFlexo!,
        },
        acabamentos,
      };
    } else if (itemGrafica.modeloCalculo === "DIGITAL") {
      // Achado N4 — larguraCm/alturaCm são garantidos não-null aqui (guarda
      // de dimensão obrigatória acima, DIGITAL saiu de MODELOS_SEM_NESTING).
      pedido = {
        tipo: "DIGITAL",
        pedido: {
          quantidade,
          numeroCliques: dados.numeroCliques ?? undefined,
          larguraM: larguraNestingCm / 100,
          alturaM: alturaNestingCm / 100,
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
    } else if (itemGrafica.modeloCalculo === "PERSONALIZACAO") {
      pedido = {
        tipo: "PERSONALIZACAO",
        pedido: {
          quantidade,
          numeroSetups: dados.numeroSetups!,
          larguraM: larguraMOpcional,
          alturaM: alturaMOpcional,
        },
        acabamentos,
      };
    } else if (itemGrafica.modeloCalculo === "REVENDA") {
      pedido = {
        tipo: "REVENDA",
        pedido: {
          quantidade,
          larguraM: larguraMOpcional,
          alturaM: alturaMOpcional,
        },
        acabamentos,
      };
    } else if (itemGrafica.modeloCalculo === "BORDADO") {
      pedido = {
        tipo: "BORDADO",
        pedido: {
          quantidade,
          numeroPontos: dados.numeroPontos!,
          larguraM: larguraMOpcional,
          alturaM: alturaMOpcional,
        },
        acabamentos,
      };
    } else if (itemGrafica.modeloCalculo === "TEMPO_MAQUINA") {
      pedido = {
        tipo: "TEMPO_MAQUINA",
        pedido: {
          quantidade,
          tempoEstimadoMin: dados.tempoEstimadoMin ?? undefined,
          metrosCorte: dados.metrosCorte ?? undefined,
          larguraM: larguraMOpcional,
          alturaM: alturaMOpcional,
        },
        acabamentos,
      };
    } else if (itemGrafica.modeloCalculo === "DTF") {
      // Achado A5 — mesmo PedidoM2 do branch M2 abaixo (DTF reaproveita o
      // mesmo motor calcularM2, ver carregarContextoPrecificacao); só o
      // discriminante de tipo muda, pra ecoar 1:1 o modeloCalculo do produto.
      pedido = {
        tipo: "DTF",
        pedido: {
          larguraM: larguraNestingCm / 100,
          alturaM: alturaNestingCm / 100,
          quantidade,
        },
        acabamentos,
      };
    } else {
      pedido = {
        tipo: "M2",
        pedido: {
          larguraM: larguraNestingCm / 100,
          alturaM: alturaNestingCm / 100,
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
      numeroPontos: itemGrafica.modeloCalculo === "BORDADO" ? dados.numeroPontos! : null,
      // Ecoa o valor de entrada como veio — TEMPO_MAQUINA aceita os dois
      // campos independentes (a guarda acima já garantiu que ao menos um
      // está presente).
      tempoEstimadoMin: itemGrafica.modeloCalculo === "TEMPO_MAQUINA" ? dados.tempoEstimadoMin : null,
      metrosCorte: itemGrafica.modeloCalculo === "TEMPO_MAQUINA" ? dados.metrosCorte : null,
      // Não é model-gated como numeroSetups acima — acabamento por hora pode
      // ser anexado a qualquer motor avançado. Ecoa o valor validado (guarda
      // já garantiu presença quando há acabamento HORA anexado).
      horasEstimadas: dados.horasEstimadas,
      // Ecoa o valor REALMENTE usado no cálculo (contexto.revenda, já
      // resolvido com o fallback pro precoCompra do catálogo quando o
      // orçamento não informou um override) — mesma razão de numeroCliques
      // acima, nunca dados.custoAquisicaoUnitario cru.
      custoAquisicaoUnitario:
        itemGrafica.modeloCalculo === "REVENDA" ? contexto.revenda!.custoAquisicaoUnitario : null,
      // Achado N10 — ecoa o valor REALMENTE usado no cálculo
      // (contexto.custoFaca, já mutado logo acima a partir de
      // dados.custoFaca quando informado), mesmo padrão de
      // custoAquisicaoUnitario acima. Model-gated pra OFFSET só porque é o
      // escopo deste achado — OrcamentoItem.custoFaca no schema não tem
      // esse gate, então estender pra outro modelo no futuro não precisa de
      // migration nova, só soltar esta condição.
      custoFaca: itemGrafica.modeloCalculo === "OFFSET" ? (contexto.custoFaca ?? null) : null,
      // Ecoa o valor de entrada como veio — não há fallback/resolução
      // nenhuma pra este campo (diferente de custoAquisicaoUnitario acima),
      // é usado direto pra decidir se zera o substrato.
      materialFornecidoPeloCliente: dados.materialFornecidoPeloCliente,
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
      // Achado N4 — mesma lógica de precificacaoEtiqueta acima: usa
      // contexto.digital (nunca dados.papelId truthy sozinho) como fonte de
      // verdade, protege contra um papelId adulterado/de outro modelo — se o
      // motor não resolveu o papel de verdade, não gravamos nada.
      precificacaoDigital: contexto.digital ? { papelId: dados.papelId! } : null,
      // Achado N8 — diferente de precificacaoEtiqueta/precificacaoDigital
      // acima, contexto.offset está SEMPRE presente pra um item OFFSET (é o
      // branch principal do motor, não uma feature opcional anexada) — então
      // a fonte de verdade de "houve override" são os campos
      // papelIdOverride/gramaturaGm2Override, que carregarContextoPrecificacao
      // só preenche quando dadosOffset foi de fato aplicado com sucesso.
      precificacaoOffset:
        itemGrafica.modeloCalculo === "OFFSET" &&
        (contexto.offset?.papelIdOverride !== undefined || contexto.offset?.gramaturaGm2Override !== undefined)
          ? {
              papelId: contexto.offset?.papelIdOverride ?? null,
              gramaturaGm2: contexto.offset?.gramaturaGm2Override ?? null,
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

// Achado N3 da auditoria de abrangência — ponto ÚNICO que recalcula e grava
// Orcamento.total a partir da soma dos itens da opção-base (opcaoId: null),
// aplicando o piso de pedido (ParametrosGrafica.pedidoMinimo) uma vez sobre
// a SOMA, nunca por item (ver aplicarPisoDoPedido em src/lib/pricing/compor.ts
// e o comentário em comporPreco, que não conhece mais pedidoMinimo).
// Reaproveitado por editarOrcamento/adicionarItemOrcamento/
// removerItemOrcamento/aplicarDescontoItemOrcamento (src/app/orcamento/[id]/
// actions.ts) — os 4 pontos que hoje reagregam o total depois de mexer nos
// itens da opção-base. Sempre chamado DENTRO da mesma transação Serializable
// que alterou os itens, pra nunca gravar um total que já ficou stale.
export async function recalcularTotalOrcamento(
  tx: Prisma.TransactionClient,
  orcamentoId: string,
  graficaId: string
): Promise<Dec> {
  const [agregado, parametros] = await Promise.all([
    tx.orcamentoItem.aggregate({
      where: { orcamentoId, opcaoId: null },
      _sum: { precoTotal: true },
    }),
    tx.parametrosGrafica.findUnique({
      where: { graficaId },
      select: { pedidoMinimo: true, incrementoArredondamento: true },
    }),
  ]);

  const somaItens = paraDecimal((agregado._sum.precoTotal ?? 0).toString());
  const pedidoMinimo = paraDecimal(parametros?.pedidoMinimo.toString() ?? "0");
  // Fallback igual ao default da coluna (ParametrosGrafica.incrementoArredondamento
  // @default(0.10)) — só usado se por algum motivo a gráfica não tiver linha
  // de ParametrosGrafica ainda (nunca deveria acontecer em produção).
  const incremento = paraDecimal(parametros?.incrementoArredondamento.toString() ?? "0.10");
  const total = aplicarPisoDoPedido(somaItens, pedidoMinimo, incremento);

  await tx.orcamento.update({ where: { id: orcamentoId }, data: { total: total.toFixed(2) } });
  return total;
}
