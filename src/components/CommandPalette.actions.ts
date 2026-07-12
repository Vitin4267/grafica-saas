"use server";

import { obterUsuarioAtual } from "@/lib/auth/session";
import { obterModulosVisiveis, podeVerMeuNegocio } from "@/lib/auth/permissoes";
import type { ModuloPermissao, PapelUsuario } from "@/generated/prisma/enums";

export type ComandosDisponiveis = {
  papel: PapelUsuario;
  modulosVisiveis: ModuloPermissao[] | null;
  mostrarMeuNegocio: boolean;
};

// Mesmo padrão de ChatAssistente.actions.ts/verificarAssistenteDisponivel:
// obterUsuarioAtual() nunca redireciona, então a paleta (montada globalmente
// em layout.tsx, inclusive em páginas sem login) só some/mostra os comandos
// certos sem quebrar nada em páginas públicas.
export async function obterComandosDisponiveis(): Promise<ComandosDisponiveis | null> {
  const usuario = await obterUsuarioAtual();
  if (!usuario) return null;

  return {
    papel: usuario.papel,
    modulosVisiveis: await obterModulosVisiveis(usuario),
    mostrarMeuNegocio: podeVerMeuNegocio(usuario),
  };
}
