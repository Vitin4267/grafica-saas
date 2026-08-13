import "server-only";
import { timingSafeEqual } from "node:crypto";

// Autenticação das rotas de cron (src/app/api/cron/*), disparadas pela infra
// da Vercel (vercel.json) com `Authorization: Bearer $CRON_SECRET`.
//
// Duas coisas que a comparação ingênua `auth !== \`Bearer ${process.env.CRON_SECRET}\``
// errava (achado da auditoria de 2026-07-26, encontrado por 3 revisões
// independentes):
//
// 1. FAIL-OPEN com env var ausente: sem CRON_SECRET no ambiente, o template
//    literal vira a string "Bearer undefined" — e qualquer um na internet
//    mandando esse header exato passava. Não é hipotético neste projeto: já
//    houve caso de env var faltando na Vercel enquanto funcionava local.
//    Agora, sem o segredo configurado, NINGUÉM passa (fail-closed) — na pior
//    hipótese o cron para de rodar, o que é visível e recuperável, ao
//    contrário de ficar aberto silenciosamente.
// 2. Comparação com `!==`, que curto-circuita no primeiro byte diferente.
//    Não é explorável de forma prática pela internet pública (ruído de rede
//    domina o delta de bytes), mas timingSafeEqual custa zero.
//
// Mesma disciplina de fail-closed que api/webhooks/stripe/route.ts já aplicava
// pro STRIPE_WEBHOOK_SIGNING_SECRET.
export function cronAutorizado(authorizationHeader: string | null): boolean {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return false;

  const esperado = Buffer.from(`Bearer ${segredo}`);
  const recebido = Buffer.from(authorizationHeader ?? "");
  // timingSafeEqual exige buffers do mesmo tamanho — comparar o tamanho antes
  // vaza só o comprimento do segredo, que não é material sensível.
  if (recebido.length !== esperado.length) return false;
  return timingSafeEqual(recebido, esperado);
}
