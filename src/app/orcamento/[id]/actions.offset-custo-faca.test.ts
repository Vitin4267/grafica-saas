import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de src/app/orcamento/[id]/actions.dimensoes-item.test.ts) —
// cobre o achado N10 da auditoria de abrangência: `custoFaca` era aceito,
// validado e descartado sem erro no branch OFFSET de precificar()
// (src/lib/pricing/precificar.ts corrigido — ver golden #8 em
// src/lib/pricing/__tests__/golden.test.ts pro teste unitário do motor).
// Este arquivo cobre o fluxo COMPLETO via adicionarItemOrcamento/
// editarOrcamento: formData -> calcularItemOrcamento -> OrcamentoItem.custoFaca
// (coluna nova, ver schema.prisma) -> precoTotal.
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
// preço + formato de folha) — o mínimo que carregarContextoPrecificacao
// (src/lib/pricing/carregar.ts) exige pro branch OFFSET não lançar
// PRENSA_NAO_CONFIGURADA/PAPEL_NAO_CONFIGURADO/PAPEL_SEM_TABELA_PRECO.
async function criarFixture(): Promise<Fixture> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Offset Custo Faca ${s}`, slug: `teste-offset-custo-faca-${s}` },
  });
  const usuario = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Usuário ${s}`,
      email: `user-offset-faca-${s}@example.com`,
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
  // Papel (matéria-prima) que o produto Offset referencia via papelId —
  // precisa de ao menos 1 linha em TabelaPrecoPapel (ver resolverPrecoPapel).
  const catalogoPapel = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "MATERIA_PRIMA", categoria: "Papel", nome: `Couché ${s}` },
  });
  const papel = await prisma.itemGrafica.create({
    data: { graficaId: grafica.id, itemCatalogoId: catalogoPapel.id },
  });
  await prisma.tabelaPrecoPapel.create({
    data: { itemGraficaId: papel.id, gramatura: 300, precoKg: 8.5 },
  });

  const catalogoProduto = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Embalagem", nome: `Caixa Offset ${s}` },
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
    // referenciado ItemGrafica.papelId (onDelete: Restrict) — Postgres só
    // valida a constraint no fim da instrução, então apagar produto e papel
    // juntos aqui não colide (mesmo padrão de outros testes deste
    // diretório). formatosFolha/tabelaPrecoPapel cascadeiam do itemGrafica.
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

describe("adicionarItemOrcamento — custoFaca em item OFFSET (achado N10)", () => {
  it(
    "grava OrcamentoItem.custoFaca e o preço reflete a faca de corte-e-vinco informada",
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
        largura: "9",
        altura: "5",
        unidadeDimensao: "CM",
        corFrente: "4",
        corVerso: "4",
      };

      const semFaca = await adicionarItemOrcamento(null, formDataDe(camposComuns));
      expect(semFaca.ok).toBe(true);
      const itemSemFaca = await prisma.orcamentoItem.findFirstOrThrow({
        where: { orcamentoId: fixture.orcamentoId },
      });
      expect(itemSemFaca.custoFaca).toBeNull();

      const comFaca = await adicionarItemOrcamento(
        null,
        formDataDe({ ...camposComuns, custoFaca: "900" })
      );
      expect(comFaca.ok).toBe(true);
      const itemComFaca = await prisma.orcamentoItem.findFirstOrThrow({
        where: { orcamentoId: fixture.orcamentoId, custoFaca: { not: null } },
      });

      // Achado N10 — antes deste fix, custoFaca não tinha onde ser
      // persistido pra um item OFFSET (só existe coluna própria em
      // OrcamentoItemPrecificacaoEtiqueta, exclusivo do M2 com clichê) e o
      // preço final não refletia o valor — os dois sintomas do achado.
      expect(itemComFaca.custoFaca?.toString()).toBe("900");
      expect(Number(itemComFaca.precoTotal)).toBeGreaterThan(Number(itemSemFaca.precoTotal));
    },
    TIMEOUT_MS
  );
});

describe("editarOrcamento — custoFaca em item OFFSET (achado N10)", () => {
  it(
    "atualiza OrcamentoItem.custoFaca de um item existente e recalcula o preço",
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
      expect(itemCriado.custoFaca).toBeNull();
      const precoSemFaca = Number(itemCriado.precoTotal);

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
          custoFaca: "900",
        })
      );

      expect(resultado.ok).toBe(true);
      const itemEditado = await prisma.orcamentoItem.findUniqueOrThrow({
        where: { id: itemCriado.id },
      });
      expect(itemEditado.custoFaca?.toString()).toBe("900");
      expect(Number(itemEditado.precoTotal)).toBeGreaterThan(precoSemFaca);

      // Remover a faca de novo (campo deixado em branco) volta custoFaca a
      // null — mesmo padrão de "editar sem tocar" dos outros campos R$
      // livres deste formulário (custoAquisicaoUnitario, horasEstimadas).
      const resultadoSemFaca = await editarOrcamento(
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
      expect(resultadoSemFaca.ok).toBe(true);
      const itemSemFacaDeNovo = await prisma.orcamentoItem.findUniqueOrThrow({
        where: { id: itemCriado.id },
      });
      expect(itemSemFacaDeNovo.custoFaca).toBeNull();
      expect(Number(itemSemFacaDeNovo.precoTotal)).toBe(precoSemFaca);
    },
    TIMEOUT_MS
  );
});
