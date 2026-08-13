import "server-only";
import { issueSignedToken, presignUrl } from "@vercel/blob";

// Gera uma URL de LEITURA temporária pra um blob PRIVADO (ver
// OrcamentoItemTinta.imagemPathname) — usado tanto pro payload que sai pro
// n8n (5 min, só o tempo de baixar e analisar) quanto pra miniatura exibida
// na tela do orçamento (10 min). Escopado ao pathname exato e só à operação
// "get" — nunca emite token de escopo maior (nunca pathname: "*", nunca
// operations incluindo "put"/"delete").
export async function urlAssinadaLeitura(pathname: string, validadeMs: number): Promise<string> {
  const validUntil = Date.now() + validadeMs;
  const token = await issueSignedToken({ pathname, operations: ["get"], validUntil });
  const { presignedUrl } = await presignUrl(token, {
    operation: "get",
    pathname,
    access: "private",
    validUntil,
  });
  return presignedUrl;
}
