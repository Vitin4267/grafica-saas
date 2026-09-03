import { describe, it, expect, afterEach, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { avancarStatusPedido, type PedidoParaAvanco } from "./status-transicao";
import { montarChavePerda } from "@/lib/perda-fixa-producao";
import {
  resolverEtapasGrafica,
  garantirEtapasGraficaPadrao,
  ETAPAS_SEMPRE_ATIVAS,
} from "@/lib/etapa-grafica";
import {
  SEQUENCIA_STATUS_PEDIDO,
  ROTULOS_STATUS_PEDIDO,
  ESTAGIOS_ATRIBUIVEIS,
} from "@/lib/producao-estagios";
import type { StatusPedido } from "@/generated/prisma/enums";

// Achado A1 da auditoria de abrangência (Parte 2/Produção,
// pesquisa-abrangencia-modulos.md), Fase 1 — teste de INTEGRAÇÃO de verdade
// (toca o Postgres de dev via DATABASE_URL), mesmo padrão de
// status-transicao.custo-automatico.test.ts / status-transicao.apontamento.test.ts.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));
// after() (next/server) lança "called outside a request scope" fora de uma
// requisição de verdade — roda a tarefa síncrona no próprio teste, mesmo
// padrão de src/lib/alerta-prazo-email.test.ts.
vi.mock("next/server", () => ({ after: (tarefa: () => void) => tarefa() }));
// dispararEventoEmail de verdade tentaria bater em EMAIL_WEBHOOK_URL
// (ausente em teste) — mock só pra capturar os argumentos (assunto/html
// carregam o rótulo customizado, é isso que o teste (c) confere).
vi.mock("@/lib/email/webhook-email", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/email/webhook-email")>();
  return { ...real, dispararEventoEmail: vi.fn(async () => true) };
});

import { dispararEventoEmail } from "@/lib/email/webhook-email";
const dispararEventoEmailMock = vi.mocked(dispararEventoEmail);

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

// resolverOrigemPublica prioriza APP_URL antes de cair pro fallback via
// headers() (que lança fora de uma requisição real) — mesmo padrão de
// src/app/o/[token]/actions.vendedor-cliente.test.ts. Só o teste (c) (e-mail
// ao responsável) entra nesse caminho; salva/restaura pra não vazar pros
// outros arquivos de teste do mesmo worker.
const APP_URL_ORIGINAL = process.env.APP_URL;
afterAll(() => {
  if (APP_URL_ORIGINAL === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = APP_URL_ORIGINAL;
});

const graficaIdsParaLimpar: string[] = [];

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.etapaGrafica.deleteMany({ where: { graficaId } });
    await prisma.responsavelEstagio.deleteMany({ where: { usuario: { graficaId } } });
    await prisma.apontamentoEtapa.deleteMany({ where: { graficaId } }).catch(() => {});
    await prisma.custoPedido.deleteMany({ where: { graficaId } });
    await prisma.movimentacaoEstoque.deleteMany({ where: { itemGrafica: { graficaId } } });
    await prisma.pedido.deleteMany({ where: { graficaId } });
    await prisma.orcamentoItem.deleteMany({ where: { orcamento: { graficaId } } });
    await prisma.orcamento.deleteMany({ where: { graficaId } });
    await prisma.fichaTecnicaItem.deleteMany({ where: { itemGrafica: { graficaId } } });
    await prisma.itemGrafica.deleteMany({ where: { graficaId } });
    await prisma.itemCatalogo.deleteMany({ where: { graficaId } });
    await prisma.categoriaCusto.deleteMany({ where: { graficaId } });
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  dispararEventoEmailMock.mockClear();
}, TIMEOUT_MS);

// ---------------------------------------------------------------------------
// Fixture SEM ficha técnica (produto sem FichaTecnicaItem) — pros testes que
// não são sobre baixa de estoque (a, b, c). Mesmo raciocínio de
// status-transicao.apontamento.test.ts: sem ficha técnica, mesmo a transição
// pra PRODUCAO não encontra nenhum item pra descontar, então perdasJsonBruto
// "[]" sempre serve.
type FixtureSimples = {
  graficaId: string;
  orcamentoId: string;
  pedidoId: string;
};

