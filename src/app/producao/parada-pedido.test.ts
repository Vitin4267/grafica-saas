import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de terceirizacao.test.ts e status-transicao.custo-automatico.test.ts)
// — cobre o achado C2 da auditoria de abrangência (pesquisa-abrangencia-
// modulos.md, Parte 2/Produção, 2026-09-01): iniciar parada, finalizar
// parada, bloqueio de segunda parada ATIVA simultânea (tanto na checagem
// otimista da action quanto no índice único parcial do banco), vínculo
// opcional com SolicitacaoCompra e RBAC de Produção
// (iniciarParadaPedido/finalizarParadaPedido).
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
import { iniciarParadaPedido, finalizarParadaPedido } from "./parada-actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

type Fixture = {
  graficaId: string;
  usuarioDonoId: string;
  usuarioOperadorId: string;
  itemGraficaId: string;
  pedidoId: string;
  orcamentoId: string;
};

async function criarFixture(): Promise<Fixture> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Parada ${s}`, slug: `teste-parada-${s}` },
  });
  // DONO: podeEditarModulo sempre true, sem precisar montar PermissaoUsuario
  // (mesmo atalho de terceirizacao.test.ts).
  const usuarioDono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-parada-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  // OPERADOR sem NENHUMA linha em PermissaoUsuario — podeEditarModulo cai no
  // fallback `false`, cobre a rejeição RBAC.
  const usuarioOperador = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Operador ${s}`,
      email: `operador-parada-${s}@example.com`,
      senhaHash: "x",
      papel: "OPERADOR",
    },
  });
  const cliente = await prisma.cliente.create({ data: { graficaId: grafica.id, nome: `Cliente ${s}` } });
  const itemCatalogo = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "MATERIA_PRIMA", categoria: "Papel", nome: `Papel Couché ${s}` },
  });
  const itemGrafica = await prisma.itemGrafica.create({
    data: { graficaId: grafica.id, itemCatalogoId: itemCatalogo.id },
  });
  const orcamento = await prisma.orcamento.create({
    data: { graficaId: grafica.id, clienteId: cliente.id, usuarioId: usuarioDono.id, status: "APROVADO", total: 500 },
  });
  const pedido = await prisma.pedido.create({
    data: { graficaId: grafica.id, orcamentoId: orcamento.id, status: "PRODUCAO" },
  });

  graficaIdsParaLimpar.push(grafica.id);

  return {
    graficaId: grafica.id,
    usuarioDonoId: usuarioDono.id,
    usuarioOperadorId: usuarioOperador.id,
    itemGraficaId: itemGrafica.id,
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

// Ordem de exclusão respeitando as FKs — mesmo cuidado de terceirizacao.test.ts.
afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.logAuditoria.deleteMany({ where: { graficaId } });
    await prisma.paradaPedido.deleteMany({ where: { graficaId } });
    await prisma.solicitacaoCompra.deleteMany({ where: { graficaId } });
    await prisma.pedido.deleteMany({ where: { graficaId } });
    await prisma.orcamento.deleteMany({ where: { graficaId } });
    await prisma.itemGrafica.deleteMany({ where: { graficaId } });
    await prisma.itemCatalogo.deleteMany({ where: { graficaId } });
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
}, TIMEOUT_MS);

