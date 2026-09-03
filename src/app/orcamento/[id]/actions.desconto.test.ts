import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de src/lib/pedido-aprovacao.test.ts e
// src/app/producao/status-transicao.custo-automatico.test.ts) — cobre o
// critério de aceite do PR-6 da fase "custo real" (fase-custo-real.md §5):
// preço negociado abaixo do custo direto é bloqueado com a mesma mensagem
// da trava existente do motor; desconto acima do limite exige aprovação e
// grava quem aprovou; orçamento antigo sem os campos novos (precoSugeridoUnitario
// null) não derruba a action.
//
// exigirUsuarioAutenticado/exigirEmailVerificado/exigirAssinaturaAtiva são
// mockados porque dependem de cookies()/headers() de uma requisição Next.js
// de verdade, que não existe rodando a action direto — mesmo motivo de
// status-transicao.custo-automatico.test.ts mockar next/cache. A checagem de
// permissão de módulo (podeEditarModulo) roda de verdade contra o banco.
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
import { adicionarItemOrcamento, aplicarDescontoItemOrcamento } from "./actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

type Fixture = {
  graficaId: string;
  usuarioDonoId: string;
  usuarioOperadorId: string;
  itemGraficaId: string;
  orcamentoId: string;
  precoVenda: number;
  precoCompra: number | null;
};

// Limite de desconto sem aprovação usado em todos os testes — bem abaixo de
// 100 (default de "sem trava") pra exercitar a trava de aprovação de verdade.
const LIMITE_SEM_APROVACAO = 15;

async function criarFixture(
  opts: { precoCompra?: number | null; simplesCobraPorArea?: boolean } = {}
): Promise<Fixture> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Desconto Item ${s}`, slug: `teste-desconto-item-${s}` },
  });
  await prisma.parametrosGrafica.create({
    data: { graficaId: grafica.id, descontoMaxSemAprovacao: LIMITE_SEM_APROVACAO },
  });
  const cliente = await prisma.cliente.create({ data: { graficaId: grafica.id, nome: `Cliente ${s}` } });
  const usuarioDono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-desconto-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const usuarioOperador = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Operador ${s}`,
      email: `operador-desconto-${s}@example.com`,
      senhaHash: "x",
      papel: "OPERADOR",
    },
  });
  // OPERADOR só passa por podeEditarModulo(ORCAMENTO) com esta linha —
  // comportamento real do RBAC (ver src/lib/auth/permissoes.ts), não mockado.
  await prisma.permissaoUsuario.create({
    data: { usuarioId: usuarioOperador.id, modulo: "ORCAMENTO", podeVer: true, podeEditar: true },
  });

  // Produto SIMPLES com preço de compra conhecido — custo direto do item
  // (pra trava de preço mínimo) = precoCompra × quantidade, mesmo cálculo do
  // bloco de comissão já existente neste arquivo (ver aplicarDescontoItemOrcamento).
  // opts.precoCompra=null (achado N11a) e opts.simplesCobraPorArea (achado
  // N11b) permitem os testes abaixo exercitarem a trava de custo desconhecido
  // e a trava de custo por área sem duplicar todo o resto da fixture.
  const precoVenda = 100;
  const precoCompra = opts.precoCompra === undefined ? 60 : opts.precoCompra;
  const catalogo = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Cartão", nome: `Produto Teste ${s}` },
  });
  const itemGrafica = await prisma.itemGrafica.create({
    data: {
      graficaId: grafica.id,
      itemCatalogoId: catalogo.id,
      precoVenda,
      precoCompra,
      simplesCobraPorArea: opts.simplesCobraPorArea ?? false,
    },
  });

  const orcamento = await prisma.orcamento.create({
    data: { graficaId: grafica.id, clienteId: cliente.id, usuarioId: usuarioDono.id, status: "RASCUNHO", total: 0 },
  });

  return {
    graficaId: grafica.id,
    usuarioDonoId: usuarioDono.id,
    usuarioOperadorId: usuarioOperador.id,
    itemGraficaId: itemGrafica.id,
    orcamentoId: orcamento.id,
    precoVenda,
    precoCompra,
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
}, TIMEOUT_MS);

