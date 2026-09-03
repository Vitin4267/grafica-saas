import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de src/app/compras/origem-solicitacao-compra.test.ts) — cobre
// o achado A9 da auditoria de abrangência (Parte 3/Compras, 2026-08-30): dá
// função de verdade a OrigemSolicitacaoCompra.CONTRATO_PROGRAMADO — uma
// solicitação vinculada a um ContratoFornecimento ativo e vigente nasce
// direto em APROVADO (fornecedor/preço copiados do contrato), sem passar
// por COTANDO, e RECEBIDO incrementa ContratoFornecimento.quantidadeConsumida.
//
// SÓ RODA DE VERDADE depois que a migration
// prisma/migrations/20260830170000_contrato_fornecimento/migration.sql
// tiver sido aplicada no banco (tabela contratos_fornecimento e a coluna
// solicitacoes_compra.contratoFornecimentoId ainda não existem até lá).
//
// Mesmos dublês de origem-solicitacao-compra.test.ts: redirect() mockado (só
// a função, não next/navigation inteiro) porque criarSolicitacaoCompra
// navega no caminho de SUCESSO; exigirUsuarioAutenticado/
// exigirEmailVerificado/exigirAssinaturaAtiva mockados porque dependem de
// cookies()/headers() de uma requisição de verdade.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));

const redirectMock = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
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
import { criarSolicitacaoCompra } from "./actions";
import { avancarStatusCompra, type SolicitacaoParaTransicao } from "./status-transicao";
import type { StatusSolicitacaoCompra } from "@/lib/compras-status";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

type Fixture = {
  graficaId: string;
  usuarioDonoId: string;
  fornecedorId: string;
  outroFornecedorId: string;
  itemGraficaId: string; // matéria-prima alvo do contrato "de verdade"
  outroItemGraficaId: string; // matéria-prima FORA do escopo do contrato
};

const graficaIdsParaLimpar: string[] = [];

