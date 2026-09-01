import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de src/app/configuracoes/identidade/actions.test.ts) — cobre
// o achado F1 da Parte 7 da auditoria de abrangência
// (pesquisa-abrangencia-modulos.md, "F. Documento e transação"): cadastro do
// ferramental físico (faca, clichê, tela, matriz...), distinto de tudo que
// já existia no schema, que só guardava o CUSTO dele.
//
// SÓ RODA DE VERDADE depois que a migration
// prisma/migrations/20260901090000_ferramental/migration.sql tiver sido
// aplicada no banco (tabela "ferramentais" e a coluna
// "orcamento_itens"."ferramentalId" ainda não existem até lá).

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
  criarFerramental,
  editarFerramental,
  desativarFerramental,
  reativarFerramental,
} from "./actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

type Fixture = {
  graficaId: string;
  usuarioDonoId: string;
  usuarioOperadorId: string; // sem nenhuma PermissaoUsuario — nunca pode editar
  clienteId: string;
  outroClienteId: string;
  itemGraficaId: string;
};

const graficaIdsParaLimpar: string[] = [];

async function criarFixture(): Promise<Fixture> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Ferramental ${s}`, slug: `teste-ferramental-${s}` },
  });
  const usuarioDono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-ferramental-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
      emailVerificadoEm: new Date(),
    },
  });
  const usuarioOperador = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Operador ${s}`,
      email: `operador-ferramental-${s}@example.com`,
      senhaHash: "x",
      papel: "OPERADOR",
      emailVerificadoEm: new Date(),
    },
  });
  const cliente = await prisma.cliente.create({
    data: { graficaId: grafica.id, nome: `Cliente ${s}` },
  });
  const outroCliente = await prisma.cliente.create({
    data: { graficaId: grafica.id, nome: `Outro Cliente ${s}` },
  });
  const catalogo = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Embalagem", nome: `Caixa ${s}` },
  });
  const itemGrafica = await prisma.itemGrafica.create({
    data: { graficaId: grafica.id, itemCatalogoId: catalogo.id },
  });

  graficaIdsParaLimpar.push(grafica.id);

  return {
    graficaId: grafica.id,
    usuarioDonoId: usuarioDono.id,
    usuarioOperadorId: usuarioOperador.id,
    clienteId: cliente.id,
    outroClienteId: outroCliente.id,
    itemGraficaId: itemGrafica.id,
  };
}

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.orcamentoItem.deleteMany({ where: { orcamento: { graficaId } } });
    await prisma.ferramental.deleteMany({ where: { graficaId } });
    await prisma.itemGrafica.deleteMany({ where: { graficaId } });
    await prisma.itemCatalogo.deleteMany({ where: { graficaId } });
    await prisma.cliente.deleteMany({ where: { graficaId } });
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

