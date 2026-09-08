import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de src/app/configuracoes/prestadores-servico/actions.test.ts)
// — cobre o achado D1 da auditoria de abrangência
// (pesquisa-abrangencia-modulos.md, "Sem conceito de 'colaborador sem
// login'"): cadastro de pessoa sem login (motorista terceirizado, operador
// de chão de fábrica), distinto de Usuario (sem email/senhaHash/auth).
//
// SÓ RODA DE VERDADE depois que a migration
// prisma/migrations/20260908130000_colaborador/migration.sql tiver sido
// aplicada no banco (tabela "colaboradores" ainda não existe até lá).

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
import { criarColaborador, editarColaborador, alternarAtivoColaborador } from "./actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

type Fixture = {
  graficaId: string;
  usuarioDonoId: string;
  usuarioOperadorId: string; // sem nenhuma PermissaoUsuario — nunca pode editar
};

const graficaIdsParaLimpar: string[] = [];

async function criarFixture(): Promise<Fixture> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Colaborador ${s}`, slug: `teste-colaborador-${s}` },
  });
  const usuarioDono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-colaborador-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
      emailVerificadoEm: new Date(),
    },
  });
  const usuarioOperador = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Operador ${s}`,
      email: `operador-colaborador-${s}@example.com`,
      senhaHash: "x",
      papel: "OPERADOR",
      emailVerificadoEm: new Date(),
    },
  });

  graficaIdsParaLimpar.push(grafica.id);

  return {
    graficaId: grafica.id,
    usuarioDonoId: usuarioDono.id,
    usuarioOperadorId: usuarioOperador.id,
  };
}

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.entrega.deleteMany({ where: { graficaId } });
    await prisma.colaborador.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
  redirectMock.mockClear();
}, TIMEOUT_MS);

async function comoUsuario(usuarioId: string) {
  const usuario = await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } });
  vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(usuario as never);
}

describe("criarColaborador (achado D1)", () => {
  it(
    "DONO cria um colaborador da GRAFICA com sucesso e o log de auditoria é gravado",
    async () => {
      const f = await criarFixture();
      await comoUsuario(f.usuarioDonoId);

      const fd = new FormData();
      fd.set("nome", "Carlos Silva");
      fd.set("tipo", "MOTORISTA");
      fd.set("telefone", "(11) 99999-0000");

      await expect(criarColaborador(null, fd)).rejects.toThrow(/^NEXT_REDIRECT:/);

      const novaId = (redirectMock.mock.calls[0][0] as string).split("/").pop()!;
      const colaborador = await prisma.colaborador.findUniqueOrThrow({ where: { id: novaId } });
      expect(colaborador.nome).toBe("Carlos Silva");
      expect(colaborador.tipo).toBe("MOTORISTA");
      expect(colaborador.telefone).toBe("(11) 99999-0000");
      expect(colaborador.ativo).toBe(true);
      expect(colaborador.graficaId).toBe(f.graficaId);
      // NUNCA cria Usuario nem toca em auth — ver comentário do model no
      // schema (proposta antiga do achado foi rejeitada de propósito).
      expect(
        await prisma.usuario.findFirst({ where: { graficaId: f.graficaId, nome: "Carlos Silva" } })
      ).toBeNull();

      const logs = await prisma.logAuditoria.findMany({
        where: { graficaId: f.graficaId, acao: "configuracoes.criar_colaborador" },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0].entidadeId).toBe(novaId);
    },
    TIMEOUT_MS
  );

  it(
    "tipo=OUTRO exige tipoOutro",
    async () => {
      const f = await criarFixture();
      await comoUsuario(f.usuarioDonoId);

      const fd = new FormData();
      fd.set("nome", "Fulano");
      fd.set("tipo", "OUTRO");

      const resultado = await criarColaborador(null, fd);
      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toMatch(/descreva o tipo/i);

      const criados = await prisma.colaborador.findMany({ where: { graficaId: f.graficaId } });
      expect(criados).toHaveLength(0);
    },
    TIMEOUT_MS
  );

  it(
    "tipo=OUTRO com tipoOutro preenchido grava normalmente",
    async () => {
      const f = await criarFixture();
      await comoUsuario(f.usuarioDonoId);

      const fd = new FormData();
      fd.set("nome", "Auxiliar Expedição");
      fd.set("tipo", "OUTRO");
      fd.set("tipoOutro", "Auxiliar de expedição");

      await expect(criarColaborador(null, fd)).rejects.toThrow(/^NEXT_REDIRECT:/);
      const novaId = (redirectMock.mock.calls[0][0] as string).split("/").pop()!;
      const colaborador = await prisma.colaborador.findUniqueOrThrow({ where: { id: novaId } });
      expect(colaborador.tipo).toBe("OUTRO");
      expect(colaborador.tipoOutro).toBe("Auxiliar de expedição");
    },
    TIMEOUT_MS
  );

  it(
    "nome vazio é rejeitado",
    async () => {
      const f = await criarFixture();
      await comoUsuario(f.usuarioDonoId);

      const fd = new FormData();
      fd.set("nome", "  ");
      fd.set("tipo", "MOTORISTA");

      const resultado = await criarColaborador(null, fd);
      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toMatch(/informe um nome/i);
    },
    TIMEOUT_MS
  );

  it(
    "tipo ausente/inválido é rejeitado",
    async () => {
      const f = await criarFixture();
      await comoUsuario(f.usuarioDonoId);

      const fd = new FormData();
      fd.set("nome", "Sem Tipo");

      const resultado = await criarColaborador(null, fd);
      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toMatch(/selecione um tipo/i);
    },
    TIMEOUT_MS
  );

  it(
    "nome repetido na MESMA gráfica é permitido (nome de pessoa, sem unique — diferente de Transportadora/Fornecedor)",
    async () => {
      const f = await criarFixture();
      await prisma.colaborador.create({
        data: { graficaId: f.graficaId, nome: "José", tipo: "MOTORISTA" },
      });
      await comoUsuario(f.usuarioDonoId);

      const fd = new FormData();
      fd.set("nome", "José");
      fd.set("tipo", "OPERADOR_CHAO_FABRICA");

      await expect(criarColaborador(null, fd)).rejects.toThrow(/^NEXT_REDIRECT:/);

      const todos = await prisma.colaborador.findMany({
        where: { graficaId: f.graficaId, nome: "José" },
      });
      expect(todos).toHaveLength(2);
    },
    TIMEOUT_MS
  );
});

