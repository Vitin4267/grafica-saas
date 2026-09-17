import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import path from "node:path";

// TODO: sem `environment: "jsdom"` e sem jsdom/@testing-library/react instalados
// — hoje ok porque os únicos testes de componente React ainda não existem
// (só lógica pura + os testes de integração abaixo, sem DOM). No dia em que
// testar um componente React, instalar jsdom (ou happy-dom) +
// @testing-library/react e configurar `environment: "jsdom"` aqui.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  // Achado rodando a suíte inteira depois de ligar RLS de verdade no piloto
  // (2026-09-17): DATABASE_URL local já é o role restrito `grafica_app`
  // (mesmo achado de menor privilégio) — sem esta troca, ~86 arquivos de
  // fixture que criam Cliente/Pedido/etc. sem estabelecer contexto de
  // tenant (a maioria mocka autenticação) quebram com "new row violates
  // row-level security policy" (INSERT com RETURNING exige a policy de
  // SELECT passar, não só a de INSERT — ver comentário no migration.sql).
  // Mesmo fix já aplicado no CI (.github/workflows/test.yml): a suíte
  // geral roda como o role owner (aqui, MIGRATION_DATABASE_URL — em CI, o
  // Postgres descartável já é superuser por padrão); só
  // src/lib/rls.test.ts testa RLS de verdade, com seu PRÓPRIO client via
  // RLS_TEST_DATABASE_URL (ou DATABASE_URL original), sem depender desta
  // sobrescrita. `npm run dev` continua intocado — só lê `.env` direto,
  // nunca passa por este arquivo — então local dev sempre roda como
  // `grafica_app` de verdade, igual produção.
  if (env.MIGRATION_DATABASE_URL) {
    env.RLS_TEST_DATABASE_URL = env.RLS_TEST_DATABASE_URL ?? env.DATABASE_URL;
    env.DATABASE_URL = env.MIGRATION_DATABASE_URL;
  }

  return {
    test: {
      include: ["src/**/*.test.ts"],
      // Alguns testes (ver *.test.ts que importam @/lib/prisma — rate-limit,
      // checkout-reserva, catalogo-ncm) são integração de verdade contra o
      // Postgres de dev, não lógica pura: precisam de DATABASE_URL. `next dev`/
      // `prisma` carregam `.env` sozinhos; o Vitest não, então sem isso
      // `npm test` falhava com "Can't reach database server" pra quem rodasse
      // fora de um shell com o `.env` já exportado (achado ao terminar a
      // auditoria de 2026-07-23 — carregamento oficial recomendado pelo Vite).
      env,
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
        // Ver src/test/server-only-stub.ts — o pacote real só funciona dentro
        // do bundling do Next.js.
        "server-only": path.resolve(__dirname, "src/test/server-only-stub.ts"),
      },
    },
  };
});
