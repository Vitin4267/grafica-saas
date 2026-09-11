import type { TipoAprovacaoProducao, ResultadoAprovacao } from "@/generated/prisma/enums";

// Achado D1 da auditoria de abrangência (Parte 2/Produção,
// pesquisa-abrangencia-modulos.md, 2026-09-11) — rótulos/ordem de exibição
// de TipoAprovacaoProducao/ResultadoAprovacao, compartilhados entre server
// (chip na lista/Kanban de producao/page.tsx) e client
// (AprovacaoProducaoSecao.tsx). Mesmo papel de ROTULOS_MOTIVO_PARADA em
// src/lib/parada-pedido-status.ts.
export const ROTULOS_TIPO_APROVACAO_PRODUCAO: Record<TipoAprovacaoProducao, string> = {
  OK_MAQUINA: "OK de máquina (1ª folha/peça)",
  PROVA_CONTRATO: "Prova de contrato",
  // Fluxo público/token FORA DE ESCOPO nesta rodada (ver comentário no
  // schema, model AprovacaoProducao) — rótulo já deixa isso explícito pra
  // quem for escolher esta opção hoje: é só um registro interno igual aos
  // outros, sem link nem notificação ao cliente por trás.
  AMOSTRA_CLIENTE: "Amostra ao cliente (registro interno — sem link público ainda)",
  INSPECAO_PROCESSO: "Inspeção de processo",
  INSPECAO_FINAL: "Inspeção final",
  OUTRO: "Outro",
};

// Ordem de exibição no select do formulário — OUTRO por último, mesmo
// critério de ORDEM_MOTIVO_PARADA.
export const ORDEM_TIPO_APROVACAO_PRODUCAO: TipoAprovacaoProducao[] = [
  "OK_MAQUINA",
  "PROVA_CONTRATO",
  "INSPECAO_PROCESSO",
  "INSPECAO_FINAL",
  "AMOSTRA_CLIENTE",
  "OUTRO",
];

export const ROTULOS_RESULTADO_APROVACAO: Record<ResultadoAprovacao, string> = {
  APROVADO: "Aprovado",
  APROVADO_COM_RESSALVA: "Aprovado com ressalva",
  REPROVADO: "Reprovado",
};

export const ORDEM_RESULTADO_APROVACAO: ResultadoAprovacao[] = [
  "APROVADO",
  "APROVADO_COM_RESSALVA",
  "REPROVADO",
];

// Rótulo pronto pra exibir — resolve "Outro: <tipoOutro>" quando aplicável,
// mesmo padrão de rotuloMotivoParada.
export function rotuloTipoAprovacaoProducao(tipo: TipoAprovacaoProducao, tipoOutro: string | null): string {
  if (tipo === "OUTRO" && tipoOutro) return tipoOutro;
  return ROTULOS_TIPO_APROVACAO_PRODUCAO[tipo];
}

// true pros dois resultados que LIBERAM o gate de avancarStatusPedido (ver
// status-transicao.ts) — único ponto que decide isso, reaproveitado tanto
// no gate quanto na UI (chip/histórico), pra nunca divergir do que o
// servidor de fato aceita.
export function resultadoLiberaTransicao(resultado: ResultadoAprovacao): boolean {
  return resultado === "APROVADO" || resultado === "APROVADO_COM_RESSALVA";
}
