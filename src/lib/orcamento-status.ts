export type StatusOrcamento = "RASCUNHO" | "ENVIADO" | "APROVADO" | "REJEITADO";

// Nunca confia no status enviado pelo client — só permite as transições abaixo,
// validadas de novo no servidor a partir do status atual lido do banco.
// Reaproveitado tanto pela action autenticada (orcamento/[id]/actions.ts) quanto
// pela ação do link público (o/[token]/actions.ts) — a mesma regra nos dois lugares.
//
// ENVIADO → RASCUNHO existe pra "o cliente pediu ajuste" (solicitarAjusteOrcamento
// em o/[token]/actions.ts): reabre a edição normal, que já é gated por
// status===RASCUNHO em todo lugar, sem precisar de nenhum código extra pra
// destravar. APROVADO/REJEITADO continuam terminais, sem exceção.
export const TRANSICOES_VALIDAS: Record<StatusOrcamento, StatusOrcamento[]> = {
  RASCUNHO: ["ENVIADO"],
  ENVIADO: ["APROVADO", "REJEITADO", "RASCUNHO"],
  APROVADO: [],
  REJEITADO: [],
};

export const ROTULOS_STATUS_ORCAMENTO: Record<StatusOrcamento, string> = {
  RASCUNHO: "Rascunho",
  ENVIADO: "Enviado",
  APROVADO: "Aprovado",
  REJEITADO: "Rejeitado",
};

// "Expirado" é um estado COMPUTADO, não um valor de StatusOrcamento — evita
// cron job e status persistido. Um orçamento ENVIADO continua ENVIADO no
// banco pra sempre; isto só decide se ele ainda pode ser respondido.
export function orcamentoEstaExpirado(orcamento: {
  status: StatusOrcamento;
  validoAteEm: Date | null;
}): boolean {
  return (
    orcamento.status === "ENVIADO" &&
    orcamento.validoAteEm !== null &&
    orcamento.validoAteEm < new Date()
  );
}

const MS_POR_DIA = 86_400_000;

// Dias inteiros desde `enviadoEm` (arredondado pra baixo — só vira "1 dia"
// depois de 24h completas, não no primeiro instante do dia seguinte).
// Assume enviadoEm no passado; usada só depois do gate de orcamentoEstaParado
// abaixo, que já garante isso na prática.
export function diasParado(enviadoEm: Date, agora: Date = new Date()): number {
  return Math.floor((agora.getTime() - enviadoEm.getTime()) / MS_POR_DIA);
}

// "Parado" = ENVIADO, ainda sem resposta do cliente (nem aprovado/rejeitado
// nem pedido de ajuste — os três zeram/avançam o status), há N dias ou mais
// desde o último envio (Orcamento.enviadoEm). N vem de
// ParametrosGrafica.diasAlertaOrcamentoParado, configurável por gráfica.
// Cobre o padrão mais comum de venda perdida numa gráfica ("mandei o
// orçamento e o cliente sumiu") — dá ao vendedor uma lista pra cobrar ANTES
// do orçamento expirar (ver orcamentoEstaExpirado acima). Distinto dele:
// aqui o corte é "há quanto tempo enviei", lá é "quando a proposta vence".
export function orcamentoEstaParado(
  orcamento: {
    status: StatusOrcamento;
    enviadoEm: Date | null;
    respostaPublicaEm: Date | null;
  },
  diasAlerta: number,
  agora: Date = new Date()
): boolean {
  if (orcamento.status !== "ENVIADO") return false;
  if (orcamento.respostaPublicaEm !== null) return false;
  if (orcamento.enviadoEm === null) return false;
  return diasParado(orcamento.enviadoEm, agora) >= diasAlerta;
}
