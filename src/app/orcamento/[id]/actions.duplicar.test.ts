import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL),
// mesmo padrão de actions.desconto.test.ts neste mesmo diretório — cobre o
// critério de aceite do "Pedir de novo": preço recalculado do catálogo ATUAL
// (nunca copiado do orçamento antigo), desconto herdado proporcionalmente,
// status de origem obrigatório e o vínculo duplicadoDeId gravado.
//
// redirect() é mockado (não next/navigation inteiro — só a função) porque
// duplicarOrcamento navega pro novo orçamento no caminho de SUCESSO via
// redirect(), que fora de uma requisição Next.js de verdade lança
// NEXT_REDIRECT — o mock deixa a asserção olhar pra onde ele tentou
// redirecionar, igual dublê de teste, sem precisar de infra de rota.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));

const redirectMock = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
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
import { duplicarOrcamento } from "./actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

type Fixture = {
  graficaId: string;
  usuarioDonoId: string;
  usuarioOperadorId: string;
  clienteId: string;
  itemCatalogoId: string;
  itemGraficaId: string;
};

async function criarFixture(): Promise<Fixture> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Duplicar ${s}`, slug: `teste-duplicar-${s}` },
  });
  await prisma.parametrosGrafica.create({
    data: { graficaId: grafica.id, descontoMaxSemAprovacao: 15 },
  });
  const cliente = await prisma.cliente.create({ data: { graficaId: grafica.id, nome: `Cliente ${s}` } });
  const usuarioDono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-duplicar-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const usuarioOperador = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Operador ${s}`,
      email: `operador-duplicar-${s}@example.com`,
      senhaHash: "x",
      papel: "OPERADOR",
    },
  });
  await prisma.permissaoUsuario.create({
    data: { usuarioId: usuarioOperador.id, modulo: "ORCAMENTO", podeVer: true, podeEditar: true },
  });

  const catalogo = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Cartão", nome: `Produto Teste ${s}` },
  });
  const itemGrafica = await prisma.itemGrafica.create({
    data: { graficaId: grafica.id, itemCatalogoId: catalogo.id, precoVenda: 100, precoCompra: 60 },
  });

  return {
    graficaId: grafica.id,
    usuarioDonoId: usuarioDono.id,
    usuarioOperadorId: usuarioOperador.id,
    clienteId: cliente.id,
    itemCatalogoId: catalogo.id,
    itemGraficaId: itemGrafica.id,
  };
}

