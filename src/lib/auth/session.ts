import "server-only";

import { cache } from "react";
import { randomBytes, createHash } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE_NAME } from "./constants";
import { obterIpRequisicao } from "./ip";
import { definirTenantAtual, semTenant } from "@/lib/tenant-context";

const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 7; // 7 dias

// Exportados pra reaproveitar em outros tokens opacos do app (ex: reset de
// senha, ver src/app/esqueci-senha/actions.ts) — mesmo esquema de token
// aleatório + hash SHA-256 salvo no banco, nunca o valor bruto.
export function gerarTokenBruto(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(tokenBruto: string): string {
  return createHash("sha256").update(tokenBruto).digest("hex");
}

export async function criarSessao(usuarioId: string) {
  const tokenBruto = gerarTokenBruto();
  const tokenHash = hashToken(tokenBruto);
  const expiraEm = new Date(Date.now() + SESSION_DURATION_MS);

  const headerList = await headers();
  const userAgent = headerList.get("user-agent");
  const ip = await obterIpRequisicao();

  await prisma.$transaction([
    // limpa sessões expiradas do usuário a cada novo login (housekeeping oportunista)
    prisma.sessao.deleteMany({
      where: { usuarioId, expiraEm: { lt: new Date() } },
    }),
    prisma.sessao.create({
      data: { usuarioId, tokenHash, expiraEm, userAgent, ip },
    }),
  ]);

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, tokenBruto, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiraEm,
  });
}

// cache() dedup por request: evita reconsultar sessão+assinatura se mais de
// um ponto do mesmo request chamar isto (ex: Server Action seguida da
// re-renderização da página). Também traz a assinatura junto (grafica.
// assinatura) na mesma query, pra exigirAssinaturaAtiva não precisar de um
// round-trip próprio — ver src/lib/auth/assinatura.ts.
export const obterUsuarioAtual = cache(async () => {
  const cookieStore = await cookies();
  const tokenBruto = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!tokenBruto) return null;

  const tokenHash = hashToken(tokenBruto);
  // Achado real de produção (2026-09-18, tirou o app do ar assim que o
  // lote 2 do RLS foi aplicado) — esta é A query que BOOTSTRAPA o tenant:
  // ninguém chama definirTenantAtual antes dela, porque é dela que se
  // descobre o graficaId (usuario.graficaId, logo abaixo). Sem semTenant,
  // ela rodava sem app.grafica_id setado; Usuario (RLS ativo desde o lote
  // 2) negava a linha aninhada, `sessao.usuario` virava null, e
  // `sessao.usuario.desativadoEm` explodia — em TODA página autenticada
  // do app, pra todo mundo. Mesma categoria de bypass do registro
  // (src/app/registro/actions.ts) e da resolução de token público: tenant
  // genuinamente desconhecido neste ponto, é EXATAMENTE pra isso que
  // bypass_rls existe.
  const sessao = await semTenant("resolver sessão por cookie — tenant ainda desconhecido", () =>
    prisma.sessao.findUnique({
      where: { tokenHash },
      include: { usuario: { include: { grafica: { include: { assinatura: true } } } } },
    })
  );

  // desativadoEm preenchido = funcionário removido (ver comentário do campo
  // no schema): tratado exatamente como sessão inválida/expirada, não como
  // "usuário logado sem permissão" — quem chama obterUsuarioAtual() direto
  // (login/registro, pra saber se já tem alguém logado) também precisa ver
  // null aqui, senão um cookie remanescente de quem foi removido causaria um
  // loop de redirecionamento entre /login e a página protegida. As sessões
  // já são apagadas no momento da remoção (ver desativarUsuario em
  // src/app/usuarios/actions.ts) — este check é a segunda linha de defesa.
  if (!sessao || sessao.expiraEm < new Date() || sessao.usuario.desativadoEm) {
    return null;
  }

  return sessao.usuario;
});

// Achado da expansão de PendenciasConfiguracaoModal->Banner (2026-09-14) —
// versão enxuta de obterUsuarioAtual, só pra quem precisa da linha de
// Sessao em si (não do Usuario relacionado): hoje só
// pendencias-configuracao.ts (ler/gravar pendenciasDispensadas). cache()
// próprio (não reaproveita o de obterUsuarioAtual) — são dois lookups por
// tokenHash separados no mesmo request quando ambos são chamados, aceitável
// porque só roda pra DONO já passado do onboarding, não em toda requisição.
export const obterSessaoAtual = cache(async () => {
  const cookieStore = await cookies();
  const tokenBruto = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!tokenBruto) return null;

  const tokenHash = hashToken(tokenBruto);
  const sessao = await prisma.sessao.findUnique({
    where: { tokenHash },
    select: { id: true, expiraEm: true, pendenciasDispensadas: true },
  });
  if (!sessao || sessao.expiraEm < new Date()) return null;

  return sessao;
});

export async function exigirUsuarioAutenticado() {
  const usuario = await obterUsuarioAtual();
  if (!usuario) {
    redirect("/login");
  }
  // Achado da auditoria de segurança (2026-09-13) — todo caminho autenticado
  // passa por aqui; a partir deste ponto, prisma-tenant-guard.ts (ver
  // src/lib/prisma.ts) já enxerga o tenant do request e passa a exigir
  // graficaId nas queries multi-tenant, conferindo o VALOR contra este
  // mesmo usuario.graficaId quando presente. Ver src/lib/tenant-context.ts.
  definirTenantAtual(usuario.graficaId);
  return usuario;
}

export async function encerrarSessao() {
  const cookieStore = await cookies();
  const tokenBruto = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (tokenBruto) {
    const tokenHash = hashToken(tokenBruto);
    await prisma.sessao.deleteMany({ where: { tokenHash } });
  }

  cookieStore.delete(SESSION_COOKIE_NAME);
}
