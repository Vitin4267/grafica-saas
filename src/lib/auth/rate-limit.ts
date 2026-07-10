import "server-only";

import { prisma } from "@/lib/prisma";

const JANELA_MS = 1000 * 60 * 15; // 15 minutos
const LIMITE_POR_EMAIL = 5;
const LIMITE_POR_IP = 20;

export async function verificarBloqueioLogin(email: string, ip: string) {
  const desde = new Date(Date.now() - JANELA_MS);

  const [falhasEmail, falhasIp] = await Promise.all([
    prisma.tentativaLogin.count({
      where: { email, sucesso: false, createdAt: { gte: desde } },
    }),
    prisma.tentativaLogin.count({
      where: { ip, sucesso: false, createdAt: { gte: desde } },
    }),
  ]);

  const bloqueado = falhasEmail >= LIMITE_POR_EMAIL || falhasIp >= LIMITE_POR_IP;
  return { bloqueado };
}

export async function registrarTentativaLogin(
  email: string,
  ip: string,
  sucesso: boolean
) {
  await prisma.tentativaLogin.create({ data: { email, ip, sucesso } });
}
