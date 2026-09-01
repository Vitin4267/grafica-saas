import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de status-transicao.custo-automatico.test.ts e
// actions.custo-auditoria.test.ts) — cobre o achado E1 da auditoria de
// abrangência (pesquisa-abrangencia-modulos.md, Parte 2/Produção,
// 2026-09-01): criar terceirização, avançar situação (motivo obrigatório em
// PROBLEMA), geração automática de CustoPedido origem=TERCEIRIZACAO quando
// valorFinal é preenchido, e RBAC de Produção (criarTerceirizacao/
// avancarTerceirizacao).
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
import { criarTerceirizacao, avancarTerceirizacao } from "./terceirizacao-actions";
import { avancarSituacaoTerceirizacao, type EtapaTerceirizadaParaTransicao } from "./terceirizacao-transicao";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

type Fixture = {
  graficaId: string;
  usuarioDonoId: string;
  usuarioOperadorId: string;
  categoriaCustoId: string;
  fornecedorId: string;
  pedidoId: string;
  orcamentoId: string;
};

async function criarFixture(): Promise<Fixture> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Terceirizacao ${s}`, slug: `teste-terceirizacao-${s}` },
  });
  // DONO: podeEditarModulo sempre true, sem precisar montar PermissaoUsuario
  // (mesmo atalho de actions.custo-auditoria.test.ts).
  const usuarioDono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-terceirizacao-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  // OPERADOR sem NENHUMA linha em PermissaoUsuario — podeEditarModulo cai no
  // fallback `false` (ver src/lib/auth/permissoes.ts), cobre a rejeição RBAC.
  const usuarioOperador = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Operador ${s}`,
      email: `operador-terceirizacao-${s}@example.com`,
      senhaHash: "x",
      papel: "OPERADOR",
    },
  });
  const categoria = await prisma.categoriaCusto.create({
    data: { graficaId: grafica.id, nome: `Acabamento ${s}` },
  });
  const fornecedor = await prisma.fornecedor.create({
    data: { graficaId: grafica.id, nome: `Laminações Fulano ${s}` },
  });
  const cliente = await prisma.cliente.create({ data: { graficaId: grafica.id, nome: `Cliente ${s}` } });
  const orcamento = await prisma.orcamento.create({
    data: { graficaId: grafica.id, clienteId: cliente.id, usuarioId: usuarioDono.id, status: "APROVADO", total: 500 },
  });
  const pedido = await prisma.pedido.create({
    data: { graficaId: grafica.id, orcamentoId: orcamento.id, status: "ACABAMENTO" },
  });

  graficaIdsParaLimpar.push(grafica.id);

  return {
    graficaId: grafica.id,
    usuarioDonoId: usuarioDono.id,
    usuarioOperadorId: usuarioOperador.id,
    categoriaCustoId: categoria.id,
    fornecedorId: fornecedor.id,
    pedidoId: pedido.id,
    orcamentoId: orcamento.id,
  };
}

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

// Ordem de exclusão respeitando as FKs Restrict/dependências do schema —
// mesmo cuidado de status-transicao.custo-automatico.test.ts.
afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.logAuditoria.deleteMany({ where: { graficaId } });
    await prisma.custoPedido.deleteMany({ where: { graficaId } });
    await prisma.etapaTerceirizada.deleteMany({ where: { graficaId } });
    await prisma.pedido.deleteMany({ where: { graficaId } });
    await prisma.orcamento.deleteMany({ where: { graficaId } });
    await prisma.fornecedor.deleteMany({ where: { graficaId } });
    await prisma.categoriaCusto.deleteMany({ where: { graficaId } });
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
}, TIMEOUT_MS);

