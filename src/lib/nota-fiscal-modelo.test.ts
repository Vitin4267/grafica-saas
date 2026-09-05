import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de src/app/catalogo/[itemGraficaId]/dtf-modelo-calculo.test.ts)
// — cobre o achado F2 da auditoria de abrangência (Parte 7, 2026-09-05):
// "Sistema só emite NF-e de mercadoria; gráfica que fatura serviço não tem
// onde cadastrar". Esta rodada é só CADASTRO (schema), não emissão de
// verdade — os testes aqui verificam só que os campos novos persistem e que
// a constraint única de NotaFiscal foi corretamente relaxada de `orcamentoId`
// sozinho pra `[orcamentoId, modelo]` (permite NFE+NFSE no mesmo orçamento,
// numa venda mista, mas continua impedindo duas notas do MESMO modelo).
//
// IMPORTANTE: a migration 20260905220000_nfse_cadastro (enum
// ModeloDocumentoFiscal + colunas novas + relaxamento da constraint única)
// foi escrita à mão mas NÃO foi aplicada ao banco de dev (regra do
// projeto — o banco de dev tem dados reais de cliente). Este arquivo só
// passa depois que alguém aplicar essa migration.

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const graficaIdsParaLimpar: string[] = [];

async function criarFixture() {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste F2 NFSE ${s}`, slug: `teste-f2-nfse-${s}` },
  });
  const cliente = await prisma.cliente.create({
    data: { graficaId: grafica.id, nome: `Cliente ${s}` },
  });
  const dono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-f2-nfse-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const orcamento = await prisma.orcamento.create({
    data: { graficaId: grafica.id, clienteId: cliente.id, usuarioId: dono.id, status: "APROVADO", total: 100 },
  });

  graficaIdsParaLimpar.push(grafica.id);
  return { graficaId: grafica.id, orcamentoId: orcamento.id };
}

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.notaFiscal.deleteMany({ where: { graficaId } });
    await prisma.orcamento.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.itemCatalogo.deleteMany({ where: { graficaId } });
    await prisma.dadosFiscaisGrafica.deleteMany({ where: { graficaId } });
    await prisma.grafica.deleteMany({ where: { id: graficaId } });
  }
  graficaIdsParaLimpar.length = 0;
});

describe("achado F2 — cadastro de NFS-e (DadosFiscaisGrafica)", () => {
  it(
    "persiste inscricaoMunicipal/codigoMunicipioIbge/aliquotaIssPercent do emitente",
    async () => {
      const { graficaId } = await criarFixture();
      const dados = await prisma.dadosFiscaisGrafica.create({
        data: {
          graficaId,
          inscricaoMunicipal: "12345",
          codigoMunicipioIbge: "4106902",
          aliquotaIssPercent: new Prisma.Decimal("5.00"),
        },
      });
      expect(dados.inscricaoMunicipal).toBe("12345");
      expect(dados.codigoMunicipioIbge).toBe("4106902");
      expect(dados.aliquotaIssPercent?.toString()).toBe("5");
    },
    TIMEOUT_MS
  );

  it(
    "gráfica que só vende mercadoria: os 3 campos ficam null sem quebrar nada (comportamento de hoje preservado)",
    async () => {
      const { graficaId } = await criarFixture();
      const dados = await prisma.dadosFiscaisGrafica.create({ data: { graficaId } });
      expect(dados.inscricaoMunicipal).toBeNull();
      expect(dados.codigoMunicipioIbge).toBeNull();
      expect(dados.aliquotaIssPercent).toBeNull();
    },
    TIMEOUT_MS
  );
});

describe("achado F2 — cadastro de NFS-e (ItemCatalogo)", () => {
  it(
    "item tipo=SERVICO persiste itemListaServicoLc116/codigoServicoMunicipal",
    async () => {
      const { graficaId } = await criarFixture();
      const s = sufixo();
      const item = await prisma.itemCatalogo.create({
        data: {
          graficaId,
          tipo: "SERVICO",
          categoria: "Composição gráfica",
          nome: `Serviço ${s}`,
          itemListaServicoLc116: "13.05",
          codigoServicoMunicipal: "0107",
        },
      });
      expect(item.itemListaServicoLc116).toBe("13.05");
      expect(item.codigoServicoMunicipal).toBe("0107");
    },
    TIMEOUT_MS
  );

  it(
    "item tipo=PRODUTO nunca é obrigado a preencher os campos de serviço (ficam null)",
    async () => {
      const { graficaId } = await criarFixture();
      const s = sufixo();
      const item = await prisma.itemCatalogo.create({
        data: { graficaId, tipo: "PRODUTO", categoria: "Cartão", nome: `Produto ${s}` },
      });
      expect(item.itemListaServicoLc116).toBeNull();
      expect(item.codigoServicoMunicipal).toBeNull();
    },
    TIMEOUT_MS
  );
});

describe("achado F2 — NotaFiscal.modelo e @@unique([orcamentoId, modelo])", () => {
  it(
    "nota nova sem `modelo` explícito nasce NFE (@default(NFE)), comportamento de sempre preservado",
    async () => {
      const { graficaId, orcamentoId } = await criarFixture();
      const nota = await prisma.notaFiscal.create({
        data: { graficaId, orcamentoId, referencia: orcamentoId },
      });
      expect(nota.modelo).toBe("NFE");
    },
    TIMEOUT_MS
  );

  it(
    "venda mista: o MESMO orçamento pode ter uma nota NFE e uma NFSE ao mesmo tempo",
    async () => {
      const { graficaId, orcamentoId } = await criarFixture();
      const nfe = await prisma.notaFiscal.create({
        data: { graficaId, orcamentoId, modelo: "NFE", referencia: orcamentoId },
      });
      const nfse = await prisma.notaFiscal.create({
        data: { graficaId, orcamentoId, modelo: "NFSE", referencia: `${orcamentoId}-NFSE` },
      });
      expect(nfe.modelo).toBe("NFE");
      expect(nfse.modelo).toBe("NFSE");

      const orcamentoComNotas = await prisma.orcamento.findUniqueOrThrow({
        where: { id: orcamentoId },
        include: { notaFiscal: true },
      });
      expect(orcamentoComNotas.notaFiscal).toHaveLength(2);
      expect(orcamentoComNotas.notaFiscal.map((n) => n.modelo).sort()).toEqual(["NFE", "NFSE"]);
    },
    TIMEOUT_MS
  );

  it(
    "continua impedindo DUAS notas do MESMO modelo pro mesmo orçamento (a constraint de antes não regrediu)",
    async () => {
      const { graficaId, orcamentoId } = await criarFixture();
      await prisma.notaFiscal.create({
        data: { graficaId, orcamentoId, modelo: "NFE", referencia: orcamentoId },
      });
      await expect(
        prisma.notaFiscal.create({
          data: { graficaId, orcamentoId, modelo: "NFE", referencia: `${orcamentoId}-outra` },
        })
      ).rejects.toThrow();
    },
    TIMEOUT_MS
  );
});
