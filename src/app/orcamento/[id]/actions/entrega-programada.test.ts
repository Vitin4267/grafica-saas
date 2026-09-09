import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de faixas.test.ts/opcoes.test.ts) — cobre o achado B3/Parte 1
// da auditoria de abrangência (versão contratual reduzida, 2026-09-09):
// cronograma de entrega COMBINADO com o cliente ("10.000 unidades em
// [data] no [local]", por linha). Ver model OrcamentoEntregaProgramada
// (schema 09-orcamento.prisma) e src/lib/orcamento-entrega-programada.ts.

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
import {
  adicionarEntregaProgramadaOrcamento,
  editarEntregaProgramadaOrcamento,
  removerEntregaProgramadaOrcamento,
} from "./entrega-programada";
import { MAX_ENTREGAS_PROGRAMADAS } from "@/lib/orcamento-entrega-programada";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function formDataDe(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [chave, valor] of Object.entries(campos)) fd.set(chave, valor);
  return fd;
}

async function usuarioParaMock(usuarioId: string) {
  return prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } });
}

const graficaIdsParaLimpar: string[] = [];

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.orcamentoEntregaProgramada.deleteMany({ where: { graficaId } });
    await prisma.orcamentoItem.deleteMany({ where: { orcamento: { graficaId } } });
    await prisma.orcamento.deleteMany({ where: { graficaId } });
    await prisma.itemGrafica.deleteMany({ where: { graficaId } });
    await prisma.itemCatalogo.deleteMany({ where: { graficaId } });
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
}, TIMEOUT_MS);

