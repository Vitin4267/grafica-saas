// Monitoramento de erro do lado do servidor — 100% opt-in via SENTRY_DSN.
// Sem essa variável configurada, o SDK simplesmente não inicializa e nada é
// enviado a lugar nenhum (mesmo princípio das outras integrações do projeto:
// Focus NFe e o assistente de IA só "ligam" quando a gráfica configura algo).
// Crie uma conta grátis em https://sentry.io, pegue o DSN do projeto e cole
// em SENTRY_DSN no .env pra ativar.
import * as Sentry from "@sentry/nextjs";

// O token de /a/[token] e /o/[token] é a CREDENCIAL de acesso (aprova arte/
// orçamento sem login) — ele vai no PATH, não em query string, então nenhum
// scrubbing padrão do Sentry (que mira em querystring/body) o remove
// sozinho. Sem isso, um erro não tratado numa dessas rotas deixava o token
// legível em texto claro no dashboard do Sentry pra qualquer um com acesso
// ao projeto lá, indefinidamente (achado da auditoria de 2026-07-26).
function redigirTokenPublico(url: string): string {
  return url.replace(/\/(a|o)\/[^/?#]+/, "/$1/[redacted]");
}

export function register() {
  if (!process.env.SENTRY_DSN) return;

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0,
    beforeSend(event) {
      if (event.request?.url) {
        event.request.url = redigirTokenPublico(event.request.url);
      }
      if (typeof event.transaction === "string") {
        event.transaction = redigirTokenPublico(event.transaction);
      }
      return event;
    },
  });
}

export const onRequestError = Sentry.captureRequestError;
