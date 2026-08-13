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
// *.blob.vercel-storage.com (public E private): arte de pedido (/a/[token])
// e logo da gráfica (/configuracoes/identidade) são servidas direto da URL
// pública do Vercel Blob; a miniatura de imagem de análise de tinta
// (/orcamento/[id], ver OrcamentoItemTinta) usa blob PRIVADO com URL
// assinada temporária (src/lib/blob-assinado.ts), que vive em
// *.private.blob.vercel-storage.com — sem o wildcard cobrindo os dois, o
// navegador bloqueia o <img> por CSP mesmo com o arquivo carregando normalmente.
const cspHeader = `
  default-src 'self';
  script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com${isDev ? " 'unsafe-eval'" : ""};
  style-src 'self' 'unsafe-inline';
  img-src 'self' blob: data: https://*.blob.vercel-storage.com;
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
  experimental: {
    serverActions: {
      // Default do Next é 1MB — abaixo até do limite de logo (3MB), quanto
      // mais do de arte (30MB, ver validarArquivoArte em
      // src/lib/upload-validacao.ts). Sem isso, qualquer arquivo de verdade
      // (não só arte grande) estourava o parser do próprio Next ANTES de
      // enviarArte/salvarLogo rodar — e como esse erro acontece fora do
      // corpo da action, cai direto na error boundary genérica, sem
      // mensagem amigável nenhuma (bug real encontrado em produção). Mantido
      // com folga acima do limite de arte (não igual) — multipart tem
      // overhead de boundary/headers por campo.
      bodySizeLimit: "35mb",
    },
  },
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
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
          },
          // COOP/CORP (achado da auditoria de 2026-07-26): isolam a página
          // de outras janelas/origens que tentem referenciá-la via
          // window.opener ou embutir sua resposta como recurso — defesa em
          // profundidade barata, complementar ao X-Frame-Options/frame-ancestors
          // que já bloqueiam embutir ESTA página, não o inverso.
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
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
      // Rotas públicas por token (/a/[token], /o/[token]) nunca devem ser
      // indexadas — o link em si é a credencial (aprova orçamento/arte), e
      // link com token acaba em lugar crawlável com frequência real (preview
      // de WhatsApp/Telegram, encurtador de URL). robots.ts complementa isso
      // pros crawlers que respeitam robots.txt; este header cobre os que não
      // respeitam mas obedecem X-Robots-Tag.
      {
        source: "/(a|o)/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }],
      },
    ];
  },
};

export default nextConfig;
