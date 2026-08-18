"use server";

import { obterUsuarioAtual } from "@/lib/auth/session";
import { montarUrlSuporte } from "@/lib/suporte";

// obterUsuarioAtual (nullable), não exigirUsuarioAutenticado — mesmo motivo
// de ChatAssistente.actions.ts: roda sozinho num useEffect de background em
// toda página autenticada, um redirect surpresa se a sessão tiver expirado
// seria bug.
export async function obterUrlSuporte(): Promise<string | null> {
  const usuario = await obterUsuarioAtual();
  if (!usuario) return null;
  return montarUrlSuporte({
    nome: usuario.nome,
    email: usuario.email,
    graficaNome: usuario.grafica.nome,
  });
}
