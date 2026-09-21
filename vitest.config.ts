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
      // Achado investigando CI vermelho (2026-09-21): src/lib/rls.test.ts é
      // o ÚNICO arquivo que chama definirTenantAtual/semTenant diretamente
      // (ver tenant-context.ts) — essas funções guardam estado numa
      // AsyncLocalStorage de ESCOPO DE MÓDULO, compartilhada por QUALQUER
      // client criado via criarClient() (src/lib/prisma.ts), inclusive o
      // client próprio de rls.test.ts. Com esse arquivo rodando junto dos
      // outros 224, algum operação assíncrona dele ficava "em voo" bem na
      // hora em que outro arquivo, tocando um model diferente, também
      // rodava — o guard de isolamento (Fase A, conferirIsolamentoTenant)
      // via um tenantAtivo de OUTRO teste e travava com
      // ErroIsolamentoTenant, um falso positivo (não é bug de RLS/dado
      // real, é vazamento de contexto de teste). PRIMEIRA tentativa de fix
      // (fileParallelism:false, forçar todos os arquivos em série) passou
      // limpo 2x local mas NÃO resolveu no CI — sequencial dentro do MESMO
      // processo/worker não é isolamento de verdade se o módulo não é
      // recarregado. Fix definitivo: exclui rls.test.ts da suíte principal
      // e roda ele sozinho, em processo `vitest` totalmente separado (ver
      // "test:rls"/"test:geral" no package.json e o workflow de CI) — a
      // ÚNICA garantia de isolamento que não depende de entender o
      // mecanismo exato do vazamento.
      exclude: ["**/node_modules/**", "src/lib/rls.test.ts"],
      // Ver src/test/setup.ts — zera contextoTenant antes de cada teste,
      // defesa em profundidade contra vazamento de enterWith entre testes
      // (mesmo achado que motivou isolar rls.test.ts acima, mas cobre
      // QUALQUER fonte do vazamento, não só aquele arquivo específico).
      setupFiles: ["src/test/setup.ts"],
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
