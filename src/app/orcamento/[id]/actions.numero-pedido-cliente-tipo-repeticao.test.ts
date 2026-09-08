import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de actions.orgao-publico.test.ts/actions.dimensao-planificada.test.ts
// neste mesmo diretório) — cobre as 2 melhorias pequenas pedidas pelo dono
// depois de comparar o GrafPro com um "Pedido Interno" real em papel da
// Assus Graphics (cliente-piloto):
//
// 1. Orcamento.numeroPedidoCliente (cabeçalho, via editarDadosGeraisOrcamento)
//    — número que o CLIENTE usa pra rastrear a própria compra.
// 2. OrcamentoItem.tipoRepeticao (por item, via adicionarItemOrcamento/
//    editarOrcamento) — checkbox "Modelo Novo / Repetição s/ alteração /
//    Repetição c/ alteração" do formulário de papel, reaproveitando o enum
//    TipoPedidoOrcamento já usado no cabeçalho.
//
// Os dois são puramente informativos — nenhum motor de preço os lê (ver
// comentário completo em OrcamentoItem.tipoRepeticao/Orcamento.
// numeroPedidoCliente no schema).
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
import { editarDadosGeraisOrcamento, adicionarItemOrcamento, editarOrcamento } from "./actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

type Fixture = {
  graficaId: string;
  usuarioId: string;
  clienteId: string;
  itemGraficaId: string;
  orcamentoId: string;
};

async function criarFixture(): Promise<Fixture> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Pedido Cliente Item ${s}`, slug: `teste-pedido-cliente-item-${s}` },
  });
  const usuario = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Usuário ${s}`,
      email: `user-pedido-cliente-item-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const cliente = await prisma.cliente.create({
    data: { graficaId: grafica.id, nome: `Cliente ${s}` },
  });
  // Produto SIMPLES — o suficiente pra exercitar tipoRepeticao, que nenhum
  // motor de preço lê.
  const catalogo = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Rótulo", nome: `Rótulo Teste ${s}` },
  });
  const itemGrafica = await prisma.itemGrafica.create({
    data: { graficaId: grafica.id, itemCatalogoId: catalogo.id, precoVenda: 10 },
  });
  const orcamento = await prisma.orcamento.create({
    data: { graficaId: grafica.id, clienteId: cliente.id, usuarioId: usuario.id, status: "RASCUNHO", total: 0 },
  });

  return {
    graficaId: grafica.id,
    usuarioId: usuario.id,
    clienteId: cliente.id,
    itemGraficaId: itemGrafica.id,
    orcamentoId: orcamento.id,
  };
}

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

describe("editarDadosGeraisOrcamento — numeroPedidoCliente", () => {
  it(
    "deve salvar numeroPedidoCliente",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioId)) as never
      );

      const resultado = await editarDadosGeraisOrcamento(
        null,
        formDataDe({ orcamentoId: fixture.orcamentoId, numeroPedidoCliente: "MLAGO/001" })
      );

      expect(resultado.ok).toBe(true);
      const orcamento = await prisma.orcamento.findUniqueOrThrow({ where: { id: fixture.orcamentoId } });
      expect(orcamento.numeroPedidoCliente).toBe("MLAGO/001");
    },
    TIMEOUT_MS
  );

  it(
    "sem preencher numeroPedidoCliente, permanece null (regressão zero — mesmo padrão de outros campos opcionais deste form)",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioId)) as never
      );

      const resultado = await editarDadosGeraisOrcamento(
        null,
        formDataDe({ orcamentoId: fixture.orcamentoId, vendedor: "João Silva" })
      );

      expect(resultado.ok).toBe(true);
      const orcamento = await prisma.orcamento.findUniqueOrThrow({ where: { id: fixture.orcamentoId } });
      expect(orcamento.vendedor).toBe("João Silva");
      expect(orcamento.numeroPedidoCliente).toBeNull();
    },
    TIMEOUT_MS
  );
});

describe("adicionarItemOrcamento/editarOrcamento — tipoRepeticao (por item)", () => {
  it(
    "adicionarItemOrcamento grava tipoRepeticao quando preenchido",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioId)) as never
      );

      const resultado = await adicionarItemOrcamento(
        null,
        formDataDe({
          orcamentoId: fixture.orcamentoId,
          itemGraficaId: fixture.itemGraficaId,
          quantidade: "1000",
          unidadeDimensao: "CM",
          tipoRepeticao: "REPETICAO_SEM_ALTERACAO",
        })
      );

      expect(resultado.ok).toBe(true);
      const item = await prisma.orcamentoItem.findFirstOrThrow({
        where: { orcamentoId: fixture.orcamentoId },
      });
      expect(item.tipoRepeticao).toBe("REPETICAO_SEM_ALTERACAO");
    },
    TIMEOUT_MS
  );

  it(
    "adicionarItemOrcamento sem tipoRepeticao continua nascendo normalmente (regressão zero)",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioId)) as never
      );

      const resultado = await adicionarItemOrcamento(
        null,
        formDataDe({
          orcamentoId: fixture.orcamentoId,
          itemGraficaId: fixture.itemGraficaId,
          quantidade: "1000",
          unidadeDimensao: "CM",
        })
      );

      expect(resultado.ok).toBe(true);
      const item = await prisma.orcamentoItem.findFirstOrThrow({
        where: { orcamentoId: fixture.orcamentoId },
      });
      expect(item.tipoRepeticao).toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "adicionarItemOrcamento rejeita um tipoRepeticao fora do enum (POST forjado)",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioId)) as never
      );

      const resultado = await adicionarItemOrcamento(
        null,
        formDataDe({
          orcamentoId: fixture.orcamentoId,
          itemGraficaId: fixture.itemGraficaId,
          quantidade: "1000",
          unidadeDimensao: "CM",
          tipoRepeticao: "VALOR_INVENTADO",
        })
      );

      expect(resultado.ok).toBe(false);
      const item = await prisma.orcamentoItem.findFirst({ where: { orcamentoId: fixture.orcamentoId } });
      expect(item).toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "editarOrcamento atualiza tipoRepeticao de um item existente",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioId)) as never
      );

      await adicionarItemOrcamento(
        null,
        formDataDe({
          orcamentoId: fixture.orcamentoId,
          itemGraficaId: fixture.itemGraficaId,
          quantidade: "1000",
          unidadeDimensao: "CM",
          tipoRepeticao: "MODELO_NOVO",
        })
      );
      const itemCriado = await prisma.orcamentoItem.findFirstOrThrow({
        where: { orcamentoId: fixture.orcamentoId },
      });
      expect(itemCriado.tipoRepeticao).toBe("MODELO_NOVO");

      const resultado = await editarOrcamento(
        null,
        formDataDe({
          orcamentoId: fixture.orcamentoId,
          orcamentoItemId: itemCriado.id,
          quantidade: "1000",
          tipoRepeticao: "REPETICAO_COM_ALTERACAO",
        })
      );

      expect(resultado.ok).toBe(true);
      const itemEditado = await prisma.orcamentoItem.findUniqueOrThrow({ where: { id: itemCriado.id } });
      expect(itemEditado.tipoRepeticao).toBe("REPETICAO_COM_ALTERACAO");
    },
    TIMEOUT_MS
  );
});
