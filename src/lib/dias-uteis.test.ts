import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { somarDiasUteis, contarDiasUteis } from "./dias-uteis";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de src/lib/custo-pedido.test.ts e
// src/lib/alerta-prazo-email.test.ts) — cobre o achado A2 da Parte 6 da
// auditoria de abrangência (2026-08-27): o PDF/link público de orçamento
// prometem "N dias úteis após aprovação", mas nada no sistema sabia calcular
// isso de verdade até esta feature.
const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const MS_POR_DIA = 86_400_000;

const graficaIdsParaLimpar: string[] = [];

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.feriadoGrafica.deleteMany({ where: { graficaId } });
    await prisma.parametrosGrafica.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
}, TIMEOUT_MS);

async function criarGrafica(dados: {
  prazoEmDiasUteis?: boolean;
  diasFuncionamento?: number;
}): Promise<string> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Dias Úteis ${s}`, slug: `teste-dias-uteis-${s}` },
  });
  graficaIdsParaLimpar.push(grafica.id);
  await prisma.parametrosGrafica.create({
    data: {
      graficaId: grafica.id,
      prazoEmDiasUteis: dados.prazoEmDiasUteis ?? true,
      diasFuncionamento: dados.diasFuncionamento ?? 31, // default do schema: segunda a sexta
    },
  });
  return grafica.id;
}

// Determinístico independente do dia real em que a suíte roda: caminha a
// partir de uma data fixa (não "hoje") até achar uma sexta-feira.
function proximaSextaFeiraUtc(apartirDe: Date): Date {
  let d = new Date(apartirDe.getTime());
  while (d.getUTCDay() !== 5) d = new Date(d.getTime() + MS_POR_DIA);
  return d;
}

function paraYyyyMmDd(data: Date): string {
  return data.toISOString().slice(0, 10);
}

describe("somarDiasUteis", () => {
  it(
    "pula fim de semana simples: +1 dia útil a partir de uma sexta cai na segunda-feira seguinte",
    async () => {
      const graficaId = await criarGrafica({});
      const sexta = proximaSextaFeiraUtc(new Date(Date.UTC(2026, 0, 1)));

      const resultado = await somarDiasUteis(sexta, 1, graficaId);

      // Sexta + 1 dia útil = segunda (3 dias corridos à frente: sáb + dom +
      // seg, mas só a segunda conta como dia útil).
      const segundaEsperada = new Date(sexta.getTime() + 3 * MS_POR_DIA);
      expect(paraYyyyMmDd(resultado)).toBe(paraYyyyMmDd(segundaEsperada));
      expect(resultado.getUTCDay()).toBe(1); // segunda-feira
    },
    TIMEOUT_MS
  );

  it(
    "pula um feriado cadastrado com data exata (recorrenteAnual: false)",
    async () => {
      const graficaId = await criarGrafica({});
      // Segunda-feira certa, longe de qualquer fim de semana na janela
      // testada (segunda + 1 útil = terça, segunda + 2 úteis pularia o
      // feriado de terça e cairia na quarta).
      const sexta = proximaSextaFeiraUtc(new Date(Date.UTC(2026, 0, 1)));
      const segunda = new Date(sexta.getTime() + 3 * MS_POR_DIA);
      const terca = new Date(segunda.getTime() + MS_POR_DIA);

      await prisma.feriadoGrafica.create({
        data: { graficaId, data: terca, descricao: "Feriado de teste", recorrenteAnual: false },
      });

      const resultado = await somarDiasUteis(segunda, 1, graficaId);

      // +1 dia útil a partir de segunda pularia a terça (feriado) e cairia
      // na quarta.
      const quartaEsperada = new Date(terca.getTime() + MS_POR_DIA);
      expect(paraYyyyMmDd(resultado)).toBe(paraYyyyMmDd(quartaEsperada));
    },
    TIMEOUT_MS
  );

  it(
    "pula um feriado recorrenteAnual comparando só mês/dia, independente do ano cadastrado",
    async () => {
      const graficaId = await criarGrafica({});
      const sexta = proximaSextaFeiraUtc(new Date(Date.UTC(2026, 0, 1)));
      const segunda = new Date(sexta.getTime() + 3 * MS_POR_DIA);
      const terca = new Date(segunda.getTime() + MS_POR_DIA);

      // Ano bem diferente do ano em que o teste roda de fato — só mês/dia
      // devem importar pra um feriado recorrente.
      const tercaAnoAntigo = new Date(Date.UTC(2019, terca.getUTCMonth(), terca.getUTCDate()));
      await prisma.feriadoGrafica.create({
        data: {
          graficaId,
          data: tercaAnoAntigo,
          descricao: "Feriado recorrente de teste",
          recorrenteAnual: true,
        },
      });

      const resultado = await somarDiasUteis(segunda, 1, graficaId);

      const quartaEsperada = new Date(terca.getTime() + MS_POR_DIA);
      expect(paraYyyyMmDd(resultado)).toBe(paraYyyyMmDd(quartaEsperada));
    },
    TIMEOUT_MS
  );

  it(
    "prazoEmDiasUteis: false cai em soma de dias corridos simples, mesmo caindo em fim de semana/feriado",
    async () => {
      const graficaId = await criarGrafica({ prazoEmDiasUteis: false });
      const sexta = proximaSextaFeiraUtc(new Date(Date.UTC(2026, 0, 1)));

      const resultado = await somarDiasUteis(sexta, 1, graficaId);

      // Dias corridos: sexta + 1 = sábado, sem pular nada.
      const sabadoEsperado = new Date(sexta.getTime() + MS_POR_DIA);
      expect(paraYyyyMmDd(resultado)).toBe(paraYyyyMmDd(sabadoEsperado));
      expect(resultado.getUTCDay()).toBe(6); // sábado
    },
    TIMEOUT_MS
  );
});

// contarDiasUteis é a metade "pura" (sem acesso a banco) usada por
// src/lib/alerta-prazo-email.ts — coberta aqui em isolamento; o cenário de
// integração completo (com ParametrosGrafica/FeriadoGrafica de verdade) está
// em src/lib/alerta-prazo-email.test.ts.
describe("contarDiasUteis", () => {
  it("conta só os dias úteis estritamente entre início e fim, pulando fim de semana", () => {
    const sexta = proximaSextaFeiraUtc(new Date(Date.UTC(2026, 0, 1)));
    const segundaSeguinte = new Date(sexta.getTime() + 3 * MS_POR_DIA);

    const contagem = contarDiasUteis(sexta, segundaSeguinte, {
      diasFuncionamento: 31,
      feriados: [],
    });

    expect(contagem).toBe(1); // só a segunda conta
  });

  it("fim no passado (ou igual ao início) devolve a diferença em dias corridos, sem pular nada", () => {
    const hoje = new Date(Date.UTC(2026, 0, 1));
    const ontem = new Date(hoje.getTime() - MS_POR_DIA);

    expect(contarDiasUteis(hoje, ontem, { diasFuncionamento: 31, feriados: [] })).toBe(-1);
    expect(contarDiasUteis(hoje, hoje, { diasFuncionamento: 31, feriados: [] })).toBe(0);
  });
});