async function criarFixture(): Promise<Fixture> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Contrato Fornecimento ${s}`, slug: `teste-contrato-fornecimento-${s}` },
  });
  const usuarioDono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-contrato-fornecimento-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const fornecedor = await prisma.fornecedor.create({ data: { graficaId: grafica.id, nome: `Fornecedor ${s}` } });
  const outroFornecedor = await prisma.fornecedor.create({
    data: { graficaId: grafica.id, nome: `Outro Fornecedor ${s}` },
  });

  const catalogoMateriaPrima = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "MATERIA_PRIMA", categoria: "Papel", nome: `Chapa offset ${s}` },
  });
  const materiaPrima = await prisma.itemGrafica.create({
    data: { graficaId: grafica.id, itemCatalogoId: catalogoMateriaPrima.id, estoqueAtual: 0 },
  });

  const catalogoOutroItem = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "MATERIA_PRIMA", categoria: "Papel", nome: `Outra chapa ${s}` },
  });
  const outroItem = await prisma.itemGrafica.create({
    data: { graficaId: grafica.id, itemCatalogoId: catalogoOutroItem.id, estoqueAtual: 0 },
  });

  graficaIdsParaLimpar.push(grafica.id);

  return {
    graficaId: grafica.id,
    usuarioDonoId: usuarioDono.id,
    fornecedorId: fornecedor.id,
    outroFornecedorId: outroFornecedor.id,
    itemGraficaId: materiaPrima.id,
    outroItemGraficaId: outroItem.id,
  };
}

// Contrato ATIVO e dentro da vigência por padrão — vigenciaInicio/Fim
// cobrindo "agora" com folga, pra nunca falhar por timing do teste rodando.
function contratoAtivoData(f: Fixture, overrides: Record<string, unknown> = {}) {
  return {
    graficaId: f.graficaId,
    fornecedorId: f.fornecedorId,
    itemGraficaId: f.itemGraficaId,
    precoUnitario: 5,
    unidadeCompra: "KG" as const,
    vigenciaInicio: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    vigenciaFim: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    ...overrides,
  };
}

async function solicitacaoParaTransicao(solicitacaoId: string): Promise<SolicitacaoParaTransicao> {
  const solicitacao = await prisma.solicitacaoCompra.findUniqueOrThrow({ where: { id: solicitacaoId } });
  return {
    id: solicitacao.id,
    graficaId: solicitacao.graficaId,
    status: solicitacao.status,
    itemGraficaId: solicitacao.itemGraficaId,
    varianteId: solicitacao.varianteId,
    quantidade: solicitacao.quantidade,
    valorEstimado: solicitacao.valorEstimado,
    valorFinal: solicitacao.valorFinal,
    fornecedorId: solicitacao.fornecedorId,
    documento: solicitacao.documento,
    pedidoId: solicitacao.pedidoId,
    contratoFornecimentoId: solicitacao.contratoFornecimentoId,
  };
}

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.movimentacaoEstoque.deleteMany({ where: { itemGrafica: { graficaId } } });
    await prisma.solicitacaoCompra.deleteMany({ where: { graficaId } });
    await prisma.contratoFornecimento.deleteMany({ where: { graficaId } });
    await prisma.itemGrafica.deleteMany({ where: { graficaId } });
    await prisma.itemCatalogo.deleteMany({ where: { graficaId } });
    await prisma.fornecedor.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
  redirectMock.mockClear();
}, TIMEOUT_MS);

describe("criarSolicitacaoCompra — origem CONTRATO_PROGRAMADO (achado A9 da auditoria de abrangência)", () => {
  it(
    "contrato ativo e vigente: solicitação nasce em APROVADO, fornecedor/valor copiados do contrato, pula COTANDO",
    async () => {
      const f = await criarFixture();
      const contrato = await prisma.contratoFornecimento.create({ data: contratoAtivoData(f) });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioDonoId } })) as never
      );

      const fd = new FormData();
      fd.set("itemGraficaId", f.itemGraficaId);
      fd.set("varianteId", "");
      fd.set("fornecedorId", ""); // nunca confia nisso — o servidor usa o do contrato
      fd.set("quantidade", "10");
      fd.set("unidadeCompra", "");
      fd.set("unidadeCompraOutro", "");
      fd.set("quantidadeCompra", "");
      fd.set("fatorConversaoCompra", "");
      fd.set("precoUnitarioCompra", "");
      fd.set("valorEstimado", "");
      fd.set("observacao", "");
      fd.set("origem", "CONTRATO_PROGRAMADO");
      fd.set("origemOutro", "");
      fd.set("pedidoId", "");
      fd.set("contratoFornecimentoId", contrato.id);

      await expect(criarSolicitacaoCompra(null, fd)).rejects.toThrow(/^NEXT_REDIRECT:/);

      const novaId = (redirectMock.mock.calls[0][0] as string).split("/").pop()!;
      const solicitacao = await prisma.solicitacaoCompra.findUniqueOrThrow({ where: { id: novaId } });
      expect(solicitacao.status).toBe("APROVADO");
      expect(solicitacao.aprovadoEm).not.toBeNull();
      expect(solicitacao.usuarioAprovadorId).toBe(f.usuarioDonoId);
      expect(solicitacao.fornecedorId).toBe(f.fornecedorId);
      expect(solicitacao.contratoFornecimentoId).toBe(contrato.id);
      expect(Number(solicitacao.valorEstimado)).toBe(50); // 5 (precoUnitario) x 10 (quantidade)
    },
    TIMEOUT_MS
  );

  it(
    "rejeita origem=CONTRATO_PROGRAMADO sem contratoFornecimentoId",
    async () => {
      const f = await criarFixture();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioDonoId } })) as never
      );

      const fd = new FormData();
      fd.set("itemGraficaId", f.itemGraficaId);
      fd.set("quantidade", "10");
      fd.set("origem", "CONTRATO_PROGRAMADO");
      // contratoFornecimentoId de propósito ausente

      const resultado = await criarSolicitacaoCompra(null, fd);
      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toMatch(/selecione o contrato/i);
      expect(redirectMock).not.toHaveBeenCalled();

      const criadas = await prisma.solicitacaoCompra.findMany({ where: { graficaId: f.graficaId } });
      expect(criadas).toHaveLength(0);
    },
    TIMEOUT_MS
  );

  it(
    "contrato INATIVO (ativo=false) nunca é aceito — nunca oferecido/usado automaticamente",
    async () => {
      const f = await criarFixture();
      const contratoInativo = await prisma.contratoFornecimento.create({
        data: contratoAtivoData(f, { ativo: false }),
      });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioDonoId } })) as never
      );

      const fd = new FormData();
      fd.set("itemGraficaId", f.itemGraficaId);
      fd.set("quantidade", "10");
      fd.set("origem", "CONTRATO_PROGRAMADO");
      fd.set("contratoFornecimentoId", contratoInativo.id);

      const resultado = await criarSolicitacaoCompra(null, fd);
      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toMatch(/inválido, inativo ou fora da vigência/i);
      expect(redirectMock).not.toHaveBeenCalled();
    },
    TIMEOUT_MS
  );

  it(
    "contrato com vigência já vencida é rejeitado",
    async () => {
      const f = await criarFixture();
      const contratoVencido = await prisma.contratoFornecimento.create({
        data: contratoAtivoData(f, {
          vigenciaInicio: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
          vigenciaFim: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // ontem
        }),
      });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioDonoId } })) as never
      );

      const fd = new FormData();
      fd.set("itemGraficaId", f.itemGraficaId);
      fd.set("quantidade", "10");
      fd.set("origem", "CONTRATO_PROGRAMADO");
      fd.set("contratoFornecimentoId", contratoVencido.id);

      const resultado = await criarSolicitacaoCompra(null, fd);
      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toMatch(/inválido, inativo ou fora da vigência/i);
    },
    TIMEOUT_MS
  );

  it(
    "contrato específico de OUTRA matéria-prima é rejeitado quando a solicitação é pra um item diferente",
    async () => {
      const f = await criarFixture();
      const contrato = await prisma.contratoFornecimento.create({ data: contratoAtivoData(f) }); // itemGraficaId = f.itemGraficaId
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioDonoId } })) as never
      );

      const fd = new FormData();
      fd.set("itemGraficaId", f.outroItemGraficaId); // item DIFERENTE do escopo do contrato
      fd.set("quantidade", "10");
      fd.set("origem", "CONTRATO_PROGRAMADO");
      fd.set("contratoFornecimentoId", contrato.id);

      const resultado = await criarSolicitacaoCompra(null, fd);
      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toMatch(/não cobre a matéria-prima/i);
    },
    TIMEOUT_MS
  );

  it(
    "contrato coringa (itemGraficaId=null) cobre qualquer matéria-prima do fornecedor",
    async () => {
      const f = await criarFixture();
      const contratoCoringa = await prisma.contratoFornecimento.create({
        data: contratoAtivoData(f, { itemGraficaId: null }),
      });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioDonoId } })) as never
      );

      const fd = new FormData();
      fd.set("itemGraficaId", f.outroItemGraficaId); // qualquer item — contrato coringa cobre
      fd.set("quantidade", "4");
      fd.set("origem", "CONTRATO_PROGRAMADO");
      fd.set("contratoFornecimentoId", contratoCoringa.id);

      await expect(criarSolicitacaoCompra(null, fd)).rejects.toThrow(/^NEXT_REDIRECT:/);

      const novaId = (redirectMock.mock.calls[0][0] as string).split("/").pop()!;
      const solicitacao = await prisma.solicitacaoCompra.findUniqueOrThrow({ where: { id: novaId } });
      expect(solicitacao.status).toBe("APROVADO");
      expect(solicitacao.fornecedorId).toBe(f.fornecedorId);
    },
    TIMEOUT_MS
  );

  it(
    "fornecedorId enviado pelo client é ignorado — o do contrato sempre prevalece",
    async () => {
      const f = await criarFixture();
      const contrato = await prisma.contratoFornecimento.create({ data: contratoAtivoData(f) }); // fornecedorId = f.fornecedorId
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioDonoId } })) as never
      );

      const fd = new FormData();
      fd.set("itemGraficaId", f.itemGraficaId);
      fd.set("fornecedorId", f.outroFornecedorId); // tentativa de forçar outro fornecedor
      fd.set("quantidade", "10");
      fd.set("origem", "CONTRATO_PROGRAMADO");
      fd.set("contratoFornecimentoId", contrato.id);

      await expect(criarSolicitacaoCompra(null, fd)).rejects.toThrow(/^NEXT_REDIRECT:/);

      const novaId = (redirectMock.mock.calls[0][0] as string).split("/").pop()!;
      const solicitacao = await prisma.solicitacaoCompra.findUniqueOrThrow({ where: { id: novaId } });
      expect(solicitacao.fornecedorId).toBe(f.fornecedorId); // nunca o outroFornecedorId enviado
    },
    TIMEOUT_MS
  );
});

describe("RECEBIDO incrementa ContratoFornecimento.quantidadeConsumida (achado A9)", () => {
  it(
    "confirmar RECEBIDO de uma solicitação vinculada incrementa quantidadeConsumida do contrato",
    async () => {
      const f = await criarFixture();
      const contrato = await prisma.contratoFornecimento.create({ data: contratoAtivoData(f) });
      const solicitacao = await prisma.solicitacaoCompra.create({
        data: {
          graficaId: f.graficaId,
          itemGraficaId: f.itemGraficaId,
          quantidade: 15,
          origem: "CONTRATO_PROGRAMADO",
          contratoFornecimentoId: contrato.id,
          fornecedorId: f.fornecedorId,
          status: "APROVADO",
          usuarioSolicitanteId: f.usuarioDonoId,
        },
      });

      for (const proximo of ["COMPRADO", "RECEBIDO"] as StatusSolicitacaoCompra[]) {
        const atual = await solicitacaoParaTransicao(solicitacao.id);
        const dados = proximo === "COMPRADO" ? { valorFinal: 75 } : {};
        const resultado = await avancarStatusCompra(atual, proximo, { id: f.usuarioDonoId }, dados);
        expect(resultado.ok).toBe(true);
      }

      const contratoAtualizado = await prisma.contratoFornecimento.findUniqueOrThrow({ where: { id: contrato.id } });
      expect(Number(contratoAtualizado.quantidadeConsumida)).toBe(15);
    },
    TIMEOUT_MS
  );

  it(
    "solicitação SEM contrato vinculado (origem normal) chegando em RECEBIDO nunca mexe em nenhum contrato — comportamento de hoje preservado",
    async () => {
      const f = await criarFixture();
      const contrato = await prisma.contratoFornecimento.create({ data: contratoAtivoData(f) });
      const solicitacao = await prisma.solicitacaoCompra.create({
        data: {
          graficaId: f.graficaId,
          itemGraficaId: f.itemGraficaId,
          quantidade: 20,
          // origem default REPOSICAO_ESTOQUE, sem contratoFornecimentoId
          usuarioSolicitanteId: f.usuarioDonoId,
        },
      });

      for (const proximo of ["APROVADO", "COMPRADO", "RECEBIDO"] as StatusSolicitacaoCompra[]) {
        const atual = await solicitacaoParaTransicao(solicitacao.id);
        const dados = proximo === "COMPRADO" ? { valorFinal: 100 } : {};
        const resultado = await avancarStatusCompra(atual, proximo, { id: f.usuarioDonoId }, dados);
        expect(resultado.ok).toBe(true);
      }

      const contratoInalterado = await prisma.contratoFornecimento.findUniqueOrThrow({ where: { id: contrato.id } });
      expect(Number(contratoInalterado.quantidadeConsumida)).toBe(0);
    },
    TIMEOUT_MS
  );

  it(
    "concorrência: duas solicitações do MESMO contrato confirmando RECEBIDO ao mesmo tempo não perdem incremento",
    async () => {
      const f = await criarFixture();
      // Contrato CORINGA (itemGraficaId=null) de propósito: as duas
      // solicitações abaixo miram matérias-primas DIFERENTES (f.itemGraficaId
      // e f.outroItemGraficaId) pra isolar o que este teste quer provar (o
      // increment() de quantidadeConsumida sob concorrência) do CAS de
      // estoque de avancarStatusCompra — duas solicitações do MESMO item
      // confirmando RECEBIDO ao mesmo tempo disputariam o CAS de
      // itemGrafica.estoqueAtual entre si (mecanismo different, já coberto
      // noutro teste), o que não é o que está sendo testado aqui.
      const contrato = await prisma.contratoFornecimento.create({
        data: contratoAtivoData(f, { itemGraficaId: null }),
      });

      const criarSolicitacaoComprada = async (itemGraficaId: string, quantidade: number) => {
        const solicitacao = await prisma.solicitacaoCompra.create({
          data: {
            graficaId: f.graficaId,
            itemGraficaId,
            quantidade,
            origem: "CONTRATO_PROGRAMADO",
            contratoFornecimentoId: contrato.id,
            fornecedorId: f.fornecedorId,
            status: "APROVADO",
            usuarioSolicitanteId: f.usuarioDonoId,
          },
        });
        // Avança até COMPRADO fora do teste de concorrência (só RECEBIDO
        // roda em paralelo abaixo — é essa transação que faz o increment()).
        const atual = await solicitacaoParaTransicao(solicitacao.id);
        await avancarStatusCompra(atual, "COMPRADO", { id: f.usuarioDonoId }, { valorFinal: quantidade * 5 });
        return solicitacao.id;
      };

      const [solicitacaoAId, solicitacaoBId] = await Promise.all([
        criarSolicitacaoComprada(f.itemGraficaId, 10),
        criarSolicitacaoComprada(f.outroItemGraficaId, 7),
      ]);

      const [atualA, atualB] = await Promise.all([
        solicitacaoParaTransicao(solicitacaoAId),
        solicitacaoParaTransicao(solicitacaoBId),
      ]);

      // As duas confirmações de RECEBIDO disparadas ao mesmo tempo — cada
      // uma faz um increment() atômico do Prisma na mesma linha do contrato;
      // se o código lesse+gravasse quantidadeConsumida em passos separados,
      // uma das duas atualizações se perderia (last-write-wins).
      const [resultadoA, resultadoB] = await Promise.all([
        avancarStatusCompra(atualA, "RECEBIDO", { id: f.usuarioDonoId }),
        avancarStatusCompra(atualB, "RECEBIDO", { id: f.usuarioDonoId }),
      ]);
      expect(resultadoA.ok).toBe(true);
      expect(resultadoB.ok).toBe(true);

      const contratoFinal = await prisma.contratoFornecimento.findUniqueOrThrow({ where: { id: contrato.id } });
      expect(Number(contratoFinal.quantidadeConsumida)).toBe(17); // 10 + 7, nenhum incremento perdido
    },
    TIMEOUT_MS
  );
});
