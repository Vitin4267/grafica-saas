import "server-only";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import type { OrigemPrevisao } from "@/generated/prisma/enums";
import { D, paraDecimal, type Dec } from "@/lib/pricing/decimal";

// Congela, no momento em que um Orcamento é aprovado (autenticado em
// src/app/orcamento/[id]/actions.ts OU pelo link público em
// src/app/o/[token]/actions.ts — os dois chamam exatamente as duas funções
// deste módulo, pra nunca divergir), os três snapshots de Pedido
// (precoSugeridoTotal/valorNegociadoTotal/custoPrevistoTotal) e a previsão
// de custo por categoria (PedidoCustoPrevisto) — ver fase-custo-real.md
// §2.3, §3.1. Nada aqui é recalculado depois: reajustar o preço de uma
// matéria-prima ou editar a ficha técnica após a aprovação nunca altera o
// que já foi gravado (mesmo princípio do preço travado do orçamento).

const CATEGORIA_CHAPAS_NOME = "Clichê";
const CATEGORIA_IMPRESSAO_NOME = "Impressão";

// Ficha técnica anexada a um item (produto OU serviço de acabamento) — mesma
// forma nos dois casos, reaproveitada abaixo pra não duplicar o `select`.
const SELECT_FICHA_TECNICA = {
  varianteId: true,
  quantidadePorUnidade: true,
  materiaPrima: {
    select: { precoCompra: true, categoriaCustoId: true, perdaFixaPadrao: true },
  },
  variante: { select: { precoCompra: true, perdaFixaPadrao: true } },
} as const;

type ItemParaPrevisao = Prisma.OrcamentoItemGetPayload<{
  select: {
    quantidade: true;
    precoTotal: true;
    precoSugeridoUnitario: true;
    modeloCalculo: true;
    breakdown: true;
    itemGrafica: {
      select: {
        categoriaCustoId: true;
        itemCatalogo: { select: { nome: true } };
        papel: { select: { categoriaCustoId: true } };
        fichaTecnica: { select: typeof SELECT_FICHA_TECNICA };
      };
    };
    // Acabamentos anexados ao item (ex: laminação) — a previsão soma
    // também a ficha técnica do SERVIÇO, com `qtdBase` como multiplicador
    // (ver comentário em calcularPrevisaoAprovacaoPedido abaixo). Vale pra
    // item SIMPLES e M2/OFFSET igual: acabamento é dimensão ortogonal ao
    // modeloCalculo do produto principal.
    acabamentos: {
      select: {
        qtdBase: true;
        itemGrafica: { select: { fichaTecnica: { select: typeof SELECT_FICHA_TECNICA } } };
      };
    };
  };
}>;

async function buscarItensParaPrevisao(
  orcamentoId: string,
  opcaoId: string | null
): Promise<ItemParaPrevisao[]> {
  return prisma.orcamentoItem.findMany({
    where: { orcamentoId, opcaoId },
    select: {
      quantidade: true,
      precoTotal: true,
      precoSugeridoUnitario: true,
      modeloCalculo: true,
      breakdown: true,
      itemGrafica: {
        select: {
          categoriaCustoId: true,
          itemCatalogo: { select: { nome: true } },
          papel: { select: { categoriaCustoId: true } },
          fichaTecnica: { select: SELECT_FICHA_TECNICA },
        },
      },
      acabamentos: {
        select: {
          qtdBase: true,
          itemGrafica: { select: { fichaTecnica: { select: SELECT_FICHA_TECNICA } } },
        },
      },
    },
  });
}

// Resolve a categoria de custo de cada componente em cascata: categoria
// específica do material/matéria-prima → categoria padrão da gráfica
// (ParametrosGrafica.categoriaCustoConsumoPadraoId) → primeira categoria
// ativa cadastrada (mesmo fallback de 3 níveis usado pelo custo automático
// de consumo em src/app/producao/status-transicao.ts, pra não divergir de
// comportamento entre previsão e custo real). `porNome` é usado só pelos
// componentes chapas/rodagem+setup do motor Offset (ver componentesCustoBreakdown).
type ResolutorCategoria = {
  padrao: string | null;
  porNome: (nome: string) => string | null;
};

