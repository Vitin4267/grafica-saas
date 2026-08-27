import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  proximoMes,
  proximaOcorrencia,
  mesmoMesOuDepois,
  gerarDespesasRecorrentesPendentes,
} from "./despesa-recorrente";

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

describe("proximaOcorrencia", () => {
  it("SEMANAL avança exatamente 7 dias corridos (não usa lógica de mês)", () => {
    const resultado = proximaOcorrencia(new Date(Date.UTC(2026, 7, 20)), "SEMANAL"); // 20/08/2026, quinta
    expect(resultado.getUTCFullYear()).toBe(2026);
    expect(resultado.getUTCMonth()).toBe(7); // agosto
    expect(resultado.getUTCDate()).toBe(27);
  });

  it("SEMANAL vira o mês quando os 7 dias cruzam a virada", () => {
    const resultado = proximaOcorrencia(new Date(Date.UTC(2026, 7, 28)), "SEMANAL"); // 28/08/2026
    expect(resultado.getUTCFullYear()).toBe(2026);
    expect(resultado.getUTCMonth()).toBe(8); // setembro
    expect(resultado.getUTCDate()).toBe(4);
  });

  it("QUINZENAL avança exatamente 14 dias corridos", () => {
    const resultado = proximaOcorrencia(new Date(Date.UTC(2026, 7, 20)), "QUINZENAL");
    expect(resultado.getUTCFullYear()).toBe(2026);
    expect(resultado.getUTCMonth()).toBe(8); // setembro
    expect(resultado.getUTCDate()).toBe(3);
  });

  it("MENSAL se comporta exatamente como proximoMes (mesma lógica de ajuste de dia)", () => {
    const data = new Date(Date.UTC(2026, 0, 31)); // 31/01/2026
    expect(proximaOcorrencia(data, "MENSAL").getTime()).toBe(proximoMes(data).getTime());
  });

  it("ANUAL avança 12 meses, ajustando 29/fev de bissexto pro 28/fev de não-bissexto", () => {
    const resultado = proximaOcorrencia(new Date(Date.UTC(2028, 1, 29)), "ANUAL"); // 29/02/2028
    expect(resultado.getUTCFullYear()).toBe(2029);
    expect(resultado.getUTCMonth()).toBe(1); // fevereiro
    expect(resultado.getUTCDate()).toBe(28);
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

  it(
    "periodicidade SEMANAL: catch-up gera a próxima ocorrência exatamente 7 dias após a última",
    async () => {
      const s = sufixo();
      const grafica = await prisma.grafica.create({
        data: { nome: `Teste Despesa Semanal ${s}`, slug: `teste-despesa-semanal-${s}` },
      });
      graficaIdsParaLimpar.push(grafica.id);

      // 10 dias atrás — já vencida há mais de uma semana, força catch-up.
      const hoje = new Date();
      const dezDiasAtras = new Date(hoje);
      dezDiasAtras.setUTCDate(dezDiasAtras.getUTCDate() - 10);
      const vencimentoOriginal = new Date(
        Date.UTC(dezDiasAtras.getUTCFullYear(), dezDiasAtras.getUTCMonth(), dezDiasAtras.getUTCDate())
      );

      const original = await prisma.despesa.create({
        data: {
          graficaId: grafica.id,
          descricao: `Feira semanal ${s}`,
          valor: 200,
          vencimento: vencimentoOriginal,
          recorrente: true,
          periodicidade: "SEMANAL",
        },
      });
      await prisma.despesa.update({
        where: { id: original.id },
        data: { serieRecorrenciaId: original.id },
      });

      await gerarDespesasRecorrentesPendentes(grafica.id);

      const serie = await prisma.despesa.findMany({
        where: { graficaId: grafica.id, serieRecorrenciaId: original.id },
        orderBy: { vencimento: "asc" },
      });

      // 10 dias vencidos, passo de 7 dias: pelo menos 1 nova ocorrência.
      expect(serie.length).toBeGreaterThanOrEqual(2);
      const diffDias =
        (serie[1].vencimento.getTime() - serie[0].vencimento.getTime()) / (1000 * 60 * 60 * 24);
      expect(diffDias).toBe(7);
    },
    TIMEOUT_MS
  );

  it(
    "recorrenciaAteEm no passado impede a geração de nova ocorrência",
    async () => {
      const s = sufixo();
      const grafica = await prisma.grafica.create({
        data: { nome: `Teste Despesa Ate Em ${s}`, slug: `teste-despesa-ate-em-${s}` },
      });
      graficaIdsParaLimpar.push(grafica.id);

      const hoje = new Date();
      const vencimentoOriginal = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - 2, 5));
      // Fim da recorrência antes até do vencimento original: a série já
      // devia ter parado, então nenhuma ocorrência nova pode nascer.
      const recorrenciaAteEm = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - 3, 1));

      const original = await prisma.despesa.create({
        data: {
          graficaId: grafica.id,
          descricao: `Assinatura encerrada ${s}`,
          valor: 90,
          vencimento: vencimentoOriginal,
          recorrente: true,
          recorrenciaAteEm,
        },
      });
      await prisma.despesa.update({
        where: { id: original.id },
        data: { serieRecorrenciaId: original.id },
      });

      await gerarDespesasRecorrentesPendentes(grafica.id);

      const serie = await prisma.despesa.findMany({
        where: { graficaId: grafica.id, serieRecorrenciaId: original.id },
      });

      expect(serie.length).toBe(1);
    },
    TIMEOUT_MS
  );

  it(
    "valorVariavel: ocorrência gerada automaticamente nasce com valor 0 em vez de copiar o valor anterior",
    async () => {
      const s = sufixo();
      const grafica = await prisma.grafica.create({
        data: { nome: `Teste Despesa Valor Variavel ${s}`, slug: `teste-despesa-valor-variavel-${s}` },
      });
      graficaIdsParaLimpar.push(grafica.id);

      const hoje = new Date();
      const vencimentoOriginal = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - 2, 5));

      const original = await prisma.despesa.create({
        data: {
          graficaId: grafica.id,
          descricao: `Conta de luz ${s}`,
          valor: 350,
          vencimento: vencimentoOriginal,
          recorrente: true,
          valorVariavel: true,
        },
      });
      await prisma.despesa.update({
        where: { id: original.id },
        data: { serieRecorrenciaId: original.id },
      });

      await gerarDespesasRecorrentesPendentes(grafica.id);

      const serie = await prisma.despesa.findMany({
        where: { graficaId: grafica.id, serieRecorrenciaId: original.id },
        orderBy: { vencimento: "asc" },
      });

      expect(serie.length).toBeGreaterThanOrEqual(2);
      for (const ocorrencia of serie.slice(1)) {
        expect(Number(ocorrencia.valor)).toBe(0);
        expect(ocorrencia.valorVariavel).toBe(true);
      }
      // A original não é retroativamente zerada — só as novas ocorrências.
      expect(Number(serie[0].valor)).toBe(350);
    },
    TIMEOUT_MS
  );
});
