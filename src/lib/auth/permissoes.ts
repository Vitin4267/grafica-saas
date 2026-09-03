import "server-only";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import type { PapelUsuario, ModuloPermissao, StatusPedido } from "@/generated/prisma/enums";

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
    select: { podeVer: true, podeEditar: true },
  });
}

// Achado A5 da auditoria de abrangência (Parte 6/Configurações) — perfil de
// acesso reutilizável (ver model PerfilAcesso no schema). Só consultado
// quando o usuário tem um perfil atribuído — retorna null (não uma linha
// "vazia") quando `perfilAcessoId` é null, pra resolverPermissaoOperador
// tratar os dois casos ("sem perfil" e "tem perfil mas o perfil não cobre
// este módulo") do mesmo jeito: cai pro passo 3 (sem acesso).
async function buscarPermissaoDoPerfil(perfilAcessoId: string | null, modulo: ModuloPermissao) {
  if (!perfilAcessoId) return null;
  return prisma.permissaoPerfil.findUnique({
    where: { perfilId_modulo: { perfilId: perfilAcessoId, modulo } },
    select: { podeVer: true, podeEditar: true },
  });
}

type LinhaPermissao = { podeVer: boolean; podeEditar: boolean } | null;

// Resolução de 3 níveis pra permissão de OPERADOR — EXATA ORDEM (achado A5
// da auditoria de abrangência, pesquisa-abrangencia-modulos.md):
//
// 1. PermissaoUsuario (override individual): se existe QUALQUER linha pro
//    par [usuarioId, modulo], ela vence — mesmo que o usuário também tenha
//    um perfil atribuído, e mesmo que a linha seja podeVer=false/podeEditar=
//    false (a PRESENÇA da linha já é um override explícito, não só o valor).
//    Isto preserva 100% o comportamento de hoje pra quem já configura
//    permissão individual: um perfil novo nunca muda o que já estava
//    configurado na unha.
// 2. Sem override individual pra este módulo: se o usuário tem
//    perfilAcessoId e o perfil tem PermissaoPerfil pro módulo, usa o perfil.
// 3. Nenhum dos dois: "ausência = sem acesso" — o mesmo padrão mais seguro
//    por omissão que o sistema já tinha antes deste achado existir.
//
// Função pura (sem I/O) de propósito — toda a lógica de decisão mora aqui,
// testável isoladamente do banco (ver permissoes.test.ts). resolverPermissao
// logo abaixo só busca os dois inputs e delega pra esta função.
export function resolverPermissaoOperador(
  individual: LinhaPermissao,
  doPerfil: LinhaPermissao
): { podeVer: boolean; podeEditar: boolean } {
  const linha = individual ?? doPerfil;
  return { podeVer: linha?.podeVer ?? false, podeEditar: linha?.podeEditar ?? false };
}

async function resolverPermissao(
  usuario: { id: string; perfilAcessoId: string | null },
  modulo: ModuloPermissao
): Promise<{ podeVer: boolean; podeEditar: boolean }> {
  const [individual, doPerfil] = await Promise.all([
    buscarPermissao(usuario.id, modulo),
    buscarPermissaoDoPerfil(usuario.perfilAcessoId, modulo),
  ]);
  return resolverPermissaoOperador(individual, doPerfil);
}

export async function podeVerModulo(
  usuario: { id: string; papel: PapelUsuario; perfilAcessoId: string | null },
  modulo: ModuloPermissao
): Promise<boolean> {
  if (usuario.papel !== "OPERADOR") return true;
  const { podeVer } = await resolverPermissao(usuario, modulo);
  return podeVer;
}

export async function podeEditarModulo(
  usuario: { id: string; papel: PapelUsuario; perfilAcessoId: string | null },
  modulo: ModuloPermissao
): Promise<boolean> {
  if (usuario.papel !== "OPERADOR") return true;
  const { podeEditar } = await resolverPermissao(usuario, modulo);
  return podeEditar;
}

// Pra usar no topo de uma página: redireciona pra /comecar (única tela sem
// nenhum gate de módulo) se o usuário não puder nem ver. Nunca redirecionar
// pra outra tela com gate de módulo aqui, senão risco de loop se o usuário
// também não tiver acesso ao destino.
export async function exigirVerModulo(
  usuario: { id: string; papel: PapelUsuario; perfilAcessoId: string | null },
  modulo: ModuloPermissao
): Promise<void> {
  if (!(await podeVerModulo(usuario, modulo))) {
    redirect("/comecar");
  }
}

// Pra usar no topo de uma Server Action: recusa a ação (sem redirecionar —
// uma action não navega) se o usuário não puder editar o módulo.
export async function exigirEditarModulo(
  usuario: { id: string; papel: PapelUsuario; perfilAcessoId: string | null },
  modulo: ModuloPermissao
): Promise<boolean> {
  return podeEditarModulo(usuario, modulo);
}

// Todos os módulos visíveis pro usuário — usado só pra decidir quais links
// mostrar no menu (UserNav). null = vê tudo (DONO/ADMIN); nunca é a única
// linha de defesa, a página de destino sempre re-checa por conta própria.
//
// Mesma resolução de 3 níveis de podeVerModulo, só que pra TODOS os módulos
// de uma vez (evita N buscas): módulo com override individual (mesmo que
// negativo) usa só esse valor; módulo sem override cai no perfil, se houver.
export async function obterModulosVisiveis(usuario: {
  id: string;
  papel: PapelUsuario;
  perfilAcessoId: string | null;
}): Promise<ModuloPermissao[] | null> {
  if (usuario.papel !== "OPERADOR") return null;

  const [individuais, doPerfil] = await Promise.all([
    prisma.permissaoUsuario.findMany({
      where: { usuarioId: usuario.id },
      select: { modulo: true, podeVer: true },
    }),
    usuario.perfilAcessoId
      ? prisma.permissaoPerfil.findMany({
          where: { perfilId: usuario.perfilAcessoId },
          select: { modulo: true, podeVer: true },
        })
      : Promise.resolve([]),
  ]);

  const individualPorModulo = new Map(individuais.map((p) => [p.modulo, p.podeVer]));

  const modulos = new Set<ModuloPermissao>();
  for (const [modulo, podeVer] of individualPorModulo) {
    if (podeVer) modulos.add(modulo);
  }
  for (const { modulo, podeVer } of doPerfil) {
    // Override individual pro módulo (mesmo negativo) já decidiu — perfil só
    // preenche módulo em que o usuário não tem nenhuma linha individual.
    if (individualPorModulo.has(modulo)) continue;
    if (podeVer) modulos.add(modulo);
  }
  return [...modulos];
}

// OR-fallback pra avancarPedido (src/app/producao/actions.ts): um OPERADOR
// sem PRODUCAO.podeEditar ainda pode confirmar a etapa ATUAL de um pedido
// específico se estiver atribuído como responsável por esse status em
// /usuarios (ver ResponsavelEstagio). Recebe o status como parâmetro (não
// busca o pedido) porque quem chama já tem o pedido em mãos nesse ponto do
// fluxo. DONO/ADMIN não precisam disso — já passam por podeEditarModulo.
export async function podeConfirmarEstagio(
  usuario: { id: string; papel: PapelUsuario },
  status: StatusPedido
): Promise<boolean> {
  if (usuario.papel !== "OPERADOR") return true;
  const linha = await prisma.responsavelEstagio.findUnique({
    where: { usuarioId_status: { usuarioId: usuario.id, status } },
  });
  return linha !== null;
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