async function montarResolutorCategoria(graficaId: string): Promise<ResolutorCategoria> {
  const [parametros, categoriasAtivas] = await Promise.all([
    prisma.parametrosGrafica.findUnique({
      where: { graficaId },
      select: { categoriaCustoConsumoPadraoId: true },
    }),
    prisma.categoriaCusto.findMany({
      where: { graficaId, ativa: true },
      orderBy: { ordem: "asc" },
      select: { id: true, nome: true },
    }),
  ]);

  const primeiraAtiva = categoriasAtivas[0]?.id ?? null;
  const padrao = parametros?.categoriaCustoConsumoPadraoId ?? primeiraAtiva;
  const porNomeMap = new Map(categoriasAtivas.map((c) => [c.nome, c.id]));

  return { padrao, porNome: (nome) => porNomeMap.get(nome) ?? null };
}

function lerDecimalDeJson(valor: unknown): Dec | null {
  if (typeof valor === "string" || typeof valor === "number") {
    if (typeof valor === "number" && !Number.isFinite(valor)) return null;
    try {
      const dec = new D(valor);
      return dec.isFinite() ? dec : null;
    } catch {
      return null;
    }
  }
  return null;
}

type ComponenteCusto = { chave: "material" | "chapas" | "impressao"; valor: Dec };

// Extrai os componentes de custo do breakdown salvo por precificar() (ver
// src/lib/pricing/precificar.ts e compor.ts) — a árvore gravada é
// { detalhes: { material, chapas?, rodagem?, setup?, ... }, metricas: {...} },
// sempre com Decimal serializado (via toJSON) como STRING em `detalhes` e
// como NUMBER puro em `metricas` (já convertido com .toNumber() antes de
// montar o objeto).
//
// M2: comporPreco() é chamado SEM detalhesExtras pro modelo M2 — então
// detalhes.material já é custoMaterial + custoImpressao SOMADOS (não dá pra
// separar por ali). A separação por categoria (bobina vs. impressão) só é
// possível lendo metricas.custoMaterial/custoImpressao, que o motor grava à
// parte só pra auditoria (ver ResultadoM2 em src/lib/pricing/m2.ts). Sem
// esses dois campos (breakdown antigo/malformado), cai num único componente
// "material" com o total — nunca inventa um split que não dá pra sustentar.
//
// OFFSET: detalhes.material é o custoBase INTEIRO (papel + chapas + rodagem
// + setup somados — ver calcularOffset()), não só o papel. O papel isolado
// é obtido por subtração: material − chapas − rodagem − setup.
//
// FLEXOGRAFIA: não tem conceito de "chapas" no breakdown (sem clichê pra
// isolar), então detalhes.material já é só o custo de material — sem
// subtração nenhuma. rodagem/setup lidos igual ao branch OFFSET.
//
// DIGITAL: detalhes.material é custoCliques + custoSubstrato SOMADOS (mesmo
// motivo do M2 — comporPreco() sempre grava o custoBase inteiro em
// `material`); detalhes.setup carrega só custoCliques (ver detalhesExtras em
// precificar.ts), então o substrato isolado é material − setup.
//
// SERIGRAFIA/SUBLIMACAO/ESTAMPAGEM_QUENTE: sem conceito de material/substrato
// — MaquinaSetupPorPeca não tem custo de matéria-prima, só custo de máquina
// (setup fixo + variável por peça, ver src/lib/pricing/setup-por-peca.ts).
// custoBase inteiro cai em "impressao", nunca em "material".
function componentesCustoBreakdown(
  breakdown: Prisma.JsonValue,
  modeloCalculo: "M2" | "OFFSET" | "FLEXOGRAFIA" | "DIGITAL" | "SERIGRAFIA" | "SUBLIMACAO" | "ESTAMPAGEM_QUENTE"
): ComponenteCusto[] | null {
  if (!breakdown || typeof breakdown !== "object" || Array.isArray(breakdown)) return null;
  const raiz = breakdown as Record<string, unknown>;
  const detalhesRaw = raiz.detalhes;
  if (!detalhesRaw || typeof detalhesRaw !== "object") return null;
  const detalhes = detalhesRaw as Record<string, unknown>;

  const materialTotal = lerDecimalDeJson(detalhes.material);
  if (!materialTotal) return null;

  if (modeloCalculo === "M2") {
    const metricasRaw = raiz.metricas;
    const metricas =
      metricasRaw && typeof metricasRaw === "object" ? (metricasRaw as Record<string, unknown>) : null;
    const custoMaterial = metricas ? lerDecimalDeJson(metricas.custoMaterial) : null;
    const custoImpressao = metricas ? lerDecimalDeJson(metricas.custoImpressao) : null;

    if (custoMaterial && custoImpressao) {
      const componentes: ComponenteCusto[] = [];
      if (custoMaterial.gt(0)) componentes.push({ chave: "material", valor: custoMaterial });
      if (custoImpressao.gt(0)) componentes.push({ chave: "impressao", valor: custoImpressao });
      return componentes;
    }
    return materialTotal.gt(0) ? [{ chave: "material", valor: materialTotal }] : [];
  }

  if (modeloCalculo === "FLEXOGRAFIA") {
    const rodagem = lerDecimalDeJson(detalhes.rodagem) ?? paraDecimal(0);
    const setup = lerDecimalDeJson(detalhes.setup) ?? paraDecimal(0);

    const componentes: ComponenteCusto[] = [];
    if (materialTotal.gt(0)) componentes.push({ chave: "material", valor: materialTotal });
    const impressao = rodagem.plus(setup);
    if (impressao.gt(0)) componentes.push({ chave: "impressao", valor: impressao });
    return componentes;
  }

  if (modeloCalculo === "DIGITAL") {
    const custoCliques = lerDecimalDeJson(detalhes.setup) ?? paraDecimal(0);
    const custoSubstrato = materialTotal.minus(custoCliques);

    const componentes: ComponenteCusto[] = [];
    if (custoSubstrato.gt(0)) componentes.push({ chave: "material", valor: custoSubstrato });
    if (custoCliques.gt(0)) componentes.push({ chave: "impressao", valor: custoCliques });
    return componentes;
  }

  if (modeloCalculo === "SERIGRAFIA" || modeloCalculo === "SUBLIMACAO" || modeloCalculo === "ESTAMPAGEM_QUENTE") {
    return materialTotal.gt(0) ? [{ chave: "impressao", valor: materialTotal }] : [];
  }

  // OFFSET
  const chapas = lerDecimalDeJson(detalhes.chapas) ?? paraDecimal(0);
  const rodagem = lerDecimalDeJson(detalhes.rodagem) ?? paraDecimal(0);
  const setup = lerDecimalDeJson(detalhes.setup) ?? paraDecimal(0);
  const papel = materialTotal.minus(chapas).minus(rodagem).minus(setup);

  const componentes: ComponenteCusto[] = [];
  if (papel.gt(0)) componentes.push({ chave: "material", valor: papel });
  if (chapas.gt(0)) componentes.push({ chave: "chapas", valor: chapas });
  const impressao = rodagem.plus(setup);
  if (impressao.gt(0)) componentes.push({ chave: "impressao", valor: impressao });
  return componentes;
}

