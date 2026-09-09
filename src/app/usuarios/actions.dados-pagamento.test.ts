import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de actions.multi-cargo.test.ts) — cobre o achado D3 da
// auditoria de abrangência (Parte 7/Pessoas, pesquisa-abrangencia-modulos.md,
// 2026-09-09): pra ONDE a gráfica paga cada usuário (CPF/chave PIX/
// especialidade), reaproveitando o enum TipoChavePix já existente (achado
// F6, sentido oposto — Grafica.chavePix é pra RECEBER do cliente).
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
import { salvarDadosPagamentoUsuarios } from "./actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const graficaIdsParaLimpar: string[] = [];

async function criarFixture() {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Dados Pagamento ${s}`, slug: `teste-dados-pagamento-${s}` },
  });
  const dono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-dados-pagamento-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const vendedor = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Vendedor ${s}`,
      email: `vendedor-dados-pagamento-${s}@example.com`,
      senhaHash: "x",
      papel: "OPERADOR",
    },
  });
  const desativado = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Desativado ${s}`,
      email: `desativado-dados-pagamento-${s}@example.com`,
      senhaHash: "x",
      papel: "OPERADOR",
      desativadoEm: new Date(),
    },
  });
  graficaIdsParaLimpar.push(grafica.id);
  return { graficaId: grafica.id, donoId: dono.id, vendedorId: vendedor.id, desativadoId: desativado.id };
}

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
}, TIMEOUT_MS);

async function comoDono(donoId: string) {
  const dono = await prisma.usuario.findUniqueOrThrow({ where: { id: donoId } });
  vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(dono as never);
}

describe("salvarDadosPagamentoUsuarios (achado D3)", () => {
  it(
    "grava CPF/chave PIX/tipo/especialidade e o log de auditoria NÃO contém o valor de CPF nem PIX",
    async () => {
      const f = await criarFixture();
      await comoDono(f.donoId);

      const fd = new FormData();
      fd.set(`cpf_${f.vendedorId}`, "123.456.789-00");
      fd.set(`chavePix_${f.vendedorId}`, "vendedor@example.com");
      fd.set(`tipoChavePix_${f.vendedorId}`, "EMAIL");
      fd.set(`especialidade_${f.vendedorId}`, "Vendedor externo");

      const resultado = await salvarDadosPagamentoUsuarios(null, fd);
      expect(resultado.ok).toBe(true);

      const atualizado = await prisma.usuario.findUniqueOrThrow({ where: { id: f.vendedorId } });
      expect(atualizado.cpf).toBe("123.456.789-00");
      expect(atualizado.chavePix).toBe("vendedor@example.com");
      expect(atualizado.tipoChavePix).toBe("EMAIL");
      expect(atualizado.especialidade).toBe("Vendedor externo");

      const logs = await prisma.logAuditoria.findMany({
        where: { graficaId: f.graficaId, acao: "usuario.salvar_dados_pagamento" },
      });
      expect(logs).toHaveLength(1);
      // Só o NOME dos campos que mudaram pode aparecer, nunca o CONTEÚDO
      // sensível — ver missão: "CPF/PIX atualizado" sem o valor.
      expect(logs[0].descricao).toMatch(/CPF/);
      expect(logs[0].descricao).toMatch(/Chave PIX/);
      expect(logs[0].descricao).not.toContain("123.456.789-00");
      expect(logs[0].descricao).not.toContain("vendedor@example.com");
      expect(logs[0].valorAnterior ?? "").not.toContain("123.456.789-00");
      expect(logs[0].valorNovo ?? "").not.toContain("123.456.789-00");
    },
    TIMEOUT_MS
  );

  it(
    "tipo de chave PIX inválido é rejeitado, e nada é gravado pra ninguém (falha rápido no primeiro usuário inválido)",
    async () => {
      const f = await criarFixture();
      await comoDono(f.donoId);

      const fd = new FormData();
      fd.set(`tipoChavePix_${f.vendedorId}`, "BITCOIN");

      const resultado = await salvarDadosPagamentoUsuarios(null, fd);
      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toMatch(/tipo de chave pix inválido/i);

      const inalterado = await prisma.usuario.findUniqueOrThrow({ where: { id: f.vendedorId } });
      expect(inalterado.chavePix).toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "usuário desativado não é afetado e não tem os campos zerados por falta de campo no formData",
    async () => {
      const f = await criarFixture();
      await prisma.usuario.update({
        where: { id: f.desativadoId },
        data: { cpf: "000.000.000-00" },
      });
      await comoDono(f.donoId);

      // Formulário só com o vendedor ativo — mesmo padrão de
      // salvarComissaoUsuarios: o desativado nem aparece no form.
      const fd = new FormData();
      fd.set(`cpf_${f.vendedorId}`, "111.111.111-11");

      const resultado = await salvarDadosPagamentoUsuarios(null, fd);
      expect(resultado.ok).toBe(true);

      const desativadoDepois = await prisma.usuario.findUniqueOrThrow({
        where: { id: f.desativadoId },
      });
      expect(desativadoDepois.cpf).toBe("000.000.000-00");
    },
    TIMEOUT_MS
  );

  it(
    "sem nenhuma mudança real não grava log de auditoria",
    async () => {
      const f = await criarFixture();
      await comoDono(f.donoId);

      const resultado = await salvarDadosPagamentoUsuarios(null, new FormData());
      expect(resultado.ok).toBe(true);

      const logs = await prisma.logAuditoria.findMany({
        where: { graficaId: f.graficaId, acao: "usuario.salvar_dados_pagamento" },
      });
      expect(logs).toHaveLength(0);
    },
    TIMEOUT_MS
  );
});
