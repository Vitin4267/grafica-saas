import { defineConfig } from "vitest/config";
import path from "node:path";

// TODO: sem `environment: "jsdom"` e sem jsdom/@testing-library/react instalados
// — hoje ok porque os únicos testes (src/lib/pricing/__tests__) são funções
// puras, sem DOM. No dia em que testar um componente React, instalar jsdom (ou
// happy-dom) + @testing-library/react e configurar `environment: "jsdom"` aqui.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // Ver src/test/server-only-stub.ts — o pacote real só funciona dentro
      // do bundling do Next.js.
      "server-only": path.resolve(__dirname, "src/test/server-only-stub.ts"),
    },
  },
});