async function criarFixtureSimples(statusInicial: StatusPedido): Promise<FixtureSimples> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Etapa Grafica ${s}`, slug: `teste-etapa-grafica-${s}` },
  });
  const cliente = await prisma.cliente.create({ data: { graficaId: grafica.id, nome: `Cliente ${s}` } });
  const usuario = await prisma.usuario.create({
    data: { graficaId: grafica.id, nome: `Usuário ${s}`, email: `teste-etapa-grafica-${s}@example.com`, senhaHash: "x" },
  });
  const catalogoProduto = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Cartão", nome: `Produto ${s}` },
  });
  const produto = await prisma.itemGrafica.create({
    data: { graficaId: grafica.id, itemCatalogoId: catalogoProduto.id },
  });
  const orcamento = await prisma.orcamento.create({
    data: { graficaId: grafica.id, clienteId: cliente.id, usuarioId: usuario.id, status: "APROVADO", total: 100 },
  });
  await prisma.orcamentoItem.create({
    data: { orcamentoId: orcamento.id, itemGraficaId: produto.id, quantidade: 1, precoUnitario: 100, precoTotal: 100 },
  });
  const pedido = await prisma.pedido.create({
    data: { graficaId: grafica.id, orcamentoId: orcamento.id, status: statusInicial },
  });

  graficaIdsParaLimpar.push(grafica.id);
  return { graficaId: grafica.id, orcamentoId: orcamento.id, pedidoId: pedido.id };
}

function pedidoParaAvanco(f: FixtureSimples, status: StatusPedido): PedidoParaAvanco {
  return {
    id: f.pedidoId,
    graficaId: f.graficaId,
    orcamentoId: f.orcamentoId,
    status,
    arteUrl: null,
    arteAprovadaEm: null,
    producaoLinkToken: null,
    orcamento: {
      cliente: { nome: "Cliente Teste", telefone: null },
      grafica: { nome: "Gráfica Teste", corPrimaria: null },
      itens: [{ quantidade: 1, itemGrafica: { itemCatalogo: { nome: "Produto Teste" } } }],
    },
  };
}

// ---------------------------------------------------------------------------
// Fixture COM ficha técnica/matéria-prima (mesmo molde de
// status-transicao.custo-automatico.test.ts) — só pro teste (d), que precisa
// de verdade da baixa de estoque acontecendo.
type FixtureComMaterial = FixtureSimples & {
  categoriaCustoId: string;
  materiaPrimaId: string;
  fichaTecnicaItemId: string;
  orcamentoItemId: string;
  precoCompra: number;
  quantidadePorUnidade: number;
  quantidadeItem: number;
};

async function criarFixtureComMaterial(statusInicial: StatusPedido): Promise<FixtureComMaterial> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Etapa Grafica Material ${s}`, slug: `teste-etapa-grafica-material-${s}` },
  });
  const cliente = await prisma.cliente.create({ data: { graficaId: grafica.id, nome: `Cliente ${s}` } });
  const usuario = await prisma.usuario.create({
    data: { graficaId: grafica.id, nome: `Usuário ${s}`, email: `teste-etapa-grafica-material-${s}@example.com`, senhaHash: "x" },
  });
  const categoria = await prisma.categoriaCusto.create({ data: { graficaId: grafica.id, nome: `Papel ${s}` } });

  const catalogoMateriaPrima = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "MATERIA_PRIMA", categoria: "Papel", nome: `Couché 150g ${s}` },
  });
  const precoCompra = 3.5;
  const materiaPrima = await prisma.itemGrafica.create({
    data: { graficaId: grafica.id, itemCatalogoId: catalogoMateriaPrima.id, precoCompra, estoqueAtual: 1000 },
  });

  const catalogoProduto = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Cartão", nome: `Cartão de Visita ${s}` },
  });
  const produto = await prisma.itemGrafica.create({
    data: { graficaId: grafica.id, itemCatalogoId: catalogoProduto.id },
  });

  const quantidadePorUnidade = 2;
  const fichaTecnicaItem = await prisma.fichaTecnicaItem.create({
    data: { itemGraficaId: produto.id, materiaPrimaId: materiaPrima.id, quantidadePorUnidade },
  });

  const orcamento = await prisma.orcamento.create({
    data: { graficaId: grafica.id, clienteId: cliente.id, usuarioId: usuario.id, status: "APROVADO", total: 500 },
  });
  const quantidadeItem = 10;
  const orcamentoItem = await prisma.orcamentoItem.create({
    data: {
      orcamentoId: orcamento.id,
      itemGraficaId: produto.id,
      quantidade: quantidadeItem,
      precoUnitario: 50,
      precoTotal: 500,
    },
  });

  const pedido = await prisma.pedido.create({
    data: { graficaId: grafica.id, orcamentoId: orcamento.id, status: statusInicial },
  });

  graficaIdsParaLimpar.push(grafica.id);

  return {
    graficaId: grafica.id,
    orcamentoId: orcamento.id,
    pedidoId: pedido.id,
    categoriaCustoId: categoria.id,
    materiaPrimaId: materiaPrima.id,
    fichaTecnicaItemId: fichaTecnicaItem.id,
    orcamentoItemId: orcamentoItem.id,
    precoCompra,
    quantidadePorUnidade,
    quantidadeItem,
  };
}

