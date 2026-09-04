import { paraDecimal } from "./decimal";
import type { FormatoFolhaInput } from "./tipos";

// Extraído de offset.ts (achado N4 da auditoria de código, 2026-09-04) — o
// motor DIGITAL agora também faz imposição (nUp) igual ao Offset, então essa
// geometria pura (quantas peças cabem numa folha, com/sem rotação) deixou de
// ser exclusiva do Offset. Nenhuma mudança de comportamento nesta extração:
// mesma fórmula, mesmos defaults, só mudou de arquivo — offset.ts continua
// reexportando os mesmos símbolos pra não quebrar ninguém que já importava
// daqui.

// pinca é uma margem de mecanismo de PRENSA OFFSET (a garra que puxa a
// folha) — motores sem prensa (ex: DIGITAL) não têm essa perda física e
// devem passar pinca=0 explicitamente na chamada, nunca herdar o default de
// 0.012 do Offset (ver calcularDigital em digital.ts).
export type PedidoImposicao = {
  larguraM: number; // w
  alturaM: number; // h
  sangria?: number; // por lado, default 0.002-0.005 (spec §2.2)
  pinca?: number; // margem de pinça da prensa (só Offset) — default 0 se ausente
  margemLateral?: number; // m_lat, refile/margens laterais da folha, default 0.01
  gapPecas?: number; // g, gap entre peças na folha, default 0.002
};

export const DEFAULTS_IMPOSICAO = {
  sangria: 0.003,
  pinca: 0,
  margemLateral: 0.01,
  gapPecas: 0.002,
};

export type ResultadoImposicao = { nUp: number; rotacionado: boolean };

// Retorna null quando nUp=0 (peça não cabe nesse formato de folha em nenhuma orientação).
export function calcularImposicao(
  pedido: PedidoImposicao,
  folha: FormatoFolhaInput
): ResultadoImposicao | null {
  const sangria = paraDecimal(pedido.sangria ?? DEFAULTS_IMPOSICAO.sangria);
  const pinca = paraDecimal(pedido.pinca ?? DEFAULTS_IMPOSICAO.pinca);
  const mLat = paraDecimal(pedido.margemLateral ?? DEFAULTS_IMPOSICAO.margemLateral);
  const g = paraDecimal(pedido.gapPecas ?? DEFAULTS_IMPOSICAO.gapPecas);

  const wLinha = paraDecimal(pedido.larguraM).plus(sangria.times(2));
  const hLinha = paraDecimal(pedido.alturaM).plus(sangria.times(2));

  const lF = paraDecimal(folha.larguraFolha);
  const aF = paraDecimal(folha.alturaFolha);
  const lu = lF.minus(pinca).minus(mLat.times(2));
  const au = aF.minus(mLat.times(2));

  const normal = lu
    .plus(g)
    .div(wLinha.plus(g))
    .floor()
    .times(au.plus(g).div(hLinha.plus(g)).floor())
    .toNumber();
  const rotacionada = lu
    .plus(g)
    .div(hLinha.plus(g))
    .floor()
    .times(au.plus(g).div(wLinha.plus(g)).floor())
    .toNumber();

  const nUp = Math.max(normal, rotacionada);
  if (nUp <= 0) return null;

  return { nUp, rotacionado: rotacionada > normal };
}
