import "server-only";

import { headers } from "next/headers";

// Resolve a origem (proto+host) da requisição atual a partir dos headers —
// usado tanto pra gerar quanto pra exibir o link público de um orçamento
// (/o/[token]). Centralizado aqui pra não duplicar o mesmo fallback de proto
// em mais de um lugar.
export async function resolverOrigemPublica(): Promise<string> {
  const headerList = await headers();
  const host = headerList.get("host");
  const proto =
    headerList.get("x-forwarded-proto") ??
    (process.env.NODE_ENV === "production" ? "https" : "http");
  return `${proto}://${host}`;
}