// Adiciona um item de quantidade 10 (precoVenda 100 → sugerido/vendido 1000,
// custo direto 600) e devolve o id do OrcamentoItem criado. dimensoes
// (achado N11b) só faz sentido combinado com uma fixture
// simplesCobraPorArea:true — exercita a trava de custo por área.
async function adicionarItemFixture(
  fixture: Fixture,
  quantidade = 10,
  dimensoes?: { largura: number; altura: number }
): Promise<string> {
  vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
    (await usuarioParaMock(fixture.usuarioDonoId)) as never
  );
  const resultado = await adicionarItemOrcamento(
    null,
    formDataDe({
      orcamentoId: fixture.orcamentoId,
      itemGraficaId: fixture.itemGraficaId,
      quantidade: String(quantidade),
      unidadeDimensao: "CM",
      ...(dimensoes
        ? { largura: String(dimensoes.largura), altura: String(dimensoes.altura) }
        : {}),
    })
  );
  expect(resultado.ok).toBe(true);
  const item = await prisma.orcamentoItem.findFirstOrThrow({ where: { orcamentoId: fixture.orcamentoId } });
  return item.id;
}

describe("adicionarItemOrcamento grava precoSugeridoUnitario", () => {
  it(
    "precoSugeridoUnitario nasce igual a precoUnitario na criação do item",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);

      const itemId = await adicionarItemFixture(fixture);
      const item = await prisma.orcamentoItem.findUniqueOrThrow({ where: { id: itemId } });

      expect(Number(item.precoUnitario)).toBe(fixture.precoVenda);
      expect(item.precoSugeridoUnitario).not.toBeNull();
      expect(Number(item.precoSugeridoUnitario)).toBe(fixture.precoVenda);
      expect(item.descontoTipo).toBeNull();
    },
    TIMEOUT_MS
  );
});

