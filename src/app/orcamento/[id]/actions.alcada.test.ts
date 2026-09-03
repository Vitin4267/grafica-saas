import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL),
// mesmo padrão de actions.desconto.test.ts neste mesmo diretório — cobre o
// achado A4 da auditoria de abrangência (Parte 6/Configurações,
// pesquisa-abrangencia-modulos.md, 2026-09-02): resolução de AlcadaAprovacao
// em aplicarDescontoItemOrcamento (alçada do usuário > alçada do papel >
// comportamento de hoje). A regressão zero (sem nenhuma AlcadaAprovacao) já
// é coberta por actions.desconto.test.ts inteiro continuar passando sem
// nenhuma alteração — este arquivo cobre só o comportamento NOVO.
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
  usuarioOperadorSeniorId: string;
  itemGraficaId: string;
  orcamentoId: string;
};

// Limite global bem alto (praticamente "sem trava") — isola a checagem da
// alçada configurada, sem interferência do limite geral da gráfica.
const LIMITE_GLOBAL_ALTO = 90;

async function criarFixture(): Promise<Fixture> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Alcada Desconto ${s}`, slug: `teste-alcada-desconto-${s}` },
  });
  await prisma.parametrosGrafica.create({
    data: { graficaId: grafica.id, descontoMaxSemAprovacao: LIMITE_GLOBAL_ALTO },
  });
  const cliente = await prisma.cliente.create({ data: { graficaId: grafica.id, nome: `Cliente ${s}` } });
  const usuarioDono = await prisma.usuario.create({
    data: { graficaId: grafica.id, nome: `Dono ${s}`, email: `dono-alcada-${s}@example.com`, senhaHash: "x", papel: "DONO" },
  });
  const usuarioOperador = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Operador ${s}`,
      email: `operador-alcada-${s}@example.com`,
      senhaHash: "x",
      papel: "OPERADOR",
    },
  });
  const usuarioOperadorSenior = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Operador Senior ${s}`,
      email: `operador-senior-alcada-${s}@example.com`,
      senhaHash: "x",
      papel: "OPERADOR",
    },
  });
  await prisma.permissaoUsuario.createMany({
    data: [
      { usuarioId: usuarioOperador.id, modulo: "ORCAMENTO", podeVer: true, podeEditar: true },
      { usuarioId: usuarioOperadorSenior.id, modulo: "ORCAMENTO", podeVer: true, podeEditar: true },
    ],
  });

  const catalogo = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Cartão", nome: `Produto Teste ${s}` },
  });
  // precoCompra bem baixo (custo direto = 10 pra qtd 10) — garante que até
  // um desconto de 95% (testado abaixo) fique ACIMA do custo direto, então
  // a única trava exercitada nestes testes é a de ALÇADA, nunca a de preço
  // mínimo (que já tem cobertura própria em actions.desconto.test.ts).
  const itemGrafica = await prisma.itemGrafica.create({
    data: { graficaId: grafica.id, itemCatalogoId: catalogo.id, precoVenda: 100, precoCompra: 1 },
  });

  const orcamento = await prisma.orcamento.create({
    data: { graficaId: grafica.id, clienteId: cliente.id, usuarioId: usuarioDono.id, status: "RASCUNHO", total: 0 },
  });

  return {
    graficaId: grafica.id,
    usuarioDonoId: usuarioDono.id,
    usuarioOperadorId: usuarioOperador.id,
    usuarioOperadorSeniorId: usuarioOperadorSenior.id,
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
    await prisma.logAuditoria.deleteMany({ where: { graficaId } });
    await prisma.alcadaAprovacao.deleteMany({ where: { graficaId } });
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

async function adicionarItemFixture(fixture: Fixture, usuarioId: string, quantidade = 10): Promise<string> {
  vi.mocked(exigirUsuarioAutenticado).mockResolvedValue((await usuarioParaMock(usuarioId)) as never);
  const resultado = await adicionarItemOrcamento(
    null,
    formDataDe({
      orcamentoId: fixture.orcamentoId,
      itemGraficaId: fixture.itemGraficaId,
      quantidade: String(quantidade),
      unidadeDimensao: "CM",
    })
  );
  expect(resultado.ok).toBe(true);
  const item = await prisma.orcamentoItem.findFirstOrThrow({ where: { orcamentoId: fixture.orcamentoId } });
  return item.id;
}

describe("aplicarDescontoItemOrcamento — alçada configurável (achado A4)", () => {
  it(
    "alçada de PAPEL trava um OPERADOR num percentual MENOR que o limite global da gráfica",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);
      await prisma.alcadaAprovacao.create({
        data: { graficaId: fixture.graficaId, tipo: "DESCONTO_ORCAMENTO", papel: "OPERADOR", limite: 5 },
      });
      const itemId = await adicionarItemFixture(fixture, fixture.usuarioDonoId);

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioOperadorId)) as never
      );
      // 8% > alçada de papel (5%), mas 8% < limite global da gráfica (90%) —
      // sem a alçada configurada isto passaria sem checagem nenhuma.
      const resultado = await aplicarDescontoItemOrcamento(
        null,
        formDataDe({ orcamentoItemId: itemId, tipo: "PERCENTUAL", valor: "8", motivo: "tentativa" })
      );

      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toContain("5.0%");
      const item = await prisma.orcamentoItem.findUniqueOrThrow({ where: { id: itemId } });
      expect(Number(item.precoUnitario)).toBe(100); // nada mudou
    },
    TIMEOUT_MS
  );

  it(
    "alçada de PAPEL libera um OPERADOR dentro do próprio percentual configurado",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);
      await prisma.alcadaAprovacao.create({
        data: { graficaId: fixture.graficaId, tipo: "DESCONTO_ORCAMENTO", papel: "OPERADOR", limite: 5 },
      });
      const itemId = await adicionarItemFixture(fixture, fixture.usuarioDonoId);

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioOperadorId)) as never
      );
      const resultado = await aplicarDescontoItemOrcamento(
        null,
        formDataDe({ orcamentoItemId: itemId, tipo: "PERCENTUAL", valor: "5", motivo: "dentro da alçada" })
      );

      expect(resultado.ok).toBe(true);
      const item = await prisma.orcamentoItem.findUniqueOrThrow({ where: { id: itemId } });
      expect(Number(item.precoUnitario)).toBeCloseTo(95, 2);
      // 5% não passa do limite GLOBAL (90%) — não precisa de aprovadoPorId.
      expect(item.aprovadoPorId).toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "alçada de USUÁRIO específico tem prioridade sobre a alçada do PAPEL — vendedor sênior aprova mais que o resto do papel",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);
      await prisma.alcadaAprovacao.createMany({
        data: [
          { graficaId: fixture.graficaId, tipo: "DESCONTO_ORCAMENTO", papel: "OPERADOR", limite: 5 },
          {
            graficaId: fixture.graficaId,
            tipo: "DESCONTO_ORCAMENTO",
            usuarioId: fixture.usuarioOperadorSeniorId,
            limite: 20,
          },
        ],
      });

      // OPERADOR comum (só a alçada do papel, 5%) continua bloqueado acima de 5%.
      const itemComum = await adicionarItemFixture(fixture, fixture.usuarioDonoId);
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioOperadorId)) as never
      );
      const resultadoComum = await aplicarDescontoItemOrcamento(
        null,
        formDataDe({ orcamentoItemId: itemComum, tipo: "PERCENTUAL", valor: "12", motivo: "acima da alçada de papel" })
      );
      expect(resultadoComum.ok).toBe(false);

      // Operador SÊNIOR (alçada própria de 20%) aplica os mesmos 12% sem bloqueio.
      const itemSenior = await adicionarItemFixture(fixture, fixture.usuarioDonoId);
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioOperadorSeniorId)) as never
      );
      const resultadoSenior = await aplicarDescontoItemOrcamento(
        null,
        formDataDe({ orcamentoItemId: itemSenior, tipo: "PERCENTUAL", valor: "12", motivo: "dentro da alçada pessoal" })
      );
      expect(resultadoSenior.ok).toBe(true);
      const item = await prisma.orcamentoItem.findUniqueOrThrow({ where: { id: itemSenior } });
      expect(Number(item.precoUnitario)).toBeCloseTo(88, 2);
    },
    TIMEOUT_MS
  );

  it(
    "sem NENHUMA alçada configurada, DONO continua sem teto (100%) mesmo acima do limite global — regressão zero",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);
      const itemId = await adicionarItemFixture(fixture, fixture.usuarioDonoId);

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioDonoId)) as never
      );
      // 95% > limite global (90%), sem alçada nenhuma cadastrada — DONO
      // segue aprovando (fallback idêntico ao comportamento hardcoded de
      // antes desta feature).
      const resultado = await aplicarDescontoItemOrcamento(
        null,
        formDataDe({ orcamentoItemId: itemId, tipo: "PERCENTUAL", valor: "95", motivo: "fechamento" })
      );

      expect(resultado.ok).toBe(true);
      const item = await prisma.orcamentoItem.findUniqueOrThrow({ where: { id: itemId } });
      expect(item.aprovadoPorId).toBe(fixture.usuarioDonoId);
    },
    TIMEOUT_MS
  );
});