// Fixture com um item de 60.000 unidades — o caso de uso real do achado
// (gráfica de embalagem/rótulo: "produz 60.000 agora, entrega 10.000/mês
// por 6 meses").
async function criarFixture(quantidadeItem = 60_000) {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Cronograma ${s}`, slug: `teste-cronograma-${s}` },
  });
  const cliente = await prisma.cliente.create({ data: { graficaId: grafica.id, nome: `Cliente ${s}` } });
  const usuarioDono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-cronograma-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const catalogo = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Rótulo", nome: `Rótulo Teste ${s}` },
  });
  const itemGrafica = await prisma.itemGrafica.create({
    data: { graficaId: grafica.id, itemCatalogoId: catalogo.id, precoVenda: 1 },
  });
  const orcamento = await prisma.orcamento.create({
    data: { graficaId: grafica.id, clienteId: cliente.id, usuarioId: usuarioDono.id, status: "RASCUNHO", total: 0 },
  });
  await prisma.orcamentoItem.create({
    data: {
      orcamentoId: orcamento.id,
      itemGraficaId: itemGrafica.id,
      quantidade: quantidadeItem,
      unidadeDimensao: "CM",
      modeloCalculo: "SIMPLES",
      precoUnitario: 1,
      precoTotal: quantidadeItem,
    },
  });

  return { graficaId: grafica.id, usuarioDonoId: usuarioDono.id, orcamentoId: orcamento.id };
}

describe("adicionarEntregaProgramadaOrcamento / editarEntregaProgramadaOrcamento / removerEntregaProgramadaOrcamento", () => {
  it(
    "cria linha de cronograma dentro do total e nunca mexe em Orcamento.total nem cria Entrega/ContaReceber",
    async () => {
      const fixture = await criarFixture(60_000);
      graficaIdsParaLimpar.push(fixture.graficaId);

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioDonoId)) as never
      );
      const resultado = await adicionarEntregaProgramadaOrcamento(
        null,
        formDataDe({
          orcamentoId: fixture.orcamentoId,
          quantidade: "10000",
          dataPrevista: "2026-10-01",
          localEntrega: "CD São Paulo",
          observacao: "Primeira parcela",
        })
      );
      expect(resultado.ok).toBe(true);
      expect(resultado.mensagem).toMatch(/Faltam 50.000/);

      const linha = await prisma.orcamentoEntregaProgramada.findFirstOrThrow({
        where: { orcamentoId: fixture.orcamentoId },
      });
      expect(linha.quantidade).toBe(10000);
      expect(linha.ordem).toBe(0);
      expect(linha.localEntrega).toBe("CD São Paulo");
      expect(linha.observacao).toBe("Primeira parcela");
      expect(linha.dataPrevista?.toISOString().slice(0, 10)).toBe("2026-10-01");

      // Nunca mexe no total do orçamento, nunca cria Entrega/ContaReceber.
      const orcamento = await prisma.orcamento.findUniqueOrThrow({ where: { id: fixture.orcamentoId } });
      expect(Number(orcamento.total)).toBe(0);
      const entregas = await prisma.entrega.count({ where: { pedido: { orcamentoId: fixture.orcamentoId } } });
      expect(entregas).toBe(0);
      const contasReceber = await prisma.contaReceber.count({ where: { orcamentoId: fixture.orcamentoId } });
      expect(contasReceber).toBe(0);
    },
    TIMEOUT_MS
  );

  it(
    "aceita cronograma que soma exatamente o total (completo, sem aviso de falta)",
    async () => {
      const fixture = await criarFixture(20_000);
      graficaIdsParaLimpar.push(fixture.graficaId);

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioDonoId)) as never
      );
      await adicionarEntregaProgramadaOrcamento(
        null,
        formDataDe({ orcamentoId: fixture.orcamentoId, quantidade: "10000" })
      );
      const resultado = await adicionarEntregaProgramadaOrcamento(
        null,
        formDataDe({ orcamentoId: fixture.orcamentoId, quantidade: "10000" })
      );
      expect(resultado.ok).toBe(true);
      expect(resultado.mensagem).toMatch(/soma já cobre/);

      const linhas = await prisma.orcamentoEntregaProgramada.findMany({
        where: { orcamentoId: fixture.orcamentoId },
      });
      expect(linhas).toHaveLength(2);
    },
    TIMEOUT_MS
  );

  it(
    "rejeita quando a soma ultrapassa a quantidade total do orçamento",
    async () => {
      const fixture = await criarFixture(20_000);
      graficaIdsParaLimpar.push(fixture.graficaId);

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioDonoId)) as never
      );
      await adicionarEntregaProgramadaOrcamento(
        null,
        formDataDe({ orcamentoId: fixture.orcamentoId, quantidade: "15000" })
      );
      const resultado = await adicionarEntregaProgramadaOrcamento(
        null,
        formDataDe({ orcamentoId: fixture.orcamentoId, quantidade: "10000" }) // 15.000 + 10.000 > 20.000
      );
      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toMatch(/ultrapassa/);

      const linhas = await prisma.orcamentoEntregaProgramada.count({
        where: { orcamentoId: fixture.orcamentoId },
      });
      expect(linhas).toBe(1); // a segunda linha (inválida) não foi criada
    },
    TIMEOUT_MS
  );

  it(
    "rejeita quantidade inválida (zero, negativa, fracionária)",
    async () => {
      const fixture = await criarFixture(20_000);
      graficaIdsParaLimpar.push(fixture.graficaId);

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioDonoId)) as never
      );
      for (const quantidade of ["0", "-5", "1.5"]) {
        const resultado = await adicionarEntregaProgramadaOrcamento(
          null,
          formDataDe({ orcamentoId: fixture.orcamentoId, quantidade })
        );
        expect(resultado.ok).toBe(false);
      }
      const total = await prisma.orcamentoEntregaProgramada.count({
        where: { orcamentoId: fixture.orcamentoId },
      });
      expect(total).toBe(0);
    },
    TIMEOUT_MS
  );

  it(
    `respeita o teto de ${MAX_ENTREGAS_PROGRAMADAS} linhas por orçamento`,
    async () => {
      // Total gigante pra nunca esbarrar na validação de soma antes do teto.
      const fixture = await criarFixture(1_000_000);
      graficaIdsParaLimpar.push(fixture.graficaId);

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioDonoId)) as never
      );
      for (let i = 0; i < MAX_ENTREGAS_PROGRAMADAS; i++) {
        const resultado = await adicionarEntregaProgramadaOrcamento(
          null,
          formDataDe({ orcamentoId: fixture.orcamentoId, quantidade: "1" })
        );
        expect(resultado.ok).toBe(true);
      }
      const resultadoExtra = await adicionarEntregaProgramadaOrcamento(
        null,
        formDataDe({ orcamentoId: fixture.orcamentoId, quantidade: "1" })
      );
      expect(resultadoExtra.ok).toBe(false);
      expect(resultadoExtra.mensagem).toMatch(/máximo/);

      const total = await prisma.orcamentoEntregaProgramada.count({
        where: { orcamentoId: fixture.orcamentoId },
      });
      expect(total).toBe(MAX_ENTREGAS_PROGRAMADAS);
    },
    TIMEOUT_MS
  );

  it(
    "editarEntregaProgramadaOrcamento atualiza campos e revalida soma excluindo a própria linha",
    async () => {
      const fixture = await criarFixture(20_000);
      graficaIdsParaLimpar.push(fixture.graficaId);

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioDonoId)) as never
      );
      await adicionarEntregaProgramadaOrcamento(
        null,
        formDataDe({ orcamentoId: fixture.orcamentoId, quantidade: "5000" })
      );
      const linha = await prisma.orcamentoEntregaProgramada.findFirstOrThrow({
        where: { orcamentoId: fixture.orcamentoId },
      });

      // Editar pra 20.000 (o total inteiro) deve passar — a validação
      // exclui a PRÓPRIA linha da soma anterior, não soma 5.000 + 20.000.
      const resultado = await editarEntregaProgramadaOrcamento(
        null,
        formDataDe({
          entregaProgramadaId: linha.id,
          quantidade: "20000",
          localEntrega: "Novo local",
          observacao: "Atualizado",
        })
      );
      expect(resultado.ok).toBe(true);

      const linhaAtualizada = await prisma.orcamentoEntregaProgramada.findUniqueOrThrow({
        where: { id: linha.id },
      });
      expect(linhaAtualizada.quantidade).toBe(20000);
      expect(linhaAtualizada.localEntrega).toBe("Novo local");
      expect(linhaAtualizada.observacao).toBe("Atualizado");
    },
    TIMEOUT_MS
  );

  it(
    "editarEntregaProgramadaOrcamento rejeita quando a nova quantidade, somada às OUTRAS linhas, ultrapassa o total",
    async () => {
      const fixture = await criarFixture(20_000);
      graficaIdsParaLimpar.push(fixture.graficaId);

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioDonoId)) as never
      );
      await adicionarEntregaProgramadaOrcamento(
        null,
        formDataDe({ orcamentoId: fixture.orcamentoId, quantidade: "10000" })
      );
      await adicionarEntregaProgramadaOrcamento(
        null,
        formDataDe({ orcamentoId: fixture.orcamentoId, quantidade: "10000" })
      );
      const [linhaA] = await prisma.orcamentoEntregaProgramada.findMany({
        where: { orcamentoId: fixture.orcamentoId },
        orderBy: { ordem: "asc" },
      });

      const resultado = await editarEntregaProgramadaOrcamento(
        null,
        formDataDe({ entregaProgramadaId: linhaA.id, quantidade: "15000" }) // 15.000 + 10.000 > 20.000
      );
      expect(resultado.ok).toBe(false);

      const linhaInalterada = await prisma.orcamentoEntregaProgramada.findUniqueOrThrow({
        where: { id: linhaA.id },
      });
      expect(linhaInalterada.quantidade).toBe(10000);
    },
    TIMEOUT_MS
  );

  it(
    "isolamento multi-tenant: usuário de outra gráfica não adiciona, edita nem remove linha alheia",
    async () => {
      const fixtureA = await criarFixture(20_000);
      graficaIdsParaLimpar.push(fixtureA.graficaId);
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixtureA.usuarioDonoId)) as never
      );
      await adicionarEntregaProgramadaOrcamento(
        null,
        formDataDe({ orcamentoId: fixtureA.orcamentoId, quantidade: "5000" })
      );
      const linha = await prisma.orcamentoEntregaProgramada.findFirstOrThrow({
        where: { orcamentoId: fixtureA.orcamentoId },
      });

      const fixtureB = await criarFixture(20_000);
      graficaIdsParaLimpar.push(fixtureB.graficaId);
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixtureB.usuarioDonoId)) as never
      );

      const tentativaAdicionar = await adicionarEntregaProgramadaOrcamento(
        null,
        formDataDe({ orcamentoId: fixtureA.orcamentoId, quantidade: "1000" })
      );
      expect(tentativaAdicionar.ok).toBe(false);

      const tentativaEditar = await editarEntregaProgramadaOrcamento(
        null,
        formDataDe({ entregaProgramadaId: linha.id, quantidade: "9999" })
      );
      expect(tentativaEditar.ok).toBe(false);

      const tentativaRemover = await removerEntregaProgramadaOrcamento(
        null,
        formDataDe({ entregaProgramadaId: linha.id })
      );
      expect(tentativaRemover.ok).toBe(false);

      const aindaExiste = await prisma.orcamentoEntregaProgramada.findUnique({ where: { id: linha.id } });
      expect(aindaExiste).not.toBeNull();
      expect(aindaExiste?.quantidade).toBe(5000);
    },
    TIMEOUT_MS
  );

  it(
    "remove só a linha alvo, sem afetar outras linhas do mesmo orçamento",
    async () => {
      const fixture = await criarFixture(20_000);
      graficaIdsParaLimpar.push(fixture.graficaId);

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioDonoId)) as never
      );
      await adicionarEntregaProgramadaOrcamento(
        null,
        formDataDe({ orcamentoId: fixture.orcamentoId, quantidade: "5000" })
      );
      await adicionarEntregaProgramadaOrcamento(
        null,
        formDataDe({ orcamentoId: fixture.orcamentoId, quantidade: "8000" })
      );
      const linhas = await prisma.orcamentoEntregaProgramada.findMany({
        where: { orcamentoId: fixture.orcamentoId },
        orderBy: { ordem: "asc" },
      });
      expect(linhas).toHaveLength(2);

      const resultado = await removerEntregaProgramadaOrcamento(
        null,
        formDataDe({ entregaProgramadaId: linhas[0].id })
      );
      expect(resultado.ok).toBe(true);

      const restantes = await prisma.orcamentoEntregaProgramada.findMany({
        where: { orcamentoId: fixture.orcamentoId },
      });
      expect(restantes).toHaveLength(1);
      expect(restantes[0].id).toBe(linhas[1].id);
    },
    TIMEOUT_MS
  );

  it(
    "orçamento sem nenhuma linha de cronograma continua sem nenhuma linha (regressão zero)",
    async () => {
      const fixture = await criarFixture(20_000);
      graficaIdsParaLimpar.push(fixture.graficaId);

      const total = await prisma.orcamentoEntregaProgramada.count({
        where: { orcamentoId: fixture.orcamentoId },
      });
      expect(total).toBe(0);
      const orcamento = await prisma.orcamento.findUniqueOrThrow({ where: { id: fixture.orcamentoId } });
      expect(orcamento.status).toBe("RASCUNHO");
    },
    TIMEOUT_MS
  );
});
