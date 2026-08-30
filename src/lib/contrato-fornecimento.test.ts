import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  contratosAplicaveis,
  calcularAlertaContrato,
  DIAS_ALERTA_VIGENCIA_CONTRATO,
  PERCENTUAL_ALERTA_QUANTIDADE_CONTRATO,
  type ContratoAtivoResumo,
} from "./contrato-fornecimento";
import { listarContratosProximosDoLimite } from "./contrato-fornecimento-db";

// Achado A9 da auditoria de abrangência (Parte 3/Compras, 2026-08-30) —
// contratosAplicaveis e calcularAlertaContrato são funções PURAS (sem
// Prisma), testadas aqui sem tocar banco. listarContratosProximosDoLimite É
// um teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via
// DATABASE_URL, mesmo padrão do resto do projeto).
//
// SÓ RODA DE VERDADE depois que a migration
// prisma/migrations/20260830170000_contrato_fornecimento/migration.sql
// tiver sido aplicada no banco (tabela contratos_fornecimento e a coluna
// solicitacoes_compra.contratoFornecimentoId ainda não existem até lá).

describe("contratosAplicaveis (pura, sem banco)", () => {
  const base: ContratoAtivoResumo = {
    id: "contrato-1",
    fornecedorId: "fornecedor-1",
    fornecedorNome: "Fornecedor 1",
    itemGraficaId: "item-A",
    varianteId: null,
    precoUnitario: 5,
    unidadeCompra: "KG",
    unidadeCompraOutro: null,
    vigenciaFim: new Date().toISOString(),
  };

  it("contrato específico do item entra quando o item bate", () => {
    const resultado = contratosAplicaveis([base], "item-A", null);
    expect(resultado.map((c) => c.id)).toEqual(["contrato-1"]);
  });

  it("contrato específico do item NÃO entra quando o item é diferente", () => {
    const resultado = contratosAplicaveis([base], "item-B", null);
    expect(resultado).toHaveLength(0);
  });

  it("contrato com varianteId só entra quando a variante bate", () => {
    const comVariante: ContratoAtivoResumo = { ...base, varianteId: "variante-X" };
    expect(contratosAplicaveis([comVariante], "item-A", "variante-X")).toHaveLength(1);
    expect(contratosAplicaveis([comVariante], "item-A", "variante-Y")).toHaveLength(0);
    expect(contratosAplicaveis([comVariante], "item-A", null)).toHaveLength(0);
  });

  it("contrato sem varianteId cobre qualquer variante do item", () => {
    expect(contratosAplicaveis([base], "item-A", "variante-qualquer")).toHaveLength(1);
    expect(contratosAplicaveis([base], "item-A", null)).toHaveLength(1);
  });

  it("contrato coringa (itemGraficaId=null) entra pra qualquer item", () => {
    const coringa: ContratoAtivoResumo = { ...base, id: "coringa", itemGraficaId: null };
    expect(contratosAplicaveis([coringa], "item-A", null)).toHaveLength(1);
    expect(contratosAplicaveis([coringa], "item-qualquer-outro", "variante-qualquer")).toHaveLength(1);
  });

  it("ordena do mais barato pro mais caro", () => {
    const caro: ContratoAtivoResumo = { ...base, id: "caro", precoUnitario: 10 };
    const barato: ContratoAtivoResumo = { ...base, id: "barato", precoUnitario: 2 };
    const resultado = contratosAplicaveis([caro, barato], "item-A", null);
    expect(resultado.map((c) => c.id)).toEqual(["barato", "caro"]);
  });
});

describe("calcularAlertaContrato (pura, sem banco)", () => {
  const agora = new Date("2026-08-30T12:00:00Z");

  it("vigência longe do fim e sem teto de quantidade — sem alerta", () => {
    const alerta = calcularAlertaContrato(
      {
        id: "c1",
        quantidadeContratada: null,
        quantidadeConsumida: 0,
        vigenciaFim: new Date("2027-06-01T00:00:00Z"),
      },
      agora
    );
    expect(alerta.vigenciaProxima).toBe(false);
    expect(alerta.quantidadeProxima).toBe(false);
  });

  it(`vigência a ${DIAS_ALERTA_VIGENCIA_CONTRATO} dias ou menos do fim — alerta de vigência`, () => {
    const fimDaquiA20Dias = new Date(agora.getTime() + 20 * 24 * 60 * 60 * 1000);
    const alerta = calcularAlertaContrato(
      { id: "c1", quantidadeContratada: null, quantidadeConsumida: 0, vigenciaFim: fimDaquiA20Dias },
      agora
    );
    expect(alerta.vigenciaProxima).toBe(true);
    expect(alerta.diasRestantesVigencia).toBe(20);
  });

  it("vigência já vencida (contrato ainda ativo=true) — conta como alerta, dias negativos", () => {
    const fimNoPassado = new Date(agora.getTime() - 5 * 24 * 60 * 60 * 1000);
    const alerta = calcularAlertaContrato(
      { id: "c1", quantidadeContratada: null, quantidadeConsumida: 0, vigenciaFim: fimNoPassado },
      agora
    );
    expect(alerta.vigenciaProxima).toBe(true);
    expect(alerta.diasRestantesVigencia).toBeLessThan(0);
  });

  it(`quantidade consumida abaixo de ${PERCENTUAL_ALERTA_QUANTIDADE_CONTRATO * 100}% — sem alerta de quantidade`, () => {
    const alerta = calcularAlertaContrato(
      {
        id: "c1",
        quantidadeContratada: 100,
        quantidadeConsumida: 50,
        vigenciaFim: new Date("2027-06-01T00:00:00Z"),
      },
      agora
    );
    expect(alerta.quantidadeProxima).toBe(false);
    expect(alerta.percentualConsumido).toBeCloseTo(0.5);
  });

  it(`quantidade consumida a partir de ${PERCENTUAL_ALERTA_QUANTIDADE_CONTRATO * 100}% — alerta de quantidade`, () => {
    const alerta = calcularAlertaContrato(
      {
        id: "c1",
        quantidadeContratada: 100,
        quantidadeConsumida: 90,
        vigenciaFim: new Date("2027-06-01T00:00:00Z"),
      },
      agora
    );
    expect(alerta.quantidadeProxima).toBe(true);
    expect(alerta.percentualConsumido).toBeCloseTo(0.9);
  });

  it("quantidadeContratada nula — percentualConsumido nulo, nunca alerta de quantidade", () => {
    const alerta = calcularAlertaContrato(
      { id: "c1", quantidadeContratada: null, quantidadeConsumida: 999, vigenciaFim: new Date("2027-06-01T00:00:00Z") },
      agora
    );
    expect(alerta.percentualConsumido).toBeNull();
    expect(alerta.quantidadeProxima).toBe(false);
  });
});

