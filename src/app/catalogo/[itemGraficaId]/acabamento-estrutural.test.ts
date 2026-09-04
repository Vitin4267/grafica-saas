import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de src/app/configuracoes/ferramentais/actions.test.ts) — cobre
// o achado C5 da Parte 7 da auditoria de abrangência
// (pesquisa-abrangencia-modulos.md, "Completude de cadastro"): dropdown
// estruturado de dobra/encadernação/colagem pra SERVICO fora do motor de
// etiqueta.
//
// SÓ RODA DE VERDADE depois que a migration
// prisma/migrations/20260904130000_acabamento_estrutural_dobra_encadernacao_colagem/migration.sql
// tiver sido aplicada no banco (colunas tipoDobra/tipoEncadernacao/
// tipoColagem + *Outro em "itens_grafica" ainda não existem até lá).

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));

vi.mock("@/lib/auth/session", () => ({
  exigirUsuarioAutenticado: vi.fn(),
}));
vi.mock("@/lib/auth/email-verificacao", () => ({
  exigirEmailVerificado: vi.fn(async () => {}),
}));
vi.mock("@/lib/auth/assinatura", () => ({
  exigirAssinaturaAtiva: vi.fn(async () => {}),
}));

import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { salvarAcabamentoEstrutural } from "./actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

type Fixture = {
  graficaId: string;
  usuarioDonoId: string;
  usuarioOperadorId: string; // sem nenhuma PermissaoUsuario — nunca pode editar
  itemGraficaId: string;
};

const graficaIdsParaLimpar: string[] = [];

async function criarFixture(): Promise<Fixture> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Acabamento Estrutural ${s}`, slug: `teste-acabamento-estrutural-${s}` },
  });
  const usuarioDono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-acabamento-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
      emailVerificadoEm: new Date(),
    },
  });
  const usuarioOperador = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Operador ${s}`,
      email: `operador-acabamento-${s}@example.com`,
      senhaHash: "x",
      papel: "OPERADOR",
      emailVerificadoEm: new Date(),
    },
  });
  const catalogo = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "SERVICO", categoria: "Acabamento", nome: `Dobra ${s}` },
  });
  const itemGrafica = await prisma.itemGrafica.create({
    data: { graficaId: grafica.id, itemCatalogoId: catalogo.id },
  });

  graficaIdsParaLimpar.push(grafica.id);

  return {
    graficaId: grafica.id,
    usuarioDonoId: usuarioDono.id,
    usuarioOperadorId: usuarioOperador.id,
    itemGraficaId: itemGrafica.id,
  };
}

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.itemGrafica.deleteMany({ where: { graficaId } });
    await prisma.itemCatalogo.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
}, TIMEOUT_MS);

async function comoUsuario(usuarioId: string) {
  const usuario = await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } });
  vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(usuario as never);
}