describe("iniciarParadaPedido (RBAC + criação, achado C2)", () => {
  it(
    "OPERADOR sem PRODUCAO.podeEditar é rejeitado, nenhuma linha é criada",
    async () => {
      const f = await criarFixture();
      await autenticarComo(f.usuarioOperadorId);

      const resultado = await iniciarParadaPedido(
        null,
        formDataDe({ pedidoId: f.pedidoId, motivo: "AGUARDANDO_MATERIAL" })
      );
      expect(resultado.ok).toBe(false);

      const paradas = await prisma.paradaPedido.findMany({ where: { pedidoId: f.pedidoId } });
      expect(paradas).toHaveLength(0);
    },
    TIMEOUT_MS
  );

  it(
    "DONO inicia a parada com iniciadaEm preenchido e gera LogAuditoria",
    async () => {
      const f = await criarFixture();
      await autenticarComo(f.usuarioDonoId);

      const resultado = await iniciarParadaPedido(
        null,
        formDataDe({ pedidoId: f.pedidoId, motivo: "MAQUINA_PARADA", observacao: "Prensa quebrou" })
      );
      expect(resultado.ok).toBe(true);

      const parada = await prisma.paradaPedido.findFirstOrThrow({ where: { pedidoId: f.pedidoId } });
      expect(parada.motivo).toBe("MAQUINA_PARADA");
      expect(parada.finalizadaEm).toBeNull();
      expect(parada.iniciadaEm).not.toBeNull();
      expect(parada.observacao).toBe("Prensa quebrou");

      const logs = await prisma.logAuditoria.findMany({ where: { graficaId: f.graficaId } });
      expect(logs).toHaveLength(1);
      expect(logs[0].entidade).toBe("ParadaPedido");
      expect(logs[0].acao).toBe("parada_pedido.iniciar");
    },
    TIMEOUT_MS
  );

  it(
    "motivo=OUTRO sem motivoOutro é rejeitado; com motivoOutro é aceito e persistido",
    async () => {
      const f = await criarFixture();
      await autenticarComo(f.usuarioDonoId);

      const semDescricao = await iniciarParadaPedido(null, formDataDe({ pedidoId: f.pedidoId, motivo: "OUTRO" }));
      expect(semDescricao.ok).toBe(false);

      const comDescricao = await iniciarParadaPedido(
        null,
        formDataDe({ pedidoId: f.pedidoId, motivo: "OUTRO", motivoOutro: "Falta de energia na região" })
      );
      expect(comDescricao.ok).toBe(true);

      const parada = await prisma.paradaPedido.findFirstOrThrow({ where: { pedidoId: f.pedidoId } });
      expect(parada.motivo).toBe("OUTRO");
      expect(parada.motivoOutro).toBe("Falta de energia na região");
    },
    TIMEOUT_MS
  );

  it(
    "rejeita motivo inválido (fora do enum)",
    async () => {
      const f = await criarFixture();
      await autenticarComo(f.usuarioDonoId);

      const resultado = await iniciarParadaPedido(
        null,
        formDataDe({ pedidoId: f.pedidoId, motivo: "MOTIVO_INEXISTENTE" })
      );
      expect(resultado.ok).toBe(false);
    },
    TIMEOUT_MS
  );

  it(
    "rejeita iniciar parada num pedido CANCELADO",
    async () => {
      const f = await criarFixture();
      await prisma.pedido.update({ where: { id: f.pedidoId }, data: { status: "CANCELADO" } });
      await autenticarComo(f.usuarioDonoId);

      const resultado = await iniciarParadaPedido(
        null,
        formDataDe({ pedidoId: f.pedidoId, motivo: "AGUARDANDO_MATERIAL" })
      );
      expect(resultado.ok).toBe(false);

      const paradas = await prisma.paradaPedido.findMany({ where: { pedidoId: f.pedidoId } });
      expect(paradas).toHaveLength(0);
    },
    TIMEOUT_MS
  );

  it(
    "bloqueia uma SEGUNDA parada ativa simultânea pro mesmo pedido (checagem da action)",
    async () => {
      const f = await criarFixture();
      await autenticarComo(f.usuarioDonoId);

      const primeira = await iniciarParadaPedido(
        null,
        formDataDe({ pedidoId: f.pedidoId, motivo: "AGUARDANDO_MATERIAL" })
      );
      expect(primeira.ok).toBe(true);

      const segunda = await iniciarParadaPedido(
        null,
        formDataDe({ pedidoId: f.pedidoId, motivo: "FALTA_OPERADOR" })
      );
      expect(segunda.ok).toBe(false);

      const paradas = await prisma.paradaPedido.findMany({ where: { pedidoId: f.pedidoId } });
      expect(paradas).toHaveLength(1);
    },
    TIMEOUT_MS
  );

  it(
    "índice único parcial do banco também barra 2 paradas ativas pro mesmo pedido (corrida real, sem passar pela action)",
    async () => {
      const f = await criarFixture();
      await prisma.paradaPedido.create({
        data: { graficaId: f.graficaId, pedidoId: f.pedidoId, motivo: "MAQUINA_PARADA" },
      });

      await expect(
        prisma.paradaPedido.create({
          data: { graficaId: f.graficaId, pedidoId: f.pedidoId, motivo: "FALTA_OPERADOR" },
        })
      ).rejects.toThrow();

      const paradas = await prisma.paradaPedido.findMany({ where: { pedidoId: f.pedidoId } });
      expect(paradas).toHaveLength(1);
    },
    TIMEOUT_MS
  );

  it(
    "permite uma NOVA parada depois que a anterior foi finalizada (não é bloqueio permanente)",
    async () => {
      const f = await criarFixture();
      await autenticarComo(f.usuarioDonoId);

      const primeira = await iniciarParadaPedido(
        null,
        formDataDe({ pedidoId: f.pedidoId, motivo: "AGUARDANDO_MATERIAL" })
      );
      expect(primeira.ok).toBe(true);
      const parada1 = await prisma.paradaPedido.findFirstOrThrow({ where: { pedidoId: f.pedidoId } });

      await finalizarParadaPedido(null, formDataDe({ paradaId: parada1.id }));

      const segunda = await iniciarParadaPedido(
        null,
        formDataDe({ pedidoId: f.pedidoId, motivo: "FALTA_OPERADOR" })
      );
      expect(segunda.ok).toBe(true);

      const paradas = await prisma.paradaPedido.findMany({ where: { pedidoId: f.pedidoId } });
      expect(paradas).toHaveLength(2);
    },
    TIMEOUT_MS
  );
});

