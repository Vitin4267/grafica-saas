import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import path from "node:path";

// Config SEPARADA só pra src/lib/rls.test.ts — ver o comentário completo em
// vitest.config.ts (exclude) pro porquê: esse arquivo é o único que chama
// definirTenantAtual/semTenant diretamente, e rodar ele junto dos outros
// 224 causava falso positivo de ErroIsolamentoTenant no CI (vazamento de
// contexto entre arquivos). Roda como processo `vitest` totalmente
// separado (ver "test" no package.json) — isolamento garantido, não
// depende de entender o mecanismo exato do vazamento.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  if (env.MIGRATION_DATABASE_URL) {
    env.RLS_TEST_DATABASE_URL = env.RLS_TEST_DATABASE_URL ?? env.DATABASE_URL;
    env.DATABASE_URL = env.MIGRATION_DATABASE_URL;
  }

  return {
    test: {
      include: ["src/lib/rls.test.ts"],
      env,
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
        "server-only": path.resolve(__dirname, "src/test/server-only-stub.ts"),
      },
    },
  };
});