function perdasJson(f: FixtureComMaterial): string {
  return JSON.stringify([{ chave: montarChavePerda(f.orcamentoItemId, f.fichaTecnicaItemId), perdaAplicada: 0 }]);
}

// ---------------------------------------------------------------------------

describe("resolverEtapasGrafica (achado A1, Fase 1)", () => {
  it(
    "gráfica sem NENHUMA EtapaGrafica cadastrada resolve exatamente como o padrão do sistema (regressão zero)",
    async () => {
      const s = sufixo();
      const grafica = await prisma.grafica.create({
        data: { nome: `Teste Resolver Etapas ${s}`, slug: `teste-resolver-etapas-${s}` },
      });
      graficaIdsParaLimpar.push(grafica.id);

      const resolvido = await resolverEtapasGrafica(grafica.id);

      expect(resolvido.sequencia).toEqual(SEQUENCIA_STATUS_PEDIDO);
      expect(resolvido.rotulos).toEqual(ROTULOS_STATUS_PEDIDO);
      expect(resolvido.estagiosPreProducao).toEqual(["ARTE", "CLICHE_FACA"]);
      expect(resolvido.estagiosAtribuiveis).toEqual(ESTAGIOS_ATRIBUIVEIS);

      // Bootstrap lazy rodou por trás: as 8 linhas (CANCELADO fora) existem
      // agora, todas ativa=true/rotulo=null/ordem=posição padrão.
      const linhas = await prisma.etapaGrafica.findMany({
        where: { graficaId: grafica.id },
        orderBy: { ordem: "asc" },
      });
      expect(linhas).toHaveLength(8);
      expect(linhas.every((l) => l.ativa)).toBe(true);
      expect(linhas.every((l) => l.rotulo === null)).toBe(true);
      expect(linhas.map((l) => l.status)).toEqual(SEQUENCIA_STATUS_PEDIDO);

      // Idempotente: resolver de novo não duplica.
      await resolverEtapasGrafica(grafica.id);
      const linhasDepois = await prisma.etapaGrafica.count({ where: { graficaId: grafica.id } });
      expect(linhasDepois).toBe(8);
    },
    TIMEOUT_MS
  );

  it(
    "desativar uma etapa remove ela de `sequencia`/`estagiosPreProducao`/`estagiosAtribuiveis`",
    async () => {
      const s = sufixo();
      const grafica = await prisma.grafica.create({
        data: { nome: `Teste Etapa Desativada ${s}`, slug: `teste-etapa-desativada-${s}` },
      });
      graficaIdsParaLimpar.push(grafica.id);
      await garantirEtapasGraficaPadrao(grafica.id);

      // ACABAMENTO é atribuível E fica no meio da sequência — desativá-la
      // exercita os 3 campos derivados de uma vez só.
      await prisma.etapaGrafica.update({
        where: { graficaId_status: { graficaId: grafica.id, status: "ACABAMENTO" } },
        data: { ativa: false },
      });

      const resolvido = await resolverEtapasGrafica(grafica.id);

      expect(resolvido.sequencia).toEqual([
        "ARTE",
        "CLICHE_FACA",
        "PRODUCAO",
        "CONFERENCIA",
        "EMBALAGEM",
        "EXPEDICAO",
        "ENTREGUE",
      ]);
      expect(resolvido.sequencia).not.toContain("ACABAMENTO");
      expect(resolvido.estagiosAtribuiveis.map((e) => e.valor)).not.toContain("ACABAMENTO");
      // rotulos continua tendo TODOS os 9 (inclusive a inativa) — só não
      // aparece mais em `sequencia`.
      expect(resolvido.rotulos.ACABAMENTO).toBe("Acabamento");
    },
    TIMEOUT_MS
  );

  it(
    "ARTE/PRODUCAO/ENTREGUE nunca podem ser desativadas (trava de negócio, não só de UI)",
    () => {
      expect(ETAPAS_SEMPRE_ATIVAS).toEqual(expect.arrayContaining(["ARTE", "PRODUCAO", "ENTREGUE"]));
      expect(ETAPAS_SEMPRE_ATIVAS).toHaveLength(3);
    }
  );

  it(
    "rótulo customizado aparece em `rotulos` e em `estagiosAtribuiveis` — padrão intocado quando null",
    async () => {
      const s = sufixo();
      const grafica = await prisma.grafica.create({
        data: { nome: `Teste Rotulo Custom ${s}`, slug: `teste-rotulo-custom-${s}` },
      });
      graficaIdsParaLimpar.push(grafica.id);
      await garantirEtapasGraficaPadrao(grafica.id);

      await prisma.$transaction([
        prisma.etapaGrafica.update({
          where: { graficaId_status: { graficaId: grafica.id, status: "CLICHE_FACA" } },
          data: { rotulo: "Queima de tela" },
        }),
        prisma.etapaGrafica.update({
          where: { graficaId_status: { graficaId: grafica.id, status: "EXPEDICAO" } },
          data: { rotulo: "Instalação" },
        }),
      ]);

      const resolvido = await resolverEtapasGrafica(grafica.id);

      expect(resolvido.rotulos.CLICHE_FACA).toBe("Queima de tela");
      expect(resolvido.rotulos.EXPEDICAO).toBe("Instalação");
      // O resto continua com o rótulo padrão do sistema.
      expect(resolvido.rotulos.ARTE).toBe("Arte");
      expect(resolvido.rotulos.PRODUCAO).toBe("Produção");
      expect(resolvido.rotulos.CANCELADO).toBe("Cancelado"); // nunca customizável

      const expedicaoAtribuivel = resolvido.estagiosAtribuiveis.find((e) => e.valor === "EXPEDICAO");
      expect(expedicaoAtribuivel?.rotulo).toBe("Instalação");

      const clicheFaca = resolvido.todas.find((e) => e.status === "CLICHE_FACA");
      expect(clicheFaca?.rotuloCustom).toBe("Queima de tela");
      expect(clicheFaca?.rotulo).toBe("Queima de tela");
    },
    TIMEOUT_MS
  );
});

