import "server-only";

import { randomInt } from "crypto";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/auth/session";
import { dispararEventoEmail } from "./webhook-email";
import { templateVerificacaoEmail } from "./templates";

const EXPIRACAO_MS = 1000 * 60 * 15; // 15 minutos

// Usada tanto no cadastro (envio inicial, ver src/app/registro/actions.ts)
// quanto no botão "reenviar código" (ver src/app/verificar-email/actions.ts)
// — um único lugar gera o código, guarda o hash e dispara o e-mail.
export async function gerarEEnviarCodigoVerificacao(usuario: {
  id: string;
  email: string;
}): Promise<void> {
  // randomInt (crypto), não Math.random — mesmo cuidado de segurança que
  // gerarTokenBruto já tem pro token de reset de senha.
  const codigo = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const codigoHash = hashToken(codigo);

  await prisma.$transaction([
    // Invalida qualquer código anterior ainda não usado — só o mais
    // recente pode ser digitado, evita dois códigos válidos em paralelo
    // (ex: usuário pede reenvio mas ainda tem o e-mail antigo aberto).
    prisma.tokenVerificacaoEmail.updateMany({
      where: { usuarioId: usuario.id, usadoEm: null },
      data: { usadoEm: new Date() },
    }),
    prisma.tokenVerificacaoEmail.create({
      data: {
        usuarioId: usuario.id,
        codigoHash,
        expiraEm: new Date(Date.now() + EXPIRACAO_MS),
      },
    }),
  ]);

  const { assunto, html, texto } = templateVerificacaoEmail(codigo);
  // after() em vez de await: o código já está gravado no banco (transação
  // acima) antes de chegar aqui, então o disparo do e-mail em si é
  // fire-and-forget — não faz sentido bloquear quem chama esta função (ex:
  // o cadastro em src/app/registro/actions.ts) esperando o webhook
  // terminar. after() garante que a instância serverless continua viva até
  // o e-mail terminar de enviar, mesmo depois da resposta já ter ido pro
  // cliente — ao contrário de um `void` solto, que arriscaria ser cortado
  // no meio se a instância for congelada logo após a resposta.
  after(() =>
    dispararEventoEmail({
      tipo: "verificacao_email_codigo",
      destinatario: usuario.email,
      assunto,
      html,
      texto,
    })
  );
}
