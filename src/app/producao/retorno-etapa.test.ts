import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { avancarStatusPedido, type PedidoParaAvanco } from "./status-transicao";
import { montarChavePerda } from "@/lib/perda-fixa-producao";
import type { StatusPedido } from "@/generated/prisma/enums";

// Achado Prod-D2 da Parte 2 (Produção) da auditoria de abrangência
// (pesquisa-abrangencia-modulos.md, "Não existe retorno de etapa: reprovado
// só pode ser CANCELADO") — teste de INTEGRAÇÃO de verdade (toca o Postgres
// de dev via DATABASE_URL, mesmo padrão de status-transicao.custo-automatico.test.ts
// e parada-pedido.test.ts). Cobre: retornarEtapa fecha/abre apontamento com
// ehRetrabalho:true; NUNCA estorna estoque; RBAC (PRODUCAO.podeEditar
// COMPLETO sempre, nunca ResponsavelEstagio); nunca aceita etapa de destino
// à frente/igual à atual; e — o teste mais importante — um pedido que já
// passou por PRODUCAO uma vez, é retornado, e reentra em PRODUCAO de novo
// NÃO gera nova baixa de estoque (a armadilha descrita na tarefa,
// neutralizada por Pedido.baixaEstoqueRealizadaEm).
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
import { retornarEtapa } from "./retorno-etapa-actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function formDataDe(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [chave, valor] of Object.entries(campos)) fd.set(chave, valor);
  return fd;
}

async function autenticarComo(usuarioId: string) {
  const usuario = await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } });
  vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(usuario as never);
}

const graficaIdsParaLimpar: string[] = [];

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.logAuditoria.deleteMany({ where: { graficaId } });
    await prisma.responsavelEstagio.deleteMany({ where: { usuario: { graficaId } } });
    await prisma.apontamentoEtapa.deleteMany({ where: { graficaId } });
    // Defensivo: só existe linha aqui se a gráfica tiver alguma
    // CategoriaCusto ativa (não é o caso de nenhuma fixture deste arquivo —
    // criarCustoAutomaticoConsumo desiste sem lançar quando não há nenhuma,
    // ver comentário na função), mas mantém a mesma ordem de limpeza de
    // status-transicao.custo-automatico.test.ts por segurança.
    await prisma.custoPedido.deleteMany({ where: { graficaId } });
    await prisma.movimentacaoEstoque.deleteMany({ where: { itemGrafica: { graficaId } } });
    await prisma.pedido.deleteMany({ where: { graficaId } });
    await prisma.orcamentoItem.deleteMany({ where: { orcamento: { graficaId } } });
    await prisma.orcamento.deleteMany({ where: { graficaId } });
    await prisma.fichaTecnicaItem.deleteMany({ where: { itemGrafica: { graficaId } } });
    await prisma.itemGrafica.deleteMany({ where: { graficaId } });
    await prisma.itemCatalogo.deleteMany({ where: { graficaId } });
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
}, TIMEOUT_MS);

// ---------------------------------------------------------------------------
// Fixture "simples" — sem ficha técnica, pedido já em ACABAMENTO (depois de
// PRODUCAO na sequência canônica) — suficiente pra testar RBAC, CAS,
// validação de etapa de destino e o efeito no ApontamentoEtapa, sem pagar o
// custo de montar a baixa de estoque de verdade (isso é o 2º fixture,
// abaixo).
// ---------------------------------------------------------------------------
type FixtureSimples = {
  graficaId: string;
  usuarioDonoId: string;
  usuarioOperadorId: string;
  pedidoId: string;
};

