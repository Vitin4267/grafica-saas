import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de actions.desativacao-lgpd.test.ts) — cobre o achado A6 da
// Parte 5 da auditoria de abrangência (pesquisa-abrangencia-modulos.md):
// completa o achado A6 da Parte 4 (limiteCredito/prazoPagamentoPadraoDias,
// já existentes) com formaPagamentoPreferida, descontoPadraoPercent e
// observacaoFinanceira em Cliente.
//
// SÓ RODA DE VERDADE depois que a migration
// prisma/migrations/20260828120000_cliente_dados_comerciais/migration.sql
// tiver sido aplicada no banco (colunas formaPagamentoPreferida/
// descontoPadraoPercent/observacaoFinanceira ainda não existem na tabela
// "clientes" até lá) — ver relatório final da tarefa.
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
import { atualizarCliente } from "./actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

type Fixture = { graficaId: string; usuarioDonoId: string; clienteId: string };

const graficaIdsParaLimpar: string[] = [];

async function criarFixture(): Promise<Fixture> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Dados Comerciais Cliente ${s}`, slug: `teste-dados-comerciais-cliente-${s}` },
  });
  const usuarioDono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-dados-comerciais-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const cliente = await prisma.cliente.create({
    data: { graficaId: grafica.id, nome: `Cliente ${s}` },
  });

  graficaIdsParaLimpar.push(grafica.id);
  return { graficaId: grafica.id, usuarioDonoId: usuarioDono.id, clienteId: cliente.id };
}

// Um <form> de verdade sempre submete um valor pra cada <input> renderizado
// (mesmo vazio, como ""). formData.get() de uma chave nunca .set() devolve
// null, que quebra os campos .optional() do clienteSchema (zod espera
// undefined, não null) — por isso a base cobre todo campo opcional do
// schema com string vazia, e os testes só sobrescrevem o que importa pro
// caso (mesmo bug já visto em actions.contatos.test.ts, rodada 12).
function formDataBase(clienteId: string, extra: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("clienteId", clienteId);
  fd.set("nome", "Cliente Atualizado");
  for (const campo of [
    "email",
    "telefone",
    "documento",
    "enderecoCep",
    "enderecoLogradouro",
    "enderecoNumero",
    "enderecoComplemento",
    "enderecoBairro",
    "enderecoMunicipio",
    "enderecoCodigoIbge",
    "enderecoUf",
    "observacoes",
    "preferenciasProducao",
    "razaoSocial",
    "nomeFantasia",
    "inscricaoEstadual",
    "inscricaoMunicipal",
    "observacaoFinanceira",
  ]) {
    fd.set(campo, "");
  }
  for (const [chave, valor] of Object.entries(extra)) fd.set(chave, valor);
  return fd;
}

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
}, TIMEOUT_MS);

describe("atualizarCliente — dados comerciais (achado A6 da Parte 5)", () => {
  it(
    "grava formaPagamentoPreferida, descontoPadraoPercent e observacaoFinanceira",
    async () => {
      const f = await criarFixture();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioDonoId } })) as never
      );

      const resultado = await atualizarCliente(
        null,
        formDataBase(f.clienteId, {
          formaPagamentoPreferida: "BOLETO",
          descontoPadraoPercent: "0.1",
          observacaoFinanceira: "Só paga com nota + boleto, portal da prefeitura",
        })
      );

      expect(resultado.ok).toBe(true);

      const cliente = await prisma.cliente.findUniqueOrThrow({ where: { id: f.clienteId } });
      expect(cliente.formaPagamentoPreferida).toBe("BOLETO");
      expect(Number(cliente.descontoPadraoPercent)).toBe(0.1);
      expect(cliente.observacaoFinanceira).toBe("Só paga com nota + boleto, portal da prefeitura");
    },
    TIMEOUT_MS
  );

  it(
    "campos em branco gravam null — comportamento de hoje, sem regressão pra quem não usa a feature",
    async () => {
      const f = await criarFixture();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioDonoId } })) as never
      );

      const resultado = await atualizarCliente(null, formDataBase(f.clienteId));

      expect(resultado.ok).toBe(true);
      const cliente = await prisma.cliente.findUniqueOrThrow({ where: { id: f.clienteId } });
      expect(cliente.formaPagamentoPreferida).toBeNull();
      expect(cliente.descontoPadraoPercent).toBeNull();
      expect(cliente.observacaoFinanceira).toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "rejeita formaPagamentoPreferida com valor fora do enum (ex: POST forjado)",
    async () => {
      const f = await criarFixture();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioDonoId } })) as never
      );

      const resultado = await atualizarCliente(
        null,
        formDataBase(f.clienteId, { formaPagamentoPreferida: "CRIPTOMOEDA" })
      );

      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toContain("Forma de pagamento");

      const cliente = await prisma.cliente.findUniqueOrThrow({ where: { id: f.clienteId } });
      expect(cliente.formaPagamentoPreferida).toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "rejeita descontoPadraoPercent acima de 1 (fração 0-1, nunca 0-100)",
    async () => {
      const f = await criarFixture();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioDonoId } })) as never
      );

      const resultado = await atualizarCliente(
        null,
        formDataBase(f.clienteId, { descontoPadraoPercent: "15" })
      );

      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toContain("Desconto padrão");
    },
    TIMEOUT_MS
  );

  it(
    "rejeita descontoPadraoPercent negativo",
    async () => {
      const f = await criarFixture();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioDonoId } })) as never
      );

      const resultado = await atualizarCliente(
        null,
        formDataBase(f.clienteId, { descontoPadraoPercent: "-0.1" })
      );

      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toContain("Desconto padrão");
    },
    TIMEOUT_MS
  );
});