export type LinhaPrevisaoCusto = {
  categoriaCustoId: string;
  valor: string; // Decimal(12,2), já arredondado
  origem: OrigemPrevisao;
  detalhe: string;
};

export type PrevisaoAprovacaoPedido = {
  aprovadoEm: Date;
  precoSugeridoTotal: string | null;
  valorNegociadoTotal: string;
  custoPrevistoTotal: string | null;
  linhas: LinhaPrevisaoCusto[];
  // Nomes/motivos dos itens que NÃO entraram na previsão (SIMPLES sem ficha
  // técnica, ficha técnica sem nenhuma matéria-prima com preço cadastrado,
  // ou breakdown do motor ausente/corrompido). Só informativo nesta fase —
  // custoPrevistoTotal===null já é o sinal formal de "previsão parcial" (ver
  // comentário abaixo). Não é persistido: a tela de fechamento (PR-5) deve
  // recalcular a lista NA HORA de exibir (mesma checagem: item SIMPLES sem
  // FichaTecnicaItem, ou com ficha técnica mas nenhuma matéria-prima com
  // precoCompra cadastrado), porque o que falta pode ter sido corrigido
  // depois da aprovação (a gráfica cadastrou a ficha técnica na semana
  // seguinte) — mostrar o estado ATUAL é mais acionável pro usuário do que
  // um snapshot congelado do que faltava no dia da aprovação. Devolvido aqui
  // só pra decidir custoPrevistoTotal e pra quem chamar logar/depurar.
  itensSemPrevisao: string[];
};

