"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

// Só entra em ação se o PRÓPRIO layout raiz quebrar (caso raríssimo) — por
// isso precisa definir <html>/<body> do zero e evita depender de qualquer
// outro componente/CSS da aplicação: se algo básico já quebrou, queremos que
// esta tela ainda funcione de qualquer jeito.
export default function GlobalError({
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
    <html lang="pt-BR">
      <body
        style={{
          display: "flex",
          minHeight: "100vh",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1.5rem",
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
          padding: "2rem",
          margin: 0,
        }}
      >
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#0f172a" }}>
          Algo deu errado
        </h1>
        <p style={{ color: "#64748b", maxWidth: "24rem" }}>
          Encontramos um erro inesperado ao carregar o site. Já registramos o
          problema.
        </p>
        <button
          onClick={() => unstable_retry()}
          style={{
            borderRadius: "0.75rem",
            background: "#0d9488",
            color: "white",
            padding: "0.625rem 1.25rem",
            fontWeight: 500,
            border: "none",
            cursor: "pointer",
          }}
        >
          Tentar de novo
        </button>
      </body>
    </html>
  );
}
