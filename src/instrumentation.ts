// Monitoramento de erro do lado do servidor — 100% opt-in via SENTRY_DSN.
// Sem essa variável configurada, o SDK simplesmente não inicializa e nada é
// enviado a lugar nenhum (mesmo princípio das outras integrações do projeto:
// Focus NFe e o assistente de IA só "ligam" quando a gráfica configura algo).
// Crie uma conta grátis em https://sentry.io, pegue o DSN do projeto e cole
// em SENTRY_DSN no .env pra ativar.
import * as Sentry from "@sentry/nextjs";

export function register() {
  if (!process.env.SENTRY_DSN) return;

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0,
  });
}

export const onRequestError = Sentry.captureRequestError;
