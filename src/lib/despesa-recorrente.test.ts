import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { proximoMes, mesmoMesOuDepois, gerarDespesasRecorrentesPendentes } from "./despesa-recorrente";

describe("proximoMes", () => {
  it("dia 31 em mês seguido de mês com 30 dias vira dia 30 (não 31, nem invalid date)", () => {
    // 31 de agosto -> setembro só tem 30 dias
    const resultado = proximoMes(new Date(Date.UTC(2026, 7, 31))); // 31/08/2026
    expect(resultado.getUTCFullYear()).toBe(2026);
    expect(resultado.getUTCMonth()).toBe(8); // setembro
    expect(resultado.getUTCDate()).toBe(30);
  });

  it("dia 31 de janeiro vira 28 quando fevereiro não é bissexto", () => {
    // 2026 não é bissexto
    const resultado = proximoMes(new Date(Date.UTC(2026, 0, 31))); // 31/01/2026
    expect(resultado.getUTCFullYear()).toBe(2026);
    expect(resultado.getUTCMonth()).toBe(1); // fevereiro
    expect(resultado.getUTCDate()).toBe(28);
  });

  it("dia 29 de janeiro vira 29 quando fevereiro é bissexto", () => {
    // 2028 é bissexto
    const resultado = proximoMes(new Date(Date.UTC(2028, 0, 29))); // 29/01/2028
    expect(resultado.getUTCFullYear()).toBe(2028);
    expect(resultado.getUTCMonth()).toBe(1); // fevereiro
    expect(resultado.getUTCDate()).toBe(29);
  });

  it("dia 31 de dezembro vira 31 de janeiro do ano seguinte (rollover de ano)", () => {
    const resultado = proximoMes(new Date(Date.UTC(2026, 11, 31))); // 31/12/2026
    expect(resultado.getUTCFullYear()).toBe(2027);
    expect(resultado.getUTCMonth()).toBe(0); // janeiro
    expect(resultado.getUTCDate()).toBe(31);
  });

  it("dia normal (sem ajuste) mantém o mesmo dia no mês seguinte", () => {
    const resultado = proximoMes(new Date(Date.UTC(2026, 2, 15))); // 15/03/2026
    expect(resultado.getUTCFullYear()).toBe(2026);
    expect(resultado.getUTCMonth()).toBe(3); // abril
    expect(resultado.getUTCDate()).toBe(15);
  });
});

describe("mesmoMesOuDepois", () => {
  it("mesmo mês e ano: true", () => {
    const data = new Date(Date.UTC(2026, 7, 20));
    const referencia = new Date(Date.UTC(2026, 7, 1));
    expect(mesmoMesOuDepois(data, referencia)).toBe(true);
  });

  it("mês anterior ao da referência: false", () => {
    const data = new Date(Date.UTC(2026, 6, 31));
    const referencia = new Date(Date.UTC(2026, 7, 1));
    expect(mesmoMesOuDepois(data, referencia)).toBe(false);
  });

  it("mês seguinte ao da referência: true", () => {
    const data = new Date(Date.UTC(2026, 8, 1));
    const referencia = new Date(Date.UTC(2026, 7, 1));
    expect(mesmoMesOuDepois(data, referencia)).toBe(true);
  });

  it("virada de ano: dezembro do ano anterior é anterior a janeiro do ano seguinte", () => {
    const data = new Date(Date.UTC(2025, 11, 31));
    const referencia = new Date(Date.UTC(2026, 0, 1));
    expect(mesmoMesOuDepois(data, referencia)).toBe(false);
  });

  it("virada de ano: janeiro do ano seguinte é mesmo mês/depois em relação a si mesmo", () => {
    const data = new Date(Date.UTC(2026, 0, 15));
    const referencia = new Date(Date.UTC(2026, 0, 1));
    expect(mesmoMesOuDepois(data, referencia)).toBe(true);
  });
});

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de src/app/producao/status-transicao.custo-automatico.test.ts)
// — cobre o bug do achado A14 da auditoria de abrangência: o `create` de
// gerarDespesasRecorrentesPendentes copiava descricao/categoria(texto)/valor
// mas esquecia categoriaCustoId, então toda ocorrência automática nascia sem
// o vínculo estruturado com CategoriaCusto, mesmo quando a série original
// tinha uma configurada. Timeout 30s por teste: vários round-trips
// sequenciais pro Postgres de dev na Neon (mesmo motivo de
// catalogo-ncm.test.ts).
const TIMEOUT_MS = 30_000;

const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const graficaIdsParaLimpar: string[] = [];

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.despesa.deleteMany({ where: { graficaId } });
    await prisma.categoriaCusto.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
}, TIMEOUT_MS);

describe("gerarDespesasRecorrentesPendentes", () => {
  it(
    "ocorrência gerada automaticamente herda o mesmo categoriaCustoId da despesa original da série",
    async () => {
      const s = sufixo();
      const grafica = await prisma.grafica.create({
        data: { nome: `Teste Despesa Recorrente ${s}`, slug: `teste-despesa-recorrente-${s}` },
      });
      graficaIdsParaLimpar.push(grafica.id);

      const categoria = await prisma.categoriaCusto.create({
        data: { graficaId: grafica.id, nome: `Aluguel ${s}` },
      });

      // Vencimento 2 meses atrás — força gerarDespesasRecorrentesPendentes a
      // avançar ao menos uma ocorrência de catch-up até o mês atual.
      const hoje = new Date();
      const vencimentoOriginal = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - 2, 5));

      const original = await prisma.despesa.create({
        data: {
          graficaId: grafica.id,
          descricao: `Aluguel do galpão ${s}`,
          categoria: "Aluguel",
          categoriaCustoId: categoria.id,
          valor: 1500,
          vencimento: vencimentoOriginal,
          recorrente: true,
        },
      });
      // serieRecorrenciaId aponta pra própria primeira ocorrência — mesmo
      // padrão de criarDespesa (ver comentário no schema de Despesa).
      await prisma.despesa.update({
        where: { id: original.id },
        data: { serieRecorrenciaId: original.id },
      });

      await gerarDespesasRecorrentesPendentes(grafica.id);

      const serie = await prisma.despesa.findMany({
        where: { graficaId: grafica.id, serieRecorrenciaId: original.id },
        orderBy: { vencimento: "asc" },
      });

      // Catch-up de pelo menos 2 meses (vencimento original + hoje).
      expect(serie.length).toBeGreaterThanOrEqual(2);
      const geradas = serie.slice(1);
      expect(geradas.length).toBeGreaterThan(0);
      for (const ocorrencia of geradas) {
        expect(ocorrencia.categoriaCustoId).toBe(categoria.id);
        expect(ocorrencia.categoria).toBe("Aluguel");
        expect(ocorrencia.descricao).toBe(original.descricao);
        expect(Number(ocorrencia.valor)).toBe(1500);
      }
    },
    TIMEOUT_MS
  );
});
