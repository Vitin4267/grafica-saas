import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de actions.dados-comerciais.test.ts) — cobre o achado
// A2/Parte 5-Fiscal da auditoria de abrangência ("Fase A"): clienteSchema
// (src/lib/clientes.ts) passou a validar dígito verificador de CPF/CNPJ
// (src/lib/documento.ts), e atualizarCliente só aplica essa validação
// quando o campo `documento` foi de fato alterado no formulário — um
// cliente com documento legado sujo (sem DV válido) não pode ficar travado
// pra edição de outros campos.
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
import { criarCliente, atualizarCliente } from "./actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

type Fixture = { graficaId: string; usuarioDonoId: string };

const graficaIdsParaLimpar: string[] = [];

async function criarFixture(): Promise<Fixture> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Documento Cliente ${s}`, slug: `teste-documento-cliente-${s}` },
  });
  const usuarioDono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-documento-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });

  graficaIdsParaLimpar.push(grafica.id);
  return { graficaId: grafica.id, usuarioDonoId: usuarioDono.id };
}

// Mesmo raciocínio de formDataBase abaixo, pro fluxo de criação (sem
// clienteId) — criarCliente lê os mesmos campos opcionais via formData.get(),
// que devolve null (não undefined) pra chave ausente e quebra os
// .optional() do zod (mesmo bug documentado em
// actions.dados-comerciais.test.ts).
function formDataBaseCriar(extra: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("nome", "Cliente Novo");
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
  ]) {
    fd.set(campo, "");
  }
  for (const [chave, valor] of Object.entries(extra)) fd.set(chave, valor);
  return fd;
}

// Mesmo raciocínio de formDataBase em actions.dados-comerciais.test.ts: um
// <form> de verdade sempre manda um valor pra cada <input> renderizado,
// então a base cobre todo campo opcional do clienteSchema com string vazia.
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

describe("criarCliente — validação de documento (achado A2/Parte 5-Fiscal, Fase A)", () => {
  it(
    "rejeita CPF com dígito verificador inválido",
    async () => {
      const f = await criarFixture();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioDonoId } })) as never
      );

      const fd = formDataBaseCriar({ documento: "111.444.777-99" });

      const resultado = await criarCliente(null, fd);
      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toContain("CPF/CNPJ");
    },
    TIMEOUT_MS
  );

  it(
    "aceita CPF válido com pontuação e normaliza antes de gravar",
    async () => {
      const f = await criarFixture();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioDonoId } })) as never
      );

      const fd = formDataBaseCriar({ nome: "Cliente Novo Válido", documento: "111.444.777-35" });

      const resultado = await criarCliente(null, fd);
      expect(resultado.ok).toBe(true);

      const cliente = await prisma.cliente.findFirstOrThrow({
        where: { graficaId: f.graficaId, nome: "Cliente Novo Válido" },
      });
      expect(cliente.documento).toBe("11144477735");
    },
    TIMEOUT_MS
  );
});

describe("atualizarCliente — documento legado sujo não trava edição (achado A2/Parte 5-Fiscal, Fase A)", () => {
  it(
    "salva edição de outros campos sem tocar num documento legado com DV inválido, quando o campo não foi alterado",
    async () => {
      const f = await criarFixture();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioDonoId } })) as never
      );

      // Documento legado sujo — criado direto via Prisma (bypassando o
      // schema), simulando um cadastro salvo antes desta validação existir.
      const cliente = await prisma.cliente.create({
        data: { graficaId: f.graficaId, nome: "Cliente Legado", documento: "12345678900" },
      });

      // Formulário reenvia o MESMO valor de sempre (defaultValue do <input>,
      // ver ClienteEditForm.tsx) — o usuário só mudou o nome.
      const resultado = await atualizarCliente(
        null,
        formDataBase(cliente.id, { nome: "Cliente Legado Renomeado", documento: "12345678900" })
      );

      expect(resultado.ok).toBe(true);
      const atualizado = await prisma.cliente.findUniqueOrThrow({ where: { id: cliente.id } });
      expect(atualizado.nome).toBe("Cliente Legado Renomeado");
      // Documento sujo permanece EXATAMENTE como estava — não foi renormalizado.
      expect(atualizado.documento).toBe("12345678900");
    },
    TIMEOUT_MS
  );

  it(
    "rejeita quando o usuário TROCA o documento legado sujo por outro valor também inválido",
    async () => {
      const f = await criarFixture();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioDonoId } })) as never
      );

      const cliente = await prisma.cliente.create({
        data: { graficaId: f.graficaId, nome: "Cliente Legado 2", documento: "12345678900" },
      });

      const resultado = await atualizarCliente(
        null,
        formDataBase(cliente.id, { documento: "999.999.999-99" })
      );

      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toContain("CPF/CNPJ");

      const inalterado = await prisma.cliente.findUniqueOrThrow({ where: { id: cliente.id } });
      expect(inalterado.documento).toBe("12345678900");
    },
    TIMEOUT_MS
  );

  it(
    "aceita e normaliza quando o usuário troca o documento legado sujo por um CPF válido",
    async () => {
      const f = await criarFixture();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioDonoId } })) as never
      );

      const cliente = await prisma.cliente.create({
        data: { graficaId: f.graficaId, nome: "Cliente Legado 3", documento: "12345678900" },
      });

      const resultado = await atualizarCliente(
        null,
        formDataBase(cliente.id, { documento: "111.444.777-35" })
      );

      expect(resultado.ok).toBe(true);
      const atualizado = await prisma.cliente.findUniqueOrThrow({ where: { id: cliente.id } });
      expect(atualizado.documento).toBe("11144477735");
    },
    TIMEOUT_MS
  );

  it(
    "reformatar o mesmo documento válido (só pontuação diferente) não é tratado como alteração real, mas normaliza mesmo assim ao salvar outro valor",
    async () => {
      const f = await criarFixture();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioDonoId } })) as never
      );

      const cliente = await prisma.cliente.create({
        data: { graficaId: f.graficaId, nome: "Cliente Normal", documento: "11144477735" },
      });

      // Mesmo documento, só que reformatado com pontuação — normalizarDocumento
      // dos dois bate, então documentoAlterado=false e o valor no banco
      // permanece exatamente como estava (sem reescrever com pontuação nova).
      const resultado = await atualizarCliente(
        null,
        formDataBase(cliente.id, { documento: "111.444.777-35" })
      );

      expect(resultado.ok).toBe(true);
      const atualizado = await prisma.cliente.findUniqueOrThrow({ where: { id: cliente.id } });
      expect(atualizado.documento).toBe("11144477735");
    },
    TIMEOUT_MS
  );
});