describe("aplicarDescontoItemOrcamento", () => {
  it(
    "OPERADOR aplica desconto dentro do limite sem precisar de aprovação",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);
      const itemId = await adicionarItemFixture(fixture);

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioOperadorId)) as never
      );
      const resultado = await aplicarDescontoItemOrcamento(
        null,
        formDataDe({
          orcamentoItemId: itemId,
          tipo: "PERCENTUAL",
          valor: "5",
          motivo: "desconto de relacionamento",
        })
      );

      expect(resultado.ok).toBe(true);
      const item = await prisma.orcamentoItem.findUniqueOrThrow({ where: { id: itemId } });
      expect(Number(item.precoUnitario)).toBeCloseTo(95, 2); // 100 × (1 − 5%)
      expect(Number(item.precoTotal)).toBeCloseTo(950, 2);
      expect(item.descontoTipo).toBe("PERCENTUAL");
      expect(Number(item.descontoValor)).toBe(5);
      expect(item.motivoDesconto).toBe("desconto de relacionamento");
      expect(item.aprovadoPorId).toBeNull();

      const orcamento = await prisma.orcamento.findUniqueOrThrow({ where: { id: fixture.orcamentoId } });
      expect(Number(orcamento.total)).toBeCloseTo(950, 2);
    },
    TIMEOUT_MS
  );

  it(
    "OPERADOR é bloqueado ao tentar desconto acima do limite sem aprovação",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);
      const itemId = await adicionarItemFixture(fixture);

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioOperadorId)) as never
      );
      // 30% > LIMITE_SEM_APROVACAO (15%), mas ainda acima do custo direto
      // (100 × 0.7 × 10 = 700 > 600) — isola a trava de aprovação da trava
      // de preço mínimo.
      const resultado = await aplicarDescontoItemOrcamento(
        null,
        formDataDe({
          orcamentoItemId: itemId,
          tipo: "PERCENTUAL",
          valor: "30",
          motivo: "tentativa de operador",
        })
      );

      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toContain("dono ou administrador");

      const item = await prisma.orcamentoItem.findUniqueOrThrow({ where: { id: itemId } });
      // Nada foi alterado — bloqueio é antes de qualquer escrita.
      expect(Number(item.precoUnitario)).toBe(100);
      expect(item.descontoTipo).toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "DONO aplica o mesmo desconto acima do limite e o sistema grava quem aprovou",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);
      const itemId = await adicionarItemFixture(fixture);

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioDonoId)) as never
      );
      const resultado = await aplicarDescontoItemOrcamento(
        null,
        formDataDe({
          orcamentoItemId: itemId,
          tipo: "PERCENTUAL",
          valor: "30",
          motivo: "fechamento de contrato anual",
        })
      );

      expect(resultado.ok).toBe(true);
      const item = await prisma.orcamentoItem.findUniqueOrThrow({ where: { id: itemId } });
      expect(Number(item.precoUnitario)).toBeCloseTo(70, 2);
      expect(item.aprovadoPorId).toBe(fixture.usuarioDonoId);

      const auditoria = await prisma.logAuditoria.findFirst({
        where: { graficaId: fixture.graficaId, entidadeId: itemId, acao: "orcamento_item.aplicar_desconto" },
      });
      expect(auditoria).not.toBeNull();
      expect(auditoria!.descricao).toContain("30");
    },
    TIMEOUT_MS
  );

  it(
    "preço negociado abaixo do custo direto é bloqueado com a mensagem da trava do motor",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);
      const itemId = await adicionarItemFixture(fixture); // qtd 10, custo direto total = 600

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioDonoId)) as never
      );
      // Preço final por unidade R$ 50 × 10 = 500, abaixo do custo direto (600).
      const resultado = await aplicarDescontoItemOrcamento(
        null,
        formDataDe({
          orcamentoItemId: itemId,
          tipo: "PRECO_FINAL",
          valor: "50",
          motivo: "tentando vender no prejuízo",
        })
      );

      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toBe(
        "O preço final calculado ficou abaixo do custo direto — configuração de margem/encargos provavelmente incorreta. Orçamento abortado por segurança."
      );

      const item = await prisma.orcamentoItem.findUniqueOrThrow({ where: { id: itemId } });
      expect(Number(item.precoUnitario)).toBe(100); // nada foi escrito
    },
    TIMEOUT_MS
  );

  it(
    "remover desconto restaura o preço sugerido e limpa os 4 campos, sem exigir motivo",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);
      const itemId = await adicionarItemFixture(fixture);

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioDonoId)) as never
      );
      await aplicarDescontoItemOrcamento(
        null,
        formDataDe({ orcamentoItemId: itemId, tipo: "PERCENTUAL", valor: "10", motivo: "motivo qualquer" })
      );

      const resultadoRemover = await aplicarDescontoItemOrcamento(
        null,
        formDataDe({ orcamentoItemId: itemId, remover: "true" })
      );

      expect(resultadoRemover.ok).toBe(true);
      const item = await prisma.orcamentoItem.findUniqueOrThrow({ where: { id: itemId } });
      expect(Number(item.precoUnitario)).toBe(100);
      expect(Number(item.precoTotal)).toBe(1000);
      expect(item.descontoTipo).toBeNull();
      expect(item.descontoValor).toBeNull();
      expect(item.motivoDesconto).toBeNull();
      expect(item.aprovadoPorId).toBeNull();

      const orcamento = await prisma.orcamento.findUniqueOrThrow({ where: { id: fixture.orcamentoId } });
      expect(Number(orcamento.total)).toBe(1000);
    },
    TIMEOUT_MS
  );

  it(
    "item sem precoSugeridoUnitario (orçamento antigo pré-fase) não derruba a action",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);

      // Simula um item criado ANTES desta funcionalidade: gravado direto no
      // banco sem precoSugeridoUnitario, como todo item pré-PR-6.
      const itemAntigo = await prisma.orcamentoItem.create({
        data: {
          orcamentoId: fixture.orcamentoId,
          itemGraficaId: fixture.itemGraficaId,
          quantidade: 5,
          precoUnitario: 100,
          precoTotal: 500,
        },
      });

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioDonoId)) as never
      );
      const resultado = await aplicarDescontoItemOrcamento(
        null,
        formDataDe({ orcamentoItemId: itemAntigo.id, tipo: "PERCENTUAL", valor: "5", motivo: "x" })
      );

      // Erro claro, não um throw/crash — "renderiza normalmente" (critério
      // de aceite do PR-6): o item continua existindo intacto.
      expect(resultado.ok).toBe(false);
      const item = await prisma.orcamentoItem.findUniqueOrThrow({ where: { id: itemAntigo.id } });
      expect(Number(item.precoUnitario)).toBe(100);
    },
    TIMEOUT_MS
  );

  // Achado N11(a) — precoCompra ausente é custo DESCONHECIDO, não zero.
  // Antes desta correção, a trava calculava custo direto = 0 nesse caso e
  // liberava qualquer desconto (inclusive pra DONO/ADMIN, que nem passam
  // pela trava de alçada). Agora o piso vira o próprio preço sugerido —
  // bloqueia até o custo de compra ser cadastrado.
  it(
    "sem precoCompra cadastrado, QUALQUER desconto é bloqueado (custo desconhecido != custo zero)",
    async () => {
      const fixture = await criarFixture({ precoCompra: null });
      graficaIdsParaLimpar.push(fixture.graficaId);
      const itemId = await adicionarItemFixture(fixture); // qtd 10, sugerido total 1000

      // DONO — sem alçada configurada, sempre passaria pela trava de
      // aprovação (limiteResolvido=100%); só a trava de custo pode bloquear.
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioDonoId)) as never
      );
      const resultado = await aplicarDescontoItemOrcamento(
        null,
        formDataDe({
          orcamentoItemId: itemId,
          tipo: "PERCENTUAL",
          valor: "5", // desconto pequeno — antes da correção, passava sem qualquer trava
          motivo: "desconto pequeno, mas custo é desconhecido",
        })
      );

      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toContain("não tem custo de compra cadastrado");

      const item = await prisma.orcamentoItem.findUniqueOrThrow({ where: { id: itemId } });
      expect(Number(item.precoUnitario)).toBe(100); // nada foi escrito
    },
    TIMEOUT_MS
  );

  // Achado N11(b) — produto SIMPLES marcado como "cobra por área"
  // (ItemGrafica.simplesCobraPorArea): o piso de custo precisa multiplicar
  // pela MESMA área usada no cálculo do preço, senão um desconto que na
  // prática vende abaixo do custo passa batido.
  describe("SIMPLES cobrado por área (simplesCobraPorArea=true)", () => {
    it(
      "desconto que fica abaixo do custo×área é bloqueado (mesmo passando no custo×peça antigo)",
      async () => {
        // precoVenda 100/m², precoCompra 18/m², item 3m×2m = 6m², qtd 1.
        // Preço sugerido = 100 × 6 = 600. Custo direto correto = 18 × 6 = 108.
        // Custo ANTIGO (sem área, achado N11b) seria só 18 × 1 = 18 — um
        // preço final de 50 passaria na trava antiga (50 ≥ 18) mas precisa
        // ser bloqueado agora (50 < 108).
        const fixture = await criarFixture({ precoCompra: 18, simplesCobraPorArea: true });
        graficaIdsParaLimpar.push(fixture.graficaId);
        const itemId = await adicionarItemFixture(fixture, 1, { largura: 300, altura: 200 });

        const item = await prisma.orcamentoItem.findUniqueOrThrow({ where: { id: itemId } });
        expect(Number(item.precoTotal)).toBe(600); // confirma a área entrou no preço

        vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
          (await usuarioParaMock(fixture.usuarioDonoId)) as never
        );
        const resultado = await aplicarDescontoItemOrcamento(
          null,
          formDataDe({
            orcamentoItemId: itemId,
            tipo: "PRECO_FINAL",
            valor: "50",
            motivo: "tentando vender abaixo do custo real (por área)",
          })
        );

        expect(resultado.ok).toBe(false);
        expect(resultado.mensagem).toContain("abaixo do custo direto");
      },
      TIMEOUT_MS
    );

    it(
      "desconto que fica acima do custo×área é aplicado normalmente",
      async () => {
        const fixture = await criarFixture({ precoCompra: 18, simplesCobraPorArea: true });
        graficaIdsParaLimpar.push(fixture.graficaId);
        const itemId = await adicionarItemFixture(fixture, 1, { largura: 300, altura: 200 });

        vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
          (await usuarioParaMock(fixture.usuarioDonoId)) as never
        );
        // 150 fica acima do custo direto correto (108) — deve passar.
        const resultado = await aplicarDescontoItemOrcamento(
          null,
          formDataDe({
            orcamentoItemId: itemId,
            tipo: "PRECO_FINAL",
            valor: "150",
            motivo: "desconto válido, ainda acima do custo por área",
          })
        );

        expect(resultado.ok).toBe(true);
        const item = await prisma.orcamentoItem.findUniqueOrThrow({ where: { id: itemId } });
        expect(Number(item.precoTotal)).toBe(150);
      },
      TIMEOUT_MS
    );
  });
});
