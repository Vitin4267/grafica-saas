import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Guarda estática (não-DB, não precisa de Postgres) — cobre o achado F8 da
// Parte 7 da auditoria de abrangência (pesquisa-abrangencia-modulos.md):
// cor especial/Pantone (CorEspecialCliente/OrcamentoItemCor) é puramente
// descritivo/organizacional, mesmo espírito de OrcamentoItemHotStamping/
// OrcamentoItemEtiqueta — nunca deve entrar no motor de preço. Mesmo padrão
// de guarda já usado pelo achado C5 (ver
// src/app/catalogo/[itemGraficaId]/acabamento-estrutural.test.ts): confirma
// em CI que nenhum arquivo em src/lib/pricing/ referencia os campos novos,
// pra um import futuro acidental falhar o build em vez de só ser pego numa
// revisão manual.
describe("achado F8 — cor especial nunca entra no motor de preço", () => {
  it("nenhum arquivo em src/lib/pricing/ referencia corEspecialId/nomeDeclarado/CorEspecialCliente/OrcamentoItemCor", () => {
    const pricingDir = join(process.cwd(), "src", "lib", "pricing");
    const proibidos = [
      "corEspecialId",
      "nomeDeclarado",
      "CorEspecialCliente",
      "OrcamentoItemCor",
      "coresEspeciais",
      "salvarNaBiblioteca",
    ];

    function coletarArquivos(dir: string): string[] {
      const resultado: string[] = [];
      for (const entrada of readdirSync(dir, { withFileTypes: true })) {
        const caminho = join(dir, entrada.name);
        if (entrada.isDirectory()) {
          resultado.push(...coletarArquivos(caminho));
        } else if (entrada.isFile() && /\.(ts|tsx)$/.test(entrada.name)) {
          resultado.push(caminho);
        }
      }
      return resultado;
    }

    const arquivos = coletarArquivos(pricingDir);
    expect(arquivos.length).toBeGreaterThan(0);

    for (const arquivo of arquivos) {
      const conteudo = readFileSync(arquivo, "utf-8");
      for (const termo of proibidos) {
        expect(conteudo.includes(termo), `${arquivo} não deveria referenciar "${termo}"`).toBe(false);
      }
    }
  });
});
