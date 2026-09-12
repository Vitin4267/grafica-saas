import type { MotivoRetorno } from "@/generated/prisma/enums";

// Achado Prod-D2 da Parte 2 (Produção) da auditoria de abrangência
// (pesquisa-abrangencia-modulos.md, "Não existe retorno de etapa") — lógica
// pura compartilhada entre server (validação em
// src/app/producao/retorno-etapa-actions.ts) e client (rótulos/ordem em
// RetornarEtapaBotao.tsx) do motivo de retorno de um Pedido pra uma etapa
// anterior. Mesmo papel/formato de refugo-producao.ts, mas pro motivo do
// PEDIDO INTEIRO voltar pra trás na FSM, não de material refugado numa
// etapa.

export const ROTULOS_MOTIVO_RETORNO: Record<MotivoRetorno, string> = {
  REPROVADO_QUALIDADE: "Reprovado na conferência de qualidade",
  ERRO_ARTE: "Erro de arte identificado depois de produzir",
  MUDANCA_PEDIDO_CLIENTE: "Mudança pedida pelo cliente",
  FALTA_MATERIAL: "Falta de material pra continuar",
  ERRO_OPERACIONAL: "Erro operacional",
  OUTRO: "Outro",
};

// Ordem de exibição no select — OUTRO por último, mesmo critério de
// ORDEM_MOTIVO_REFUGO/ORDEM_MOTIVO_PARADA.
export const ORDEM_MOTIVO_RETORNO: MotivoRetorno[] = [
  "REPROVADO_QUALIDADE",
  "ERRO_ARTE",
  "MUDANCA_PEDIDO_CLIENTE",
  "FALTA_MATERIAL",
  "ERRO_OPERACIONAL",
  "OUTRO",
];

// Rótulo pronto pra exibir — resolve "Outro: <motivoOutro>" quando
// aplicável, mesmo padrão de rotuloMotivoRefugo/rotuloMotivoParada.
export function rotuloMotivoRetorno(motivo: MotivoRetorno, motivoOutro: string | null): string {
  if (motivo === "OUTRO" && motivoOutro) return motivoOutro;
  return ROTULOS_MOTIVO_RETORNO[motivo];
}
