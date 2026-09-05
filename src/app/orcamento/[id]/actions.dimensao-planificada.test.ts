import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de src/app/orcamento/[id]/actions.offset-custo-faca.test.ts)
// — cobre o achado A11 da Parte 1 da auditoria de abrangência (Embalagem/
// cartonagem): OrcamentoItem.larguraCm/alturaCm alimentavam direto o
// nesting (aproveitamento de folha), mas numa caixa a dimensão que REALMENTE
// ocupa a folha é o DESENVOLVIMENTO DA FACA (a peça planificada, aberta),
// não o produto acabado fechado — sem separar os dois, o custo saía errado
// por 2-3×. OrcamentoItem.larguraPlanificadaCm/alturaPlanificadaCm (novos,
// opcionais) resolvem isso: quando presentes, o motor de nesting usa ESSAS
// dimensões; ausentes, cai no comportamento de sempre (larguraCm/alturaCm).
// Este arquivo cobre o fluxo COMPLETO via adicionarItemOrcamento/
// editarOrcamento: formData -> calcularItemOrcamento -> imposição
// (src/lib/pricing/imposicao.ts) -> precoTotal.
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
import { adicionarItemOrcamento, editarOrcamento } from "./actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

type Fixture = {
  graficaId: string;
  usuarioId: string;
  clienteId: string;
  itemGraficaId: string;
  orcamentoId: string;
};

