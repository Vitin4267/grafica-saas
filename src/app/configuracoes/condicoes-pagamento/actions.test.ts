import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de src/app/configuracoes/contas-financeiras/actions.test.ts)
// — cobre o CRUD de CondicaoPagamento/CondicaoPagamentoParcela, o gap de UI
// do achado A7 da Parte 4 da auditoria de abrangência
// (pesquisa-abrangencia-modulos.md): o model e o bootstrap lazy
// (garantirCondicoesPagamentoPadrao) já existiam, esta tela é o único jeito
// de criar/editar uma condição sem ser via Prisma direto.
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
import {
  criarCondicaoPagamento,
  editarCondicaoPagamento,
  alternarAtivaCondicaoPagamento,
} from "./actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const graficaIdsParaLimpar: string[] = [];

async function criarFixture() {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Condicao Pagamento ${s}`, slug: `teste-condicao-pagamento-${s}` },
  });
  const dono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-condicao-pagamento-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });

  graficaIdsParaLimpar.push(grafica.id);
  return { graficaId: grafica.id, usuarioId: dono.id };
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
    await prisma.condicaoPagamentoParcela.deleteMany({ where: { condicaoPagamento: { graficaId } } });
    await prisma.condicaoPagamento.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
}, TIMEOUT_MS);

describe("CondicaoPagamento — CRUD (achado A7 da Parte 4)", () => {
  it(
    "criarCondicaoPagamento: cria com âncora/acréscimo/parcelas e redireciona pra tela de detalhe",
    async () => {
      const f = await criarFixture();
      await logarComo(f.usuarioId);

      await expect(
        criarCondicaoPagamento(
          null,
          formDataDe({
            nome: "30/60/90 com 2% de acréscimo",
            ancora: "APROVACAO",
            acrescimoPercent: "2",
            parcelasJson: JSON.stringify([
              { percentual: "33.34", diasAposAncora: "30" },
              { percentual: "33.33", diasAposAncora: "60" },
              { percentual: "33.33", diasAposAncora: "90" },
            ]),
          })
        )
      ).rejects.toThrow("NEXT_REDIRECT");

      const condicao = await prisma.condicaoPagamento.findFirstOrThrow({
        where: { graficaId: f.graficaId, nome: "30/60/90 com 2% de acréscimo" },
        include: { parcelas: { orderBy: { ordem: "asc" } } },
      });
      expect(condicao.ancora).toBe("APROVACAO");
      expect(Number(condicao.acrescimoPercent)).toBe(2);
      expect(condicao.ativa).toBe(true);
      expect(condicao.parcelas).toHaveLength(3);
      expect(condicao.parcelas[0].ordem).toBe(1);
      expect(Number(condicao.parcelas[0].percentual)).toBe(33.34);
      expect(condicao.parcelas[2].diasAposAncora).toBe(90);
    },
    TIMEOUT_MS
  );

  it(
    "criarCondicaoPagamento: sem acréscimo informado, acrescimoPercent fica null",
    async () => {
      const f = await criarFixture();
      await logarComo(f.usuarioId);

      await expect(
        criarCondicaoPagamento(
          null,
          formDataDe({
            nome: "1x faturado 30 dias",
            ancora: "EMISSAO_NOTA",
            parcelasJson: JSON.stringify([{ percentual: "100", diasAposAncora: "30" }]),
          })
        )
      ).rejects.toThrow("NEXT_REDIRECT");

      const condicao = await prisma.condicaoPagamento.findFirstOrThrow({
        where: { graficaId: f.graficaId, nome: "1x faturado 30 dias" },
      });
      expect(condicao.acrescimoPercent).toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "criarCondicaoPagamento: soma dos percentuais diferente de 100% é rejeitada",
    async () => {
      const f = await criarFixture();
      await logarComo(f.usuarioId);

      const resultado = await criarCondicaoPagamento(
        null,
        formDataDe({
          nome: "Condição Quebrada",
          ancora: "APROVACAO",
          parcelasJson: JSON.stringify([
            { percentual: "50", diasAposAncora: "0" },
            { percentual: "40", diasAposAncora: "30" },
          ]),
        })
      );

      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toContain("100%");
      const existe = await prisma.condicaoPagamento.findFirst({
        where: { graficaId: f.graficaId, nome: "Condição Quebrada" },
      });
      expect(existe).toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "criarCondicaoPagamento: sem nenhuma parcela é rejeitado",
    async () => {
      const f = await criarFixture();
      await logarComo(f.usuarioId);

      const resultado = await criarCondicaoPagamento(
        null,
        formDataDe({ nome: "Sem Parcela", ancora: "APROVACAO", parcelasJson: JSON.stringify([]) })
      );

      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toContain("ao menos uma parcela");
    },
    TIMEOUT_MS
  );

  it(
    "criarCondicaoPagamento: nome vazio ou âncora inválida são rejeitados",
    async () => {
      const f = await criarFixture();
      await logarComo(f.usuarioId);

      const semNome = await criarCondicaoPagamento(
        null,
        formDataDe({
          nome: "  ",
          ancora: "APROVACAO",
          parcelasJson: JSON.stringify([{ percentual: "100", diasAposAncora: "0" }]),
        })
      );
      expect(semNome.ok).toBe(false);

      const ancoraInvalida = await criarCondicaoPagamento(
        null,
        formDataDe({
          nome: "Condição X",
          ancora: "NAO_EXISTE",
          parcelasJson: JSON.stringify([{ percentual: "100", diasAposAncora: "0" }]),
        })
      );
      expect(ancoraInvalida.ok).toBe(false);
      expect(ancoraInvalida.mensagem).toContain("âncora de vencimento válida");
    },
    TIMEOUT_MS
  );

  it(
    "criarCondicaoPagamento: nome duplicado na mesma gráfica é rejeitado",
    async () => {
      const f = await criarFixture();
      await logarComo(f.usuarioId);
      await prisma.condicaoPagamento.create({
        data: {
          graficaId: f.graficaId,
          nome: "Condição Existente",
          ancora: "APROVACAO",
          parcelas: { create: [{ ordem: 1, percentual: 100, diasAposAncora: 0 }] },
        },
      });

      const resultado = await criarCondicaoPagamento(
        null,
        formDataDe({
          nome: "Condição Existente",
          ancora: "ENTREGA",
          parcelasJson: JSON.stringify([{ percentual: "100", diasAposAncora: "0" }]),
        })
      );

      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toContain("Já existe uma condição de pagamento");
    },
    TIMEOUT_MS
  );

  it(
    "editarCondicaoPagamento: substitui nome/âncora/parcelas inteiras (delete + recreate)",
    async () => {
      const f = await criarFixture();
      await logarComo(f.usuarioId);
      const condicao = await prisma.condicaoPagamento.create({
        data: {
          graficaId: f.graficaId,
          nome: "50% + 50% na entrega",
          ancora: "ENTREGA",
          parcelas: {
            create: [
              { ordem: 1, percentual: 50, diasAposAncora: 0 },
              { ordem: 2, percentual: 50, diasAposAncora: 30 },
            ],
          },
        },
      });

      const resultado = await editarCondicaoPagamento(
        null,
        formDataDe({
          condicaoId: condicao.id,
          nome: "50% + 50% na entrega (revisada)",
          ancora: "ENTREGA",
          acrescimoPercent: "1.5",
          parcelasJson: JSON.stringify([
            { percentual: "60", diasAposAncora: "0" },
            { percentual: "40", diasAposAncora: "45" },
          ]),
        })
      );

      expect(resultado.ok).toBe(true);
      const atualizada = await prisma.condicaoPagamento.findUniqueOrThrow({
        where: { id: condicao.id },
        include: { parcelas: { orderBy: { ordem: "asc" } } },
      });
      expect(atualizada.nome).toBe("50% + 50% na entrega (revisada)");
      expect(Number(atualizada.acrescimoPercent)).toBe(1.5);
      expect(atualizada.parcelas).toHaveLength(2);
      expect(Number(atualizada.parcelas[0].percentual)).toBe(60);
      expect(atualizada.parcelas[1].diasAposAncora).toBe(45);
    },
    TIMEOUT_MS
  );

  it(
    "editarCondicaoPagamento: condição de outra gráfica não é encontrada (isolamento de tenant)",
    async () => {
      const f = await criarFixture();
      const outra = await criarFixture();
      await logarComo(f.usuarioId);
      const condicaoDeOutraGrafica = await prisma.condicaoPagamento.create({
        data: {
          graficaId: outra.graficaId,
          nome: "Condição Alheia",
          ancora: "APROVACAO",
          parcelas: { create: [{ ordem: 1, percentual: 100, diasAposAncora: 0 }] },
        },
      });

      const resultado = await editarCondicaoPagamento(
        null,
        formDataDe({
          condicaoId: condicaoDeOutraGrafica.id,
          nome: "Tentativa",
          ancora: "APROVACAO",
          parcelasJson: JSON.stringify([{ percentual: "100", diasAposAncora: "0" }]),
        })
      );

      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toContain("não encontrada");
    },
    TIMEOUT_MS
  );

  it(
    "alternarAtivaCondicaoPagamento: alterna ativa/inativa sem apagar a condição nem suas parcelas",
    async () => {
      const f = await criarFixture();
      await logarComo(f.usuarioId);
      const condicao = await prisma.condicaoPagamento.create({
        data: {
          graficaId: f.graficaId,
          nome: "Condição Alternável",
          ancora: "APROVACAO",
          parcelas: { create: [{ ordem: 1, percentual: 100, diasAposAncora: 0 }] },
        },
      });
      expect(condicao.ativa).toBe(true);

      const desativou = await alternarAtivaCondicaoPagamento(null, formDataDe({ condicaoId: condicao.id }));
      expect(desativou.ok).toBe(true);
      let atual = await prisma.condicaoPagamento.findUniqueOrThrow({
        where: { id: condicao.id },
        include: { parcelas: true },
      });
      expect(atual.ativa).toBe(false);
      expect(atual.parcelas).toHaveLength(1);

      const reativou = await alternarAtivaCondicaoPagamento(null, formDataDe({ condicaoId: condicao.id }));
      expect(reativou.ok).toBe(true);
      atual = await prisma.condicaoPagamento.findUniqueOrThrow({
        where: { id: condicao.id },
        include: { parcelas: true },
      });
      expect(atual.ativa).toBe(true);
    },
    TIMEOUT_MS
  );
});
