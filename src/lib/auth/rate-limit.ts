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

// Mesma lógica de janela deslizante do login, aplicada ao cadastro (/registro)
// — sem isso, um bot cria gráficas/usuários sem limite, cada tentativa ainda
// pagando o custo de CPU do hash argon2id (só é evitado quando o e-mail já
// existe, ver src/app/registro/actions.ts).
//
// Afrouxado de 5/hora pra 8/30min (2026-07-11) — o valor original travou o
// próprio dono durante uma sessão de testes (várias tentativas automatizadas
// bateram no mesmo IP de loopback do dev local). Ainda exige esperar meia
// hora pra tentar de novo depois de esgotar a cota — continua caro pra um
// bot sustentar cadastro em massa, só dá mais folga pra erro de digitação/
// teste manual não travar por uma hora inteira.
const JANELA_REGISTRO_MS = 1000 * 60 * 30; // 30 minutos
const LIMITE_REGISTRO_POR_IP = 8;

export async function verificarBloqueioRegistro(ip: string): Promise<boolean> {
  const desde = new Date(Date.now() - JANELA_REGISTRO_MS);
  const tentativas = await prisma.tentativaRegistro.count({
    where: { ip, createdAt: { gte: desde } },
  });
  return tentativas >= LIMITE_REGISTRO_POR_IP;
}

export async function registrarTentativaRegistro(ip: string) {
  await prisma.tentativaRegistro.create({ data: { ip } });
}