// Calcula (SEM gravar nada) a previsão de custo por categoria de um
// orçamento — chamado FORA da transação de aprovação, mesmo cuidado já
// aplicado ao cálculo de comissão nos dois pontos de aprovação (ficha de
// custo não muda por causa de uma corrida desta leitura, então não precisa
// participar da transação Serializable; mantém ela curta).
// opcaoId: qual conjunto de itens usar quando o orçamento tem múltiplas
// opções (ver src/lib/orcamento-opcoes.ts) — null pra opção-base (Opção A,
// caso de sempre) ou o id da OrcamentoOpcao que o cliente escolheu. Quem
// chama já resolveu essa escolha ANTES de chegar aqui (ver
// resolverOpcoesNaAprovacao, chamado antes na mesma transação de aprovação);
// esta função só lê, nunca decide.
export async function calcularPrevisaoAprovacaoPedido(
  orcamentoId: string,
  graficaId: string,
  agora: Date = new Date(),
  opcaoId: string | null = null
): Promise<PrevisaoAprovacaoPedido> {
  const [itens, resolutor] = await Promise.all([
    buscarItensParaPrevisao(orcamentoId, opcaoId),
    montarResolutorCategoria(graficaId),
  ]);

  // precoSugeridoUnitario (PR-6, preço sugerido vs. negociado) ainda não é
  // preenchido por nenhuma tela hoje — soma fica null sempre que NENHUM item
  // tiver o campo preenchido, o que é o caso normal por enquanto (ver
  // fase-custo-real.md §2.4). valorNegociadoTotal usa precoTotal, que SEMPRE
  // existe (é o valor vendido de hoje, travado desde sempre).
  let precoSugeridoTotal: Dec | null = null;
  let valorNegociadoTotal = paraDecimal(0);
  for (const item of itens) {
    valorNegociadoTotal = valorNegociadoTotal.plus(paraDecimal(item.precoTotal.toString()));
    if (item.precoSugeridoUnitario !== null) {
      const parcial = paraDecimal(item.precoSugeridoUnitario.toString()).times(item.quantidade);
      precoSugeridoTotal = (precoSugeridoTotal ?? paraDecimal(0)).plus(parcial);
    }
  }

  const porCategoria = new Map<string, { valor: Dec; origem: OrigemPrevisao; detalhes: string[] }>();
  const itensSemPrevisao: string[] = [];

  function acumular(categoriaCustoId: string | null, valor: Dec, origem: OrigemPrevisao, detalhe: string): boolean {
    if (!categoriaCustoId || valor.lte(0)) return false;
    const existente = porCategoria.get(categoriaCustoId);
    if (existente) {
      existente.valor = existente.valor.plus(valor);
      // MOTOR_PRECIFICACAO tem prioridade de rotulagem sobre FICHA_TECNICA
      // quando a MESMA categoria recebe contribuição dos dois métodos no
      // mesmo pedido (ex: um item Offset e um item Simples caindo os dois em
      // "Papel") — dado do motor é mais rico/auditável, então a origem
      // exibida reflete a fonte "melhor", mesmo a soma incluindo as duas.
      if (existente.origem !== "MOTOR_PRECIFICACAO") existente.origem = origem;
      existente.detalhes.push(detalhe);
    } else {
      porCategoria.set(categoriaCustoId, { valor, origem, detalhes: [detalhe] });
    }
    return true;
  }

  for (const item of itens) {
    const nomeItem = item.itemGrafica.itemCatalogo.nome;

    // Acabamentos anexados (ex: laminação) — somados ANTES do bloco
    // SIMPLES/M2/OFFSET abaixo, que termina em `continue` pro caso SIMPLES:
    // acabamento é ortogonal ao modeloCalculo do produto principal, então
    // roda pra todo item, não só SIMPLES. Mesma fórmula do bloco SIMPLES
    // logo abaixo (quantidadePorUnidade × qtdBase do acabamento + perdaFixa
    // aplicável, uma vez só) × precoCompra — só que o multiplicador é
    // `acabamento.qtdBase` (snapshot da base de cobrança do acabamento), não
    // `item.quantidade`. Aditivo por natureza: acabamento sem ficha técnica
    // cadastrada (o caso mais comum ainda) não contribui em nada e NÃO entra
    // em itensSemPrevisao — a ausência de dado opcional não é uma lacuna do
    // item, ao contrário de um produto SIMPLES sem ficha técnica nenhuma.
    for (const acabamento of item.acabamentos) {
      for (const ficha of acabamento.itemGrafica.fichaTecnica) {
        const precoCompra = ficha.varianteId ? (ficha.variante?.precoCompra ?? null) : ficha.materiaPrima.precoCompra;
        if (precoCompra === null) continue; // sem preço cadastrado — não inventa custo

        const perdaFixa = ficha.varianteId ? ficha.variante?.perdaFixaPadrao : ficha.materiaPrima.perdaFixaPadrao;
        const quantidade = paraDecimal(ficha.quantidadePorUnidade.toString())
          .times(acabamento.qtdBase.toString())
          .plus(perdaFixa ? paraDecimal(perdaFixa.toString()) : 0);
        const valor = quantidade.times(paraDecimal(precoCompra.toString()));

        const categoriaId = ficha.materiaPrima.categoriaCustoId ?? resolutor.padrao;
        acumular(categoriaId, valor, "FICHA_TECNICA", `${nomeItem} — acabamento (ficha técnica)`);
      }
    }

    if (item.modeloCalculo === "SIMPLES") {
      const fichaTecnica = item.itemGrafica.fichaTecnica;
      if (fichaTecnica.length === 0) {
        itensSemPrevisao.push(`${nomeItem} (sem ficha técnica cadastrada)`);
        continue;
      }

      let contribuiu = false;
      for (const ficha of fichaTecnica) {
        const precoCompra = ficha.varianteId ? (ficha.variante?.precoCompra ?? null) : ficha.materiaPrima.precoCompra;
        if (precoCompra === null) continue; // sem preço cadastrado — não inventa custo (mesmo princípio de snapshotCustoFicha)

        const perdaFixa = ficha.varianteId ? ficha.variante?.perdaFixaPadrao : ficha.materiaPrima.perdaFixaPadrao;
        // Perda fixa de calibragem é FIXA por passagem em produção, não
        // escala com a quantidade do pedido (mesmo princípio de
        // ItemGrafica.perdaFixaPadrao — ver comentário no schema e
        // status-transicao.ts) — soma-se UMA vez, fora da multiplicação por
        // item.quantidade.
        const quantidade = paraDecimal(ficha.quantidadePorUnidade.toString())
          .times(item.quantidade)
          .plus(perdaFixa ? paraDecimal(perdaFixa.toString()) : 0);
        const valor = quantidade.times(paraDecimal(precoCompra.toString()));

        const categoriaId = ficha.materiaPrima.categoriaCustoId ?? resolutor.padrao;
        const gravou = acumular(categoriaId, valor, "FICHA_TECNICA", `${nomeItem} — ficha técnica`);
        if (gravou) contribuiu = true;
      }
      if (!contribuiu) {
        itensSemPrevisao.push(`${nomeItem} (ficha técnica sem matéria-prima com preço de compra cadastrado)`);
      }
      continue;
    }

    // M2, OFFSET, FLEXOGRAFIA, DIGITAL ou setup-por-peça (SERIGRAFIA/
    // SUBLIMACAO/ESTAMPAGEM_QUENTE)
    const componentes = item.breakdown ? componentesCustoBreakdown(item.breakdown, item.modeloCalculo) : null;
    if (!componentes) {
      itensSemPrevisao.push(`${nomeItem} (breakdown do motor de precificação ausente ou inválido)`);
      continue;
    }

    let contribuiu = false;
    for (const componente of componentes) {
      let categoriaId: string | null;
      let rotulo: string;
      if (componente.chave === "material") {
        // Offset referencia a matéria-prima (papel) usada — a categoria dela
        // é a fonte certa. M2 não tem esse vínculo formal ainda (o próprio
        // ItemGrafica do PRODUTO representa o material, ver comentário em
        // src/lib/pricing/carregar.ts) — usa a categoriaCustoId do produto
        // em si, se a gráfica tiver configurado, senão cai na padrão.
        categoriaId =
          (item.modeloCalculo === "OFFSET"
            ? item.itemGrafica.papel?.categoriaCustoId
            : item.itemGrafica.categoriaCustoId) ?? resolutor.padrao;
        rotulo = "material";
      } else if (componente.chave === "chapas") {
        categoriaId = resolutor.porNome(CATEGORIA_CHAPAS_NOME) ?? resolutor.padrao;
        rotulo = "chapas";
      } else {
        categoriaId = resolutor.porNome(CATEGORIA_IMPRESSAO_NOME) ?? resolutor.padrao;
        rotulo = item.modeloCalculo === "OFFSET" ? "rodagem + setup" : "impressão";
      }

      const gravou = acumular(
        categoriaId,
        componente.valor,
        "MOTOR_PRECIFICACAO",
        `${nomeItem} — ${rotulo} (breakdown motor ${item.modeloCalculo})`
      );
      if (gravou) contribuiu = true;
    }
    if (!contribuiu) {
      // Defensivo: só acontece se a gráfica não tiver NENHUMA categoria de
      // custo cadastrada (nem própria, nem padrão, nem "primeira ativa") —
      // não deveria ocorrer, já que garantirCategoriasCustoPadrao roda no
      // bootstrap (ver src/lib/custo-pedido.ts), mas sem isso o pedido
      // pareceria "previsão completa" com zero linhas geradas.
      itensSemPrevisao.push(`${nomeItem} (nenhuma categoria de custo cadastrada na gráfica)`);
    }
  }

  const linhas: LinhaPrevisaoCusto[] = [...porCategoria.entries()].map(([categoriaCustoId, dados]) => ({
    categoriaCustoId,
    valor: dados.valor.toFixed(2),
    origem: dados.origem,
    detalhe: dados.detalhes.join("; ").slice(0, 500),
  }));

  // custoPrevistoTotal===null é o sinal formal de "previsão parcial ou zero
  // itens previsíveis" (ver fase-custo-real.md §3.1: inventar um custo
  // estimado por percentual seria pior que não ter nenhum). Um total parcial
  // fingindo ser completo é o mesmo erro que isso evita — por isso, com
  // QUALQUER item em itensSemPrevisao, o total inteiro fica null em vez de
  // somar só o que foi calculado.
  const custoPrevistoTotal =
    itensSemPrevisao.length > 0
      ? null
      : linhas.reduce((acc, l) => acc.plus(l.valor), paraDecimal(0)).toFixed(2);

  return {
    aprovadoEm: agora,
    precoSugeridoTotal: precoSugeridoTotal ? precoSugeridoTotal.toFixed(2) : null,
    valorNegociadoTotal: valorNegociadoTotal.toFixed(2),
    custoPrevistoTotal,
    linhas,
    itensSemPrevisao,
  };
}

