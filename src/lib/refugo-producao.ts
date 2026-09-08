import type { MotivoRefugo } from "@/generated/prisma/enums";

// Achado B3 da Parte 2 (Produção) da auditoria de abrangência
// (pesquisa-abrangencia-modulos.md, 2026-09-07) — lógica pura compartilhada
// entre server (parse do FormData em src/app/producao/actions.ts, cálculo de
// baixa em src/app/producao/status-transicao.ts) e client (rótulos/ordem em
// RefugoEtapaCampos.tsx) do refugo reportado num ApontamentoEtapa. Mesmo
// papel de perda-fixa-producao.ts, mas pra refugo VARIÁVEL reportado
// manualmente a cada transição, não a perda FIXA de calibragem.

export const ROTULOS_MOTIVO_REFUGO: Record<MotivoRefugo, string> = {
  ACERTO_MAQUINA: "Acerto de máquina (calibragem)",
  ERRO_REGISTRO_COR: "Erro de registro de cor",
  FALHA_IMPRESSAO: "Falha de impressão (borrão, riscos, falta de tinta)",
  ERRO_CORTE_REFILE: "Erro de corte/refile",
  FALHA_ACABAMENTO: "Falha de acabamento (laminação, dobra, cola)",
  MATERIAL_DEFEITUOSO: "Material defeituoso (culpa do fornecedor)",
  ERRO_ARTE_ARQUIVO: "Erro de arte/arquivo",
  ERRO_OPERACIONAL: "Erro operacional",
  OUTRO: "Outro",
};

// Ordem de exibição no select — OUTRO por último, mesmo critério de
// ORDEM_MOTIVO_PARADA (src/lib/parada-pedido-status.ts).
export const ORDEM_MOTIVO_REFUGO: MotivoRefugo[] = [
  "ACERTO_MAQUINA",
  "ERRO_REGISTRO_COR",
  "FALHA_IMPRESSAO",
  "ERRO_CORTE_REFILE",
  "FALHA_ACABAMENTO",
  "MATERIAL_DEFEITUOSO",
  "ERRO_ARTE_ARQUIVO",
  "ERRO_OPERACIONAL",
  "OUTRO",
];

// Rótulo pronto pra exibir — resolve "Outro: <motivoOutro>" quando aplicável,
// mesmo padrão de rotuloMotivoParada.
export function rotuloMotivoRefugo(motivo: MotivoRefugo, motivoOutro: string | null): string {
  if (motivo === "OUTRO" && motivoOutro) return motivoOutro;
  return ROTULOS_MOTIVO_REFUGO[motivo];
}

// A baixa de estoque ADICIONAL do refugo nunca gera CustoPedido automático
// quando o motivo é MATERIAL_DEFEITUOSO — ver comentário completo no enum
// MotivoRefugo (prisma/schema/10-producao.prisma). A MovimentacaoEstoque
// continua sendo criada normalmente pra qualquer motivo (o material saiu
// fisicamente do estoque de qualquer forma) — só o LANÇAMENTO DE CUSTO fica
// de fora pra este motivo específico.
export function refugoGeraCustoAutomatico(motivo: MotivoRefugo | null): boolean {
  return motivo !== "MATERIAL_DEFEITUOSO";
}

export type ItemFichaParaBaixaRefugo = {
  // Consumo TOTAL desta linha de ficha técnica pra produzir a quantidade
  // CHEIA do item de orçamento (ver calcularQuantidadeConsumidaFichaProduto,
  // src/lib/baixa-estoque-substrato.ts) — já reflete o consumo físico real
  // do motor avançado quando aplicável, não só o linear.
  quantidadeConsumidaTotal: number;
  // OrcamentoItem.quantidade — a base da proporção "por unidade".
  quantidadeItemPedido: number;
};

// Consumo adicional pra repor o refugo reportado: mesma taxa de consumo POR
// UNIDADE (quantidadeConsumidaTotal / quantidadeItemPedido) multiplicada
// pela quantidade refugada — modela "reimprimir/refazer as peças refugadas
// consome material de novo, na mesma proporção do resto do pedido". Uma
// aproximação deliberada (documentada, não um bug): pra item com motor
// avançado (OFFSET/M2/FLEXOGRAFIA) o consumo físico real não é
// necessariamente linear em relação à quantidade de peças boas (ex: uma
// folha de offset produz várias peças de uma vez) — dividir o total pela
// quantidade do item já é o mesmo tipo de simplificação que o resto do
// sistema aceita pra este tipo de estimativa (ver perda-fixa-producao.ts,
// que também trabalha com quantidades "por entrada", não por peça
// individual). quantidadeItemPedido<=0 (não deveria acontecer,
// OrcamentoItem.quantidade é sempre >0) ou quantidadeRefugo<=0 devolvem 0
// em vez de dividir por zero/gerar baixa negativa.
export function calcularBaixaRefugoLinha(item: ItemFichaParaBaixaRefugo, quantidadeRefugo: number): number {
  if (item.quantidadeItemPedido <= 0 || quantidadeRefugo <= 0) return 0;
  const consumoPorUnidade = item.quantidadeConsumidaTotal / item.quantidadeItemPedido;
  return consumoPorUnidade * quantidadeRefugo;
}

