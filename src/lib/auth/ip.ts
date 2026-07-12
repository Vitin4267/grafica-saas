import "server-only";
import { headers } from "next/headers";

// `X-Forwarded-For` é uma lista "cliente, proxy1, proxy2, ..." — cada proxy
// ACRESCENTA seu próprio IP ao FINAL da lista, nunca reescreve o início.
// Ou seja, o único valor que não é livremente forjável pelo requisitante é
// o ÚLTIMO (adicionado pela borda confiável — Vercel, no nosso caso — bem
// antes de chegar no código da aplicação). Ler o PRIMEIRO valor (erro fácil
// de cometer, o nome do header sugere "o de origem") deixa qualquer rate
// limit por IP burlável só mandando um X-Forwarded-For forjado a cada
// requisição.
export async function obterIpRequisicao(): Promise<string> {
  const headerList = await headers();
  const lista = headerList.get("x-forwarded-for")?.split(",") ?? [];
  return lista.at(-1)?.trim() || "desconhecido";
}