describe("listarContratosProximosDoLimite — teste de integração real", () => {
  const TIMEOUT_MS = 30_000;
  const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const graficaIdsParaLimpar: string[] = [];

  afterEach(async () => {
    for (const graficaId of graficaIdsParaLimpar) {
      await prisma.contratoFornecimento.deleteMany({ where: { graficaId } });
      await prisma.itemGrafica.deleteMany({ where: { graficaId } });
      await prisma.itemCatalogo.deleteMany({ where: { graficaId } });
      await prisma.fornecedor.deleteMany({ where: { graficaId } });
      await prisma.usuario.deleteMany({ where: { graficaId } });
      await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
    }
    graficaIdsParaLimpar.length = 0;
  }, TIMEOUT_MS);

  async function criarGraficaEFornecedor() {
    const s = sufixo();
    const grafica = await prisma.grafica.create({
      data: { nome: `Teste Alerta Contrato ${s}`, slug: `teste-alerta-contrato-${s}` },
    });
    const fornecedor = await prisma.fornecedor.create({ data: { graficaId: grafica.id, nome: `Fornecedor ${s}` } });
    graficaIdsParaLimpar.push(grafica.id);
    return { graficaId: grafica.id, fornecedorId: fornecedor.id };
  }

  it(
    "contrato com vigência acabando aparece na lista",
    async () => {
      const { graficaId, fornecedorId } = await criarGraficaEFornecedor();
      await prisma.contratoFornecimento.create({
        data: {
          graficaId,
          fornecedorId,
          precoUnitario: 5,
          unidadeCompra: "KG",
          vigenciaInicio: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
          vigenciaFim: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), // 10 dias — dentro do limiar de 30
        },
      });

      const resultado = await listarContratosProximosDoLimite(graficaId);
      expect(resultado).toHaveLength(1);
      expect(resultado[0].vigenciaProxima).toBe(true);
    },
    TIMEOUT_MS
  );

  it(
    "contrato com quantidade consumida acima de 90% aparece na lista",
    async () => {
      const { graficaId, fornecedorId } = await criarGraficaEFornecedor();
      await prisma.contratoFornecimento.create({
        data: {
          graficaId,
          fornecedorId,
          precoUnitario: 5,
          unidadeCompra: "KG",
          vigenciaInicio: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
          vigenciaFim: new Date(Date.now() + 200 * 24 * 60 * 60 * 1000), // longe do fim
          quantidadeContratada: 100,
          quantidadeConsumida: 95,
        },
      });

      const resultado = await listarContratosProximosDoLimite(graficaId);
      expect(resultado).toHaveLength(1);
      expect(resultado[0].quantidadeProxima).toBe(true);
    },
    TIMEOUT_MS
  );

  it(
    "contrato normal (vigência longe, sem teto de quantidade) NÃO aparece na lista",
    async () => {
      const { graficaId, fornecedorId } = await criarGraficaEFornecedor();
      await prisma.contratoFornecimento.create({
        data: {
          graficaId,
          fornecedorId,
          precoUnitario: 5,
          unidadeCompra: "KG",
          vigenciaInicio: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
          vigenciaFim: new Date(Date.now() + 200 * 24 * 60 * 60 * 1000),
        },
      });

      const resultado = await listarContratosProximosDoLimite(graficaId);
      expect(resultado).toHaveLength(0);
    },
    TIMEOUT_MS
  );

  it(
    "contrato INATIVO esgotando não aparece na lista — alerta só serve pra contrato ainda em uso",
    async () => {
      const { graficaId, fornecedorId } = await criarGraficaEFornecedor();
      await prisma.contratoFornecimento.create({
        data: {
          graficaId,
          fornecedorId,
          precoUnitario: 5,
          unidadeCompra: "KG",
          vigenciaInicio: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
          vigenciaFim: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // esgotando de verdade
          ativo: false,
        },
      });

      const resultado = await listarContratosProximosDoLimite(graficaId);
      expect(resultado).toHaveLength(0);
    },
    TIMEOUT_MS
  );
});
