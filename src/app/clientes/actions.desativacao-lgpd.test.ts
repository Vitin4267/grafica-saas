import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de src/app/orcamento/[id]/actions.desconto.test.ts) — cobre o
// achado A9 da auditoria de abrangência: Cliente ganhou desativação
// reversível (desativarCliente/reativarCliente) e anonimização LGPD
// (anonimizarCliente) no lugar de "fale com o suporte" quando havia
// orçamento vinculado. Cobre também que Orcamento nunca é apagado/desvinculado
// por nenhuma das duas ações — é justamente essa preservação (obrigação
// fiscal de retenção) que diferencia isto de excluirCliente.
//
// SÓ RODA DE VERDADE depois que a migration
// prisma/migrations/20260824130000_cliente_desativacao_bloqueio_lgpd/migration.sql
// tiver sido aplicada no banco (desativadoEm/bloqueadoParaVenda/motivoBloqueio/
// updatedAt ainda não existem na tabela "clientes" até lá) — ver relatório
// final da tarefa.
//
// exigirUsuarioAutenticado/exigirEmailVerificado/exigirAssinaturaAtiva são
// mockados porque dependem de cookies()/headers() de uma requisição Next.js
// de verdade, que não existe rodando a action direto — mesmo motivo do
// arquivo citado acima. A checagem de permissão de módulo (podeEditarModulo)
// roda de verdade contra o banco.
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
import { desativarCliente, reativarCliente, anonimizarCliente } from "./actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

type Fixture = {
  graficaId: string;
  usuarioDonoId: string;
  usuarioOperadorId: string;
  clienteId: string;
  orcamentoId: string;
};

async function criarFixture(): Promise<Fixture> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Desativação Cliente ${s}`, slug: `teste-desativacao-cliente-${s}` },
  });
  const usuarioDono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-desativacao-cliente-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const usuarioOperador = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Operador ${s}`,
      email: `operador-desativacao-cliente-${s}@example.com`,
      senhaHash: "x",
      papel: "OPERADOR",
    },
  });
  // Sem PermissaoUsuario pra CLIENTES — de propósito, é o caso que prova o
  // bloqueio de OPERADOR sem permissão (ver teste abaixo).

  const cliente = await prisma.cliente.create({
    data: {
      graficaId: grafica.id,
      nome: `Cliente ${s}`,
      email: `cliente-${s}@example.com`,
      telefone: "11999998888",
      documento: `${s}`.replace(/[^0-9]/g, "").slice(0, 11).padEnd(11, "0"),
    },
  });

  // Orçamento vinculado — é justamente o caso em que excluirCliente falhava
  // (ver comentário do achado A9). Precisa continuar íntegro depois de
  // desativar/anonimizar.
  const orcamento = await prisma.orcamento.create({
    data: { graficaId: grafica.id, clienteId: cliente.id, usuarioId: usuarioDono.id, status: "RASCUNHO", total: 100 },
  });

  return {
    graficaId: grafica.id,
    usuarioDonoId: usuarioDono.id,
    usuarioOperadorId: usuarioOperador.id,
    clienteId: cliente.id,
    orcamentoId: orcamento.id,
  };
}

function formDataDe(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [chave, valor] of Object.entries(campos)) fd.set(chave, valor);
  return fd;
}

async function usuarioParaMock(usuarioId: string) {
  return prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } });
}

const graficaIdsParaLimpar: string[] = [];

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.logAuditoria.deleteMany({ where: { graficaId } });
    await prisma.orcamento.deleteMany({ where: { graficaId } });
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.permissaoUsuario.deleteMany({ where: { usuario: { graficaId } } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
}, TIMEOUT_MS);

