import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de src/app/configuracoes/ferramentais/actions.test.ts) — cobre
// o achado D2 da Parte 7 da auditoria de abrangência
// (pesquisa-abrangencia-modulos.md, "D. Equipe e prestadores externos"):
// cadastro do prestador de serviço recorrente (acabamento terceirizado,
// logística, design), distinto de Fornecedor (que é só compra de material).
//
// SÓ RODA DE VERDADE depois que a migration
// prisma/migrations/20260904130000_prestador_servico/migration.sql tiver
// sido aplicada no banco (tabela "prestadores_servico" ainda não existe até
// lá).

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
import {
  criarPrestadorServico,
  editarPrestadorServico,
  alternarAtivoPrestadorServico,
} from "./actions";

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
    data: { nome: `Teste Prestador ${s}`, slug: `teste-prestador-${s}` },
  });
  const usuarioDono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-prestador-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
      emailVerificadoEm: new Date(),
    },
  });
  const usuarioOperador = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Operador ${s}`,
      email: `operador-prestador-${s}@example.com`,
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
    await prisma.despesa.deleteMany({ where: { graficaId } });
    await prisma.prestadorServico.deleteMany({ where: { graficaId } });
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

describe("criarPrestadorServico (achado D2)", () => {
  it(
    "DONO cria um prestador de serviço da GRAFICA com sucesso e o log de auditoria é gravado",
    async () => {
      const f = await criarFixture();
      await comoUsuario(f.usuarioDonoId);

      const fd = new FormData();
      fd.set("nome", "Laminadora Silva");
      fd.set("tipo", "ACABAMENTO");
      fd.set("documento", "12345678000199");
      fd.set("telefone", "(11) 99999-0000");
      fd.set("email", "contato@laminadorasilva.com.br");
      fd.set("observacoes", "Prazo de 3 dias úteis");

      await expect(criarPrestadorServico(null, fd)).rejects.toThrow(/^NEXT_REDIRECT:/);

      const novaId = (redirectMock.mock.calls[0][0] as string).split("/").pop()!;
      const prestador = await prisma.prestadorServico.findUniqueOrThrow({ where: { id: novaId } });
      expect(prestador.nome).toBe("Laminadora Silva");
      expect(prestador.tipo).toBe("ACABAMENTO");
      expect(prestador.documento).toBe("12345678000199");
      expect(prestador.telefone).toBe("(11) 99999-0000");
      expect(prestador.email).toBe("contato@laminadorasilva.com.br");
      expect(prestador.ativo).toBe(true);
      expect(prestador.graficaId).toBe(f.graficaId);

      const logs = await prisma.logAuditoria.findMany({
        where: { graficaId: f.graficaId, acao: "configuracoes.criar_prestador_servico" },
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
      fd.set("nome", "Zé do Frete");
      fd.set("tipo", "OUTRO");

      const resultado = await criarPrestadorServico(null, fd);
      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toMatch(/descreva o tipo/i);

      const criados = await prisma.prestadorServico.findMany({ where: { graficaId: f.graficaId } });
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
      fd.set("nome", "Manutenção Rápida");
      fd.set("tipo", "OUTRO");
      fd.set("tipoOutro", "Manutenção de máquina");

      await expect(criarPrestadorServico(null, fd)).rejects.toThrow(/^NEXT_REDIRECT:/);
      const novaId = (redirectMock.mock.calls[0][0] as string).split("/").pop()!;
      const prestador = await prisma.prestadorServico.findUniqueOrThrow({ where: { id: novaId } });
      expect(prestador.tipo).toBe("OUTRO");
      expect(prestador.tipoOutro).toBe("Manutenção de máquina");
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
      fd.set("tipo", "DESIGN");

      const resultado = await criarPrestadorServico(null, fd);
      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toMatch(/informe um nome/i);
    },
    TIMEOUT_MS
  );

  it(
    "nome duplicado na MESMA gráfica é rejeitado",
    async () => {
      const f = await criarFixture();
      await prisma.prestadorServico.create({
        data: { graficaId: f.graficaId, nome: "Duplicado LTDA", tipo: "LOGISTICA" },
      });
      await comoUsuario(f.usuarioDonoId);

      const fd = new FormData();
      fd.set("nome", "Duplicado LTDA");
      fd.set("tipo", "DESIGN");

      const resultado = await criarPrestadorServico(null, fd);
      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toMatch(/já existe/i);
    },
    TIMEOUT_MS
  );

  it(
    "o MESMO nome em gráficas DIFERENTES é permitido (unicidade escopada por tenant)",
    async () => {
      const f = await criarFixture();
      const outraFixture = await criarFixture();
      await prisma.prestadorServico.create({
        data: { graficaId: outraFixture.graficaId, nome: "Igual LTDA", tipo: "LOGISTICA" },
      });
      await comoUsuario(f.usuarioDonoId);

      const fd = new FormData();
      fd.set("nome", "Igual LTDA");
      fd.set("tipo", "LOGISTICA");

      await expect(criarPrestadorServico(null, fd)).rejects.toThrow(/^NEXT_REDIRECT:/);
    },
    TIMEOUT_MS
  );
});

describe("editarPrestadorServico (achado D2)", () => {
  it(
    "atualiza campos e registra diff no log de auditoria",
    async () => {
      const f = await criarFixture();
      const prestador = await prisma.prestadorServico.create({
        data: { graficaId: f.graficaId, nome: "Design Freela", tipo: "DESIGN" },
      });
      await comoUsuario(f.usuarioDonoId);

      const fd = new FormData();
      fd.set("prestadorServicoId", prestador.id);
      fd.set("nome", "Design Freela Editado");
      fd.set("tipo", "ACABAMENTO");
      fd.set("telefone", "(11) 98888-0000");

      const resultado = await editarPrestadorServico(null, fd);
      expect(resultado.ok).toBe(true);

      const atualizado = await prisma.prestadorServico.findUniqueOrThrow({
        where: { id: prestador.id },
      });
      expect(atualizado.nome).toBe("Design Freela Editado");
      expect(atualizado.tipo).toBe("ACABAMENTO");
      expect(atualizado.telefone).toBe("(11) 98888-0000");

      const logs = await prisma.logAuditoria.findMany({
        where: { graficaId: f.graficaId, acao: "configuracoes.editar_prestador_servico" },
      });
      expect(logs).toHaveLength(1);
    },
    TIMEOUT_MS
  );

  it(
    "sem nenhuma mudança real não grava log de auditoria",
    async () => {
      const f = await criarFixture();
      const prestador = await prisma.prestadorServico.create({
        data: { graficaId: f.graficaId, nome: "Sem Mudanca", tipo: "LOGISTICA" },
      });
      await comoUsuario(f.usuarioDonoId);

      const fd = new FormData();
      fd.set("prestadorServicoId", prestador.id);
      fd.set("nome", "Sem Mudanca");
      fd.set("tipo", "LOGISTICA");

      const resultado = await editarPrestadorServico(null, fd);
      expect(resultado.ok).toBe(true);

      const logs = await prisma.logAuditoria.findMany({
        where: { graficaId: f.graficaId, acao: "configuracoes.editar_prestador_servico" },
      });
      expect(logs).toHaveLength(0);
    },
    TIMEOUT_MS
  );

  it(
    "isolamento multi-tenant: não encontra/edita prestador de OUTRA gráfica",
    async () => {
      const f = await criarFixture();
      const outraFixture = await criarFixture();
      const prestadorDeOutraGrafica = await prisma.prestadorServico.create({
        data: { graficaId: outraFixture.graficaId, nome: "Da Outra Grafica", tipo: "DESIGN" },
      });
      await comoUsuario(f.usuarioDonoId);

      const fd = new FormData();
      fd.set("prestadorServicoId", prestadorDeOutraGrafica.id);
      fd.set("nome", "Tentativa de invasão");
      fd.set("tipo", "OUTRO");
      fd.set("tipoOutro", "hack");

      const resultado = await editarPrestadorServico(null, fd);
      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toMatch(/não encontrado/i);

      const inalterado = await prisma.prestadorServico.findUniqueOrThrow({
        where: { id: prestadorDeOutraGrafica.id },
      });
      expect(inalterado.nome).toBe("Da Outra Grafica");
    },
    TIMEOUT_MS
  );
});

describe("alternarAtivoPrestadorServico (achado D2)", () => {
  it(
    "desativa e reativa, sem apagar o cadastro (nunca hard delete)",
    async () => {
      const f = await criarFixture();
      const prestador = await prisma.prestadorServico.create({
        data: { graficaId: f.graficaId, nome: "Alterna Ativo", tipo: "ACABAMENTO" },
      });
      await comoUsuario(f.usuarioDonoId);

      const fdDesativar = new FormData();
      fdDesativar.set("prestadorServicoId", prestador.id);
      const resultadoDesativar = await alternarAtivoPrestadorServico(null, fdDesativar);
      expect(resultadoDesativar.ok).toBe(true);
      expect(resultadoDesativar.mensagem).toMatch(/desativado/i);

      const desativado = await prisma.prestadorServico.findUniqueOrThrow({
        where: { id: prestador.id },
      });
      expect(desativado.ativo).toBe(false);

      const resultadoReativar = await alternarAtivoPrestadorServico(null, fdDesativar);
      expect(resultadoReativar.ok).toBe(true);
      expect(resultadoReativar.mensagem).toMatch(/ativado/i);

      const reativado = await prisma.prestadorServico.findUniqueOrThrow({
        where: { id: prestador.id },
      });
      expect(reativado.ativo).toBe(true);

      const logs = await prisma.logAuditoria.findMany({
        where: {
          graficaId: f.graficaId,
          acao: {
            in: [
              "configuracoes.desativar_prestador_servico",
              "configuracoes.ativar_prestador_servico",
            ],
          },
        },
      });
      expect(logs).toHaveLength(2);
    },
    TIMEOUT_MS
  );

  it(
    "isolamento multi-tenant: não desativa prestador de OUTRA gráfica",
    async () => {
      const f = await criarFixture();
      const outraFixture = await criarFixture();
      const prestadorDeOutraGrafica = await prisma.prestadorServico.create({
        data: { graficaId: outraFixture.graficaId, nome: "Intocavel", tipo: "LOGISTICA" },
      });
      await comoUsuario(f.usuarioDonoId);

      const fd = new FormData();
      fd.set("prestadorServicoId", prestadorDeOutraGrafica.id);
      const resultado = await alternarAtivoPrestadorServico(null, fd);
      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toMatch(/não encontrado/i);

      const inalterado = await prisma.prestadorServico.findUniqueOrThrow({
        where: { id: prestadorDeOutraGrafica.id },
      });
      expect(inalterado.ativo).toBe(true);
    },
    TIMEOUT_MS
  );
});

describe("RBAC — OPERADOR sem permissão de CONFIGURACOES não consegue mexer em PrestadorServico", () => {
  it(
    "criarPrestadorServico recusa e nada é criado",
    async () => {
      const f = await criarFixture();
      await comoUsuario(f.usuarioOperadorId);

      const fd = new FormData();
      fd.set("nome", "RBAC Teste");
      fd.set("tipo", "ACABAMENTO");

      const resultado = await criarPrestadorServico(null, fd);
      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toMatch(/não tem permissão/i);
      expect(redirectMock).not.toHaveBeenCalled();

      const criados = await prisma.prestadorServico.findMany({ where: { graficaId: f.graficaId } });
      expect(criados).toHaveLength(0);
    },
    TIMEOUT_MS
  );

  it(
    "editarPrestadorServico recusa e nada muda",
    async () => {
      const f = await criarFixture();
      const prestador = await prisma.prestadorServico.create({
        data: { graficaId: f.graficaId, nome: "RBAC Edicao", tipo: "ACABAMENTO" },
      });
      await comoUsuario(f.usuarioOperadorId);

      const fd = new FormData();
      fd.set("prestadorServicoId", prestador.id);
      fd.set("nome", "RBAC Edicao Alterada");
      fd.set("tipo", "ACABAMENTO");

      const resultado = await editarPrestadorServico(null, fd);
      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toMatch(/não tem permissão/i);

      const inalterado = await prisma.prestadorServico.findUniqueOrThrow({ where: { id: prestador.id } });
      expect(inalterado.nome).toBe("RBAC Edicao");
    },
    TIMEOUT_MS
  );

  it(
    "alternarAtivoPrestadorServico recusa",
    async () => {
      const f = await criarFixture();
      const prestador = await prisma.prestadorServico.create({
        data: { graficaId: f.graficaId, nome: "RBAC Ativo", tipo: "ACABAMENTO" },
      });
      await comoUsuario(f.usuarioOperadorId);

      const fd = new FormData();
      fd.set("prestadorServicoId", prestador.id);
      const resultado = await alternarAtivoPrestadorServico(null, fd);
      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toMatch(/não tem permissão/i);

      const inalterado = await prisma.prestadorServico.findUniqueOrThrow({ where: { id: prestador.id } });
      expect(inalterado.ativo).toBe(true);
    },
    TIMEOUT_MS
  );
});
