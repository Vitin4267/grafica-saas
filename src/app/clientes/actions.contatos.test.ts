import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de src/app/clientes/actions.desativacao-lgpd.test.ts) — cobre
// o achado A4 da Parte 5 da auditoria de abrangência
// (pesquisa-abrangencia-modulos.md): cadastro de contatos de um Cliente
// Pessoa Jurídica (ContatoCliente) + seleção de um contato no orçamento
// (Orcamento.contatoClienteId), convivendo com o snapshot em texto
// contatoNome/contatoEmail que já existia.
//
// SÓ RODA DE VERDADE depois que a migration
// prisma/migrations/20260827170000_contato_cliente/migration.sql tiver sido
// aplicada no banco (tabela contatos_cliente e a coluna
// orcamentos.contatoClienteId ainda não existem até lá) — ver relatório
// final da tarefa.
//
// exigirUsuarioAutenticado/exigirEmailVerificado/exigirAssinaturaAtiva são
// mockados porque dependem de cookies()/headers() de uma requisição Next.js
// de verdade, que não existe rodando a action direto — mesmo motivo dos
// arquivos citados acima. A checagem de permissão de módulo
// (podeEditarModulo) roda de verdade contra o banco.
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
import { criarContatoCliente, desativarContatoCliente } from "./actions";
import { editarDadosGeraisOrcamento } from "../orcamento/[id]/actions";

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
    data: { nome: `Teste Contato Cliente ${s}`, slug: `teste-contato-cliente-${s}` },
  });
  const usuarioDono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-contato-cliente-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const usuarioOperador = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Operador ${s}`,
      email: `operador-contato-cliente-${s}@example.com`,
      senhaHash: "x",
      papel: "OPERADOR",
    },
  });
  // Sem PermissaoUsuario pra CLIENTES — de propósito, prova o bloqueio de
  // OPERADOR sem permissão (mesmo padrão de actions.desativacao-lgpd.test.ts).

  const cliente = await prisma.cliente.create({
    data: { graficaId: grafica.id, nome: `Cliente PJ ${s}` },
  });

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
    await prisma.contatoCliente.deleteMany({ where: { cliente: { graficaId } } });
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.permissaoUsuario.deleteMany({ where: { usuario: { graficaId } } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
}, TIMEOUT_MS);

describe("criarContatoCliente", () => {
  it(
    "marcar um contato como principal desmarca o principal anterior do mesmo cliente",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioDonoId)) as never
      );

      const primeiro = await criarContatoCliente(
        null,
        formDataDe({
          clienteId: fixture.clienteId,
          nome: "Ana Compras",
          cargo: "",
          departamento: "",
          email: "ana@exemplo.com",
          telefone: "",
          whatsapp: "",
          funcao: "COMPRADOR",
          principal: "on",
        })
      );
      expect(primeiro.ok).toBe(true);

      const contatoAna = await prisma.contatoCliente.findFirstOrThrow({
        where: { clienteId: fixture.clienteId, nome: "Ana Compras" },
      });
      expect(contatoAna.principal).toBe(true);

      const segundo = await criarContatoCliente(
        null,
        formDataDe({
          clienteId: fixture.clienteId,
          nome: "Bruno Financeiro",
          cargo: "",
          departamento: "",
          email: "bruno@exemplo.com",
          telefone: "",
          whatsapp: "",
          funcao: "FINANCEIRO",
          principal: "on",
        })
      );
      expect(segundo.ok).toBe(true);

      const anaDepois = await prisma.contatoCliente.findUniqueOrThrow({ where: { id: contatoAna.id } });
      const contatoBruno = await prisma.contatoCliente.findFirstOrThrow({
        where: { clienteId: fixture.clienteId, nome: "Bruno Financeiro" },
      });
      expect(anaDepois.principal).toBe(false);
      expect(contatoBruno.principal).toBe(true);

      // Nunca mais de 1 principal simultâneo pro mesmo cliente.
      const totalPrincipais = await prisma.contatoCliente.count({
        where: { clienteId: fixture.clienteId, principal: true },
      });
      expect(totalPrincipais).toBe(1);
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

      const resultado = await criarContatoCliente(
        null,
        formDataDe({ clienteId: fixture.clienteId, nome: "Carla Recepção", funcao: "RECEBIMENTO" })
      );
      expect(resultado.ok).toBe(false);

      const total = await prisma.contatoCliente.count({ where: { clienteId: fixture.clienteId } });
      expect(total).toBe(0);
    },
    TIMEOUT_MS
  );
});

describe("desativarContatoCliente (soft-delete)", () => {
  it(
    "contato desativado some da lista de ativos, mas continua existindo",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioDonoId)) as never
      );

      await criarContatoCliente(
        null,
        formDataDe({
          clienteId: fixture.clienteId,
          nome: "Diana Arte",
          cargo: "",
          departamento: "",
          email: "",
          telefone: "",
          whatsapp: "",
          funcao: "APROVACAO_ARTE",
        })
      );
      const contato = await prisma.contatoCliente.findFirstOrThrow({
        where: { clienteId: fixture.clienteId, nome: "Diana Arte" },
      });

      const resultado = await desativarContatoCliente(null, formDataDe({ contatoId: contato.id }));
      expect(resultado.ok).toBe(true);

      // Mesma query que o <select> do orçamento usa (ver
      // src/app/orcamento/[id]/page.tsx) — contato desativado não pode
      // aparecer aqui.
      const ativos = await prisma.contatoCliente.findMany({
        where: { clienteId: fixture.clienteId, ativo: true },
      });
      expect(ativos.find((c) => c.id === contato.id)).toBeUndefined();

      // Mas o registro em si não foi apagado — soft-delete, nunca hard delete.
      const contatoDepois = await prisma.contatoCliente.findUniqueOrThrow({ where: { id: contato.id } });
      expect(contatoDepois.ativo).toBe(false);
      expect(contatoDepois.nome).toBe("Diana Arte");
    },
    TIMEOUT_MS
  );
});

describe("editarDadosGeraisOrcamento com contatoClienteId", () => {
  it(
    "escolher um contato cadastrado preenche o snapshot contatoNome/contatoEmail e grava o vínculo",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioDonoId)) as never
      );

      await criarContatoCliente(
        null,
        formDataDe({
          clienteId: fixture.clienteId,
          nome: "Elisa Financeiro",
          cargo: "",
          departamento: "",
          email: "elisa@exemplo.com",
          telefone: "",
          whatsapp: "",
          funcao: "FINANCEIRO",
        })
      );
      const contato = await prisma.contatoCliente.findFirstOrThrow({
        where: { clienteId: fixture.clienteId, nome: "Elisa Financeiro" },
      });

      // Simula o que o <select> em EditarDadosGeraisOrcamentoForm.tsx faz no
      // cliente: ao escolher o contato, pré-preenche nome/e-mail no próprio
      // form antes de submeter — o servidor recebe os 3 campos já
      // preenchidos, mas ainda assim RE-VALIDA o vínculo (nunca confia no
      // texto solto pra decidir o que gravar em contatoClienteId).
      const resultado = await editarDadosGeraisOrcamento(
        null,
        formDataDe({
          orcamentoId: fixture.orcamentoId,
          contatoClienteId: contato.id,
          contatoNome: contato.nome,
          contatoEmail: contato.email ?? "",
        })
      );
      expect(resultado.ok).toBe(true);

      const orcamento = await prisma.orcamento.findUniqueOrThrow({ where: { id: fixture.orcamentoId } });
      expect(orcamento.contatoClienteId).toBe(contato.id);
      expect(orcamento.contatoNome).toBe("Elisa Financeiro");
      expect(orcamento.contatoEmail).toBe("elisa@exemplo.com");
    },
    TIMEOUT_MS
  );

  it(
    "digitação manual sem escolher contato (comportamento de hoje) continua funcionando, contatoClienteId fica null",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioDonoId)) as never
      );

      const resultado = await editarDadosGeraisOrcamento(
        null,
        formDataDe({
          orcamentoId: fixture.orcamentoId,
          contatoNome: "Fulano Digitado à Mão",
          contatoEmail: "fulano@exemplo.com",
        })
      );
      expect(resultado.ok).toBe(true);

      const orcamento = await prisma.orcamento.findUniqueOrThrow({ where: { id: fixture.orcamentoId } });
      expect(orcamento.contatoClienteId).toBeNull();
      expect(orcamento.contatoNome).toBe("Fulano Digitado à Mão");
      expect(orcamento.contatoEmail).toBe("fulano@exemplo.com");
    },
    TIMEOUT_MS
  );

  it(
    "rejeita um contatoClienteId que pertence a outro cliente (nunca confia no id cru do form)",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);
      const outroCliente = await prisma.cliente.create({
        data: { graficaId: fixture.graficaId, nome: `Outro Cliente ${sufixo()}` },
      });

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioDonoId)) as never
      );

      await criarContatoCliente(
        null,
        formDataDe({
          clienteId: outroCliente.id,
          nome: "Contato de Outro Cliente",
          cargo: "",
          departamento: "",
          email: "",
          telefone: "",
          whatsapp: "",
          funcao: "COMPRADOR",
        })
      );
      const contatoAlheio = await prisma.contatoCliente.findFirstOrThrow({
        where: { clienteId: outroCliente.id },
      });

      const resultado = await editarDadosGeraisOrcamento(
        null,
        formDataDe({ orcamentoId: fixture.orcamentoId, contatoClienteId: contatoAlheio.id })
      );
      expect(resultado.ok).toBe(false);

      const orcamento = await prisma.orcamento.findUniqueOrThrow({ where: { id: fixture.orcamentoId } });
      expect(orcamento.contatoClienteId).toBeNull();
    },
    TIMEOUT_MS
  );
});
