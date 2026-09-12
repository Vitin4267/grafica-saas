import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de actions.fornecedor.test.ts) — cobre o achado Fin-A1 da
// Parte 4 da auditoria de abrangência (pesquisa-abrangencia-modulos.md):
// Despesa e CustoPedido eram universos paralelos, o mesmo gasto precisava
// ser digitado duas vezes. Esta rodada constrói só a direção
// Despesa → CustoPedido (ver criarCustoAutomaticoDespesa em
// src/lib/custo-pedido.ts) — o caminho inverso fica pra uma rodada futura.
// FALHA ESPERADA até a migration 20260911100000_despesa_custo_pedido ser
// aplicada ao banco (mesmo padrão já documentado em
// actions.baixa-parcial.test.ts).
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
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
import { criarDespesa, editarDespesa, excluirDespesa } from "./actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const graficaIdsParaLimpar: string[] = [];

async function criarFixture() {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Despesa CustoPedido ${s}`, slug: `teste-despesa-custo-pedido-${s}` },
  });
  const cliente = await prisma.cliente.create({
    data: { graficaId: grafica.id, nome: `Cliente ${s}` },
  });
  const dono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-despesa-custo-pedido-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const categoria = await prisma.categoriaCusto.create({
    data: { graficaId: grafica.id, nome: `Categoria ${s}` },
  });
  const orcamento = await prisma.orcamento.create({
    data: { graficaId: grafica.id, clienteId: cliente.id, usuarioId: dono.id, status: "APROVADO", total: 1000 },
  });
  const pedido = await prisma.pedido.create({
    data: { graficaId: grafica.id, orcamentoId: orcamento.id },
  });

  graficaIdsParaLimpar.push(grafica.id);
  return {
    graficaId: grafica.id,
    usuarioId: dono.id,
    categoriaCustoId: categoria.id,
    pedidoId: pedido.id,
    orcamentoId: orcamento.id,
  };
}

function formDataDe(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [chave, valor] of Object.entries(campos)) fd.set(chave, valor);
  return fd;
}

async function logarComo(usuarioId: string) {
  vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
    (await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } })) as never
  );
}

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.custoPedido.deleteMany({ where: { graficaId } });
    await prisma.despesa.deleteMany({ where: { graficaId } });
    await prisma.pedido.deleteMany({ where: { graficaId } });
    await prisma.orcamento.deleteMany({ where: { graficaId } });
    await prisma.categoriaCusto.deleteMany({ where: { graficaId } });
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
}, TIMEOUT_MS);

describe("Despesa → CustoPedido (achado Fin-A1 da Parte 4)", () => {
  it(
    "caminho feliz: criarDespesa com pedidoId E categoriaCustoId gera o CustoPedido espelhado (origem=DESPESA)",
    async () => {
      const f = await criarFixture();
      await logarComo(f.usuarioId);

      const resultado = await criarDespesa(
        null,
        formDataDe({
          descricao: "Laminação terceirizada",
          valor: "800",
          vencimento: "2026-10-01",
          categoriaCustoId: f.categoriaCustoId,
          pedidoId: f.pedidoId,
        })
      );

      expect(resultado.ok).toBe(true);
      const despesa = await prisma.despesa.findFirstOrThrow({
        where: { graficaId: f.graficaId, descricao: "Laminação terceirizada" },
      });
      expect(despesa.pedidoId).toBe(f.pedidoId);

      const custo = await prisma.custoPedido.findUniqueOrThrow({ where: { despesaId: despesa.id } });
      expect(custo.origem).toBe("DESPESA");
      expect(custo.pedidoId).toBe(f.pedidoId);
      expect(custo.categoriaCustoId).toBe(f.categoriaCustoId);
      expect(Number(custo.valor)).toBe(800);
      expect(custo.estornadoEm).toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "pedidoId SEM categoriaCustoId: não gera CustoPedido nenhum, e a despesa é criada normalmente (sem erro)",
    async () => {
      const f = await criarFixture();
      await logarComo(f.usuarioId);

      const resultado = await criarDespesa(
        null,
        formDataDe({
          descricao: "Despesa só com pedido",
          valor: "300",
          vencimento: "2026-10-01",
          pedidoId: f.pedidoId,
        })
      );

      expect(resultado.ok).toBe(true);
      const despesa = await prisma.despesa.findFirstOrThrow({
        where: { graficaId: f.graficaId, descricao: "Despesa só com pedido" },
      });
      expect(despesa.pedidoId).toBe(f.pedidoId);

      const custo = await prisma.custoPedido.findUnique({ where: { despesaId: despesa.id } });
      expect(custo).toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "categoriaCustoId SEM pedidoId: não gera CustoPedido nenhum — REGRESSÃO ZERO pra quem nunca usa o vínculo com pedido",
    async () => {
      const f = await criarFixture();
      await logarComo(f.usuarioId);

      const resultado = await criarDespesa(
        null,
        formDataDe({
          descricao: "Despesa normal, sem pedido",
          valor: "150",
          vencimento: "2026-10-01",
          categoriaCustoId: f.categoriaCustoId,
        })
      );

      expect(resultado.ok).toBe(true);
      const despesa = await prisma.despesa.findFirstOrThrow({
        where: { graficaId: f.graficaId, descricao: "Despesa normal, sem pedido" },
      });
      expect(despesa.pedidoId).toBeNull();

      const custo = await prisma.custoPedido.findUnique({ where: { despesaId: despesa.id } });
      expect(custo).toBeNull();
      const totalCustos = await prisma.custoPedido.count({ where: { graficaId: f.graficaId } });
      expect(totalCustos).toBe(0);
    },
    TIMEOUT_MS
  );

  it(
    "sem pedidoId nem categoriaCustoId (form antigo): comportamento IDÊNTICO a antes desta feature — regressão zero",
    async () => {
      const f = await criarFixture();
      await logarComo(f.usuarioId);

      const resultado = await criarDespesa(
        null,
        formDataDe({ descricao: "Despesa velha, sem nada novo", valor: "50", vencimento: "2026-10-01" })
      );

      expect(resultado.ok).toBe(true);
      const totalDespesas = await prisma.despesa.count({ where: { graficaId: f.graficaId } });
      const totalCustos = await prisma.custoPedido.count({ where: { graficaId: f.graficaId } });
      expect(totalDespesas).toBe(1);
      expect(totalCustos).toBe(0);
    },
    TIMEOUT_MS
  );

  it(
    "editarDespesa: mudar o valor ATUALIZA o CustoPedido espelhado existente (não duplica)",
    async () => {
      const f = await criarFixture();
      await logarComo(f.usuarioId);

      await criarDespesa(
        null,
        formDataDe({
          descricao: "Frete pro pedido",
          valor: "200",
          vencimento: "2026-10-01",
          categoriaCustoId: f.categoriaCustoId,
          pedidoId: f.pedidoId,
        })
      );
      const despesa = await prisma.despesa.findFirstOrThrow({
        where: { graficaId: f.graficaId, descricao: "Frete pro pedido" },
      });

      const resultado = await editarDespesa(
        null,
        formDataDe({
          despesaId: despesa.id,
          descricao: "Frete pro pedido",
          valor: "260",
          vencimento: "2026-10-01",
          categoriaCustoId: f.categoriaCustoId,
          pedidoId: f.pedidoId,
        })
      );

      expect(resultado.ok).toBe(true);
      const custos = await prisma.custoPedido.findMany({ where: { despesaId: despesa.id } });
      expect(custos).toHaveLength(1);
      expect(Number(custos[0].valor)).toBe(260);
      expect(custos[0].estornadoEm).toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "editarDespesa: remover o pedidoId ESTORNA o CustoPedido espelhado (nunca deleta)",
    async () => {
      const f = await criarFixture();
      await logarComo(f.usuarioId);

      await criarDespesa(
        null,
        formDataDe({
          descricao: "Custo que vai perder o pedido",
          valor: "400",
          vencimento: "2026-10-01",
          categoriaCustoId: f.categoriaCustoId,
          pedidoId: f.pedidoId,
        })
      );
      const despesa = await prisma.despesa.findFirstOrThrow({
        where: { graficaId: f.graficaId, descricao: "Custo que vai perder o pedido" },
      });
      const custoAntes = await prisma.custoPedido.findUniqueOrThrow({ where: { despesaId: despesa.id } });

      const resultado = await editarDespesa(
        null,
        formDataDe({
          despesaId: despesa.id,
          descricao: "Custo que vai perder o pedido",
          valor: "400",
          vencimento: "2026-10-01",
          categoriaCustoId: f.categoriaCustoId,
          // pedidoId deliberadamente omitido — desvincula o pedido.
        })
      );

      expect(resultado.ok).toBe(true);
      const despesaAtualizada = await prisma.despesa.findUniqueOrThrow({ where: { id: despesa.id } });
      expect(despesaAtualizada.pedidoId).toBeNull();

      // Estornado, NUNCA deletado — mesmo padrão do resto do sistema.
      const custoDepois = await prisma.custoPedido.findUniqueOrThrow({ where: { id: custoAntes.id } });
      expect(custoDepois.estornadoEm).not.toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "editarDespesa: reativa (estornadoEm volta a null) se pedidoId/categoriaCustoId forem preenchidos de novo depois de removidos",
    async () => {
      const f = await criarFixture();
      await logarComo(f.usuarioId);

      await criarDespesa(
        null,
        formDataDe({
          descricao: "Custo que vai e volta",
          valor: "100",
          vencimento: "2026-10-01",
          categoriaCustoId: f.categoriaCustoId,
          pedidoId: f.pedidoId,
        })
      );
      const despesa = await prisma.despesa.findFirstOrThrow({
        where: { graficaId: f.graficaId, descricao: "Custo que vai e volta" },
      });

      await editarDespesa(
        null,
        formDataDe({
          despesaId: despesa.id,
          descricao: "Custo que vai e volta",
          valor: "100",
          vencimento: "2026-10-01",
          categoriaCustoId: f.categoriaCustoId,
        })
      );
      const custoEstornado = await prisma.custoPedido.findUniqueOrThrow({ where: { despesaId: despesa.id } });
      expect(custoEstornado.estornadoEm).not.toBeNull();

      const resultado = await editarDespesa(
        null,
        formDataDe({
          despesaId: despesa.id,
          descricao: "Custo que vai e volta",
          valor: "120",
          vencimento: "2026-10-01",
          categoriaCustoId: f.categoriaCustoId,
          pedidoId: f.pedidoId,
        })
      );

      expect(resultado.ok).toBe(true);
      const custoReativado = await prisma.custoPedido.findUniqueOrThrow({ where: { id: custoEstornado.id } });
      expect(custoReativado.estornadoEm).toBeNull();
      expect(Number(custoReativado.valor)).toBe(120);
      // Continua sendo a MESMA linha (dedup via despesaId @unique) — nunca
      // uma segunda linha pra mesma despesa.
      const totalCustos = await prisma.custoPedido.count({ where: { despesaId: despesa.id } });
      expect(totalCustos).toBe(1);
    },
    TIMEOUT_MS
  );

  it(
    "excluirDespesa: despesa com CustoPedido espelhado ativo — estorna o custo ANTES de excluir a despesa",
    async () => {
      const f = await criarFixture();
      await logarComo(f.usuarioId);

      await criarDespesa(
        null,
        formDataDe({
          descricao: "Despesa que vai ser excluída",
          valor: "500",
          vencimento: "2026-10-01",
          categoriaCustoId: f.categoriaCustoId,
          pedidoId: f.pedidoId,
        })
      );
      const despesa = await prisma.despesa.findFirstOrThrow({
        where: { graficaId: f.graficaId, descricao: "Despesa que vai ser excluída" },
      });
      const custoAntes = await prisma.custoPedido.findUniqueOrThrow({ where: { despesaId: despesa.id } });
      expect(custoAntes.estornadoEm).toBeNull();

      await expect(excluirDespesa(null, formDataDe({ despesaId: despesa.id }))).rejects.toThrow("NEXT_REDIRECT");

      const despesaExiste = await prisma.despesa.findUnique({ where: { id: despesa.id } });
      expect(despesaExiste).toBeNull();

      // Nunca deletado — só perde o vínculo (FK SetNull) e fica estornado.
      const custoDepois = await prisma.custoPedido.findUniqueOrThrow({ where: { id: custoAntes.id } });
      expect(custoDepois.despesaId).toBeNull();
      expect(custoDepois.estornadoEm).not.toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "pedidoId de outra gráfica é rejeitado (isolamento de tenant)",
    async () => {
      const f = await criarFixture();
      const outra = await criarFixture();
      await logarComo(f.usuarioId);

      const resultado = await criarDespesa(
        null,
        formDataDe({
          descricao: "Despesa pedido alheio",
          valor: "200",
          vencimento: "2026-10-01",
          categoriaCustoId: f.categoriaCustoId,
          pedidoId: outra.pedidoId,
        })
      );

      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toContain("Pedido não encontrado");
    },
    TIMEOUT_MS
  );

  it(
    "bug N19: CustoPedido TERCEIRIZACAO + Despesa mesma categoria + pedido → ambos disparam possivelDuplicidade",
    async () => {
      const f = await criarFixture();
      await logarComo(f.usuarioId);

      // Passo 1: cria CustoPedido origem TERCEIRIZACAO (simulando uma terceirização já lançada)
      const custoTerceirizacao = await prisma.custoPedido.create({
        data: {
          graficaId: f.graficaId,
          pedidoId: f.pedidoId,
          categoriaCustoId: f.categoriaCustoId,
          origem: "TERCEIRIZACAO",
          etapaTerceirizadaId: "etapa-teste-123",
          valor: 800,
          valorCalculado: 800,
          possivelDuplicidade: false,
        },
      });

      // Passo 2: cria Despesa vinculada ao MESMO pedido+categoria
      const resultado = await criarDespesa(
        null,
        formDataDe({
          descricao: "Nota do terceirizado",
          valor: "800",
          vencimento: "2026-10-01",
          categoriaCustoId: f.categoriaCustoId,
          pedidoId: f.pedidoId,
        })
      );

      expect(resultado.ok).toBe(true);
      const despesa = await prisma.despesa.findFirstOrThrow({
        where: { graficaId: f.graficaId, descricao: "Nota do terceirizado" },
      });

      // Passo 3: verifica que o CustoPedido novo (origem DESPESA) tem possivelDuplicidade=true
      const custoDespesa = await prisma.custoPedido.findUniqueOrThrow({
        where: { despesaId: despesa.id },
      });
      expect(custoDespesa.origem).toBe("DESPESA");
      expect(custoDespesa.pedidoId).toBe(f.pedidoId);
      expect(custoDespesa.categoriaCustoId).toBe(f.categoriaCustoId);
      expect(custoDespesa.possivelDuplicidade).toBe(true);
      expect(Number(custoDespesa.valor)).toBe(800);

      // Passo 4: verifica que o CustoPedido antigo (TERCEIRIZACAO) CONTINUA com possivelDuplicidade=false
      // (pois não tem FK de dedup — cada origem tem seu próprio FK de proteção)
      const custoTerceirizacaoAgora = await prisma.custoPedido.findUniqueOrThrow({
        where: { id: custoTerceirizacao.id },
      });
      expect(custoTerceirizacaoAgora.possivelDuplicidade).toBe(false);
    },
    TIMEOUT_MS
  );
});
