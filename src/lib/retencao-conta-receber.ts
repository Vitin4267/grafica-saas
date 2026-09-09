import type { TributoRetido } from "@/generated/prisma/enums";

// Achado A9 da Parte 4 da auditoria de abrangência (2026-09-09) — mesmo
// padrão enum-fechado+OUTRO do resto do schema (ver
// src/lib/tipos-cliente.ts). Ordem: IRRF/CSRF primeiro (os dois mais comuns
// em nota de serviço pra PJ), depois PIS/COFINS/CSLL discriminados
// separadamente (quem não usa o código unificado CSRF), depois ISS (retido
// pelo MUNICÍPIO, o mais comum em NFS-e de impresso personalizado), INSS por
// último (raro em gráfica), OUTRO ao final.
export const ORDEM_TRIBUTO_RETIDO: TributoRetido[] = [
  "IRRF",
  "CSRF",
  "PIS",
  "COFINS",
  "CSLL",
  "ISS",
  "INSS",
  "OUTRO",
];

export const ROTULO_TRIBUTO_RETIDO: Record<TributoRetido, string> = {
  IRRF: "IRRF",
  CSRF: "CSRF (PIS+COFINS+CSLL unificado)",
  PIS: "PIS",
  COFINS: "COFINS",
  CSLL: "CSLL",
  ISS: "ISS retido",
  INSS: "INSS",
  OUTRO: "Outro",
};
