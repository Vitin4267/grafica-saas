"use client";

import { useEffect } from "react";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/Button";
import { AlertTriangleIcon } from "@/components/icons";

// Error boundary de rota (não pega tudo — ver global-error.tsx pro caso raro
// do próprio layout raiz quebrar). Sentry.captureException é sempre seguro de
// chamar mesmo sem SENTRY_DSN configurado — o SDK só não envia nada.
export default function ErrorPage({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-20 text-center">
      <Logo />
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-50 text-rose-600 dark:bg-rose-950 dark:text-rose-400">
        <AlertTriangleIcon className="h-7 w-7" />
      </span>
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          Algo deu errado
        </h1>
        <p className="mt-2 max-w-sm text-slate-500">
          Encontramos um erro inesperado. Já registramos o problema — tente de
          novo em instantes.
        </p>
      </div>
      <div className="flex gap-3">
        <Button variant="primary" onClick={() => unstable_retry()}>
          Tentar de novo
        </Button>
        <Link href="/orcamento">
          <Button type="button" variant="outline">
            Voltar ao painel
          </Button>
        </Link>
      </div>
    </div>
  );
}