async function criarFixtureSimples(): Promise<FixtureSimples> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Retorno Etapa ${s}`, slug: `teste-retorno-etapa-${s}` },
  });
  const cliente = await prisma.cliente.create({ data: { graficaId: grafica.id, nome: `Cliente ${s}` } });
  // DONO: podeEditarModulo sempre true, sem precisar montar PermissaoUsuario
  // (mesmo atalho de parada-pedido.test.ts/terceirizacao.test.ts).
  const usuarioDono = await prisma.usuario.create({
    data: { graficaId: grafica.id, nome: `Dono ${s}`, email: `dono-retorno-${s}@example.com`, senhaHash: "x", papel: "DONO" },
  });
  // OPERADOR sem NENHUMA linha em PermissaoUsuario — podeEditarModulo cai no
  // fallback `false`. Ganha um ResponsavelEstagio pra ACABAMENTO de propósito
  // — prova que retornarEtapa NUNCA libera por responsável de etapa (achado
  // Prod-D2, item 3: diferente de avancarPedido, que aceita isso).
  const usuarioOperador = await prisma.usuario.create({
    data: { graficaId: grafica.id, nome: `Operador ${s}`, email: `operador-retorno-${s}@example.com`, senhaHash: "x", papel: "OPERADOR" },
  });
  await prisma.responsavelEstagio.create({
    data: { usuarioId: usuarioOperador.id, status: "ACABAMENTO" },
  });
  const orcamento = await prisma.orcamento.create({
    data: { graficaId: grafica.id, clienteId: cliente.id, usuarioId: usuarioDono.id, status: "APROVADO", total: 100 },
  });
  const pedido = await prisma.pedido.create({
    data: { graficaId: grafica.id, orcamentoId: orcamento.id, status: "ACABAMENTO" },
  });
  await prisma.apontamentoEtapa.create({
    data: { graficaId: grafica.id, pedidoId: pedido.id, status: "ACABAMENTO", origemConfirmacao: "APP" },
  });

  graficaIdsParaLimpar.push(grafica.id);

  return { graficaId: grafica.id, usuarioDonoId: usuarioDono.id, usuarioOperadorId: usuarioOperador.id, pedidoId: pedido.id };
}

describe("retornarEtapa — RBAC, CAS e validação de destino (achado Prod-D2)", () => {
  it(
    "OPERADOR sem PRODUCAO.podeEditar é rejeitado MESMO sendo responsável pela etapa atual (nunca libera por ResponsavelEstagio)",
    async () => {
      const f = await criarFixtureSimples();
      await autenticarComo(f.usuarioOperadorId);

      const resultado = await retornarEtapa(
        null,
        formDataDe({ pedidoId: f.pedidoId, etapaDestino: "PRODUCAO", motivo: "REPROVADO_QUALIDADE" })
      );
      expect(resultado.ok).toBe(false);

      const pedidoDepois = await prisma.pedido.findUniqueOrThrow({ where: { id: f.pedidoId } });
      expect(pedidoDepois.status).toBe("ACABAMENTO");
      const apontamentos = await prisma.apontamentoEtapa.findMany({ where: { pedidoId: f.pedidoId } });
      expect(apontamentos).toHaveLength(1);
    },
    TIMEOUT_MS
  );

  it(
    "DONO retorna o pedido pra uma etapa anterior: fecha o apontamento atual, abre um novo ehRetrabalho:true com o motivo, muda o status e audita",
    async () => {
      const f = await criarFixtureSimples();
      await autenticarComo(f.usuarioDonoId);

      const resultado = await retornarEtapa(
        null,
        formDataDe({ pedidoId: f.pedidoId, etapaDestino: "PRODUCAO", motivo: "REPROVADO_QUALIDADE" })
      );
      expect(resultado.ok).toBe(true);

      const pedidoDepois = await prisma.pedido.findUniqueOrThrow({ where: { id: f.pedidoId } });
      expect(pedidoDepois.status).toBe("PRODUCAO");
      // Nunca setado por retornarEtapa — permanece null (o pedido desta
      // fixture nunca passou pelo branch de baixa de verdade).
      expect(pedidoDepois.baixaEstoqueRealizadaEm).toBeNull();

      const apontamentos = await prisma.apontamentoEtapa.findMany({
        where: { pedidoId: f.pedidoId },
        orderBy: { iniciadoEm: "asc" },
      });
      expect(apontamentos).toHaveLength(2);
      const [acabamento, producaoRetrabalho] = apontamentos;
      expect(acabamento.status).toBe("ACABAMENTO");
      expect(acabamento.finalizadoEm).not.toBeNull();
      expect(producaoRetrabalho.status).toBe("PRODUCAO");
      expect(producaoRetrabalho.finalizadoEm).toBeNull();
      expect(producaoRetrabalho.ehRetrabalho).toBe(true);
      expect(producaoRetrabalho.motivoRetorno).toBe("REPROVADO_QUALIDADE");
      expect(producaoRetrabalho.operadorId).toBe(f.usuarioDonoId);

      const logs = await prisma.logAuditoria.findMany({ where: { graficaId: f.graficaId, acao: "pedido.retornar_etapa" } });
      expect(logs).toHaveLength(1);
      expect(logs[0].entidadeId).toBe(f.pedidoId);
    },
    TIMEOUT_MS
  );

  it(
    "motivo=OUTRO sem motivoOutro é rejeitado; com motivoOutro é aceito e persistido no apontamento",
    async () => {
      const f = await criarFixtureSimples();
      await autenticarComo(f.usuarioDonoId);

      const semDescricao = await retornarEtapa(
        null,
        formDataDe({ pedidoId: f.pedidoId, etapaDestino: "PRODUCAO", motivo: "OUTRO" })
      );
      expect(semDescricao.ok).toBe(false);

      const comDescricao = await retornarEtapa(
        null,
        formDataDe({ pedidoId: f.pedidoId, etapaDestino: "PRODUCAO", motivo: "OUTRO", motivoOutro: "Cliente pediu troca de papel" })
      );
      expect(comDescricao.ok).toBe(true);

      const aberto = await prisma.apontamentoEtapa.findFirstOrThrow({ where: { pedidoId: f.pedidoId, finalizadoEm: null } });
      expect(aberto.motivoRetorno).toBe("OUTRO");
      expect(aberto.motivoRetornoOutro).toBe("Cliente pediu troca de papel");
    },
    TIMEOUT_MS
  );

  it("rejeita motivo inválido (fora do enum)", async () => {
    const f = await criarFixtureSimples();
    await autenticarComo(f.usuarioDonoId);

    const resultado = await retornarEtapa(
      null,
      formDataDe({ pedidoId: f.pedidoId, etapaDestino: "PRODUCAO", motivo: "MOTIVO_INEXISTENTE" })
    );
    expect(resultado.ok).toBe(false);
  }, TIMEOUT_MS);

  it(
    "rejeita etapa de destino à FRENTE da atual",
    async () => {
      const f = await criarFixtureSimples();
      await autenticarComo(f.usuarioDonoId);

      const resultado = await retornarEtapa(
        null,
        formDataDe({ pedidoId: f.pedidoId, etapaDestino: "EXPEDICAO", motivo: "REPROVADO_QUALIDADE" })
      );
      expect(resultado.ok).toBe(false);

      const pedidoDepois = await prisma.pedido.findUniqueOrThrow({ where: { id: f.pedidoId } });
      expect(pedidoDepois.status).toBe("ACABAMENTO");
    },
    TIMEOUT_MS
  );

  it(
    "rejeita etapa de destino IGUAL à atual (não é um retorno)",
    async () => {
      const f = await criarFixtureSimples();
      await autenticarComo(f.usuarioDonoId);

      const resultado = await retornarEtapa(
        null,
        formDataDe({ pedidoId: f.pedidoId, etapaDestino: "ACABAMENTO", motivo: "REPROVADO_QUALIDADE" })
      );
      expect(resultado.ok).toBe(false);
    },
    TIMEOUT_MS
  );

  it(
    "rejeita etapa de destino inexistente/fora do enum",
    async () => {
      const f = await criarFixtureSimples();
      await autenticarComo(f.usuarioDonoId);

      const resultado = await retornarEtapa(
        null,
        formDataDe({ pedidoId: f.pedidoId, etapaDestino: "STATUS_INEXISTENTE", motivo: "REPROVADO_QUALIDADE" })
      );
      expect(resultado.ok).toBe(false);
    },
    TIMEOUT_MS
  );

  it(
    "rejeita retorno num pedido já ENTREGUE/CANCELADO",
    async () => {
      const f = await criarFixtureSimples();
      await prisma.pedido.update({ where: { id: f.pedidoId }, data: { status: "CANCELADO" } });
      await autenticarComo(f.usuarioDonoId);

      const resultado = await retornarEtapa(
        null,
        formDataDe({ pedidoId: f.pedidoId, etapaDestino: "PRODUCAO", motivo: "REPROVADO_QUALIDADE" })
      );
      expect(resultado.ok).toBe(false);
    },
    TIMEOUT_MS
  );
});

// ---------------------------------------------------------------------------
// Fixture "com estoque" — produto COM ficha técnica (matéria-prima real,
// estoqueAtual configurado) e pedido em CLICHE_FACA, pra exercitar a baixa
// de estoque DE VERDADE (avancarStatusPedido) antes/depois do retorno. Mesmo
// padrão de status-transicao.custo-automatico.test.ts.
// ---------------------------------------------------------------------------
type FixtureComEstoque = {
  graficaId: string;
  usuarioDonoId: string;
  materiaPrimaId: string;
  orcamentoId: string;
  orcamentoItemId: string;
  fichaTecnicaItemId: string;
  pedidoId: string;
  quantidadeItem: number;
  estoqueInicial: number;
};

async function criarFixtureComEstoque(): Promise<FixtureComEstoque> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Retorno Estoque ${s}`, slug: `teste-retorno-estoque-${s}` },
  });
  const cliente = await prisma.cliente.create({ data: { graficaId: grafica.id, nome: `Cliente ${s}` } });
  const usuarioDono = await prisma.usuario.create({
    data: { graficaId: grafica.id, nome: `Dono ${s}`, email: `dono-retorno-estoque-${s}@example.com`, senhaHash: "x", papel: "DONO" },
  });

  const catalogoMateriaPrima = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "MATERIA_PRIMA", categoria: "Papel", nome: `Couché 150g ${s}` },
  });
  const estoqueInicial = 1000;
  const materiaPrima = await prisma.itemGrafica.create({
    data: { graficaId: grafica.id, itemCatalogoId: catalogoMateriaPrima.id, precoCompra: 3.5, estoqueAtual: estoqueInicial },
  });

  const catalogoProduto = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Cartão", nome: `Cartão de Visita ${s}` },
  });
  const produto = await prisma.itemGrafica.create({
    data: { graficaId: grafica.id, itemCatalogoId: catalogoProduto.id },
  });

  const fichaTecnicaItem = await prisma.fichaTecnicaItem.create({
    data: { itemGraficaId: produto.id, materiaPrimaId: materiaPrima.id, quantidadePorUnidade: 2 },
  });

  const orcamento = await prisma.orcamento.create({
    data: { graficaId: grafica.id, clienteId: cliente.id, usuarioId: usuarioDono.id, status: "APROVADO", total: 500 },
  });
  const quantidadeItem = 10;
  const orcamentoItem = await prisma.orcamentoItem.create({
    data: { orcamentoId: orcamento.id, itemGraficaId: produto.id, quantidade: quantidadeItem, precoUnitario: 50, precoTotal: 500 },
  });

  const pedido = await prisma.pedido.create({
    data: { graficaId: grafica.id, orcamentoId: orcamento.id, status: "CLICHE_FACA" },
  });
  await prisma.apontamentoEtapa.create({
    data: { graficaId: grafica.id, pedidoId: pedido.id, status: "CLICHE_FACA", origemConfirmacao: "APP" },
  });

  graficaIdsParaLimpar.push(grafica.id);

  return {
    graficaId: grafica.id,
    usuarioDonoId: usuarioDono.id,
    materiaPrimaId: materiaPrima.id,
    orcamentoId: orcamento.id,
    orcamentoItemId: orcamentoItem.id,
    fichaTecnicaItemId: fichaTecnicaItem.id,
    pedidoId: pedido.id,
    quantidadeItem,
    estoqueInicial,
  };
}