describe("editarColaborador (achado D1)", () => {
  it(
    "atualiza campos e registra diff no log de auditoria",
    async () => {
      const f = await criarFixture();
      const colaborador = await prisma.colaborador.create({
        data: { graficaId: f.graficaId, nome: "Motorista Original", tipo: "MOTORISTA" },
      });
      await comoUsuario(f.usuarioDonoId);

      const fd = new FormData();
      fd.set("colaboradorId", colaborador.id);
      fd.set("nome", "Motorista Editado");
      fd.set("tipo", "OPERADOR_CHAO_FABRICA");
      fd.set("telefone", "(11) 98888-0000");

      const resultado = await editarColaborador(null, fd);
      expect(resultado.ok).toBe(true);

      const atualizado = await prisma.colaborador.findUniqueOrThrow({ where: { id: colaborador.id } });
      expect(atualizado.nome).toBe("Motorista Editado");
      expect(atualizado.tipo).toBe("OPERADOR_CHAO_FABRICA");
      expect(atualizado.telefone).toBe("(11) 98888-0000");

      const logs = await prisma.logAuditoria.findMany({
        where: { graficaId: f.graficaId, acao: "configuracoes.editar_colaborador" },
      });
      expect(logs).toHaveLength(1);
    },
    TIMEOUT_MS
  );

  it(
    "sem nenhuma mudança real não grava log de auditoria",
    async () => {
      const f = await criarFixture();
      const colaborador = await prisma.colaborador.create({
        data: { graficaId: f.graficaId, nome: "Sem Mudanca", tipo: "MOTORISTA" },
      });
      await comoUsuario(f.usuarioDonoId);

      const fd = new FormData();
      fd.set("colaboradorId", colaborador.id);
      fd.set("nome", "Sem Mudanca");
      fd.set("tipo", "MOTORISTA");

      const resultado = await editarColaborador(null, fd);
      expect(resultado.ok).toBe(true);

      const logs = await prisma.logAuditoria.findMany({
        where: { graficaId: f.graficaId, acao: "configuracoes.editar_colaborador" },
      });
      expect(logs).toHaveLength(0);
    },
    TIMEOUT_MS
  );

  it(
    "isolamento multi-tenant: não encontra/edita colaborador de OUTRA gráfica",
    async () => {
      const f = await criarFixture();
      const outraFixture = await criarFixture();
      const colaboradorDeOutraGrafica = await prisma.colaborador.create({
        data: { graficaId: outraFixture.graficaId, nome: "Da Outra Grafica", tipo: "MOTORISTA" },
      });
      await comoUsuario(f.usuarioDonoId);

      const fd = new FormData();
      fd.set("colaboradorId", colaboradorDeOutraGrafica.id);
      fd.set("nome", "Tentativa de invasão");
      fd.set("tipo", "OUTRO");
      fd.set("tipoOutro", "hack");

      const resultado = await editarColaborador(null, fd);
      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toMatch(/não encontrado/i);

      const inalterado = await prisma.colaborador.findUniqueOrThrow({
        where: { id: colaboradorDeOutraGrafica.id },
      });
      expect(inalterado.nome).toBe("Da Outra Grafica");
    },
    TIMEOUT_MS
  );
});