// Cria um orçamento já no status pedido (default APROVADO) com um item
// SIMPLES de quantidade `quantidade`, opcionalmente com desconto negociado —
// espelha o estado que aplicarDescontoItemOrcamento deixaria, sem depender
// daquela action (evita acoplar este teste ao comportamento dela).
async function criarOrcamentoOrigem(
  fixture: Fixture,
  opcoes: {
    status?: "RASCUNHO" | "ENVIADO" | "APROVADO" | "REJEITADO";
    quantidade?: number;
    comDesconto?: boolean;
  } = {}
) {
  const quantidade = opcoes.quantidade ?? 10;
  const precoSugeridoUnitario = 100; // preço de venda no momento da criação original
  const precoUnitarioVendido = opcoes.comDesconto ? 90 : 100; // 10% de desconto quando comDesconto
  return prisma.orcamento.create({
    data: {
      graficaId: fixture.graficaId,
      clienteId: fixture.clienteId,
      usuarioId: fixture.usuarioDonoId,
      status: opcoes.status ?? "APROVADO",
      total: precoUnitarioVendido * quantidade,
      itens: {
        create: {
          itemGraficaId: fixture.itemGraficaId,
          quantidade,
          precoUnitario: precoUnitarioVendido,
          precoTotal: precoUnitarioVendido * quantidade,
          precoSugeridoUnitario,
          descontoTipo: opcoes.comDesconto ? "PERCENTUAL" : null,
          descontoValor: opcoes.comDesconto ? 10 : null,
          motivoDesconto: opcoes.comDesconto ? "fidelidade" : null,
        },
      },
    },
  });
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
    await prisma.logAuditoria.deleteMany({ where: { graficaId } });
    await prisma.orcamentoItem.deleteMany({ where: { orcamento: { graficaId } } });
    await prisma.orcamento.deleteMany({ where: { graficaId } });
    await prisma.itemGrafica.deleteMany({ where: { graficaId } });
    await prisma.itemCatalogo.deleteMany({ where: { graficaId } });
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.permissaoUsuario.deleteMany({ where: { usuario: { graficaId } } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.parametrosGrafica.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
  redirectMock.mockClear();
}, TIMEOUT_MS);

describe("duplicarOrcamento", () => {
  it(
    "cria um orçamento novo em RASCUNHO com preço RECALCULADO a partir do preço ATUAL do catálogo",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);
      const original = await criarOrcamentoOrigem(fixture, { quantidade: 10 });

      // Catálogo reajustou depois que o orçamento original foi criado —
      // preço vendido no original (100/un) não pode aparecer no novo.
      await prisma.itemGrafica.update({
        where: { id: fixture.itemGraficaId },
        data: { precoVenda: 150 },
      });

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioDonoId)) as never
      );

      await expect(
        duplicarOrcamento(null, formDataDe({ orcamentoId: original.id }))
      ).rejects.toThrow(/^NEXT_REDIRECT:/);

      expect(redirectMock).toHaveBeenCalledTimes(1);
      const urlRedirecionada = redirectMock.mock.calls[0][0] as string;
      const novoId = urlRedirecionada.split("/").pop()!;

      const novo = await prisma.orcamento.findUniqueOrThrow({
        where: { id: novoId },
        include: { itens: true },
      });

      expect(novo.status).toBe("RASCUNHO");
      expect(novo.clienteId).toBe(fixture.clienteId);
      expect(novo.duplicadoDeId).toBe(original.id);
      expect(novo.tipoPedido).toBe("REPETICAO_SEM_ALTERACAO");
      expect(novo.itens).toHaveLength(1);
      // Preço novo usa o preço ATUAL (150), nunca o congelado no original (100).
      expect(Number(novo.itens[0].precoUnitario)).toBe(150);
      expect(Number(novo.itens[0].precoTotal)).toBe(1500);
      expect(Number(novo.total)).toBe(1500);
      expect(novo.itens[0].descontoTipo).toBeNull();

      // Nunca copiados: status/link/resposta pública/arte — permanecem no
      // estado "nunca aconteceu" de um orçamento recém-criado.
      expect(novo.linkPublicoToken).toBeNull();
      expect(novo.respostaPublicaEm).toBeNull();
      expect(novo.arteUrl).toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "reaplica o MESMO PERCENTUAL de desconto (não o valor em R$) sobre o preço recalculado",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);
      // Original: sugerido 100, vendido 90 (10% de desconto), qtd 10.
      const original = await criarOrcamentoOrigem(fixture, { quantidade: 10, comDesconto: true });

      // Preço do catálogo dobra — o desconto herdado precisa ser sobre o
      // NOVO sugerido (200), não repetir o valor antigo de R$90/un.
      await prisma.itemGrafica.update({
        where: { id: fixture.itemGraficaId },
        data: { precoVenda: 200 },
      });

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioDonoId)) as never
      );

      await expect(
        duplicarOrcamento(null, formDataDe({ orcamentoId: original.id }))
      ).rejects.toThrow(/^NEXT_REDIRECT:/);

      const novoId = (redirectMock.mock.calls[0][0] as string).split("/").pop()!;
      const novo = await prisma.orcamento.findUniqueOrThrow({
        where: { id: novoId },
        include: { itens: true },
      });

      const item = novo.itens[0];
      expect(item.descontoTipo).toBe("PERCENTUAL");
      expect(Number(item.descontoValor)).toBeCloseTo(10, 2);
      // 200 × (1 − 10%) = 180/un — nunca 90 (valor absoluto antigo) nem 200
      // (ignorando o desconto).
      expect(Number(item.precoUnitario)).toBeCloseTo(180, 2);
      expect(Number(item.precoTotal)).toBeCloseTo(1800, 2);
    },
    TIMEOUT_MS
  );

  it(
    "OPERADOR duplicando um item com desconto herdado ACIMA do limite da gráfica recebe o item sem desconto (preço cheio)",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);
      // 30% de desconto efetivo no original > limite de 15% configurado na fixture.
      const original = await prisma.orcamento.create({
        data: {
          graficaId: fixture.graficaId,
          clienteId: fixture.clienteId,
          usuarioId: fixture.usuarioDonoId,
          status: "APROVADO",
          total: 700,
          itens: {
            create: {
              itemGraficaId: fixture.itemGraficaId,
              quantidade: 10,
              precoUnitario: 70,
              precoTotal: 700,
              precoSugeridoUnitario: 100,
              descontoTipo: "PERCENTUAL",
              descontoValor: 30,
              motivoDesconto: "fechamento de contrato anual",
            },
          },
        },
      });

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioOperadorId)) as never
      );

      await expect(
        duplicarOrcamento(null, formDataDe({ orcamentoId: original.id }))
      ).rejects.toThrow(/^NEXT_REDIRECT:/);

      const novoId = (redirectMock.mock.calls[0][0] as string).split("/").pop()!;
      const novo = await prisma.orcamento.findUniqueOrThrow({
        where: { id: novoId },
        include: { itens: true },
      });

      // OPERADOR não pode aprovar um desconto acima do limite — o item nasce
      // com preço CHEIO (100/un) em vez de bloquear a duplicação inteira.
      expect(novo.itens[0].descontoTipo).toBeNull();
      expect(Number(novo.itens[0].precoUnitario)).toBe(100);
    },
    TIMEOUT_MS
  );

  it(
    "DONO duplicando o mesmo item acima do limite recebe o desconto aplicado, com aprovadoPorId gravado",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);
      const original = await prisma.orcamento.create({
        data: {
          graficaId: fixture.graficaId,
          clienteId: fixture.clienteId,
          usuarioId: fixture.usuarioDonoId,
          status: "APROVADO",
          total: 700,
          itens: {
            create: {
              itemGraficaId: fixture.itemGraficaId,
              quantidade: 10,
              precoUnitario: 70,
              precoTotal: 700,
              precoSugeridoUnitario: 100,
              descontoTipo: "PERCENTUAL",
              descontoValor: 30,
              motivoDesconto: "fechamento de contrato anual",
            },
          },
        },
      });

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioDonoId)) as never
      );

      await expect(
        duplicarOrcamento(null, formDataDe({ orcamentoId: original.id }))
      ).rejects.toThrow(/^NEXT_REDIRECT:/);

      const novoId = (redirectMock.mock.calls[0][0] as string).split("/").pop()!;
      const novo = await prisma.orcamento.findUniqueOrThrow({
        where: { id: novoId },
        include: { itens: true },
      });

      expect(novo.itens[0].descontoTipo).toBe("PERCENTUAL");
      expect(Number(novo.itens[0].precoUnitario)).toBeCloseTo(70, 2);
      expect(novo.itens[0].aprovadoPorId).toBe(fixture.usuarioDonoId);

      const auditoria = await prisma.logAuditoria.findFirst({
        where: { graficaId: fixture.graficaId, entidadeId: novo.id, acao: "orcamento.duplicar" },
      });
      expect(auditoria).not.toBeNull();
    },
    TIMEOUT_MS
  );

  it.each(["RASCUNHO", "ENVIADO"] as const)(
    "bloqueia duplicar um orçamento em status %s",
    async (status) => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);
      const original = await criarOrcamentoOrigem(fixture, { status });

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioDonoId)) as never
      );

      const resultado = await duplicarOrcamento(null, formDataDe({ orcamentoId: original.id }));

      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toContain("aprovado ou rejeitado");
      expect(redirectMock).not.toHaveBeenCalled();

      const contagem = await prisma.orcamento.count({ where: { graficaId: fixture.graficaId } });
      expect(contagem).toBe(1); // nada novo foi criado
    },
    TIMEOUT_MS
  );

  it(
    "item cujo produto foi desativado no catálogo bloqueia a duplicação com mensagem clara (nada é criado)",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);
      const original = await criarOrcamentoOrigem(fixture, { quantidade: 5 });

      await prisma.itemGrafica.update({
        where: { id: fixture.itemGraficaId },
        data: { ativo: false },
      });

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioDonoId)) as never
      );

      const resultado = await duplicarOrcamento(null, formDataDe({ orcamentoId: original.id }));

      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toContain("não está mais disponível no catálogo");
      expect(redirectMock).not.toHaveBeenCalled();

      const contagem = await prisma.orcamento.count({ where: { graficaId: fixture.graficaId } });
      expect(contagem).toBe(1);
    },
    TIMEOUT_MS
  );
});
