import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de src/app/clientes/actions.contatos.test.ts) — cobre o
// achado A5 da Parte 5 da auditoria de abrangência
// (pesquisa-abrangencia-modulos.md): cadastro de endereços adicionais de um
// Cliente (EnderecoCliente, tipo PRINCIPAL/COBRANCA/ENTREGA) + seleção de um
// endereço de entrega no orçamento (Orcamento.enderecoEntregaId), convivendo
// com o snapshot em texto livre localEntrega que já existia.
//
// SÓ RODA DE VERDADE depois que a migration
// prisma/migrations/20260829110000_endereco_cliente/migration.sql tiver sido
// aplicada no banco (tabela enderecos_cliente e a coluna
// orcamentos.enderecoEntregaId ainda não existem até lá) — ver relatório
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
import { criarEnderecoCliente, desativarEnderecoCliente } from "./actions";
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
    data: { nome: `Teste Endereço Cliente ${s}`, slug: `teste-endereco-cliente-${s}` },
  });
  const usuarioDono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-endereco-cliente-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const usuarioOperador = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Operador ${s}`,
      email: `operador-endereco-cliente-${s}@example.com`,
      senhaHash: "x",
      papel: "OPERADOR",
    },
  });
  // Sem PermissaoUsuario pra CLIENTES — de propósito, prova o bloqueio de
  // OPERADOR sem permissão (mesmo padrão de actions.contatos.test.ts).

  const cliente = await prisma.cliente.create({
    data: { graficaId: grafica.id, nome: `Cliente Endereços ${s}` },
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

// Um <form> de verdade sempre submete um valor pra cada <input> renderizado
// (mesmo vazio, como ""). formData.get() de uma chave nunca .set() devolve
// null, que quebra os campos .optional() do enderecoClienteSchema (zod
// espera undefined, não null) — mesmo bug já visto em
// actions.contatos.test.ts (rodada 12) e actions.dados-comerciais.test.ts
// (rodada 13). Base cobre todo campo opcional do schema com "".
function formDataEndereco(campos: Record<string, string>): FormData {
  return formDataDe({
    cep: "",
    logradouro: "",
    numero: "",
    complemento: "",
    bairro: "",
    municipio: "",
    codigoIbge: "",
    uf: "",
    contatoNome: "",
    contatoTelefone: "",
    instrucoesEntrega: "",
    ...campos,
  });
}

async function usuarioParaMock(usuarioId: string) {
  return prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } });
}

const graficaIdsParaLimpar: string[] = [];

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.logAuditoria.deleteMany({ where: { graficaId } });
    await prisma.orcamento.deleteMany({ where: { graficaId } });
    await prisma.enderecoCliente.deleteMany({ where: { cliente: { graficaId } } });
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.permissaoUsuario.deleteMany({ where: { usuario: { graficaId } } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
}, TIMEOUT_MS);

describe("criarEnderecoCliente", () => {
  it(
    "cadastra endereços de tipos diferentes (PRINCIPAL/COBRANCA/ENTREGA) pro mesmo cliente",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioDonoId)) as never
      );

      const principal = await criarEnderecoCliente(
        null,
        formDataEndereco({
          clienteId: fixture.clienteId,
          apelido: "Escritório São Paulo",
          tipo: "PRINCIPAL",
          municipio: "São Paulo",
          uf: "SP",
        })
      );
      expect(principal.ok).toBe(true);

      const cobranca = await criarEnderecoCliente(
        null,
        formDataEndereco({
          clienteId: fixture.clienteId,
          apelido: "Financeiro Matriz",
          tipo: "COBRANCA",
          municipio: "São Paulo",
          uf: "SP",
        })
      );
      expect(cobranca.ok).toBe(true);

      const entrega = await criarEnderecoCliente(
        null,
        formDataEndereco({
          clienteId: fixture.clienteId,
          apelido: "Fábrica Extrema",
          tipo: "ENTREGA",
          municipio: "Extrema",
          uf: "MG",
          contatoNome: "Portaria",
          contatoTelefone: "(35) 99999-0000",
          instrucoesEntrega: "Receber só de manhã, tocar interfone",
        })
      );
      expect(entrega.ok).toBe(true);

      const enderecos = await prisma.enderecoCliente.findMany({
        where: { clienteId: fixture.clienteId },
        orderBy: { tipo: "asc" },
      });
      expect(enderecos).toHaveLength(3);
      expect(enderecos.map((e) => e.tipo).sort()).toEqual(["COBRANCA", "ENTREGA", "PRINCIPAL"]);

      const enderecoEntrega = enderecos.find((e) => e.tipo === "ENTREGA");
      expect(enderecoEntrega?.municipio).toBe("Extrema");
      expect(enderecoEntrega?.instrucoesEntrega).toBe("Receber só de manhã, tocar interfone");
    },
    TIMEOUT_MS
  );

  it(
    "marcar um endereço como padrão desmarca o padrão anterior do MESMO tipo, mas não mexe em outro tipo",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioDonoId)) as never
      );

      // Endereço de cobrança padrão — não deve ser afetado pela disputa de
      // padrão entre os dois endereços de ENTREGA abaixo.
      const cobranca = await criarEnderecoCliente(
        null,
        formDataEndereco({
          clienteId: fixture.clienteId,
          apelido: "Financeiro Matriz",
          tipo: "COBRANCA",
          padrao: "on",
        })
      );
      expect(cobranca.ok).toBe(true);

      const primeiraEntrega = await criarEnderecoCliente(
        null,
        formDataEndereco({
          clienteId: fixture.clienteId,
          apelido: "Fábrica Extrema",
          tipo: "ENTREGA",
          padrao: "on",
        })
      );
      expect(primeiraEntrega.ok).toBe(true);

      const enderecoExtrema = await prisma.enderecoCliente.findFirstOrThrow({
        where: { clienteId: fixture.clienteId, apelido: "Fábrica Extrema" },
      });
      expect(enderecoExtrema.padrao).toBe(true);

      const segundaEntrega = await criarEnderecoCliente(
        null,
        formDataEndereco({
          clienteId: fixture.clienteId,
          apelido: "Loja Shopping Iguatemi",
          tipo: "ENTREGA",
          padrao: "on",
        })
      );
      expect(segundaEntrega.ok).toBe(true);

      const extremaDepois = await prisma.enderecoCliente.findUniqueOrThrow({ where: { id: enderecoExtrema.id } });
      const enderecoIguatemi = await prisma.enderecoCliente.findFirstOrThrow({
        where: { clienteId: fixture.clienteId, apelido: "Loja Shopping Iguatemi" },
      });
      expect(extremaDepois.padrao).toBe(false);
      expect(enderecoIguatemi.padrao).toBe(true);

      // Nunca mais de 1 padrão simultâneo por TIPO pro mesmo cliente.
      const padraoEntrega = await prisma.enderecoCliente.count({
        where: { clienteId: fixture.clienteId, tipo: "ENTREGA", padrao: true },
      });
      expect(padraoEntrega).toBe(1);

      // O padrão de COBRANCA não foi tocado pela disputa entre os 2 ENTREGA.
      const enderecoCobranca = await prisma.enderecoCliente.findFirstOrThrow({
        where: { clienteId: fixture.clienteId, tipo: "COBRANCA" },
      });
      expect(enderecoCobranca.padrao).toBe(true);
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

      const resultado = await criarEnderecoCliente(
        null,
        formDataEndereco({ clienteId: fixture.clienteId, apelido: "Fábrica Extrema", tipo: "ENTREGA" })
      );
      expect(resultado.ok).toBe(false);

      const total = await prisma.enderecoCliente.count({ where: { clienteId: fixture.clienteId } });
      expect(total).toBe(0);
    },
    TIMEOUT_MS
  );
});

describe("desativarEnderecoCliente (soft-delete)", () => {
  it(
    "endereço desativado some da lista de ativos, mas continua existindo — e é reversível",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioDonoId)) as never
      );

      await criarEnderecoCliente(
        null,
        formDataEndereco({ clienteId: fixture.clienteId, apelido: "Depósito Antigo", tipo: "ENTREGA" })
      );
      const endereco = await prisma.enderecoCliente.findFirstOrThrow({
        where: { clienteId: fixture.clienteId, apelido: "Depósito Antigo" },
      });

      const resultado = await desativarEnderecoCliente(null, formDataDe({ enderecoId: endereco.id }));
      expect(resultado.ok).toBe(true);

      // Mesma query que o <select> do orçamento usaria — endereço desativado
      // não pode aparecer aqui.
      const ativos = await prisma.enderecoCliente.findMany({
        where: { clienteId: fixture.clienteId, ativo: true },
      });
      expect(ativos.find((e) => e.id === endereco.id)).toBeUndefined();

      // Mas o registro em si não foi apagado — soft-delete, nunca hard delete.
      const enderecoDepois = await prisma.enderecoCliente.findUniqueOrThrow({ where: { id: endereco.id } });
      expect(enderecoDepois.ativo).toBe(false);
      expect(enderecoDepois.apelido).toBe("Depósito Antigo");
    },
    TIMEOUT_MS
  );
});

describe("editarDadosGeraisOrcamento com enderecoEntregaId", () => {
  it(
    "escolher um endereço cadastrado grava o vínculo, convivendo com o texto livre localEntrega",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioDonoId)) as never
      );

      await criarEnderecoCliente(
        null,
        formDataEndereco({
          clienteId: fixture.clienteId,
          apelido: "Fábrica Extrema",
          tipo: "ENTREGA",
          municipio: "Extrema",
          uf: "MG",
        })
      );
      const endereco = await prisma.enderecoCliente.findFirstOrThrow({
        where: { clienteId: fixture.clienteId, apelido: "Fábrica Extrema" },
      });

      // Simula o vendedor escolhendo o endereço cadastrado no <select> e o
      // pré-preenchimento do texto livre localEntrega no cliente — o
      // servidor ainda assim RE-VALIDA o vínculo (nunca confia no id cru).
      const resultado = await editarDadosGeraisOrcamento(
        null,
        formDataDe({
          orcamentoId: fixture.orcamentoId,
          enderecoEntregaId: endereco.id,
          localEntrega: "Fábrica Extrema — Extrema/MG, receber só de manhã",
        })
      );
      expect(resultado.ok).toBe(true);

      const orcamento = await prisma.orcamento.findUniqueOrThrow({ where: { id: fixture.orcamentoId } });
      expect(orcamento.enderecoEntregaId).toBe(endereco.id);
      expect(orcamento.localEntrega).toBe("Fábrica Extrema — Extrema/MG, receber só de manhã");
    },
    TIMEOUT_MS
  );

  it(
    "digitação manual sem escolher endereço (comportamento de hoje) continua funcionando, enderecoEntregaId fica null",
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
          localEntrega: "Entregar na portaria dos fundos, digitado à mão",
        })
      );
      expect(resultado.ok).toBe(true);

      const orcamento = await prisma.orcamento.findUniqueOrThrow({ where: { id: fixture.orcamentoId } });
      expect(orcamento.enderecoEntregaId).toBeNull();
      expect(orcamento.localEntrega).toBe("Entregar na portaria dos fundos, digitado à mão");
    },
    TIMEOUT_MS
  );

  it(
    "rejeita um enderecoEntregaId que pertence a outro cliente (nunca confia no id cru do form)",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);
      const outroCliente = await prisma.cliente.create({
        data: { graficaId: fixture.graficaId, nome: `Outro Cliente ${sufixo()}` },
      });

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioDonoId)) as never
      );

      await criarEnderecoCliente(
        null,
        formDataEndereco({ clienteId: outroCliente.id, apelido: "Endereço de Outro Cliente", tipo: "ENTREGA" })
      );
      const enderecoAlheio = await prisma.enderecoCliente.findFirstOrThrow({
        where: { clienteId: outroCliente.id },
      });

      const resultado = await editarDadosGeraisOrcamento(
        null,
        formDataDe({ orcamentoId: fixture.orcamentoId, enderecoEntregaId: enderecoAlheio.id })
      );
      expect(resultado.ok).toBe(false);

      const orcamento = await prisma.orcamento.findUniqueOrThrow({ where: { id: fixture.orcamentoId } });
      expect(orcamento.enderecoEntregaId).toBeNull();
    },
    TIMEOUT_MS
  );
});
