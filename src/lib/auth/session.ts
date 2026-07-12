import "server-only";

import { randomBytes, createHash } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE_NAME } from "./constants";
import { obterIpRequisicao } from "./ip";

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

export async function obterUsuarioAtual() {
  const cookieStore = await cookies();
  const tokenBruto = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!tokenBruto) return null;

  const tokenHash = hashToken(tokenBruto);
  const sessao = await prisma.sessao.findUnique({
    where: { tokenHash },
    include: { usuario: { include: { grafica: true } } },
  });

  if (!sessao || sessao.expiraEm < new Date()) {
    return null;
  }

  return sessao.usuario;
}

export async function exigirUsuarioAutenticado() {
  const usuario = await obterUsuarioAtual();
  if (!usuario) {
    redirect("/login");
  }
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
