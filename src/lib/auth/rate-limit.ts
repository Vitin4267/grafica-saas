import "server-only";

import { prisma } from "@/lib/prisma";

const JANELA_MS = 1000 * 60 * 15; // 15 minutos
const LIMITE_POR_EMAIL = 5;
const LIMITE_POR_IP = 20;

export async function verificarBloqueioLogin(email: string, ip: string): Promise<boolean> {
  const desde = new Date(Date.now() - JANELA_MS);

  const [falhasEmail, falhasIp] = await Promise.all([
    prisma.tentativaLogin.count({
      where: { email, sucesso: false, createdAt: { gte: desde } },
    }),
    prisma.tentativaLogin.count({
      where: { ip, sucesso: false, createdAt: { gte: desde } },
    }),
  ]);

  return falhasEmail >= LIMITE_POR_EMAIL || falhasIp >= LIMITE_POR_IP;
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

// Mesmo padrão de verificarBloqueioLogin (janela deslizante, conta por
// e-mail E por IP) — evita spam de e-mail de reset pro mesmo destinatário
// e limita um atacante disparando pedidos pra vários e-mails.
const JANELA_RESET_MS = 1000 * 60 * 15; // 15 minutos
const LIMITE_RESET_POR_EMAIL = 3;
const LIMITE_RESET_POR_IP = 10;

export async function verificarBloqueioResetSenha(email: string, ip: string): Promise<boolean> {
  const desde = new Date(Date.now() - JANELA_RESET_MS);

  const [tentativasEmail, tentativasIp] = await Promise.all([
    prisma.tentativaResetSenha.count({ where: { email, createdAt: { gte: desde } } }),
    prisma.tentativaResetSenha.count({ where: { ip, createdAt: { gte: desde } } }),
  ]);

  return tentativasEmail >= LIMITE_RESET_POR_EMAIL || tentativasIp >= LIMITE_RESET_POR_IP;
}

export async function registrarTentativaResetSenha(email: string, ip: string) {
  await prisma.tentativaResetSenha.create({ data: { email, ip } });
}

// Mesmo padrão de verificarBloqueioResetSenha, só que por usuarioId em vez
// de email — nesse ponto do fluxo o usuário já está autenticado (ver
// src/app/verificar-email/actions.ts), não precisa aceitar e-mail cru.
// Limita quantos códigos NOVOS podem ser pedidos; quantos PALPITES cada
// código aceita é uma trava separada (ver LIMITE_TENTATIVAS em
// src/lib/auth/verificacao-email.ts).
const JANELA_VERIFICACAO_EMAIL_MS = 1000 * 60 * 15; // 15 minutos
const LIMITE_VERIFICACAO_EMAIL_POR_USUARIO = 3;
const LIMITE_VERIFICACAO_EMAIL_POR_IP = 10;

export async function verificarBloqueioVerificacaoEmail(
  usuarioId: string,
  ip: string
): Promise<boolean> {
  const desde = new Date(Date.now() - JANELA_VERIFICACAO_EMAIL_MS);

  const [tentativasUsuario, tentativasIp] = await Promise.all([
    prisma.tentativaVerificacaoEmail.count({ where: { usuarioId, createdAt: { gte: desde } } }),
    prisma.tentativaVerificacaoEmail.count({ where: { ip, createdAt: { gte: desde } } }),
  ]);

  return (
    tentativasUsuario >= LIMITE_VERIFICACAO_EMAIL_POR_USUARIO ||
    tentativasIp >= LIMITE_VERIFICACAO_EMAIL_POR_IP
  );
}

export async function registrarTentativaVerificacaoEmail(usuarioId: string, ip: string) {
  await prisma.tentativaVerificacaoEmail.create({ data: { usuarioId, ip } });
}
