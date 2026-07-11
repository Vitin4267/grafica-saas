import "server-only";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import type { PapelUsuario, ModuloPermissao } from "@/generated/prisma/enums";

export { MODULOS_PERMISSAO } from "@/lib/modulos-permissao";

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

// Controle granular por módulo — só se aplica a OPERADOR. DONO sempre tem
// acesso total; ADMIN também (decisão do usuário: ADMIN continua como
// "quase-dono", sem precisar configurar nada — só OPERADOR passa pelo
// controle fino). Ausência de linha em PermissaoUsuario pra um módulo =
// sem acesso nenhum, nem ver — padrão mais seguro por omissão.
async function buscarPermissao(usuarioId: string, modulo: ModuloPermissao) {
  return prisma.permissaoUsuario.findUnique({
    where: { usuarioId_modulo: { usuarioId, modulo } },
  });
}

export async function podeVerModulo(
  usuario: { id: string; papel: PapelUsuario },
  modulo: ModuloPermissao
): Promise<boolean> {
  if (usuario.papel !== "OPERADOR") return true;
  const permissao = await buscarPermissao(usuario.id, modulo);
  return permissao?.podeVer ?? false;
}

export async function podeEditarModulo(
  usuario: { id: string; papel: PapelUsuario },
  modulo: ModuloPermissao
): Promise<boolean> {
  if (usuario.papel !== "OPERADOR") return true;
  const permissao = await buscarPermissao(usuario.id, modulo);
  return permissao?.podeEditar ?? false;
}

// Pra usar no topo de uma página: redireciona pra /comecar (única tela sem
// nenhum gate de módulo) se o usuário não puder nem ver. Nunca redirecionar
// pra outra tela com gate de módulo aqui, senão risco de loop se o usuário
// também não tiver acesso ao destino.
export async function exigirVerModulo(
  usuario: { id: string; papel: PapelUsuario },
  modulo: ModuloPermissao
): Promise<void> {
  if (!(await podeVerModulo(usuario, modulo))) {
    redirect("/comecar");
  }
}

// Pra usar no topo de uma Server Action: recusa a ação (sem redirecionar —
// uma action não navega) se o usuário não puder editar o módulo.
export async function exigirEditarModulo(
  usuario: { id: string; papel: PapelUsuario },
  modulo: ModuloPermissao
): Promise<boolean> {
  return podeEditarModulo(usuario, modulo);
}

// Todos os módulos visíveis pro usuário — usado só pra decidir quais links
// mostrar no menu (UserNav). null = vê tudo (DONO/ADMIN); nunca é a única
// linha de defesa, a página de destino sempre re-checa por conta própria.
export async function obterModulosVisiveis(usuario: {
  id: string;
  papel: PapelUsuario;
}): Promise<ModuloPermissao[] | null> {
  if (usuario.papel !== "OPERADOR") return null;
  const permissoes = await prisma.permissaoUsuario.findMany({
    where: { usuarioId: usuario.id, podeVer: true },
    select: { modulo: true },
  });
  return permissoes.map((p) => p.modulo);
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
