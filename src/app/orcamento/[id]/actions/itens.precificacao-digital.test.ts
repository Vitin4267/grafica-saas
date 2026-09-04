import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão dos outros arquivos de teste deste diretório) — cobre um gap
// encontrado durante a revisão do achado N8: o achado N4 (motor Digital faz
// imposição em folha) calculava o preço certo a partir do papel escolhido no
// orçamento, mas NUNCA persistia OrcamentoItemPrecificacaoDigital em nenhum
// dos 3 fluxos de escrita — a tela de edição sempre reabria com o papel em
// branco. Este arquivo cobre os 2 fluxos deste módulo (adicionar e editar
// item); criarOrcamento (src/app/orcamento/actions.ts) e
// adicionarOpcaoOrcamento (opcoes.actions.ts) receberam a mesma correção,
// mesmo padrão, sem teste dedicado por ora.
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
import { adicionarItemOrcamento, editarOrcamento } from "./itens";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const graficaIdsParaLimpar: string[] = [];

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.orcamentoItem.deleteMany({ where: { orcamento: { graficaId } } });
    await prisma.orcamento.deleteMany({ where: { graficaId } });
    await prisma.itemGrafica.deleteMany({ where: { graficaId } });
    await prisma.itemCatalogo.deleteMany({ where: { graficaId } });
    await prisma.impressoraDigital.deleteMany({ where: { graficaId } });
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
}, TIMEOUT_MS);

async function criarFixtureDigital() {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Precificacao Digital ${s}`, slug: `teste-precificacao-digital-${s}` },
  });
  graficaIdsParaLimpar.push(grafica.id);
  const usuario = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Usuário ${s}`,
      email: `user-precificacao-digital-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const cliente = await prisma.cliente.create({ data: { graficaId: grafica.id, nome: `Cliente ${s}` } });
  const impressora = await prisma.impressoraDigital.create({
    data: { graficaId: grafica.id, nome: `HP Indigo ${s}`, custoPorClique: 0.08 },
  });
  const catalogoPapel = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "MATERIA_PRIMA", categoria: "Papel", nome: `Couché ${s}` },
  });
  const papel = await prisma.itemGrafica.create({
    data: {
      graficaId: grafica.id,
      itemCatalogoId: catalogoPapel.id,
      precoCompra: 1.2,
      formatosFolha: { create: [{ nome: `SRA3 ${s}`, larguraFolha: 0.32, alturaFolha: 0.45 }] },
    },
  });
  const catalogoProduto = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Cartão", nome: `Cartão Digital ${s}` },
  });
  const produto = await prisma.itemGrafica.create({
    data: {
      graficaId: grafica.id,
      itemCatalogoId: catalogoProduto.id,
      modeloCalculo: "DIGITAL",
      impressoraDigitalId: impressora.id,
      precoVenda: 1,
    },
  });
  const orcamento = await prisma.orcamento.create({
    data: { graficaId: grafica.id, clienteId: cliente.id, usuarioId: usuario.id, status: "RASCUNHO", total: 0 },
  });

  return { graficaId: grafica.id, usuarioId: usuario.id, orcamentoId: orcamento.id, papel, produto };
}

function formDataDigital(campos: Record<string, string>): FormData {
  const base: Record<string, string> = {
    quantidade: "100",
    largura: "9",
    altura: "5",
    unidadeDimensao: "CM",
    profundidade: "",
    espessuraMm: "",
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
    materialFornecidoPeloCliente: "false",
    cores: "",
    acabamento: "",
    descricaoLivre: "",
    quantidadeCores: "",
    custoFaca: "",
    custoFrete: "",
    gramaturaGm2: "",
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
    ...campos,
  };
  const fd = new FormData();
  for (const [chave, valor] of Object.entries(base)) fd.set(chave, valor);
  return fd;
}

describe("motor Digital persiste o papel escolhido no orçamento (correção de gap do achado N4)", () => {
  it(
    "adicionarItemOrcamento cria OrcamentoItemPrecificacaoDigital com o papelId escolhido",
    async () => {
      const f = await criarFixtureDigital();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioId } })) as never
      );

      const resultado = await adicionarItemOrcamento(
        null,
        formDataDigital({ orcamentoId: f.orcamentoId, itemGraficaId: f.produto.id, papelId: f.papel.id })
      );
      expect(resultado.ok).toBe(true);

      const item = await prisma.orcamentoItem.findFirstOrThrow({
        where: { orcamentoId: f.orcamentoId },
        include: { precificacaoDigital: true },
      });
      expect(item.precificacaoDigital?.papelId).toBe(f.papel.id);
    },
    TIMEOUT_MS
  );

  it(
    "editarOrcamento faz upsert em OrcamentoItemPrecificacaoDigital ao trocar o papel de um item existente",
    async () => {
      const f = await criarFixtureDigital();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioId } })) as never
      );

      await adicionarItemOrcamento(
        null,
        formDataDigital({ orcamentoId: f.orcamentoId, itemGraficaId: f.produto.id, papelId: f.papel.id })
      );
      const item = await prisma.orcamentoItem.findFirstOrThrow({ where: { orcamentoId: f.orcamentoId } });

      const catalogoPapel2 = await prisma.itemCatalogo.create({
        data: { graficaId: f.graficaId, tipo: "MATERIA_PRIMA", categoria: "Papel", nome: `Papel alternativo ${sufixo()}` },
      });
      const papel2 = await prisma.itemGrafica.create({
        data: {
          graficaId: f.graficaId,
          itemCatalogoId: catalogoPapel2.id,
          precoCompra: 2,
          formatosFolha: { create: [{ nome: "SRA3 alt", larguraFolha: 0.32, alturaFolha: 0.45 }] },
        },
      });

      const resultado = await editarOrcamento(
        null,
        formDataDigital({
          orcamentoId: f.orcamentoId,
          orcamentoItemId: item.id,
          papelId: papel2.id,
          larguraCm: "9",
          alturaCm: "5",
        })
      );
      expect(resultado.ok).toBe(true);

      const itemAtualizado = await prisma.orcamentoItem.findUniqueOrThrow({
        where: { id: item.id },
        include: { precificacaoDigital: true },
      });
      expect(itemAtualizado.precificacaoDigital?.papelId).toBe(papel2.id);
    },
    TIMEOUT_MS
  );
});
