import type { MetadataRoute } from "next";

// Bloqueia indexação das rotas públicas por token — o token EM SI é a
// credencial de acesso (aprova orçamento em /o/[token], aprova arte em
// /a/[token]), e esses links circulam por canais que às vezes acabam
// crawláveis (preview de WhatsApp/Telegram, encurtador). Complementa o
// header X-Robots-Tag em next.config.ts, que cobre os crawlers que ignoram
// robots.txt mas respeitam o header.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      disallow: ["/a/", "/o/"],
    },
  };
}
