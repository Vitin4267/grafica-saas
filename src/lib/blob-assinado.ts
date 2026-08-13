import "server-only";
import { issueSignedToken, presignUrl } from "@vercel/blob";

// Confere ANTES de qualquer put/del/list/issueSignedToken contra o store
// PRIVADO (tinta/backup) que a env var está de fato presente. Sem essa
// checagem, `token: process.env.BLOB_PRIVATE_READ_WRITE_TOKEN` vira
// `token: undefined` quando a var falta — e o SDK do @vercel/blob trata
// isso como "não fornecido", caindo silenciosamente pro token do store
// PÚBLICO (BLOB_READ_WRITE_TOKEN). Isso mandaria arquivo privado (imagem de
// análise de tinta, ou o backup diário com Usuario.senhaHash e
// DadosFiscaisGrafica.focusNfeToken em texto claro) pro store errado, sem
// erro nenhum. Falha alto em vez disso — reaproveitada por
// AnaliseTinta.actions.ts e src/app/api/cron/backup/route.ts.
export function exigirTokenBlobPrivado(): string {
  const token = process.env.BLOB_PRIVATE_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error(
      "BLOB_PRIVATE_READ_WRITE_TOKEN não configurado — operação no store privado do Blob abortada (evita cair pro store público por engano)."
    );
  }
  return token;
}

// Gera uma URL de LEITURA temporária pra um blob PRIVADO (ver
// OrcamentoItemTinta.imagemPathname) — usado tanto pro payload que sai pro
// n8n (5 min, só o tempo de baixar e analisar) quanto pra miniatura exibida
// na tela do orçamento (10 min). Escopado ao pathname exato e só à operação
// "get" — nunca emite token de escopo maior (nunca pathname: "*", nunca
// operations incluindo "put"/"delete").
export async function urlAssinadaLeitura(pathname: string, validadeMs: number): Promise<string> {
  const validUntil = Date.now() + validadeMs;
  const token = await issueSignedToken({
    pathname,
    operations: ["get"],
    validUntil,
    token: exigirTokenBlobPrivado(),
  });
  const { presignedUrl } = await presignUrl(token, {
    operation: "get",
    pathname,
    access: "private",
    validUntil,
  });
  return presignedUrl;
}