// Grava o resultado de calcularPrevisaoAprovacaoPedido — chamado DE DENTRO
// da mesma transação que já faz o CAS de status do Orcamento + upsert do
// Pedido (ver os dois pontos de aprovação). Usa `orcamentoId` (não
// `pedidoId`) pra não depender do retorno do upsert anterior na mesma
// transação — Pedido.orcamentoId é @unique, então dá pra atualizar
// diretamente por ele.
export async function gravarPrevisaoAprovacaoPedido(
  tx: Prisma.TransactionClient,
  params: { graficaId: string; orcamentoId: string; previsao: PrevisaoAprovacaoPedido }
): Promise<void> {
  const pedido = await tx.pedido.update({
    where: { orcamentoId: params.orcamentoId },
    data: {
      aprovadoEm: params.previsao.aprovadoEm,
      precoSugeridoTotal: params.previsao.precoSugeridoTotal,
      valorNegociadoTotal: params.previsao.valorNegociadoTotal,
      custoPrevistoTotal: params.previsao.custoPrevistoTotal,
    },
    select: { id: true },
  });

  if (params.previsao.linhas.length > 0) {
    await tx.pedidoCustoPrevisto.createMany({
      data: params.previsao.linhas.map((linha) => ({
        graficaId: params.graficaId,
        pedidoId: pedido.id,
        categoriaCustoId: linha.categoriaCustoId,
        valor: linha.valor,
        origem: linha.origem,
        detalhe: linha.detalhe,
      })),
    });
  }
}
