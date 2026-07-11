// Monitoramento de erro do lado do navegador — mesma lógica opt-in do
// instrumentation.ts, mas com NEXT_PUBLIC_ porque precisa rodar no bundle do
// cliente (o DSN do Sentry não é segredo, é feito pra ser público — só
// identifica pra qual projeto mandar o erro).
import * as Sentry from "@sentry/nextjs";

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0,
  });
}