export type RefugoInput = {
  quantidadeBoa: number | null;
  quantidadeRefugo: number | null;
  motivoRefugo: MotivoRefugo | null;
  motivoRefugoOutro: string | null;
  // O operador decide se quer a baixa adicional de matéria-prima — NUNCA
  // imposta (ver enunciado do achado B3): default sempre false quando o
  // checkbox não vem marcado no FormData.
  gerarBaixaEstoque: boolean;
};

const MOTIVOS_VALIDOS = new Set<string>(ORDEM_MOTIVO_REFUGO);

// Teto "irreal" de propósito (mesmo espírito de PERDA_MAXIMA em
// perda-fixa-producao.ts) — só pra pegar erro de digitação grosseiro (ex: um
// zero a mais) sem incomodar o uso normal.
const QUANTIDADE_MAXIMA = 1_000_000;

export type ResolucaoRefugoInput = { ok: true; refugo: RefugoInput | null } | { ok: false; mensagem: string };

// Lê e valida os campos de refugo de um FormData — usado por avancarPedido
// (src/app/producao/actions.ts). Todos os campos são OPCIONAIS: um FormData
// sem nenhum deles (formulário antigo, ou chamador de teste que não passa
// nada) devolve `refugo: null`, que avancarStatusPedido trata como "nada a
// reportar" — zero mudança de comportamento pra quem não usa esta feature.
// "quantidadeBoa"/"quantidadeRefugo" vazios contam como não-preenchidos
// (mesmo tratamento de FormData.get ausente vs vazio já usado em
// extrairEValidarSelecaoMaquina).
export function parseRefugoFormData(formData: FormData): ResolucaoRefugoInput {
  const quantidadeBoaRaw = String(formData.get("quantidadeBoa") ?? "").trim();
  const quantidadeRefugoRaw = String(formData.get("quantidadeRefugo") ?? "").trim();
  const motivoRefugoRaw = String(formData.get("motivoRefugo") ?? "").trim();
  const motivoRefugoOutroRaw = String(formData.get("motivoRefugoOutro") ?? "").trim();
  const gerarBaixaEstoque = String(formData.get("gerarBaixaRefugo") ?? "") === "on";

  if (!quantidadeBoaRaw && !quantidadeRefugoRaw && !motivoRefugoRaw) {
    return { ok: true, refugo: null };
  }

  let quantidadeBoa: number | null = null;
  if (quantidadeBoaRaw) {
    quantidadeBoa = Number(quantidadeBoaRaw);
    if (!Number.isFinite(quantidadeBoa) || quantidadeBoa < 0 || quantidadeBoa > QUANTIDADE_MAXIMA) {
      return { ok: false, mensagem: "Quantidade boa inválida." };
    }
    quantidadeBoa = Math.round(quantidadeBoa);
  }

  let quantidadeRefugo: number | null = null;
  if (quantidadeRefugoRaw) {
    quantidadeRefugo = Number(quantidadeRefugoRaw);
    if (!Number.isFinite(quantidadeRefugo) || quantidadeRefugo < 0 || quantidadeRefugo > QUANTIDADE_MAXIMA) {
      return { ok: false, mensagem: "Quantidade de refugo inválida." };
    }
    quantidadeRefugo = Math.round(quantidadeRefugo);
  }

  let motivoRefugo: MotivoRefugo | null = null;
  if (motivoRefugoRaw) {
    if (!MOTIVOS_VALIDOS.has(motivoRefugoRaw)) {
      return { ok: false, mensagem: "Motivo de refugo inválido." };
    }
    motivoRefugo = motivoRefugoRaw as MotivoRefugo;
  }

  // Motivo é obrigatório quando há refugo > 0 (a UI já só mostra o select
  // nesse caso, mas o servidor nunca confia só na UI — mesmo princípio de
  // "tudo sensível no backend").
  if (quantidadeRefugo && quantidadeRefugo > 0 && !motivoRefugo) {
    return { ok: false, mensagem: "Informe o motivo do refugo." };
  }
  // motivoRefugoOutro obrigatório quando motivo=OUTRO — mesmo padrão de todo
  // enum fechado+OUTRO do sistema.
  if (motivoRefugo === "OUTRO" && !motivoRefugoOutroRaw) {
    return { ok: false, mensagem: "Descreva o motivo do refugo." };
  }

  return {
    ok: true,
    refugo: {
      quantidadeBoa,
      quantidadeRefugo,
      motivoRefugo,
      motivoRefugoOutro: motivoRefugo === "OUTRO" ? motivoRefugoOutroRaw.slice(0, 200) : null,
      gerarBaixaEstoque,
    },
  };
}
