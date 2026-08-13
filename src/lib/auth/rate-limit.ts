import "server-only";

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

// Toda função "reservar*"/"tentar*" abaixo faz o CHECK (count das tentativas
// na janela) e o REGISTRO da nova tentativa dentro da MESMA transação
// Serializable — não duas chamadas Prisma separadas. Sem isso, era um
// clássico read-then-write: N requisições paralelas liam "4 tentativas" (1
// abaixo do limite) ANTES de qualquer uma delas gravar a sua, e todas
// passavam — furando o limite por concorrência. Sob Serializable, o Postgres
// detecta esse padrão (leitura de um range + escrita nesse mesmo range por
// transações concorrentes) e aborta uma delas com erro de serialização
// (ver ehConflitoDeSerializacao em src/lib/prisma-conflito.ts) — quem chama
// deve tratar esse erro como "bloqueado, tente de novo".

const JANELA_MS = 1000 * 60 * 15; // 15 minutos
const LIMITE_POR_EMAIL = 5;
const LIMITE_POR_IP = 20;

// Login precisa saber se a tentativa deu certo, e isso só se sabe DEPOIS do
// hash argon2id (50-150ms) — verificar senha dentro da transação seguraria
// a conexão aberta por esse tempo todo. Por isso o registro de login é em
// duas fases: reserva um registro sucesso:false ANTES de verificar a senha
// (fechando a race de contagem), e confirma pra sucesso:true depois, fora da
// transação, só se a senha bater.
export async function reservarTentativaLogin(
  email: string,
  ip: string
): Promise<{ id: string } | null> {
  const desde = new Date(Date.now() - JANELA_MS);
  return prisma.$transaction(
    async (tx) => {
      const [falhasEmail, falhasIp] = await Promise.all([
        tx.tentativaLogin.count({
          where: { email, sucesso: false, createdAt: { gte: desde } },
        }),
        tx.tentativaLogin.count({
          where: { ip, sucesso: false, createdAt: { gte: desde } },
        }),
      ]);
      if (falhasEmail >= LIMITE_POR_EMAIL || falhasIp >= LIMITE_POR_IP) {
        return null;
      }
      return tx.tentativaLogin.create({
        data: { email, ip, sucesso: false },
        select: { id: true },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}

export async function confirmarTentativaLoginBemSucedida(tentativaId: string) {
  await prisma.tentativaLogin.update({
    where: { id: tentativaId },
    data: { sucesso: true },
  });
}

// Afrouxado de 5/hora pra 8/30min (2026-07-11) — o valor original travou o
// próprio dono durante uma sessão de testes (várias tentativas automatizadas
// bateram no mesmo IP de loopback do dev local). Ainda exige esperar meia
// hora pra tentar de novo depois de esgotar a cota — continua caro pra um
// bot sustentar cadastro em massa, só dá mais folga pra erro de digitação/
// teste manual não travar por uma hora inteira.
const JANELA_REGISTRO_MS = 1000 * 60 * 30; // 30 minutos
const LIMITE_REGISTRO_POR_IP = 8;

// Sem operação cara entre o check e o registro (diferente do login) — check
// e create cabem juntos na mesma transação, sem precisar de reserva em duas
// fases. Retorna true = BLOQUEADO (nada foi registrado), false = passou (já
// registrado).
export async function tentarRegistrarCadastro(ip: string): Promise<boolean> {
  const desde = new Date(Date.now() - JANELA_REGISTRO_MS);
  return prisma.$transaction(
    async (tx) => {
      const tentativas = await tx.tentativaRegistro.count({
        where: { ip, createdAt: { gte: desde } },
      });
      if (tentativas >= LIMITE_REGISTRO_POR_IP) return true;
      await tx.tentativaRegistro.create({ data: { ip } });
      return false;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}

// Mesmo padrão de tentarRegistrarCadastro (janela deslizante, conta por
// e-mail E por IP) — evita spam de e-mail de reset pro mesmo destinatário
// e limita um atacante disparando pedidos pra vários e-mails.
const JANELA_RESET_MS = 1000 * 60 * 15; // 15 minutos
const LIMITE_RESET_POR_EMAIL = 3;
const LIMITE_RESET_POR_IP = 10;

export async function tentarRegistrarResetSenha(email: string, ip: string): Promise<boolean> {
  const desde = new Date(Date.now() - JANELA_RESET_MS);
  return prisma.$transaction(
    async (tx) => {
      const [tentativasEmail, tentativasIp] = await Promise.all([
        tx.tentativaResetSenha.count({ where: { email, createdAt: { gte: desde } } }),
        tx.tentativaResetSenha.count({ where: { ip, createdAt: { gte: desde } } }),
      ]);
      if (tentativasEmail >= LIMITE_RESET_POR_EMAIL || tentativasIp >= LIMITE_RESET_POR_IP) {
        return true;
      }
      await tx.tentativaResetSenha.create({ data: { email, ip } });
      return false;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}

// Mesmo padrão de tentarRegistrarResetSenha, só que por usuarioId em vez de
// email — nesse ponto do fluxo o usuário já está autenticado (ver
// src/app/verificar-email/actions.ts), não precisa aceitar e-mail cru.
// Limita quantos códigos NOVOS podem ser pedidos; quantos PALPITES cada
// código aceita é uma trava separada (ver LIMITE_TENTATIVAS em
// src/lib/auth/verificacao-email.ts).
const JANELA_VERIFICACAO_EMAIL_MS = 1000 * 60 * 15; // 15 minutos
const LIMITE_VERIFICACAO_EMAIL_POR_USUARIO = 3;
const LIMITE_VERIFICACAO_EMAIL_POR_IP = 10;

// Protege responderArtePublica (src/app/a/[token]/actions.ts): quem tem o
// token de um pedido consegue chamar a action indefinidamente — o branch
// "pedir alteração" não trava sozinho (diferente de "aprovar"), então cada
// chamada dispara um e-mail novo pro(s) DONO(s). Limita por pedidoId (o
// alvo real, não muda trocando de IP) e por IP (limita abuso espalhado por
// vários pedidos). Janela mais curta e limite mais alto que reset de senha
// de propósito: um cliente real pode legitimamente pedir 2-3 alterações
// seguidas numa conversa indo e voltando com a gráfica.
const JANELA_RESPOSTA_ARTE_MS = 1000 * 60 * 15; // 15 minutos
const LIMITE_RESPOSTA_ARTE_POR_PEDIDO = 5;
const LIMITE_RESPOSTA_ARTE_POR_IP = 15;

export async function tentarRegistrarRespostaArte(pedidoId: string, ip: string): Promise<boolean> {
  const desde = new Date(Date.now() - JANELA_RESPOSTA_ARTE_MS);
  return prisma.$transaction(
    async (tx) => {
      const [tentativasPedido, tentativasIp] = await Promise.all([
        tx.tentativaRespostaArte.count({ where: { pedidoId, createdAt: { gte: desde } } }),
        tx.tentativaRespostaArte.count({ where: { ip, createdAt: { gte: desde } } }),
      ]);
      if (
        tentativasPedido >= LIMITE_RESPOSTA_ARTE_POR_PEDIDO ||
        tentativasIp >= LIMITE_RESPOSTA_ARTE_POR_IP
      ) {
        return true;
      }
      await tx.tentativaRespostaArte.create({ data: { pedidoId, ip } });
      return false;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}

export async function tentarRegistrarVerificacaoEmail(
  usuarioId: string,
  ip: string
): Promise<boolean> {
  const desde = new Date(Date.now() - JANELA_VERIFICACAO_EMAIL_MS);
  return prisma.$transaction(
    async (tx) => {
      const [tentativasUsuario, tentativasIp] = await Promise.all([
        tx.tentativaVerificacaoEmail.count({ where: { usuarioId, createdAt: { gte: desde } } }),
        tx.tentativaVerificacaoEmail.count({ where: { ip, createdAt: { gte: desde } } }),
      ]);
      if (
        tentativasUsuario >= LIMITE_VERIFICACAO_EMAIL_POR_USUARIO ||
        tentativasIp >= LIMITE_VERIFICACAO_EMAIL_POR_IP
      ) {
        return true;
      }
      await tx.tentativaVerificacaoEmail.create({ data: { usuarioId, ip } });
      return false;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}
