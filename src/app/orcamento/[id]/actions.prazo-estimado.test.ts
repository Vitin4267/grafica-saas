import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de src/app/orcamento/[id]/actions.desconto.test.ts) — cobre o
// achado B4 da auditoria de abrangência: OrcamentoItem ganhou
// prazoEstimadoDias (prazo estimado de entrega EM DIAS, específico de cada
// item). Quando preenchido, o cabeçalho do Orcamento exibe automaticamente o
// MÁXIMO entre os itens com este campo preenchido. Cobre adicionarItemOrcamento
// e editarOrcamento (fluxo de FormData direto na tela de detalhe do orçamento),
// além de duplicarOrcamento (prazo deve ser copiado junto).
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));

// duplicarOrcamento navega pro novo orçamento no caminho de sucesso via
// redirect(), que fora de uma requisição Next.js de verdade lança
// NEXT_REDIRECT — mesmo padrão de actions.duplicar.test.ts neste diretório.
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
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
import { adicionarItemOrcamento, editarOrcamento, duplicarOrcamento } from "./actions";

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
    data: { nome: `Teste Prazo Estimado ${s}`, slug: `teste-prazo-estimado-${s}` },
  });
  const usuario = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Usuário ${s}`,
      email: `user-prazo-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const cliente = await prisma.cliente.create({
    data: { graficaId: grafica.id, nome: `Cliente ${s}` },
  });
  // Produto SIMPLES — o suficiente pra exercitar prazoEstimadoDias.
  const catalogo = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Embalagem", nome: `Item Teste ${s}` },
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
  return prisma.usuario.findUniqueOrThrow({
    where: { id: usuarioId },
    include: {
      grafica: {
        include: {
          assinatura: true,
        },
      },
    },
  });
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
});