describe("criarTerceirizacao (RBAC + criação, achado E1)", () => {
  it(
    "OPERADOR sem PRODUCAO.podeEditar é rejeitado, nenhuma linha é criada",
    async () => {
      const f = await criarFixture();
      await autenticarComo(f.usuarioOperadorId);

      const resultado = await criarTerceirizacao(
        null,
        formDataDe({ pedidoId: f.pedidoId, fornecedorId: f.fornecedorId })
      );
      expect(resultado.ok).toBe(false);

      const etapas = await prisma.etapaTerceirizada.findMany({ where: { pedidoId: f.pedidoId } });
      expect(etapas).toHaveLength(0);
    },
    TIMEOUT_MS
  );

  it(
    "DONO cria a terceirização com fornecedor cadastrado, status snapshot do pedido e gera LogAuditoria",
    async () => {
      const f = await criarFixture();
      await autenticarComo(f.usuarioDonoId);

      const resultado = await criarTerceirizacao(
        null,
        formDataDe({
          pedidoId: f.pedidoId,
          fornecedorId: f.fornecedorId,
          previsaoRetorno: "2026-09-10",
          valorAcordado: "150.00",
        })
      );
      expect(resultado.ok).toBe(true);

      const etapa = await prisma.etapaTerceirizada.findFirstOrThrow({ where: { pedidoId: f.pedidoId } });
      expect(etapa.status).toBe("ACABAMENTO"); // snapshot do StatusPedido atual
      expect(etapa.situacao).toBe("AGUARDANDO_ENVIO");
      expect(etapa.fornecedorId).toBe(f.fornecedorId);
      expect(etapa.fornecedorNome).toBeNull();
      expect(Number(etapa.valorAcordado)).toBe(150);
      expect(etapa.previsaoRetorno?.toISOString().slice(0, 10)).toBe("2026-09-10");

      const logs = await prisma.logAuditoria.findMany({ where: { graficaId: f.graficaId } });
      expect(logs).toHaveLength(1);
      expect(logs[0].entidade).toBe("EtapaTerceirizada");
      expect(logs[0].acao).toBe("etapa_terceirizada.criar");
    },
    TIMEOUT_MS
  );

  it(
    "aceita fornecedor livre (nome digitado) quando não há fornecedorId, sem exigir cadastro formal",
    async () => {
      const f = await criarFixture();
      await autenticarComo(f.usuarioDonoId);

      const resultado = await criarTerceirizacao(
        null,
        formDataDe({ pedidoId: f.pedidoId, fornecedorNome: "Terceiro sem cadastro" })
      );
      expect(resultado.ok).toBe(true);

      const etapa = await prisma.etapaTerceirizada.findFirstOrThrow({ where: { pedidoId: f.pedidoId } });
      expect(etapa.fornecedorId).toBeNull();
      expect(etapa.fornecedorNome).toBe("Terceiro sem cadastro");
    },
    TIMEOUT_MS
  );

  it(
    "rejeita quando nem fornecedorId nem fornecedorNome são informados",
    async () => {
      const f = await criarFixture();
      await autenticarComo(f.usuarioDonoId);

      const resultado = await criarTerceirizacao(null, formDataDe({ pedidoId: f.pedidoId }));
      expect(resultado.ok).toBe(false);

      const etapas = await prisma.etapaTerceirizada.findMany({ where: { pedidoId: f.pedidoId } });
      expect(etapas).toHaveLength(0);
    },
    TIMEOUT_MS
  );
});

describe("avancarTerceirizacao (transições + motivo obrigatório em PROBLEMA)", () => {
  it(
    "OPERADOR sem PRODUCAO.podeEditar é rejeitado",
    async () => {
      const f = await criarFixture();
      await autenticarComo(f.usuarioDonoId);
      const criacao = await criarTerceirizacao(
        null,
        formDataDe({ pedidoId: f.pedidoId, fornecedorId: f.fornecedorId })
      );
      expect(criacao.ok).toBe(true);
      const etapa = await prisma.etapaTerceirizada.findFirstOrThrow({ where: { pedidoId: f.pedidoId } });

      await autenticarComo(f.usuarioOperadorId);
      const resultado = await avancarTerceirizacao(
        null,
        formDataDe({ etapaId: etapa.id, proximaSituacao: "ENVIADO" })
      );
      expect(resultado.ok).toBe(false);

      const etapaDepois = await prisma.etapaTerceirizada.findUniqueOrThrow({ where: { id: etapa.id } });
      expect(etapaDepois.situacao).toBe("AGUARDANDO_ENVIO");
    },
    TIMEOUT_MS
  );

  it(
    "AGUARDANDO_ENVIO -> ENVIADO grava enviadoEm; ENVIADO -> PROBLEMA sem observação é rejeitado; com observação é aceito",
    async () => {
      const f = await criarFixture();
      await autenticarComo(f.usuarioDonoId);
      await criarTerceirizacao(null, formDataDe({ pedidoId: f.pedidoId, fornecedorId: f.fornecedorId }));
      const etapa = await prisma.etapaTerceirizada.findFirstOrThrow({ where: { pedidoId: f.pedidoId } });

      const paraEnviado = await avancarTerceirizacao(
        null,
        formDataDe({ etapaId: etapa.id, proximaSituacao: "ENVIADO" })
      );
      expect(paraEnviado.ok).toBe(true);
      const apósEnvio = await prisma.etapaTerceirizada.findUniqueOrThrow({ where: { id: etapa.id } });
      expect(apósEnvio.situacao).toBe("ENVIADO");
      expect(apósEnvio.enviadoEm).not.toBeNull();

      const semMotivo = await avancarTerceirizacao(
        null,
        formDataDe({ etapaId: etapa.id, proximaSituacao: "PROBLEMA" })
      );
      expect(semMotivo.ok).toBe(false);

      const comMotivo = await avancarTerceirizacao(
        null,
        formDataDe({ etapaId: etapa.id, proximaSituacao: "PROBLEMA", observacao: "Fornecedor sumiu" })
      );
      expect(comMotivo.ok).toBe(true);
      const apósProblema = await prisma.etapaTerceirizada.findUniqueOrThrow({ where: { id: etapa.id } });
      expect(apósProblema.situacao).toBe("PROBLEMA");
      expect(apósProblema.observacao).toBe("Fornecedor sumiu");
    },
    TIMEOUT_MS
  );

  it(
    "transição inválida (RETORNADO é terminal) é rejeitada pelo core avancarSituacaoTerceirizacao",
    async () => {
      const f = await criarFixture();
      const etapa = await prisma.etapaTerceirizada.create({
        data: {
          graficaId: f.graficaId,
          pedidoId: f.pedidoId,
          status: "ACABAMENTO",
          fornecedorId: f.fornecedorId,
          situacao: "RETORNADO",
        },
      });

      const parametrosTransicao: EtapaTerceirizadaParaTransicao = {
        id: etapa.id,
        graficaId: etapa.graficaId,
        pedidoId: etapa.pedidoId,
        situacao: "RETORNADO",
        fornecedorId: etapa.fornecedorId,
        fornecedorNome: etapa.fornecedorNome,
        enviadoEm: etapa.enviadoEm,
        previsaoRetorno: etapa.previsaoRetorno,
        retornadoEm: etapa.retornadoEm,
        valorAcordado: etapa.valorAcordado,
        valorFinal: etapa.valorFinal,
        notaRemessa: etapa.notaRemessa,
        notaRetorno: etapa.notaRetorno,
        observacao: etapa.observacao,
      };

      const resultado = await avancarSituacaoTerceirizacao(parametrosTransicao, "ENVIADO");
      expect(resultado.ok).toBe(false);
    },
    TIMEOUT_MS
  );
});