describe("avancarStatusPedido usando a sequência/rótulos resolvidos por gráfica (achado A1)", () => {
  it(
    "(a) regressão zero: gráfica sem NENHUMA EtapaGrafica avança ARTE→Clichê/Faca normalmente, com rótulo padrão",
    async () => {
      const f = await criarFixtureSimples("ARTE");
      const resultado = await avancarStatusPedido(pedidoParaAvanco(f, "ARTE"), "[]");

      expect(resultado.ok).toBe(true);
      if (!resultado.ok) throw new Error("unreachable");
      expect(resultado.statusAnterior).toBe("ARTE");
      expect(resultado.proximoStatus).toBe("CLICHE_FACA");
      expect(resultado.mensagem).toBe("Avançado para Clichê/Faca.");

      const pedido = await prisma.pedido.findUniqueOrThrow({ where: { id: f.pedidoId } });
      expect(pedido.status).toBe("CLICHE_FACA");
    },
    TIMEOUT_MS
  );

  it(
    "(b) desativar uma etapa pula ela na transição real (PRODUCAO avança direto pra Conferência, pulando Acabamento)",
    async () => {
      const f = await criarFixtureSimples("PRODUCAO");
      await garantirEtapasGraficaPadrao(f.graficaId);
      await prisma.etapaGrafica.update({
        where: { graficaId_status: { graficaId: f.graficaId, status: "ACABAMENTO" } },
        data: { ativa: false },
      });

      const resultado = await avancarStatusPedido(pedidoParaAvanco(f, "PRODUCAO"), "[]");

      expect(resultado.ok).toBe(true);
      if (!resultado.ok) throw new Error("unreachable");
      expect(resultado.proximoStatus).toBe("CONFERENCIA");
      expect(resultado.mensagem).toBe("Avançado para Conferência.");

      const pedido = await prisma.pedido.findUniqueOrThrow({ where: { id: f.pedidoId } });
      expect(pedido.status).toBe("CONFERENCIA");
    },
    TIMEOUT_MS
  );

  it(
    "um pedido preso numa etapa que acabou de ser desativada recebe erro amigável, nunca regride",
    async () => {
      const f = await criarFixtureSimples("CLICHE_FACA");
      await garantirEtapasGraficaPadrao(f.graficaId);
      await prisma.etapaGrafica.update({
        where: { graficaId_status: { graficaId: f.graficaId, status: "CLICHE_FACA" } },
        data: { ativa: false },
      });

      const resultado = await avancarStatusPedido(pedidoParaAvanco(f, "CLICHE_FACA"), "[]");

      expect(resultado.ok).toBe(false);
      if (resultado.ok) throw new Error("unreachable");
      expect(resultado.mensagem).toMatch(/desativada/);

      // Nunca regride pro índice 0 da sequência ativa (era o risco do bug
      // óbvio: [-1 + 1] === 0).
      const pedido = await prisma.pedido.findUniqueOrThrow({ where: { id: f.pedidoId } });
      expect(pedido.status).toBe("CLICHE_FACA");
    },
    TIMEOUT_MS
  );

  it(
    "(c) rótulo customizado aparece na mensagem de retorno e no e-mail ao responsável da etapa",
    async () => {
      process.env.APP_URL = "https://teste-etapa-grafica.example.com";

      const f = await criarFixtureSimples("PRODUCAO");
      await garantirEtapasGraficaPadrao(f.graficaId);
      await prisma.etapaGrafica.update({
        where: { graficaId_status: { graficaId: f.graficaId, status: "ACABAMENTO" } },
        data: { rotulo: "Cura" },
      });

      const s = sufixo();
      const responsavel = await prisma.usuario.create({
        data: {
          graficaId: f.graficaId,
          nome: `Responsável Cura ${s}`,
          email: `responsavel-cura-${s}@example.com`,
          senhaHash: "x",
        },
      });
      await prisma.responsavelEstagio.create({
        data: { usuarioId: responsavel.id, status: "ACABAMENTO" },
      });

      const resultado = await avancarStatusPedido(pedidoParaAvanco(f, "PRODUCAO"), "[]");

      expect(resultado.ok).toBe(true);
      if (!resultado.ok) throw new Error("unreachable");
      expect(resultado.mensagem).toBe("Avançado para Cura.");

      expect(dispararEventoEmailMock).toHaveBeenCalledTimes(1);
      const chamada = dispararEventoEmailMock.mock.calls[0][0];
      expect(chamada.destinatario).toBe(responsavel.email);
      expect(chamada.assunto).toContain("Cura");
      expect(chamada.assunto).not.toContain("Acabamento");
      expect(chamada.html).toContain("Cura");
    },
    TIMEOUT_MS
  );

  it(
    "(d) baixa de estoque na transição pra PRODUCAO continua correta com Clichê/Faca desativada (dispara saindo de Arte)",
    async () => {
      const f = await criarFixtureComMaterial("ARTE");
      await garantirEtapasGraficaPadrao(f.graficaId);
      await prisma.etapaGrafica.update({
        where: { graficaId_status: { graficaId: f.graficaId, status: "CLICHE_FACA" } },
        data: { ativa: false },
      });

      const pedidoAntes: PedidoParaAvanco = {
        id: f.pedidoId,
        graficaId: f.graficaId,
        orcamentoId: f.orcamentoId,
        status: "ARTE",
        arteUrl: null,
        arteAprovadaEm: null,
        producaoLinkToken: null,
        orcamento: {
          cliente: { nome: "Cliente Teste", telefone: null },
          grafica: { nome: "Gráfica Teste", corPrimaria: null },
          itens: [{ quantidade: f.quantidadeItem, itemGrafica: { itemCatalogo: { nome: "Produto Teste" } } }],
        },
      };

      const resultado = await avancarStatusPedido(pedidoAntes, perdasJson(f));

      expect(resultado.ok).toBe(true);
      if (!resultado.ok) throw new Error("unreachable");
      // Pulou CLICHE_FACA (desativada) — foi direto de ARTE pra PRODUCAO, e
      // é exatamente essa transição que precisa ter disparado a baixa.
      expect(resultado.statusAnterior).toBe("ARTE");
      expect(resultado.proximoStatus).toBe("PRODUCAO");

      const pedidoDepois = await prisma.pedido.findUniqueOrThrow({ where: { id: f.pedidoId } });
      expect(pedidoDepois.status).toBe("PRODUCAO");

      // Mesma asserção de status-transicao.custo-automatico.test.ts: baixou
      // estoque exatamente uma vez, valorizado, com CustoPedido automático —
      // só que agora saindo de ARTE, não de CLICHE_FACA.
      const movimentacoes = await prisma.movimentacaoEstoque.findMany({ where: { pedidoId: f.pedidoId } });
      expect(movimentacoes).toHaveLength(1);
      const quantidadeEsperada = f.quantidadePorUnidade * f.quantidadeItem;
      expect(Number(movimentacoes[0].quantidade)).toBeCloseTo(quantidadeEsperada, 4);

      const materiaPrimaDepois = await prisma.itemGrafica.findUniqueOrThrow({ where: { id: f.materiaPrimaId } });
      expect(Number(materiaPrimaDepois.estoqueAtual)).toBeCloseTo(1000 - quantidadeEsperada, 4);

      const custos = await prisma.custoPedido.findMany({ where: { pedidoId: f.pedidoId } });
      expect(custos).toHaveLength(1);
      expect(custos[0].origem).toBe("CONSUMO_ESTOQUE");
      expect(Number(custos[0].valor)).toBeCloseTo(f.precoCompra * quantidadeEsperada, 2);
    },
    TIMEOUT_MS
  );

  it(
    "(d bis) gráfica com Clichê/Faca ATIVA (default) continua baixando estoque exatamente na transição Clichê/Faca→Produção",
    async () => {
      const f = await criarFixtureComMaterial("CLICHE_FACA");
      // Sem nenhuma EtapaGrafica configurada — bootstrap lazy roda dentro de
      // avancarStatusPedido, mesmo cenário do teste (a).

      const pedidoAntes: PedidoParaAvanco = {
        id: f.pedidoId,
        graficaId: f.graficaId,
        orcamentoId: f.orcamentoId,
        status: "CLICHE_FACA",
        arteUrl: null,
        arteAprovadaEm: null,
        producaoLinkToken: null,
        orcamento: {
          cliente: { nome: "Cliente Teste", telefone: null },
          grafica: { nome: "Gráfica Teste", corPrimaria: null },
          itens: [{ quantidade: f.quantidadeItem, itemGrafica: { itemCatalogo: { nome: "Produto Teste" } } }],
        },
      };

      const resultado = await avancarStatusPedido(pedidoAntes, perdasJson(f));
      expect(resultado.ok).toBe(true);

      const movimentacoes = await prisma.movimentacaoEstoque.findMany({ where: { pedidoId: f.pedidoId } });
      expect(movimentacoes).toHaveLength(1);
      const custos = await prisma.custoPedido.findMany({ where: { pedidoId: f.pedidoId } });
      expect(custos).toHaveLength(1);
    },
    TIMEOUT_MS
  );
});