describe("criarFerramental (achado F1)", () => {
  it(
    "DONO cria um ferramental da GRAFICA com sucesso e o log de auditoria é gravado",
    async () => {
      const f = await criarFixture();
      await comoUsuario(f.usuarioDonoId);

      const fd = new FormData();
      fd.set("codigo", "FC-0001");
      fd.set("tipo", "FACA_CORTE_VINCO");
      fd.set("descricao", "Faca da caixa modelo A");
      fd.set("proprietario", "GRAFICA");
      fd.set("itemGraficaId", f.itemGraficaId);
      fd.set("localizacao", "Armário 2");
      fd.set("status", "ATIVO");

      await expect(criarFerramental(null, fd)).rejects.toThrow(/^NEXT_REDIRECT:/);

      const novaId = (redirectMock.mock.calls[0][0] as string).split("/").pop()!;
      const ferramental = await prisma.ferramental.findUniqueOrThrow({ where: { id: novaId } });
      expect(ferramental.codigo).toBe("FC-0001");
      expect(ferramental.tipo).toBe("FACA_CORTE_VINCO");
      expect(ferramental.proprietario).toBe("GRAFICA");
      expect(ferramental.clienteId).toBeNull();
      expect(ferramental.itemGraficaId).toBe(f.itemGraficaId);
      expect(ferramental.status).toBe("ATIVO");
      expect(ferramental.desativadoEm).toBeNull();

      const logs = await prisma.logAuditoria.findMany({
        where: { graficaId: f.graficaId, acao: "configuracoes.criar_ferramental" },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0].entidadeId).toBe(novaId);
    },
    TIMEOUT_MS
  );

  it(
    "proprietario=CLIENTE grava o clienteId escolhido",
    async () => {
      const f = await criarFixture();
      await comoUsuario(f.usuarioDonoId);

      const fd = new FormData();
      fd.set("codigo", "CL-0001");
      fd.set("tipo", "CLICHE_FLEXO");
      fd.set("proprietario", "CLIENTE");
      fd.set("clienteId", f.clienteId);
      fd.set("status", "ATIVO");

      await expect(criarFerramental(null, fd)).rejects.toThrow(/^NEXT_REDIRECT:/);

      const novaId = (redirectMock.mock.calls[0][0] as string).split("/").pop()!;
      const ferramental = await prisma.ferramental.findUniqueOrThrow({ where: { id: novaId } });
      expect(ferramental.proprietario).toBe("CLIENTE");
      expect(ferramental.clienteId).toBe(f.clienteId);
    },
    TIMEOUT_MS
  );

  it(
    "proprietario=GRAFICA IGNORA um clienteId mandado pelo client — regra permanente 'tudo sensível no backend'",
    async () => {
      const f = await criarFixture();
      await comoUsuario(f.usuarioDonoId);

      const fd = new FormData();
      fd.set("codigo", "FC-0002");
      fd.set("tipo", "FACA_CORTE_VINCO");
      fd.set("proprietario", "GRAFICA");
      fd.set("clienteId", f.clienteId); // tentativa de forçar um dono mesmo com proprietario=GRAFICA
      fd.set("status", "ATIVO");

      await expect(criarFerramental(null, fd)).rejects.toThrow(/^NEXT_REDIRECT:/);

      const novaId = (redirectMock.mock.calls[0][0] as string).split("/").pop()!;
      const ferramental = await prisma.ferramental.findUniqueOrThrow({ where: { id: novaId } });
      expect(ferramental.clienteId).toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "rejeita proprietario=CLIENTE sem clienteId",
    async () => {
      const f = await criarFixture();
      await comoUsuario(f.usuarioDonoId);

      const fd = new FormData();
      fd.set("codigo", "CL-0002");
      fd.set("tipo", "CLICHE_FLEXO");
      fd.set("proprietario", "CLIENTE");
      fd.set("status", "ATIVO");

      const resultado = await criarFerramental(null, fd);
      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toMatch(/selecione o cliente/i);
      expect(redirectMock).not.toHaveBeenCalled();

      const criados = await prisma.ferramental.findMany({ where: { graficaId: f.graficaId } });
      expect(criados).toHaveLength(0);
    },
    TIMEOUT_MS
  );

  it(
    "rejeita clienteId de OUTRA gráfica (isolamento de tenant)",
    async () => {
      const f = await criarFixture();
      const outraFixture = await criarFixture();
      await comoUsuario(f.usuarioDonoId);

      const fd = new FormData();
      fd.set("codigo", "CL-0003");
      fd.set("tipo", "CLICHE_FLEXO");
      fd.set("proprietario", "CLIENTE");
      fd.set("clienteId", outraFixture.clienteId); // cliente de outra gráfica
      fd.set("status", "ATIVO");

      const resultado = await criarFerramental(null, fd);
      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toMatch(/cliente não encontrado/i);
    },
    TIMEOUT_MS
  );

  it(
    "tipo=OUTRO exige tipoOutro",
    async () => {
      const f = await criarFixture();
      await comoUsuario(f.usuarioDonoId);

      const fd = new FormData();
      fd.set("codigo", "OT-0001");
      fd.set("tipo", "OUTRO");
      fd.set("proprietario", "GRAFICA");
      fd.set("status", "ATIVO");

      const resultado = await criarFerramental(null, fd);
      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toMatch(/descreva o tipo/i);
    },
    TIMEOUT_MS
  );

  it(
    "código duplicado na MESMA gráfica é rejeitado",
    async () => {
      const f = await criarFixture();
      await prisma.ferramental.create({
        data: { graficaId: f.graficaId, tipo: "FACA_CORTE_VINCO", codigo: "DUP-0001" },
      });
      await comoUsuario(f.usuarioDonoId);

      const fd = new FormData();
      fd.set("codigo", "DUP-0001");
      fd.set("tipo", "CLICHE_FLEXO");
      fd.set("proprietario", "GRAFICA");
      fd.set("status", "ATIVO");

      const resultado = await criarFerramental(null, fd);
      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toMatch(/já existe/i);
    },
    TIMEOUT_MS
  );

  it(
    "o MESMO código em gráficas DIFERENTES é permitido (unicidade escopada por tenant)",
    async () => {
      const f = await criarFixture();
      const outraFixture = await criarFixture();
      await prisma.ferramental.create({
        data: { graficaId: outraFixture.graficaId, tipo: "FACA_CORTE_VINCO", codigo: "IGUAL-0001" },
      });
      await comoUsuario(f.usuarioDonoId);

      const fd = new FormData();
      fd.set("codigo", "IGUAL-0001");
      fd.set("tipo", "FACA_CORTE_VINCO");
      fd.set("proprietario", "GRAFICA");
      fd.set("status", "ATIVO");

      await expect(criarFerramental(null, fd)).rejects.toThrow(/^NEXT_REDIRECT:/);
    },
    TIMEOUT_MS
  );
});

describe("editarFerramental (achado F1)", () => {
  it(
    "atualiza campos e registra diff no log de auditoria",
    async () => {
      const f = await criarFixture();
      const ferramental = await prisma.ferramental.create({
        data: { graficaId: f.graficaId, tipo: "FACA_CORTE_VINCO", codigo: "ED-0001" },
      });
      await comoUsuario(f.usuarioDonoId);

      const fd = new FormData();
      fd.set("ferramentalId", ferramental.id);
      fd.set("codigo", "ED-0001-B");
      fd.set("tipo", "CLICHE_FLEXO");
      fd.set("proprietario", "GRAFICA");
      fd.set("status", "EM_MANUTENCAO");
      fd.set("tiragensAcumuladas", "150");

      const resultado = await editarFerramental(null, fd);
      expect(resultado.ok).toBe(true);

      const atualizado = await prisma.ferramental.findUniqueOrThrow({ where: { id: ferramental.id } });
      expect(atualizado.codigo).toBe("ED-0001-B");
      expect(atualizado.tipo).toBe("CLICHE_FLEXO");
      expect(atualizado.status).toBe("EM_MANUTENCAO");
      expect(atualizado.tiragensAcumuladas).toBe(150);

      const logs = await prisma.logAuditoria.findMany({
        where: { graficaId: f.graficaId, acao: "configuracoes.editar_ferramental" },
      });
      expect(logs).toHaveLength(1);
    },
    TIMEOUT_MS
  );

  it(
    "sem nenhuma mudança real não grava log de auditoria",
    async () => {
      const f = await criarFixture();
      const ferramental = await prisma.ferramental.create({
        data: { graficaId: f.graficaId, tipo: "FACA_CORTE_VINCO", codigo: "ED-0002" },
      });
      await comoUsuario(f.usuarioDonoId);

      const fd = new FormData();
      fd.set("ferramentalId", ferramental.id);
      fd.set("codigo", "ED-0002");
      fd.set("tipo", "FACA_CORTE_VINCO");
      fd.set("proprietario", "GRAFICA");
      fd.set("status", "ATIVO");
      fd.set("tiragensAcumuladas", "0");

      const resultado = await editarFerramental(null, fd);
      expect(resultado.ok).toBe(true);

      const logs = await prisma.logAuditoria.findMany({
        where: { graficaId: f.graficaId, acao: "configuracoes.editar_ferramental" },
      });
      expect(logs).toHaveLength(0);
    },
    TIMEOUT_MS
  );
});

describe("desativarFerramental / reativarFerramental (achado F1)", () => {
  it(
    "desativa (soft delete reversível) e reativa, sem apagar o cadastro",
    async () => {
      const f = await criarFixture();
      const ferramental = await prisma.ferramental.create({
        data: { graficaId: f.graficaId, tipo: "FACA_CORTE_VINCO", codigo: "DS-0001" },
      });
      await comoUsuario(f.usuarioDonoId);

      const fdDesativar = new FormData();
      fdDesativar.set("ferramentalId", ferramental.id);
      const resultadoDesativar = await desativarFerramental(null, fdDesativar);
      expect(resultadoDesativar.ok).toBe(true);

      const desativado = await prisma.ferramental.findUniqueOrThrow({ where: { id: ferramental.id } });
      expect(desativado.desativadoEm).not.toBeNull();

      const fdReativar = new FormData();
      fdReativar.set("ferramentalId", ferramental.id);
      const resultadoReativar = await reativarFerramental(null, fdReativar);
      expect(resultadoReativar.ok).toBe(true);

      const reativado = await prisma.ferramental.findUniqueOrThrow({ where: { id: ferramental.id } });
      expect(reativado.desativadoEm).toBeNull();

      const logs = await prisma.logAuditoria.findMany({
        where: {
          graficaId: f.graficaId,
          acao: { in: ["configuracoes.desativar_ferramental", "configuracoes.reativar_ferramental"] },
        },
      });
      expect(logs).toHaveLength(2);
    },
    TIMEOUT_MS
  );
});

describe("RBAC — OPERADOR sem permissão de CONFIGURACOES não consegue mexer em Ferramental", () => {
  it(
    "criarFerramental recusa e nada é criado",
    async () => {
      const f = await criarFixture();
      await comoUsuario(f.usuarioOperadorId);

      const fd = new FormData();
      fd.set("codigo", "RBAC-0001");
      fd.set("tipo", "FACA_CORTE_VINCO");
      fd.set("proprietario", "GRAFICA");
      fd.set("status", "ATIVO");

      const resultado = await criarFerramental(null, fd);
      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toMatch(/não tem permissão/i);
      expect(redirectMock).not.toHaveBeenCalled();

      const criados = await prisma.ferramental.findMany({ where: { graficaId: f.graficaId } });
      expect(criados).toHaveLength(0);
    },
    TIMEOUT_MS
  );

  it(
    "editarFerramental recusa e nada muda",
    async () => {
      const f = await criarFixture();
      const ferramental = await prisma.ferramental.create({
        data: { graficaId: f.graficaId, tipo: "FACA_CORTE_VINCO", codigo: "RBAC-0002" },
      });
      await comoUsuario(f.usuarioOperadorId);

      const fd = new FormData();
      fd.set("ferramentalId", ferramental.id);
      fd.set("codigo", "RBAC-0002-ALTERADO");
      fd.set("tipo", "FACA_CORTE_VINCO");
      fd.set("proprietario", "GRAFICA");
      fd.set("status", "ATIVO");

      const resultado = await editarFerramental(null, fd);
      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toMatch(/não tem permissão/i);

      const inalterado = await prisma.ferramental.findUniqueOrThrow({ where: { id: ferramental.id } });
      expect(inalterado.codigo).toBe("RBAC-0002");
    },
    TIMEOUT_MS
  );

  it(
    "desativarFerramental recusa",
    async () => {
      const f = await criarFixture();
      const ferramental = await prisma.ferramental.create({
        data: { graficaId: f.graficaId, tipo: "FACA_CORTE_VINCO", codigo: "RBAC-0003" },
      });
      await comoUsuario(f.usuarioOperadorId);

      const fd = new FormData();
      fd.set("ferramentalId", ferramental.id);
      const resultado = await desativarFerramental(null, fd);
      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toMatch(/não tem permissão/i);

      const inalterado = await prisma.ferramental.findUniqueOrThrow({ where: { id: ferramental.id } });
      expect(inalterado.desativadoEm).toBeNull();
    },
    TIMEOUT_MS
  );
});