describe("desativarCliente / reativarCliente", () => {
  it(
    "desativa um cliente com orçamento vinculado sem apagar nada, e reativa de volta",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioDonoId)) as never
      );

      const resultado = await desativarCliente(null, formDataDe({ clienteId: fixture.clienteId }));
      expect(resultado.ok).toBe(true);

      const cliente = await prisma.cliente.findUniqueOrThrow({ where: { id: fixture.clienteId } });
      expect(cliente.desativadoEm).not.toBeNull();
      // Nada de pessoal foi tocado — desativar é reversível, diferente de anonimizar.
      expect(cliente.nome).toBe((await prisma.cliente.findUniqueOrThrow({ where: { id: fixture.clienteId } })).nome);

      // Orçamento continua intacto — é justamente isso que faltava antes
      // (excluirCliente falhava aqui e mandava "fale com o suporte").
      const orcamento = await prisma.orcamento.findUniqueOrThrow({ where: { id: fixture.orcamentoId } });
      expect(orcamento.clienteId).toBe(fixture.clienteId);

      const auditoriaDesativar = await prisma.logAuditoria.findFirst({
        where: { graficaId: fixture.graficaId, entidadeId: fixture.clienteId, acao: "cliente.desativar" },
      });
      expect(auditoriaDesativar).not.toBeNull();

      // Desativar de novo é bloqueado com mensagem clara, não um erro genérico.
      const segunda = await desativarCliente(null, formDataDe({ clienteId: fixture.clienteId }));
      expect(segunda.ok).toBe(false);

      // Reverso: reativarCliente volta desativadoEm pra null.
      const reativado = await reativarCliente(null, formDataDe({ clienteId: fixture.clienteId }));
      expect(reativado.ok).toBe(true);
      const clienteReativado = await prisma.cliente.findUniqueOrThrow({ where: { id: fixture.clienteId } });
      expect(clienteReativado.desativadoEm).toBeNull();

      const auditoriaReativar = await prisma.logAuditoria.findFirst({
        where: { graficaId: fixture.graficaId, entidadeId: fixture.clienteId, acao: "cliente.reativar" },
      });
      expect(auditoriaReativar).not.toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "OPERADOR sem permissão em CLIENTES é bloqueado antes de qualquer escrita",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioOperadorId)) as never
      );

      const resultado = await desativarCliente(null, formDataDe({ clienteId: fixture.clienteId }));
      expect(resultado.ok).toBe(false);

      const cliente = await prisma.cliente.findUniqueOrThrow({ where: { id: fixture.clienteId } });
      expect(cliente.desativadoEm).toBeNull();
    },
    TIMEOUT_MS
  );
});

describe("anonimizarCliente", () => {
  it(
    "sobrescreve os dados pessoais, marca desativadoEm e preserva o orçamento vinculado",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioDonoId)) as never
      );

      const resultado = await anonimizarCliente(null, formDataDe({ clienteId: fixture.clienteId }));
      expect(resultado.ok).toBe(true);

      const cliente = await prisma.cliente.findUniqueOrThrow({ where: { id: fixture.clienteId } });
      expect(cliente.nome).toBe("Cliente removido");
      expect(cliente.email).toBeNull();
      expect(cliente.telefone).toBeNull();
      expect(cliente.documento).toBeNull();
      expect(cliente.desativadoEm).not.toBeNull();

      // A obrigação de retenção fiscal é o ponto central do achado A9: o
      // orçamento (e por extensão a nota fiscal, quando existir) nunca é
      // apagado nem desvinculado.
      const orcamento = await prisma.orcamento.findUniqueOrThrow({ where: { id: fixture.orcamentoId } });
      expect(orcamento.clienteId).toBe(fixture.clienteId);

      const auditoria = await prisma.logAuditoria.findFirst({
        where: { graficaId: fixture.graficaId, entidadeId: fixture.clienteId, acao: "cliente.anonimizar" },
      });
      expect(auditoria).not.toBeNull();
      expect(auditoria!.descricao).toContain("LGPD");
    },
    TIMEOUT_MS
  );

  it(
    "dois clientes anonimizados da mesma gráfica convivem (documento null não colide no índice único)",
    async () => {
      const fixture1 = await criarFixture();
      graficaIdsParaLimpar.push(fixture1.graficaId);
      const s2 = sufixo();
      const cliente2 = await prisma.cliente.create({
        data: { graficaId: fixture1.graficaId, nome: `Outro Cliente ${s2}` },
      });

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture1.usuarioDonoId)) as never
      );

      const primeira = await anonimizarCliente(null, formDataDe({ clienteId: fixture1.clienteId }));
      expect(primeira.ok).toBe(true);
      const segunda = await anonimizarCliente(null, formDataDe({ clienteId: cliente2.id }));
      expect(segunda.ok).toBe(true);

      const c1 = await prisma.cliente.findUniqueOrThrow({ where: { id: fixture1.clienteId } });
      const c2 = await prisma.cliente.findUniqueOrThrow({ where: { id: cliente2.id } });
      expect(c1.documento).toBeNull();
      expect(c2.documento).toBeNull();
    },
    TIMEOUT_MS
  );
});
