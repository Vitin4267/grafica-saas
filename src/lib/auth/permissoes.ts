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

// Feature "multi-cargo" (2026-09-06) — um usuário pode ter N cargos
// (PerfilAcesso) ao mesmo tempo, ver model PerfilUsuario no schema. Lista os
// ids dos perfis atribuídos a este usuário; array vazio = sem nenhum cargo
// (mesmo tratamento de "sem perfil" de antes desta feature).
async function buscarPerfilIds(usuarioId: string): Promise<string[]> {
  const vinculos = await prisma.perfilUsuario.findMany({
    where: { usuarioId },
    select: { perfilAcessoId: true },
  });
  return vinculos.map((v) => v.perfilAcessoId);
}

// Achado A5 da auditoria de abrangência (Parte 6/Configurações) — perfil de
// acesso reutilizável (ver model PerfilAcesso no schema). Uma linha por
// cargo que TEM PermissaoPerfil pro módulo em questão — cargo sem linha pro
// módulo simplesmente não aparece no array (equivalente a null, contribui
// "false" pra união em resolverPermissaoOperador).
async function buscarPermissoesDosPerfis(perfilIds: string[], modulo: ModuloPermissao) {
  if (perfilIds.length === 0) return [];
  return prisma.permissaoPerfil.findMany({
    where: { perfilId: { in: perfilIds }, modulo },
    select: { podeVer: true, podeEditar: true },
  });
}

type LinhaPermissao = { podeVer: boolean; podeEditar: boolean } | null;

// Resolução de permissão de OPERADOR — EXATA ORDEM (achado A5 da auditoria
// de abrangência, pesquisa-abrangencia-modulos.md; união por multi-cargo
// adicionada 2026-09-06):
//
// 1. PermissaoUsuario (override individual): se existe QUALQUER linha pro
//    par [usuarioId, modulo], ela vence — mesmo que o usuário também tenha
//    um ou mais cargos atribuídos, e mesmo que a linha seja podeVer=false/
//    podeEditar=false (a PRESENÇA da linha já é um override explícito, não
//    só o valor). Isto preserva 100% o comportamento de hoje pra quem já
//    configura permissão individual: nenhum cargo nunca muda o que já
//    estava configurado na unha.
// 2. Sem override individual pra este módulo: UNIÃO (OR) entre TODOS os
//    cargos do usuário que têm PermissaoPerfil pro módulo — o cargo mais
//    permissivo vence (podeVer/podeEditar cada um resolvido
//    independentemente). Um usuário com 2 cargos (ex: Vendedor +
//    Financeiro) enxerga a soma dos dois, nunca menos que qualquer um deles
//    sozinho.
// 3. Nenhum dos dois: "ausência = sem acesso" — o mesmo padrão mais seguro
//    por omissão que o sistema já tinha antes deste achado existir.
//
// Função pura (sem I/O) de propósito — toda a lógica de decisão mora aqui,
// testável isoladamente do banco (ver permissoes.test.ts). resolverPermissao
// logo abaixo só busca os inputs e delega pra esta função.
export function resolverPermissaoOperador(
  individual: LinhaPermissao,
  doPerfis: LinhaPermissao[]
): { podeVer: boolean; podeEditar: boolean } {
  if (individual) {
    return { podeVer: individual.podeVer, podeEditar: individual.podeEditar };
  }
  return {
    podeVer: doPerfis.some((p) => p?.podeVer ?? false),
    podeEditar: doPerfis.some((p) => p?.podeEditar ?? false),
  };
}

async function resolverPermissao(
  usuario: { id: string },
  modulo: ModuloPermissao
): Promise<{ podeVer: boolean; podeEditar: boolean }> {
  const [individual, perfilIds] = await Promise.all([
    buscarPermissao(usuario.id, modulo),
    buscarPerfilIds(usuario.id),
  ]);
  const doPerfis = await buscarPermissoesDosPerfis(perfilIds, modulo);
  return resolverPermissaoOperador(individual, doPerfis);
}

export async function podeVerModulo(
  usuario: { id: string; papel: PapelUsuario },
  modulo: ModuloPermissao
): Promise<boolean> {
  if (usuario.papel !== "OPERADOR") return true;
  const { podeVer } = await resolverPermissao(usuario, modulo);
  return podeVer;
}

export async function podeEditarModulo(
  usuario: { id: string; papel: PapelUsuario },
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
//
// Mesma resolução de podeVerModulo, só que pra TODOS os módulos de uma vez
// (evita N buscas): módulo com override individual (mesmo que negativo) usa
// só esse valor; módulo sem override é a UNIÃO de podeVer entre todos os
// cargos do usuário (multi-cargo, 2026-09-06).
export async function obterModulosVisiveis(usuario: {
  id: string;
  papel: PapelUsuario;
}): Promise<ModuloPermissao[] | null> {
  if (usuario.papel !== "OPERADOR") return null;

  const perfilIds = await buscarPerfilIds(usuario.id);
  const [individuais, doPerfis] = await Promise.all([
    prisma.permissaoUsuario.findMany({
      where: { usuarioId: usuario.id },
      select: { modulo: true, podeVer: true },
    }),
    perfilIds.length > 0
      ? prisma.permissaoPerfil.findMany({
          where: { perfilId: { in: perfilIds } },
          select: { modulo: true, podeVer: true },
        })
      : Promise.resolve([]),
  ]);

  const individualPorModulo = new Map(individuais.map((p) => [p.modulo, p.podeVer]));

  const modulos = new Set<ModuloPermissao>();
  for (const [modulo, podeVer] of individualPorModulo) {
    if (podeVer) modulos.add(modulo);
  }
  for (const { modulo, podeVer } of doPerfis) {
    // Override individual pro módulo (mesmo negativo) já decidiu — cargo só
    // preenche módulo em que o usuário não tem nenhuma linha individual.
    // Vários cargos podem repetir o mesmo módulo aqui (união) — o Set
    // absorve a duplicidade sem problema.
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
