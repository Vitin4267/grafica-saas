import "server-only";

import { headers } from "next/headers";

// Resolve a origem (proto+host) pra montar links que saem do app — link
// público de orçamento (/o/[token]), link de redefinição de senha por
// e-mail, e as URLs de retorno do Stripe Checkout/Customer Portal.
//
// Prioriza APP_URL (env var fixa) quando configurada — os headers
// `host`/`x-forwarded-proto` da requisição podem, dependendo da
// infraestrutura de proxy/hospedagem, ser influenciados por quem faz a
// chamada (host header injection): um link de reset de senha montado a
// partir de um `host` forjado sairia apontando pro domínio de um
// atacante, que capturaria o token quando a vítima clicasse. Configure
// `APP_URL` em produção pra eliminar esse risco por completo.
export async function resolverOrigemPublica(): Promise<string> {
  const configurada = process.env.APP_URL;
  if (configurada) {
    return configurada.replace(/\/+$/, "");
  }

  // Fallback pelos headers — usado em dev local (sem APP_URL configurada).
  const headerList = await headers();
  const host = headerList.get("host");
  const proto =
    headerList.get("x-forwarded-proto") ??
    (process.env.NODE_ENV === "production" ? "https" : "http");
  return `${proto}://${host}`;
}
