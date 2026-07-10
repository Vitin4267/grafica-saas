import "server-only";

import { redirect } from "next/navigation";
import type { PapelUsuario } from "@/generated/prisma/enums";

// Primeiro uso real de controle de acesso por papel no projeto — hoje qualquer
// usuário autenticado acessa tudo. Escopo desta rodada: só a tela /usuarios
// exige um papel específico; todo o resto do app continua sem RBAC granular.
export function exigirPapel(
  usuario: { papel: PapelUsuario },
  papeisPermitidos: PapelUsuario[]
) {
  if (!papeisPermitidos.includes(usuario.papel)) {
    redirect("/orcamento");
  }
}

// Acesso à aba "Meu Negócio": DONO sempre vê; qualquer outro papel só vê se o DONO
// ligou o compartilhamento geral da gráfica E concedeu acesso individual a esse
// usuário (os dois em /usuarios) — ver comentários nos campos correspondentes no
// schema (Grafica.compartilharMeuNegocio, Usuario.acessoMeuNegocio).
export function podeVerMeuNegocio(usuario: {
  papel: PapelUsuario;
  acessoMeuNegocio: boolean;
  grafica: { compartilharMeuNegocio: boolean };
}): boolean {
  return (
    usuario.papel === "DONO" ||
    (usuario.grafica.compartilharMeuNegocio && usuario.acessoMeuNegocio)
  );
}