describe("alternarAtivoColaborador (achado D1)", () => {
  it(
    "desativa e reativa, sem apagar o cadastro (nunca hard delete)",
    async () => {
      const f = await criarFixture();
      const colaborador = await prisma.colaborador.create({
        data: { graficaId: f.graficaId, nome: "Alterna Ativo", tipo: "MOTORISTA" },
      });
      await comoUsuario(f.usuarioDonoId);

      const fdDesativar = new FormData();
      fdDesativar.set("colaboradorId", colaborador.id);
      const resultadoDesativar = await alternarAtivoColaborador(null, fdDesativar);
      expect(resultadoDesativar.ok).toBe(true);
      expect(resultadoDesativar.mensagem).toMatch(/desativado/i);

      const desativado = await prisma.colaborador.findUniqueOrThrow({ where: { id: colaborador.id } });
      expect(desativado.ativo).toBe(false);

      const resultadoReativar = await alternarAtivoColaborador(null, fdDesativar);
      expect(resultadoReativar.ok).toBe(true);
      expect(resultadoReativar.mensagem).toMatch(/ativado/i);

      const reativado = await prisma.colaborador.findUniqueOrThrow({ where: { id: colaborador.id } });
      expect(reativado.ativo).toBe(true);

      const logs = await prisma.logAuditoria.findMany({
        where: {
          graficaId: f.graficaId,
          acao: { in: ["configuracoes.desativar_colaborador", "configuracoes.ativar_colaborador"] },
        },
      });
      expect(logs).toHaveLength(2);
    },
    TIMEOUT_MS
  );

  it(
    "isolamento multi-tenant: não desativa colaborador de OUTRA gráfica",
    async () => {
      const f = await criarFixture();
      const outraFixture = await criarFixture();
      const colaboradorDeOutraGrafica = await prisma.colaborador.create({
        data: { graficaId: outraFixture.graficaId, nome: "Intocavel", tipo: "MOTORISTA" },
      });
      await comoUsuario(f.usuarioDonoId);

      const fd = new FormData();
      fd.set("colaboradorId", colaboradorDeOutraGrafica.id);
      const resultado = await alternarAtivoColaborador(null, fd);
      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toMatch(/não encontrado/i);

      const inalterado = await prisma.colaborador.findUniqueOrThrow({
        where: { id: colaboradorDeOutraGrafica.id },
      });
      expect(inalterado.ativo).toBe(true);
    },
    TIMEOUT_MS
  );
});

describe("RBAC — OPERADOR sem permissão de CONFIGURACOES não consegue mexer em Colaborador", () => {
  it(
    "criarColaborador recusa e nada é criado",
    async () => {
      const f = await criarFixture();
      await comoUsuario(f.usuarioOperadorId);

      const fd = new FormData();
      fd.set("nome", "RBAC Teste");
      fd.set("tipo", "MOTORISTA");

      const resultado = await criarColaborador(null, fd);
      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toMatch(/não tem permissão/i);
      expect(redirectMock).not.toHaveBeenCalled();

      const criados = await prisma.colaborador.findMany({ where: { graficaId: f.graficaId } });
      expect(criados).toHaveLength(0);
    },
    TIMEOUT_MS
  );

  it(
    "editarColaborador recusa e nada muda",
    async () => {
      const f = await criarFixture();
      const colaborador = await prisma.colaborador.create({
        data: { graficaId: f.graficaId, nome: "RBAC Edicao", tipo: "MOTORISTA" },
      });
      await comoUsuario(f.usuarioOperadorId);

      const fd = new FormData();
      fd.set("colaboradorId", colaborador.id);
      fd.set("nome", "RBAC Edicao Alterada");
      fd.set("tipo", "MOTORISTA");

      const resultado = await editarColaborador(null, fd);
      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toMatch(/não tem permissão/i);

      const inalterado = await prisma.colaborador.findUniqueOrThrow({ where: { id: colaborador.id } });
      expect(inalterado.nome).toBe("RBAC Edicao");
    },
    TIMEOUT_MS
  );

  it(
    "alternarAtivoColaborador recusa",
    async () => {
      const f = await criarFixture();
      const colaborador = await prisma.colaborador.create({
        data: { graficaId: f.graficaId, nome: "RBAC Ativo", tipo: "MOTORISTA" },
      });
      await comoUsuario(f.usuarioOperadorId);

      const fd = new FormData();
      fd.set("colaboradorId", colaborador.id);
      const resultado = await alternarAtivoColaborador(null, fd);
      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toMatch(/não tem permissão/i);

      const inalterado = await prisma.colaborador.findUniqueOrThrow({ where: { id: colaborador.id } });
      expect(inalterado.ativo).toBe(true);
    },
    TIMEOUT_MS
  );
});
