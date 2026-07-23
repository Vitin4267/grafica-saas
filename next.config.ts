import type { NextConfig } from "next";

// CSP sem nonce (a app não tem infraestrutura de proxy.ts pra gerar um por
// requisição hoje) — ainda assim reduz bastante a superfície de XSS/clickjacking:
// bloqueia script/objeto/frame de qualquer origem que não seja a própria app,
// e 'unsafe-inline' em script/style fica só porque o bootstrap do próprio
// Next.js precisa disso sem nonce (não há HTML gerado a partir de entrada do
// usuário em lugar nenhum do código — sem dangerouslySetInnerHTML no projeto).
const isDev = process.env.NODE_ENV === "development";
// challenges.cloudflare.com: widget do Turnstile na tela de login (opcional,
// só carrega se NEXT_PUBLIC_TURNSTILE_SITE_KEY estiver configurada — ver
// src/components/Turnstile.tsx). Precisa de script (carrega o widget),
// frame (o desafio roda num iframe) e connect (o widget confirma via XHR).
// *.public.blob.vercel-storage.com: arte de pedido (/a/[token]) e logo da
// gráfica (/configuracoes/identidade) são servidos direto da URL pública do
// Vercel Blob, não proxiados pelo próprio domínio — sem isso o navegador
// bloqueia o <img> por CSP mesmo com o arquivo carregando normalmente.
const cspHeader = `
  default-src 'self';
  script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com${isDev ? " 'unsafe-eval'" : ""};
  style-src 'self' 'unsafe-inline';
  img-src 'self' blob: data: https://*.public.blob.vercel-storage.com;
  font-src 'self';
  connect-src 'self' https://challenges.cloudflare.com;
  frame-src https://challenges.cloudflare.com;
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'none';
  upgrade-insecure-requests;
`
  .replace(/\s{2,}/g, " ")
  .trim();

const nextConfig: NextConfig = {
  // Achado do scan ZAP de 2026-07-23: por padrão o Next.js manda
  // "X-Powered-By: Next.js" em toda resposta — não é uma vulnerabilidade em
  // si, mas facilita fingerprinting do stack pra quem for atacar. Sem custo
  // nenhum desligar.
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Content-Security-Policy", value: cspHeader },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          ...(process.env.NODE_ENV === "production"
            ? [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=63072000; includeSubDomains; preload",
                },
              ]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;
