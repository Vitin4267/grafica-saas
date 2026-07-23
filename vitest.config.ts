import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import path from "node:path";

// TODO: sem `environment: "jsdom"` e sem jsdom/@testing-library/react instalados
// — hoje ok porque os únicos testes de componente React ainda não existem
// (só lógica pura + os testes de integração abaixo, sem DOM). No dia em que
// testar um componente React, instalar jsdom (ou happy-dom) +
// @testing-library/react e configurar `environment: "jsdom"` aqui.
export default defineConfig(({ mode }) => ({
  test: {
    include: ["src/**/*.test.ts"],
    // Alguns testes (ver *.test.ts que importam @/lib/prisma — rate-limit,
    // checkout-reserva, catalogo-ncm) são integração de verdade contra o
    // Postgres de dev, não lógica pura: precisam de DATABASE_URL. `next dev`/
    // `prisma` carregam `.env` sozinhos; o Vitest não, então sem isso
    // `npm test` falhava com "Can't reach database server" pra quem rodasse
    // fora de um shell com o `.env` já exportado (achado ao terminar a
    // auditoria de 2026-07-23 — carregamento oficial recomendado pelo Vite).
    env: loadEnv(mode, process.cwd(), ""),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // Ver src/test/server-only-stub.ts — o pacote real só funciona dentro
      // do bundling do Next.js.
      "server-only": path.resolve(__dirname, "src/test/server-only-stub.ts"),
    },
  },
}));