// Monta um produto OFFSET completo e funcional (prensa + papel com tabela de
// preço + formato de folha 66x96cm) — mesmo mínimo de
// actions.offset-custo-faca.test.ts, que carregarContextoPrecificacao (ver
// src/lib/pricing/carregar.ts) exige pro branch OFFSET não lançar
// PRENSA_NAO_CONFIGURADA/PAPEL_NAO_CONFIGURADO/PAPEL_SEM_TABELA_PRECO.
async function criarFixture(): Promise<Fixture> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Dimensao Planificada ${s}`, slug: `teste-dimensao-planificada-${s}` },
  });
  const usuario = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Usuário ${s}`,
      email: `user-dim-planificada-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const cliente = await prisma.cliente.create({
    data: { graficaId: grafica.id, nome: `Cliente ${s}` },
  });
  const prensa = await prisma.prensa.create({
    data: { graficaId: grafica.id, nome: `Prensa ${s}` },
  });
  const catalogoPapel = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "MATERIA_PRIMA", categoria: "Papelão", nome: `Papelão ondulado ${s}` },
  });
  const papel = await prisma.itemGrafica.create({
    data: { graficaId: grafica.id, itemCatalogoId: catalogoPapel.id },
  });
  await prisma.tabelaPrecoPapel.create({
    data: { itemGraficaId: papel.id, gramatura: 300, precoKg: 8.5 },
  });

  const catalogoProduto = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Embalagem", nome: `Caixa de papelão ${s}` },
  });
  const itemGrafica = await prisma.itemGrafica.create({
    data: {
      graficaId: grafica.id,
      itemCatalogoId: catalogoProduto.id,
      precoVenda: 1, // motor avançado ignora isso, mas as actions exigem !== null
      modeloCalculo: "OFFSET",
      prensaId: prensa.id,
      papelId: papel.id,
      gramaturaGm2: 300,
      formatosFolha: {
        create: [{ nome: "Fechada 66x96", larguraFolha: 0.66, alturaFolha: 0.96 }],
      },
    },
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
    // Uma única instrução DELETE cobrindo os dois lados do FK auto-
    // referenciado ItemGrafica.papelId (onDelete: Restrict) — mesmo padrão
    // de actions.offset-custo-faca.test.ts.
    await prisma.itemGrafica.deleteMany({ where: { graficaId } });
    await prisma.itemCatalogo.deleteMany({ where: { graficaId } });
    await prisma.prensa.deleteMany({ where: { graficaId } });
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
}, TIMEOUT_MS);

describe("adicionarItemOrcamento — dimensão planificada em item OFFSET (achado A11)", () => {
  it(
    "sem dimensão planificada, o nesting usa largura/altura do produto fechado (regressão zero)",
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
          // Caixa 9x5cm FECHADA — sem planificação informada, o nesting usa
          // isso direto (99 peças/folha na folha 66x96cm cadastrada).
          largura: "9",
          altura: "5",
          unidadeDimensao: "CM",
          corFrente: "4",
          corVerso: "4",
        })
      );

      expect(resultado.ok).toBe(true);
      const item = await prisma.orcamentoItem.findFirstOrThrow({
        where: { orcamentoId: fixture.orcamentoId },
      });
      expect(item.larguraPlanificadaCm).toBeNull();
      expect(item.alturaPlanificadaCm).toBeNull();
      expect(item.larguraCm?.toString()).toBe("9");
      expect(item.alturaCm?.toString()).toBe("5");
    },
    TIMEOUT_MS
  );

  it(
    "com dimensão planificada MAIOR (desenvolvimento da faca), o custo por peça sobe — menos peças cabem na folha",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioId)) as never
      );

      const camposComuns = {
        orcamentoId: fixture.orcamentoId,
        itemGraficaId: fixture.itemGraficaId,
        quantidade: "1000",
        // Caixa 9x5x10cm fechada — planifica pra ~55x45cm (desenvolvimento
        // da faca, o que de fato ocupa a folha de papelão).
        largura: "9",
        altura: "5",
        unidadeDimensao: "CM",
        corFrente: "4",
        corVerso: "4",
      };

      const semPlanificada = await adicionarItemOrcamento(null, formDataDe(camposComuns));
      expect(semPlanificada.ok).toBe(true);
      const itemSemPlanificada = await prisma.orcamentoItem.findFirstOrThrow({
        where: { orcamentoId: fixture.orcamentoId },
      });

      const comPlanificada = await adicionarItemOrcamento(
        null,
        formDataDe({ ...camposComuns, larguraPlanificada: "55", alturaPlanificada: "45" })
      );
      expect(comPlanificada.ok).toBe(true);
      const itemComPlanificada = await prisma.orcamentoItem.findFirstOrThrow({
        where: { orcamentoId: fixture.orcamentoId, larguraPlanificadaCm: { not: null } },
      });

      // Achado A11 — a dimensão FECHADA (9x5cm) continua gravada em
      // larguraCm/alturaCm (é o produto vendido), mas a planificada (o que
      // ocupa a folha) fica em colunas separadas.
      expect(itemComPlanificada.larguraCm?.toString()).toBe("9");
      expect(itemComPlanificada.alturaCm?.toString()).toBe("5");
      expect(itemComPlanificada.larguraPlanificadaCm?.toString()).toBe("55");
      expect(itemComPlanificada.alturaPlanificadaCm?.toString()).toBe("45");

      // Sem separar os dois (comportamento de ANTES desta correção), o
      // motor usava 9x5cm pro nesting: ~99 peças cabem numa folha 66x96cm.
      // Com a planificação de ~55x45cm, só 2 peças cabem por folha — MUITO
      // mais folha consumida por peça, logo custo por peça bem maior. Este
      // é exatamente o bug do achado A11 (custo de embalagem errado por
      // 2-3×) sendo corrigido.
      expect(Number(itemComPlanificada.precoTotal)).toBeGreaterThan(
        Number(itemSemPlanificada.precoTotal) * 2
      );
    },
    TIMEOUT_MS
  );

  it(
    "informar só a largura planificada (sem a altura) é rejeitado — as duas vêm juntas ou nenhuma",
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
          largura: "9",
          altura: "5",
          unidadeDimensao: "CM",
          corFrente: "4",
          corVerso: "4",
          larguraPlanificada: "55",
        })
      );

      expect(resultado.ok).toBe(false);
      const item = await prisma.orcamentoItem.findFirst({
        where: { orcamentoId: fixture.orcamentoId },
      });
      expect(item).toBeNull();
    },
    TIMEOUT_MS
  );
});

describe("editarOrcamento — dimensão planificada em item OFFSET (achado A11)", () => {
  it(
    "adicionar/remover a dimensão planificada de um item existente recalcula o preço",
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
          largura: "9",
          altura: "5",
          unidadeDimensao: "CM",
          corFrente: "4",
          corVerso: "4",
        })
      );
      const itemCriado = await prisma.orcamentoItem.findFirstOrThrow({
        where: { orcamentoId: fixture.orcamentoId },
      });
      expect(itemCriado.larguraPlanificadaCm).toBeNull();
      const precoSemPlanificada = Number(itemCriado.precoTotal);

      // editarOrcamento recebe larguraCm/alturaCm/larguraPlanificadaCm/
      // alturaPlanificadaCm já em cm (EditarOrcamentoForm.tsx converte no
      // client antes de mandar, mesmo padrão de larguraCm/alturaCm).
      const resultado = await editarOrcamento(
        null,
        formDataDe({
          orcamentoId: fixture.orcamentoId,
          orcamentoItemId: itemCriado.id,
          quantidade: "1000",
          larguraCm: "9",
          alturaCm: "5",
          corFrente: "4",
          corVerso: "4",
          larguraPlanificadaCm: "55",
          alturaPlanificadaCm: "45",
        })
      );

      expect(resultado.ok).toBe(true);
      const itemComPlanificada = await prisma.orcamentoItem.findUniqueOrThrow({
        where: { id: itemCriado.id },
      });
      expect(itemComPlanificada.larguraPlanificadaCm?.toString()).toBe("55");
      expect(itemComPlanificada.alturaPlanificadaCm?.toString()).toBe("45");
      expect(Number(itemComPlanificada.precoTotal)).toBeGreaterThan(precoSemPlanificada * 2);

      // Remover a planificação de novo (campos deixados em branco) volta os
      // dois a null e o preço volta ao original — mesmo padrão de "editar
      // sem tocar" dos outros campos opcionais deste formulário.
      const resultadoSemPlanificada = await editarOrcamento(
        null,
        formDataDe({
          orcamentoId: fixture.orcamentoId,
          orcamentoItemId: itemCriado.id,
          quantidade: "1000",
          larguraCm: "9",
          alturaCm: "5",
          corFrente: "4",
          corVerso: "4",
        })
      );
      expect(resultadoSemPlanificada.ok).toBe(true);
      const itemSemPlanificadaDeNovo = await prisma.orcamentoItem.findUniqueOrThrow({
        where: { id: itemCriado.id },
      });
      expect(itemSemPlanificadaDeNovo.larguraPlanificadaCm).toBeNull();
      expect(itemSemPlanificadaDeNovo.alturaPlanificadaCm).toBeNull();
      expect(Number(itemSemPlanificadaDeNovo.precoTotal)).toBe(precoSemPlanificada);
    },
    TIMEOUT_MS
  );
});