describe("vínculo opcional com SolicitacaoCompra (proposta original do achado C2)", () => {
  it(
    "AGUARDANDO_MATERIAL vinculado a uma SolicitacaoCompra da mesma gráfica é aceito e persistido",
    async () => {
      const f = await criarFixture();
      const compra = await prisma.solicitacaoCompra.create({
        data: { graficaId: f.graficaId, itemGraficaId: f.itemGraficaId, quantidade: 500, usuarioSolicitanteId: f.usuarioDonoId },
      });
      await autenticarComo(f.usuarioDonoId);

      const resultado = await iniciarParadaPedido(
        null,
        formDataDe({ pedidoId: f.pedidoId, motivo: "AGUARDANDO_MATERIAL", solicitacaoCompraId: compra.id })
      );
      expect(resultado.ok).toBe(true);

      const parada = await prisma.paradaPedido.findFirstOrThrow({ where: { pedidoId: f.pedidoId } });
      expect(parada.solicitacaoCompraId).toBe(compra.id);
    },
    TIMEOUT_MS
  );

  it(
    "rejeita solicitacaoCompraId de OUTRA gráfica (isolamento de tenant)",
    async () => {
      const f = await criarFixture();
      const outraGrafica = await prisma.grafica.create({
        data: { nome: `Outra Grafica ${sufixo()}`, slug: `outra-grafica-${sufixo()}` },
      });
      const outroItemCatalogo = await prisma.itemCatalogo.create({
        data: { graficaId: outraGrafica.id, tipo: "MATERIA_PRIMA", categoria: "Papel", nome: `Papel de outra gráfica ${sufixo()}` },
      });
      const outroItemGrafica = await prisma.itemGrafica.create({
        data: { graficaId: outraGrafica.id, itemCatalogoId: outroItemCatalogo.id },
      });
      const usuarioDeOutraGrafica = await prisma.usuario.create({
        data: {
          graficaId: outraGrafica.id,
          nome: `Dono outra grafica ${sufixo()}`,
          email: `dono-outra-grafica-${sufixo()}@example.com`,
          senhaHash: "x",
          papel: "DONO",
        },
      });
      const compraDeOutraGrafica = await prisma.solicitacaoCompra.create({
        data: {
          graficaId: outraGrafica.id,
          itemGraficaId: outroItemGrafica.id,
          quantidade: 100,
          usuarioSolicitanteId: usuarioDeOutraGrafica.id,
        },
      });
      await autenticarComo(f.usuarioDonoId);

      const resultado = await iniciarParadaPedido(
        null,
        formDataDe({
          pedidoId: f.pedidoId,
          motivo: "AGUARDANDO_MATERIAL",
          solicitacaoCompraId: compraDeOutraGrafica.id,
        })
      );
      expect(resultado.ok).toBe(false);

      const paradas = await prisma.paradaPedido.findMany({ where: { pedidoId: f.pedidoId } });
      expect(paradas).toHaveLength(0);

      // Limpeza da gráfica auxiliar criada só neste teste.
      await prisma.solicitacaoCompra.deleteMany({ where: { graficaId: outraGrafica.id } });
      await prisma.itemGrafica.deleteMany({ where: { graficaId: outraGrafica.id } });
      await prisma.itemCatalogo.deleteMany({ where: { graficaId: outraGrafica.id } });
      await prisma.usuario.deleteMany({ where: { graficaId: outraGrafica.id } });
      await prisma.grafica.delete({ where: { id: outraGrafica.id } });
    },
    TIMEOUT_MS
  );
});

