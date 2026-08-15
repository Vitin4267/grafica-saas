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
//
// opcoes.aguardarEnvio controla COMO o e-mail é disparado:
// - false/omitido (cadastro): via after(), fire-and-forget — não vale a pena
//   segurar o redirect do cadastro esperando o webhook responder. Retorna
//   `null`: o resultado do envio simplesmente não é conhecido nesse modo.
// - true (reenvio de código): aguarda o disparo de verdade (até TIMEOUT_MS
//   dentro de dispararEventoEmail) e devolve o resultado — o usuário está
//   parado na tela esperando o código, então vale a pena esperar pra poder
//   contar pra ele se realmente funcionou (ver src/app/verificar-email/actions.ts).
export async function gerarEEnviarCodigoVerificacao(
  usuario: {
    id: string;
    email: string;
    graficaId: string;
  },
  opcoes?: { aguardarEnvio?: boolean }
): Promise<boolean | null> {
  // randomInt (crypto), não Math.random — mesmo cuidado de segurança que
  // gerarTokenBruto já tem pro token de reset de senha.
  const codigo = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const codigoHash = hashToken(codigo);

  // Cor da marca da gráfica pro e-mail (ver templateVerificacaoEmail) — só o
  // campo corPrimaria, nada mais; graficaId já veio no `usuario` que o
  // chamador passou (sempre um registro completo de Usuario, ver
  // src/app/registro/actions.ts e src/app/verificar-email/actions.ts).
  const grafica = await prisma.grafica.findUnique({
    where: { id: usuario.graficaId },
    select: { corPrimaria: true },
  });

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

  const { assunto, html, texto } = templateVerificacaoEmail(codigo, grafica?.corPrimaria);
  const evento = {
    tipo: "verificacao_email_codigo" as const,
    destinatario: usuario.email,
    assunto,
    html,
    texto,
  };

  if (opcoes?.aguardarEnvio) {
    // Reenvio de código: o usuário está parado na tela de verificação
    // esperando, então vale a pena aguardar o disparo de verdade (até
    // TIMEOUT_MS, ver webhook-email.ts) pra poder contar pra ele se
    // funcionou ou não — ver src/app/verificar-email/actions.ts.
    return dispararEventoEmail(evento);
  }

  // after() em vez de await: o código já está gravado no banco (transação
  // acima) antes de chegar aqui, então o disparo do e-mail em si é
  // fire-and-forget — não faz sentido bloquear quem chama esta função (ex:
  // o cadastro em src/app/registro/actions.ts) esperando o webhook
  // terminar. after() garante que a instância serverless continua viva até
  // o e-mail terminar de enviar, mesmo depois da resposta já ter ido pro
  // cliente — ao contrário de um `void` solto, que arriscaria ser cortado
  // no meio se a instância for congelada logo após a resposta. O resultado
  // não é conhecido nesse modo (por isso `null`, não `false`).
  after(() => dispararEventoEmail(evento));
  return null;
}