describe("Achado B4 — Prazo estimado por item de orçamento", () => {
  it(
    "deve adicionar item com prazo estimado preenchido",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        await usuarioParaMock(fixture.usuarioId)
      );

      const resultado = await adicionarItemOrcamento(
        null,
        formDataDe({
          orcamentoId: fixture.orcamentoId,
          itemGraficaId: fixture.itemGraficaId,
          quantidade: "100",
          largura: "",
          altura: "",
          profundidade: "",
          espessuraMm: "",
          unidadeDimensao: "CM",
          corFrente: "",
          corVerso: "",
          numeroCoresFlexo: "",
          numeroCliques: "",
          numeroSetups: "",
          prazoEstimadoDias: "5",
          numeroPontos: "",
          tempoEstimadoMin: "",
          metrosCorte: "",
          horasEstimadas: "",
          custoAquisicaoUnitario: "",
          materialFornecidoPeloCliente: "",
          cores: "",
          acabamento: "",
          descricaoLivre: "",
          papelId: "",
          quantidadeCores: "",
          custoFaca: "",
          custoFrete: "",
          materialSubstrato: "",
          materialSubstratoOutro: "",
          tipoAdesivo: "",
          tipoAdesivoOutro: "",
          superficieAplicacao: "",
          superficieAplicacaoOutro: "",
          formatoEtiqueta: "",
          coresRotulo: "",
          coresContraRotulo: "",
          embalagemQtdPorRolo: "",
          tubeteMedida: "",
          rotulagem: "",
          serrilha: "",
          serrilhaOutro: "",
          vernizRotuloTotal: "false",
          vernizRotuloReserva: "false",
          vernizRotuloTipo: "",
          vernizRotuloTipoOutro: "",
          vernizContraRotuloTotal: "false",
          vernizContraRotuloReserva: "false",
          vernizContraRotuloTipo: "",
          vernizContraRotuloTipoOutro: "",
          laminacaoRotulo: "",
          laminacaoRotuloOutro: "",
          laminacaoContraRotulo: "",
          laminacaoContraRotuloOutro: "",
          rebobinamento: "",
          hotStampingsJson: "[]",
        })
      );

      expect(resultado.ok).toBe(true);

      const item = await prisma.orcamentoItem.findFirst({
        where: { orcamentoId: fixture.orcamentoId },
      });
      expect(item).toBeDefined();
      expect(item?.prazoEstimadoDias).toBe(5);
    },
    TIMEOUT_MS
  );

  it(
    "deve editar item e atualizar prazo estimado",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        await usuarioParaMock(fixture.usuarioId)
      );

      // Adicionar primeiro
      await adicionarItemOrcamento(
        null,
        formDataDe({
          orcamentoId: fixture.orcamentoId,
          itemGraficaId: fixture.itemGraficaId,
          quantidade: "100",
          largura: "",
          altura: "",
          profundidade: "",
          espessuraMm: "",
          unidadeDimensao: "CM",
          corFrente: "",
          corVerso: "",
          numeroCoresFlexo: "",
          numeroCliques: "",
          numeroSetups: "",
          prazoEstimadoDias: "5",
          numeroPontos: "",
          tempoEstimadoMin: "",
          metrosCorte: "",
          horasEstimadas: "",
          custoAquisicaoUnitario: "",
          materialFornecidoPeloCliente: "",
          cores: "",
          acabamento: "",
          descricaoLivre: "",
          papelId: "",
          quantidadeCores: "",
          custoFaca: "",
          custoFrete: "",
          materialSubstrato: "",
          materialSubstratoOutro: "",
          tipoAdesivo: "",
          tipoAdesivoOutro: "",
          superficieAplicacao: "",
          superficieAplicacaoOutro: "",
          formatoEtiqueta: "",
          coresRotulo: "",
          coresContraRotulo: "",
          embalagemQtdPorRolo: "",
          tubeteMedida: "",
          rotulagem: "",
          serrilha: "",
          serrilhaOutro: "",
          vernizRotuloTotal: "false",
          vernizRotuloReserva: "false",
          vernizRotuloTipo: "",
          vernizRotuloTipoOutro: "",
          vernizContraRotuloTotal: "false",
          vernizContraRotuloReserva: "false",
          vernizContraRotuloTipo: "",
          vernizContraRotuloTipoOutro: "",
          laminacaoRotulo: "",
          laminacaoRotuloOutro: "",
          laminacaoContraRotulo: "",
          laminacaoContraRotuloOutro: "",
          rebobinamento: "",
          hotStampingsJson: "[]",
        })
      );

      const item = await prisma.orcamentoItem.findFirst({
        where: { orcamentoId: fixture.orcamentoId },
      });
      expect(item?.prazoEstimadoDias).toBe(5);

      // Editar para 10 dias
      const resultado = await editarOrcamento(
        null,
        formDataDe({
          orcamentoId: fixture.orcamentoId,
          orcamentoItemId: item!.id,
          quantidade: "100",
          larguraCm: "",
          alturaCm: "",
          profundidadeCm: "",
          espessuraMm: "",
          corFrente: "",
          corVerso: "",
          numeroCoresFlexo: "",
          numeroCliques: "",
          numeroSetups: "",
          prazoEstimadoDias: "10",
          numeroPontos: "",
          tempoEstimadoMin: "",
          metrosCorte: "",
          horasEstimadas: "",
          custoAquisicaoUnitario: "",
          materialFornecidoPeloCliente: "",
          cores: "",
          acabamento: "",
          descricaoLivre: "",
          papelId: "",
          quantidadeCores: "",
          custoFaca: "",
          custoFrete: "",
          materialSubstrato: "",
          materialSubstratoOutro: "",
          tipoAdesivo: "",
          tipoAdesivoOutro: "",
          superficieAplicacao: "",
          superficieAplicacaoOutro: "",
          formatoEtiqueta: "",
          coresRotulo: "",
          coresContraRotulo: "",
          embalagemQtdPorRolo: "",
          tubeteMedida: "",
          rotulagem: "",
          serrilha: "",
          serrilhaOutro: "",
          vernizRotuloTotal: "false",
          vernizRotuloReserva: "false",
          vernizRotuloTipo: "",
          vernizRotuloTipoOutro: "",
          vernizContraRotuloTotal: "false",
          vernizContraRotuloReserva: "false",
          vernizContraRotuloTipo: "",
          vernizContraRotuloTipoOutro: "",
          laminacaoRotulo: "",
          laminacaoRotuloOutro: "",
          laminacaoContraRotulo: "",
          laminacaoContraRotuloOutro: "",
          rebobinamento: "",
          hotStampingsJson: "[]",
        })
      );

      expect(resultado.ok).toBe(true);

      const itemAtualizado = await prisma.orcamentoItem.findUnique({
        where: { id: item!.id },
      });
      expect(itemAtualizado?.prazoEstimadoDias).toBe(10);
    },
    TIMEOUT_MS
  );

  it(
    "deve permitir item sem prazo (campo vazio = null)",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        await usuarioParaMock(fixture.usuarioId)
      );

      const resultado = await adicionarItemOrcamento(
        null,
        formDataDe({
          orcamentoId: fixture.orcamentoId,
          itemGraficaId: fixture.itemGraficaId,
          quantidade: "100",
          largura: "",
          altura: "",
          profundidade: "",
          espessuraMm: "",
          unidadeDimensao: "CM",
          corFrente: "",
          corVerso: "",
          numeroCoresFlexo: "",
          numeroCliques: "",
          numeroSetups: "",
          prazoEstimadoDias: "",
          numeroPontos: "",
          tempoEstimadoMin: "",
          metrosCorte: "",
          horasEstimadas: "",
          custoAquisicaoUnitario: "",
          materialFornecidoPeloCliente: "",
          cores: "",
          acabamento: "",
          descricaoLivre: "",
          papelId: "",
          quantidadeCores: "",
          custoFaca: "",
          custoFrete: "",
          materialSubstrato: "",
          materialSubstratoOutro: "",
          tipoAdesivo: "",
          tipoAdesivoOutro: "",
          superficieAplicacao: "",
          superficieAplicacaoOutro: "",
          formatoEtiqueta: "",
          coresRotulo: "",
          coresContraRotulo: "",
          embalagemQtdPorRolo: "",
          tubeteMedida: "",
          rotulagem: "",
          serrilha: "",
          serrilhaOutro: "",
          vernizRotuloTotal: "false",
          vernizRotuloReserva: "false",
          vernizRotuloTipo: "",
          vernizRotuloTipoOutro: "",
          vernizContraRotuloTotal: "false",
          vernizContraRotuloReserva: "false",
          vernizContraRotuloTipo: "",
          vernizContraRotuloTipoOutro: "",
          laminacaoRotulo: "",
          laminacaoRotuloOutro: "",
          laminacaoContraRotulo: "",
          laminacaoContraRotuloOutro: "",
          rebobinamento: "",
          hotStampingsJson: "[]",
        })
      );

      expect(resultado.ok).toBe(true);

      const item = await prisma.orcamentoItem.findFirst({
        where: { orcamentoId: fixture.orcamentoId },
      });
      expect(item?.prazoEstimadoDias).toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "deve copiar prazo estimado ao duplicar orçamento",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        await usuarioParaMock(fixture.usuarioId)
      );

      // Adicionar item com prazo
      await adicionarItemOrcamento(
        null,
        formDataDe({
          orcamentoId: fixture.orcamentoId,
          itemGraficaId: fixture.itemGraficaId,
          quantidade: "100",
          largura: "",
          altura: "",
          profundidade: "",
          espessuraMm: "",
          unidadeDimensao: "CM",
          corFrente: "",
          corVerso: "",
          numeroCoresFlexo: "",
          numeroCliques: "",
          numeroSetups: "",
          prazoEstimadoDias: "7",
          numeroPontos: "",
          tempoEstimadoMin: "",
          metrosCorte: "",
          horasEstimadas: "",
          custoAquisicaoUnitario: "",
          materialFornecidoPeloCliente: "",
          cores: "",
          acabamento: "",
          descricaoLivre: "",
          papelId: "",
          quantidadeCores: "",
          custoFaca: "",
          custoFrete: "",
          materialSubstrato: "",
          materialSubstratoOutro: "",
          tipoAdesivo: "",
          tipoAdesivoOutro: "",
          superficieAplicacao: "",
          superficieAplicacaoOutro: "",
          formatoEtiqueta: "",
          coresRotulo: "",
          coresContraRotulo: "",
          embalagemQtdPorRolo: "",
          tubeteMedida: "",
          rotulagem: "",
          serrilha: "",
          serrilhaOutro: "",
          vernizRotuloTotal: "false",
          vernizRotuloReserva: "false",
          vernizRotuloTipo: "",
          vernizRotuloTipoOutro: "",
          vernizContraRotuloTotal: "false",
          vernizContraRotuloReserva: "false",
          vernizContraRotuloTipo: "",
          vernizContraRotuloTipoOutro: "",
          laminacaoRotulo: "",
          laminacaoRotuloOutro: "",
          laminacaoContraRotulo: "",
          laminacaoContraRotuloOutro: "",
          rebobinamento: "",
          hotStampingsJson: "[]",
        })
      );

      // Aprovar orçamento (requisito para duplicar)
      await prisma.orcamento.update({
        where: { id: fixture.orcamentoId },
        data: { status: "APROVADO" },
      });

      // Duplicar — caminho de sucesso termina em redirect() (NEXT_REDIRECT).
      await expect(
        duplicarOrcamento(null, formDataDe({ orcamentoId: fixture.orcamentoId }))
      ).rejects.toThrow(/^NEXT_REDIRECT:/);

      // Encontrar o novo orçamento (duplicado) — procura todos os orçamentos
      // do cliente que não seja o original
      const orcamentos = await prisma.orcamento.findMany({
        where: {
          clienteId: fixture.clienteId,
          id: { not: fixture.orcamentoId },
        },
      });
      expect(orcamentos.length).toBe(1);
      const novoOrcamento = orcamentos[0];

      const itemDuplicado = await prisma.orcamentoItem.findFirst({
        where: { orcamentoId: novoOrcamento!.id },
      });
      expect(itemDuplicado?.prazoEstimadoDias).toBe(7);
    },
    TIMEOUT_MS
  );
});