function pedidoParaAvanco(
  f: FixtureComEstoque,
  status: StatusPedido,
  baixaEstoqueRealizadaEm: Date | null = null
): PedidoParaAvanco {
  return {
    id: f.pedidoId,
    graficaId: f.graficaId,
    orcamentoId: f.orcamentoId,
    status,
    arteUrl: null,
    arteAprovadaEm: null,
    producaoLinkToken: null,
    baixaEstoqueRealizadaEm,
    orcamento: {
      clienteId: "cliente-teste",
      condicaoPagamentoId: null,
      total: 0,
      cliente: { nome: "Cliente Teste", telefone: null },
      grafica: { nome: "Gráfica Teste", corPrimaria: null },
      itens: [{ quantidade: f.quantidadeItem, itemGrafica: { itemCatalogo: { nome: "Produto Teste" } } }],
    },
  };
}

function perdasJson(f: FixtureComEstoque): string {
  return JSON.stringify([{ chave: montarChavePerda(f.orcamentoItemId, f.fichaTecnicaItemId), perdaAplicada: 0 }]);
}

describe("baixaEstoqueRealizadaEm — trava contra baixa DUPLICADA (achado Prod-D2, o teste mais importante desta tarefa)", () => {
  it(
    "1ª entrada em PRODUCAO baixa estoque e carimba baixaEstoqueRealizadaEm; retornarEtapa NUNCA mexe nesse carimbo; reentrada em PRODUCAO NÃO gera nova baixa, mas o pedido avança normalmente",
    async () => {
      const f = await criarFixtureComEstoque();

      // 1ª entrada em PRODUCAO — baixa de verdade.
      const primeiraEntrada = await avancarStatusPedido(pedidoParaAvanco(f, "CLICHE_FACA"), perdasJson(f));
      expect(primeiraEntrada.ok).toBe(true);

      const pedidoAposPrimeira = await prisma.pedido.findUniqueOrThrow({ where: { id: f.pedidoId } });
      expect(pedidoAposPrimeira.status).toBe("PRODUCAO");
      expect(pedidoAposPrimeira.baixaEstoqueRealizadaEm).not.toBeNull();
      const carimboOriginal = pedidoAposPrimeira.baixaEstoqueRealizadaEm!.getTime();

      const movimentacoesAposPrimeira = await prisma.movimentacaoEstoque.findMany({
        where: { pedidoId: f.pedidoId, tipo: "SAIDA_PRODUCAO" },
      });
      expect(movimentacoesAposPrimeira).toHaveLength(1);
      expect(Number(movimentacoesAposPrimeira[0].quantidade)).toBe(2 * f.quantidadeItem); // 2 por unidade × 10

      const materiaPrimaAposPrimeira = await prisma.itemGrafica.findUniqueOrThrow({ where: { id: f.materiaPrimaId } });
      expect(Number(materiaPrimaAposPrimeira.estoqueAtual)).toBe(f.estoqueInicial - 2 * f.quantidadeItem);

      // Retorna pra CLICHE_FACA (ex: reprovado na conferência de qualidade,
      // volta pra refazer) — via a Server Action real, autenticada como
      // DONO (PRODUCAO.podeEditar completo).
      await autenticarComo(f.usuarioDonoId);
      const retorno = await retornarEtapa(
        null,
        formDataDe({ pedidoId: f.pedidoId, etapaDestino: "CLICHE_FACA", motivo: "REPROVADO_QUALIDADE" })
      );
      expect(retorno.ok).toBe(true);

      const pedidoAposRetorno = await prisma.pedido.findUniqueOrThrow({ where: { id: f.pedidoId } });
      expect(pedidoAposRetorno.status).toBe("CLICHE_FACA");
      // NUNCA mexido por retornarEtapa — mesmo carimbo de antes, byte a byte.
      expect(pedidoAposRetorno.baixaEstoqueRealizadaEm!.getTime()).toBe(carimboOriginal);

      // retornarEtapa NUNCA estorna nem baixa estoque — nem SAIDA_PRODUCAO
      // nova, nem ESTORNO_CANCELAMENTO nenhum.
      const movimentacoesAposRetorno = await prisma.movimentacaoEstoque.findMany({ where: { pedidoId: f.pedidoId } });
      expect(movimentacoesAposRetorno).toHaveLength(1); // a mesma de antes, nenhuma nova
      const materiaPrimaAposRetorno = await prisma.itemGrafica.findUniqueOrThrow({ where: { id: f.materiaPrimaId } });
      expect(Number(materiaPrimaAposRetorno.estoqueAtual)).toBe(f.estoqueInicial - 2 * f.quantidadeItem); // inalterado

      // Apontamento: PRODUCAO fechado, CLICHE_FACA novo aberto com
      // ehRetrabalho:true.
      const apontamentosAposRetorno = await prisma.apontamentoEtapa.findMany({
        where: { pedidoId: f.pedidoId },
        orderBy: { iniciadoEm: "asc" },
      });
      expect(apontamentosAposRetorno).toHaveLength(3); // CLICHE_FACA inicial, PRODUCAO, CLICHE_FACA (retrabalho)
      const clicheFacaRetrabalho = apontamentosAposRetorno[2];
      expect(clicheFacaRetrabalho.status).toBe("CLICHE_FACA");
      expect(clicheFacaRetrabalho.ehRetrabalho).toBe(true);
      expect(clicheFacaRetrabalho.finalizadoEm).toBeNull();

      // 2ª entrada em PRODUCAO (reentrada, pela sequência normal) — passando
      // o baixaEstoqueRealizadaEm REAL lido do banco (é isso que o call-site
      // de verdade, avancarPedido em actions.ts, sempre faz: busca o Pedido
      // inteiro sem `select`, então o escalar viaja de graça).
      const segundaEntrada = await avancarStatusPedido(
        pedidoParaAvanco(f, "CLICHE_FACA", pedidoAposRetorno.baixaEstoqueRealizadaEm),
        perdasJson(f)
      );
      // O TESTE MAIS IMPORTANTE: o pedido AVANÇA normalmente...
      expect(segundaEntrada.ok).toBe(true);
      const pedidoAposSegunda = await prisma.pedido.findUniqueOrThrow({ where: { id: f.pedidoId } });
      expect(pedidoAposSegunda.status).toBe("PRODUCAO");
      // ...o carimbo continua sendo o ORIGINAL (nunca resetado/reescrito)...
      expect(pedidoAposSegunda.baixaEstoqueRealizadaEm!.getTime()).toBe(carimboOriginal);
      // ...e NENHUMA MovimentacaoEstoque nova foi criada — nem SAIDA_PRODUCAO,
      // nem nenhum outro tipo. Continua exatamente 1 (da primeira entrada).
      const movimentacoesAposSegunda = await prisma.movimentacaoEstoque.findMany({ where: { pedidoId: f.pedidoId } });
      expect(movimentacoesAposSegunda).toHaveLength(1);
      // ...e o saldo de matéria-prima continua o mesmo da primeira baixa —
      // NÃO foi descontado uma segunda vez.
      const materiaPrimaAposSegunda = await prisma.itemGrafica.findUniqueOrThrow({ where: { id: f.materiaPrimaId } });
      expect(Number(materiaPrimaAposSegunda.estoqueAtual)).toBe(f.estoqueInicial - 2 * f.quantidadeItem);

      // Apontamento da 2ª entrada em PRODUCAO é um apontamento NOVO e NORMAL
      // (ehRetrabalho:false) — o retrabalho foi a passagem por CLICHE_FACA,
      // não esta.
      const apontamentosFinal = await prisma.apontamentoEtapa.findMany({
        where: { pedidoId: f.pedidoId },
        orderBy: { iniciadoEm: "asc" },
      });
      expect(apontamentosFinal).toHaveLength(4);
      const producaoFinal = apontamentosFinal[3];
      expect(producaoFinal.status).toBe("PRODUCAO");
      expect(producaoFinal.ehRetrabalho).toBe(false);
      expect(producaoFinal.finalizadoEm).toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "regressão: um pedido que NUNCA usa retorno de etapa continua baixando estoque normalmente na 1ª (e única) entrada em PRODUCAO",
    async () => {
      const f = await criarFixtureComEstoque();

      const resultado = await avancarStatusPedido(pedidoParaAvanco(f, "CLICHE_FACA"), perdasJson(f));
      expect(resultado.ok).toBe(true);

      const movimentacoes = await prisma.movimentacaoEstoque.findMany({ where: { pedidoId: f.pedidoId, tipo: "SAIDA_PRODUCAO" } });
      expect(movimentacoes).toHaveLength(1);
      const pedido = await prisma.pedido.findUniqueOrThrow({ where: { id: f.pedidoId } });
      expect(pedido.baixaEstoqueRealizadaEm).not.toBeNull();
    },
    TIMEOUT_MS
  );
});