describe("CustoPedido origem=TERCEIRIZACAO automático (achado E1, efeito b)", () => {
  it(
    "valorFinal preenchido ao avançar pra RETORNADO gera um CustoPedido origem=TERCEIRIZACAO com fallback pra 1ª categoria ativa",
    async () => {
      const f = await criarFixture();
      await autenticarComo(f.usuarioDonoId);
      await criarTerceirizacao(null, formDataDe({ pedidoId: f.pedidoId, fornecedorId: f.fornecedorId }));
      const etapa = await prisma.etapaTerceirizada.findFirstOrThrow({ where: { pedidoId: f.pedidoId } });
      await avancarTerceirizacao(null, formDataDe({ etapaId: etapa.id, proximaSituacao: "ENVIADO" }));

      const resultado = await avancarTerceirizacao(
        null,
        formDataDe({ etapaId: etapa.id, proximaSituacao: "RETORNADO", valorFinal: "280.50" })
      );
      expect(resultado.ok).toBe(true);

      const custos = await prisma.custoPedido.findMany({ where: { pedidoId: f.pedidoId } });
      expect(custos).toHaveLength(1);
      const custo = custos[0];
      expect(custo.origem).toBe("TERCEIRIZACAO");
      expect(custo.categoriaCustoId).toBe(f.categoriaCustoId);
      expect(Number(custo.valor)).toBeCloseTo(280.5, 2);
      expect(Number(custo.valorCalculado)).toBeCloseTo(280.5, 2);
      expect(custo.etapaTerceirizadaId).toBe(etapa.id);
      expect(custo.possivelDuplicidade).toBe(false);

      const etapaFinal = await prisma.etapaTerceirizada.findUniqueOrThrow({ where: { id: etapa.id } });
      expect(etapaFinal.situacao).toBe("RETORNADO");
      expect(etapaFinal.retornadoEm).not.toBeNull();
      expect(Number(etapaFinal.valorFinal)).toBeCloseTo(280.5, 2);
    },
    TIMEOUT_MS
  );

  it(
    "chamar de novo pra mesma terceirização (reentrância) não duplica o CustoPedido (dedup via etapaTerceirizadaId)",
    async () => {
      const f = await criarFixture();
      const etapa = await prisma.etapaTerceirizada.create({
        data: {
          graficaId: f.graficaId,
          pedidoId: f.pedidoId,
          status: "ACABAMENTO",
          fornecedorId: f.fornecedorId,
          situacao: "ENVIADO",
          valorFinal: 100,
        },
      });

      const parametrosBase: EtapaTerceirizadaParaTransicao = {
        id: etapa.id,
        graficaId: etapa.graficaId,
        pedidoId: etapa.pedidoId,
        situacao: "ENVIADO",
        fornecedorId: etapa.fornecedorId,
        fornecedorNome: etapa.fornecedorNome,
        enviadoEm: etapa.enviadoEm,
        previsaoRetorno: etapa.previsaoRetorno,
        retornadoEm: etapa.retornadoEm,
        valorAcordado: etapa.valorAcordado,
        valorFinal: etapa.valorFinal,
        notaRemessa: etapa.notaRemessa,
        notaRetorno: etapa.notaRetorno,
        observacao: etapa.observacao,
      };

      const primeira = await avancarSituacaoTerceirizacao(parametrosBase, "RETORNADO");
      expect(primeira.ok).toBe(true);

      // Reentrância: o mesmo objeto "stale" não consegue avançar de novo
      // (situação já mudou pra RETORNADO no banco), mas mesmo que a chamada
      // fosse repetida via outro caminho, criarCustoAutomaticoTerceirizacao
      // dedupa por etapaTerceirizadaId @unique — nunca duas linhas.
      const custos = await prisma.custoPedido.findMany({ where: { pedidoId: f.pedidoId } });
      expect(custos).toHaveLength(1);
    },
    TIMEOUT_MS
  );

  it(
    "custo automático que colide com manual na mesma categoria nasce marcado possivelDuplicidade, nunca somado calado",
    async () => {
      const f = await criarFixture();
      await prisma.custoPedido.create({
        data: {
          graficaId: f.graficaId,
          pedidoId: f.pedidoId,
          categoriaCustoId: f.categoriaCustoId,
          valor: 90,
          origem: "MANUAL",
        },
      });

      const etapa = await prisma.etapaTerceirizada.create({
        data: {
          graficaId: f.graficaId,
          pedidoId: f.pedidoId,
          status: "ACABAMENTO",
          fornecedorId: f.fornecedorId,
          situacao: "ENVIADO",
        },
      });
      const parametrosTransicao: EtapaTerceirizadaParaTransicao = {
        id: etapa.id,
        graficaId: etapa.graficaId,
        pedidoId: etapa.pedidoId,
        situacao: "ENVIADO",
        fornecedorId: etapa.fornecedorId,
        fornecedorNome: etapa.fornecedorNome,
        enviadoEm: etapa.enviadoEm,
        previsaoRetorno: etapa.previsaoRetorno,
        retornadoEm: etapa.retornadoEm,
        valorAcordado: etapa.valorAcordado,
        valorFinal: etapa.valorFinal,
        notaRemessa: etapa.notaRemessa,
        notaRetorno: etapa.notaRetorno,
        observacao: etapa.observacao,
      };

      const resultado = await avancarSituacaoTerceirizacao(parametrosTransicao, "RETORNADO", { valorFinal: 60 });
      expect(resultado.ok).toBe(true);

      const custos = await prisma.custoPedido.findMany({ where: { pedidoId: f.pedidoId } });
      expect(custos).toHaveLength(2);
      const manual = custos.find((c) => c.origem === "MANUAL")!;
      const automatico = custos.find((c) => c.origem === "TERCEIRIZACAO")!;
      expect(Number(manual.valor)).toBe(90); // intocado
      expect(Number(automatico.valor)).toBeCloseTo(60, 2);
      expect(automatico.possivelDuplicidade).toBe(true);
      expect(manual.possivelDuplicidade).toBe(false);
    },
    TIMEOUT_MS
  );

  it(
    "valorFinal ausente (undefined) nunca gera CustoPedido — só valor preenchido dispara o efeito",
    async () => {
      const f = await criarFixture();
      const etapa = await prisma.etapaTerceirizada.create({
        data: {
          graficaId: f.graficaId,
          pedidoId: f.pedidoId,
          status: "ACABAMENTO",
          fornecedorId: f.fornecedorId,
          situacao: "AGUARDANDO_ENVIO",
        },
      });
      const parametrosTransicao: EtapaTerceirizadaParaTransicao = {
        id: etapa.id,
        graficaId: etapa.graficaId,
        pedidoId: etapa.pedidoId,
        situacao: "AGUARDANDO_ENVIO",
        fornecedorId: etapa.fornecedorId,
        fornecedorNome: etapa.fornecedorNome,
        enviadoEm: etapa.enviadoEm,
        previsaoRetorno: etapa.previsaoRetorno,
        retornadoEm: etapa.retornadoEm,
        valorAcordado: etapa.valorAcordado,
        valorFinal: etapa.valorFinal,
        notaRemessa: etapa.notaRemessa,
        notaRetorno: etapa.notaRetorno,
        observacao: etapa.observacao,
      };

      const resultado = await avancarSituacaoTerceirizacao(parametrosTransicao, "ENVIADO");
      expect(resultado.ok).toBe(true);

      const custos = await prisma.custoPedido.findMany({ where: { pedidoId: f.pedidoId } });
      expect(custos).toHaveLength(0);
    },
    TIMEOUT_MS
  );
});