describe("finalizarParadaPedido (RBAC + fechamento, achado C2)", () => {
  it(
    "OPERADOR sem PRODUCAO.podeEditar é rejeitado",
    async () => {
      const f = await criarFixture();
      await autenticarComo(f.usuarioDonoId);
      await iniciarParadaPedido(null, formDataDe({ pedidoId: f.pedidoId, motivo: "AGUARDANDO_MATERIAL" }));
      const parada = await prisma.paradaPedido.findFirstOrThrow({ where: { pedidoId: f.pedidoId } });

      await autenticarComo(f.usuarioOperadorId);
      const resultado = await finalizarParadaPedido(null, formDataDe({ paradaId: parada.id }));
      expect(resultado.ok).toBe(false);

      const paradaDepois = await prisma.paradaPedido.findUniqueOrThrow({ where: { id: parada.id } });
      expect(paradaDepois.finalizadaEm).toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "DONO finaliza a parada, gravando finalizadaEm e anexando a observação de resolução",
    async () => {
      const f = await criarFixture();
      await autenticarComo(f.usuarioDonoId);
      await iniciarParadaPedido(
        null,
        formDataDe({ pedidoId: f.pedidoId, motivo: "AGUARDANDO_APROVACAO_CLIENTE", observacao: "Aguardando retorno" })
      );
      const parada = await prisma.paradaPedido.findFirstOrThrow({ where: { pedidoId: f.pedidoId } });

      const resultado = await finalizarParadaPedido(
        null,
        formDataDe({ paradaId: parada.id, observacao: "Cliente aprovou por WhatsApp" })
      );
      expect(resultado.ok).toBe(true);

      const paradaFinal = await prisma.paradaPedido.findUniqueOrThrow({ where: { id: parada.id } });
      expect(paradaFinal.finalizadaEm).not.toBeNull();
      expect(paradaFinal.observacao).toContain("Aguardando retorno");
      expect(paradaFinal.observacao).toContain("Cliente aprovou por WhatsApp");

      const logs = await prisma.logAuditoria.findMany({
        where: { graficaId: f.graficaId, acao: "parada_pedido.finalizar" },
      });
      expect(logs).toHaveLength(1);
    },
    TIMEOUT_MS
  );

  it(
    "finalizar uma parada já finalizada é rejeitado (CAS), sem sobrescrever finalizadaEm",
    async () => {
      const f = await criarFixture();
      await autenticarComo(f.usuarioDonoId);
      await iniciarParadaPedido(null, formDataDe({ pedidoId: f.pedidoId, motivo: "MAQUINA_PARADA" }));
      const parada = await prisma.paradaPedido.findFirstOrThrow({ where: { pedidoId: f.pedidoId } });

      const primeira = await finalizarParadaPedido(null, formDataDe({ paradaId: parada.id }));
      expect(primeira.ok).toBe(true);
      const paradaApósPrimeira = await prisma.paradaPedido.findUniqueOrThrow({ where: { id: parada.id } });

      const segunda = await finalizarParadaPedido(null, formDataDe({ paradaId: parada.id }));
      expect(segunda.ok).toBe(false);

      const paradaApósSegunda = await prisma.paradaPedido.findUniqueOrThrow({ where: { id: parada.id } });
      expect(paradaApósSegunda.finalizadaEm?.getTime()).toBe(paradaApósPrimeira.finalizadaEm?.getTime());
    },
    TIMEOUT_MS
  );

  it(
    "finalizar parada inexistente/de outra gráfica é rejeitado",
    async () => {
      const f = await criarFixture();
      await autenticarComo(f.usuarioDonoId);

      const resultado = await finalizarParadaPedido(null, formDataDe({ paradaId: "id-inexistente" }));
      expect(resultado.ok).toBe(false);
    },
    TIMEOUT_MS
  );
});
