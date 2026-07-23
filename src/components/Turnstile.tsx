"use client";

import { useTheme } from "next-themes";
import Script from "next/script";
import { useMontado } from "@/lib/hooks/useMontado";

// Widget do Cloudflare Turnstile — só existe se NEXT_PUBLIC_TURNSTILE_SITE_KEY
// estiver configurada (ver LoginForm.tsx), senão nem este componente é
// renderizado. Espera montar antes de decidir o tema (mesmo guard do
// ThemeToggle) pra não desenhar o widget com o tema errado por um instante.
export function Turnstile({ siteKey }: { siteKey: string }) {
  const { resolvedTheme } = useTheme();
  const montado = useMontado();

  if (!montado) {
    return <div className="h-[65px]" aria-hidden />;
  }

  return (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" async defer />
      <div
        className="cf-turnstile"
        data-sitekey={siteKey}
        data-theme={resolvedTheme === "dark" ? "dark" : "light"}
      />
    </>
  );
}