describe("salvarAcabamentoEstrutural (achado C5)", () => {
  it(
    "salva tipoDobra fechado (sem OUTRO) e não grava tipoDobraOutro",
    async () => {
      const f = await criarFixture();
      await comoUsuario(f.usuarioDonoId);

      const fd = new FormData();
      fd.set("itemGraficaId", f.itemGraficaId);
      fd.set("tipoDobra", "SANFONA");

      const resultado = await salvarAcabamentoEstrutural(null, fd);
      expect(resultado.ok).toBe(true);

      const item = await prisma.itemGrafica.findUniqueOrThrow({ where: { id: f.itemGraficaId } });
      expect(item.tipoDobra).toBe("SANFONA");
      expect(item.tipoDobraOutro).toBeNull();
      expect(item.tipoEncadernacao).toBeNull();
      expect(item.tipoColagem).toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "tipoEncadernacao=OUTRO grava o texto livre em tipoEncadernacaoOutro",
    async () => {
      const f = await criarFixture();
      await comoUsuario(f.usuarioDonoId);

      const fd = new FormData();
      fd.set("itemGraficaId", f.itemGraficaId);
      fd.set("tipoEncadernacao", "OUTRO");
      fd.set("tipoEncadernacaoOutro", "Encadernação japonesa");

      const resultado = await salvarAcabamentoEstrutural(null, fd);
      expect(resultado.ok).toBe(true);

      const item = await prisma.itemGrafica.findUniqueOrThrow({ where: { id: f.itemGraficaId } });
      expect(item.tipoEncadernacao).toBe("OUTRO");
      expect(item.tipoEncadernacaoOutro).toBe("Encadernação japonesa");
    },
    TIMEOUT_MS
  );

  it(
    "trocar de OUTRO pra um tipo fechado limpa o campo *Outro anterior",
    async () => {
      const f = await criarFixture();
      await comoUsuario(f.usuarioDonoId);

      const fdOutro = new FormData();
      fdOutro.set("itemGraficaId", f.itemGraficaId);
      fdOutro.set("tipoColagem", "OUTRO");
      fdOutro.set("tipoColagemOutro", "Cola hot melt reforçada");
      await salvarAcabamentoEstrutural(null, fdOutro);

      const fdFechado = new FormData();
      fdFechado.set("itemGraficaId", f.itemGraficaId);
      fdFechado.set("tipoColagem", "PUR");
      const resultado = await salvarAcabamentoEstrutural(null, fdFechado);
      expect(resultado.ok).toBe(true);

      const item = await prisma.itemGrafica.findUniqueOrThrow({ where: { id: f.itemGraficaId } });
      expect(item.tipoColagem).toBe("PUR");
      expect(item.tipoColagemOutro).toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "os 3 campos são independentes e podem ser salvos juntos",
    async () => {
      const f = await criarFixture();
      await comoUsuario(f.usuarioDonoId);

      const fd = new FormData();
      fd.set("itemGraficaId", f.itemGraficaId);
      fd.set("tipoDobra", "MEIA_DOBRA");
      fd.set("tipoEncadernacao", "WIRE_O");
      fd.set("tipoColagem", "COLA_FRIA");

      const resultado = await salvarAcabamentoEstrutural(null, fd);
      expect(resultado.ok).toBe(true);

      const item = await prisma.itemGrafica.findUniqueOrThrow({ where: { id: f.itemGraficaId } });
      expect(item.tipoDobra).toBe("MEIA_DOBRA");
      expect(item.tipoEncadernacao).toBe("WIRE_O");
      expect(item.tipoColagem).toBe("COLA_FRIA");
    },
    TIMEOUT_MS
  );

  it(
    "deixar em branco limpa a configuração de volta pra null",
    async () => {
      const f = await criarFixture();
      await comoUsuario(f.usuarioDonoId);

      const fdComValor = new FormData();
      fdComValor.set("itemGraficaId", f.itemGraficaId);
      fdComValor.set("tipoDobra", "CARTA");
      await salvarAcabamentoEstrutural(null, fdComValor);

      const fdVazio = new FormData();
      fdVazio.set("itemGraficaId", f.itemGraficaId);
      const resultado = await salvarAcabamentoEstrutural(null, fdVazio);
      expect(resultado.ok).toBe(true);

      const item = await prisma.itemGrafica.findUniqueOrThrow({ where: { id: f.itemGraficaId } });
      expect(item.tipoDobra).toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "isolamento de tenant: item de OUTRA gráfica é rejeitado",
    async () => {
      const f = await criarFixture();
      const outraFixture = await criarFixture();
      await comoUsuario(f.usuarioDonoId);

      const fd = new FormData();
      fd.set("itemGraficaId", outraFixture.itemGraficaId);
      fd.set("tipoDobra", "SANFONA");

      const resultado = await salvarAcabamentoEstrutural(null, fd);
      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toMatch(/não encontrado/i);

      const itemOutraGrafica = await prisma.itemGrafica.findUniqueOrThrow({
        where: { id: outraFixture.itemGraficaId },
      });
      expect(itemOutraGrafica.tipoDobra).toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "RBAC — OPERADOR sem permissão de CATALOGO não consegue salvar",
    async () => {
      const f = await criarFixture();
      await comoUsuario(f.usuarioOperadorId);

      const fd = new FormData();
      fd.set("itemGraficaId", f.itemGraficaId);
      fd.set("tipoDobra", "SANFONA");

      const resultado = await salvarAcabamentoEstrutural(null, fd);
      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toMatch(/não tem permissão/i);

      const item = await prisma.itemGrafica.findUniqueOrThrow({ where: { id: f.itemGraficaId } });
      expect(item.tipoDobra).toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "tipo inválido (fora do enum) é rejeitado, nada é gravado",
    async () => {
      const f = await criarFixture();
      await comoUsuario(f.usuarioDonoId);

      const fd = new FormData();
      fd.set("itemGraficaId", f.itemGraficaId);
      fd.set("tipoDobra", "TIPO_QUE_NAO_EXISTE");

      const resultado = await salvarAcabamentoEstrutural(null, fd);
      expect(resultado.ok).toBe(false);

      const item = await prisma.itemGrafica.findUniqueOrThrow({ where: { id: f.itemGraficaId } });
      expect(item.tipoDobra).toBeNull();
    },
    TIMEOUT_MS
  );
});

// Guarda estática (não-DB): confirma que os 3 campos puramente descritivos
// nunca são lidos por src/lib/pricing/ — reforça em CI a garantia do
// comentário no schema ("NUNCA lido por src/lib/pricing/"), pra um import
// futuro acidental (ex: alguém copiando o padrão de EstagioAcabamento sem
// perceber que este aqui é ainda mais restrito) falhar o build em vez de
// só ser pego numa revisão manual.
describe("achado C5 — campos nunca entram no motor de preço", () => {
  it("nenhum arquivo em src/lib/pricing/ referencia tipoDobra/tipoEncadernacao/tipoColagem", () => {
    const pricingDir = join(process.cwd(), "src", "lib", "pricing");
    const proibidos = [
      "tipoDobra",
      "tipoDobraOutro",
      "tipoEncadernacao",
      "tipoEncadernacaoOutro",
      "tipoColagem",
      "tipoColagemOutro",
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
        expect(conteudo.includes(termo), `${arquivo} não deveria referenciar "${termo}"`).toBe(
          false
        );
      }
    }
  });
});
