import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de status-transicao.custo-automatico.test.ts e
// actions.comissao-custo.test.ts) — cobre o achado A17 da auditoria de
// abrangência (pesquisa-abrangencia-modulos.md, módulo Financeiro):
// CustoPedido decide o lucro de cada pedido, mas edições/criações/exclusões
// MANUAIS dele não deixavam nenhum rastro em LogAuditoria. Este arquivo
// confirma que lancarCustoPedido e excluirCustoPedido (as duas actions que
// escrevem CustoPedido por ação direta de um usuário, ver producao/actions.ts)
// agora geram uma linha de auditoria cada.
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
import { lancarCustoPedido, excluirCustoPedido } from "./actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

type Fixture = {
  graficaId: string;
  usuarioId: string;
  categoriaCustoId: string;
  pedidoId: string;
};

async function criarFixture(): Promise<Fixture> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Custo Auditoria ${s}`, slug: `teste-custo-auditoria-${s}` },
  });
  // papel DONO de propósito — podeEditarModulo só consulta permissão
  // granular pra OPERADOR, então isso deixa a fixture focada no que este
  // teste cobre (auditoria), sem precisar montar PermissaoModulo junto.
  const usuario = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-custo-auditoria-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const categoria = await prisma.categoriaCusto.create({
    data: { graficaId: grafica.id, nome: `Frete ${s}` },
  });
  const cliente = await prisma.cliente.create({ data: { graficaId: grafica.id, nome: `Cliente ${s}` } });
  const orcamento = await prisma.orcamento.create({
    data: { graficaId: grafica.id, clienteId: cliente.id, usuarioId: usuario.id, status: "APROVADO", total: 100 },
  });
  const pedido = await prisma.pedido.create({
    data: { graficaId: grafica.id, orcamentoId: orcamento.id, status: "ARTE" },
  });

  graficaIdsParaLimpar.push(grafica.id);

  return { graficaId: grafica.id, usuarioId: usuario.id, categoriaCustoId: categoria.id, pedidoId: pedido.id };
}

function formDataDe(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [chave, valor] of Object.entries(campos)) fd.set(chave, valor);
  return fd;
}

const graficaIdsParaLimpar: string[] = [];

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.logAuditoria.deleteMany({ where: { graficaId } });
    await prisma.custoPedido.deleteMany({ where: { graficaId } });
    await prisma.pedido.deleteMany({ where: { graficaId } });
    await prisma.orcamento.deleteMany({ where: { graficaId } });
    await prisma.categoriaCusto.deleteMany({ where: { graficaId } });
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
}, TIMEOUT_MS);

describe("CustoPedido manual deixa rastro em LogAuditoria (achado A17)", () => {
  it(
    "lancarCustoPedido gera um LogAuditoria de criação com a entidade CustoPedido",
    async () => {
      const f = await criarFixture();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioId } })) as never
      );

      const resultado = await lancarCustoPedido(
        null,
        formDataDe({
          pedidoId: f.pedidoId,
          categoriaCustoId: f.categoriaCustoId,
          valor: "150.5",
          observacao: "Frete emergencial",
        })
      );
      expect(resultado.ok).toBe(true);

      const custo = await prisma.custoPedido.findFirstOrThrow({ where: { pedidoId: f.pedidoId } });

      const logs = await prisma.logAuditoria.findMany({ where: { graficaId: f.graficaId } });
      expect(logs).toHaveLength(1);
      expect(logs[0].entidade).toBe("CustoPedido");
      expect(logs[0].entidadeId).toBe(custo.id);
      expect(logs[0].acao).toBe("custo_pedido.criar");
      expect(logs[0].usuarioId).toBe(f.usuarioId);
      expect(logs[0].descricao).toContain("150,50");
    },
    TIMEOUT_MS
  );

  it(
    "excluirCustoPedido gera um LogAuditoria de exclusão com a entidade CustoPedido, mesmo após o registro sumir",
    async () => {
      const f = await criarFixture();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioId } })) as never
      );

      const custo = await prisma.custoPedido.create({
        data: {
          graficaId: f.graficaId,
          pedidoId: f.pedidoId,
          categoriaCustoId: f.categoriaCustoId,
          valor: 80,
          criadoPorId: f.usuarioId,
        },
      });

      const resultado = await excluirCustoPedido(null, formDataDe({ custoId: custo.id }));
      expect(resultado.ok).toBe(true);

      const aindaExiste = await prisma.custoPedido.findUnique({ where: { id: custo.id } });
      expect(aindaExiste).toBeNull(); // exclusão real, não soft-delete

      const logs = await prisma.logAuditoria.findMany({ where: { graficaId: f.graficaId } });
      expect(logs).toHaveLength(1);
      expect(logs[0].entidade).toBe("CustoPedido");
      expect(logs[0].entidadeId).toBe(custo.id);
      expect(logs[0].acao).toBe("custo_pedido.excluir");
      expect(logs[0].usuarioId).toBe(f.usuarioId);
      expect(logs[0].descricao).toContain("80,00");
    },
    TIMEOUT_MS
  );
});
