import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de actions.dados-comerciais.test.ts) — cobre o achado A9 da
// Parte 4 da auditoria de abrangência (2026-09-09): Cliente.retemImpostos/
// tipoTomador/tipoTomadorOutro, versão declarativa de retenção de imposto
// na fonte. FALHA ESPERADA até a migration
// 20260909140000_retencao_conta_receber ser aplicada ao banco.
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
    data: { nome: `Teste Tomador Cliente ${s}`, slug: `teste-tomador-cliente-${s}` },
  });
  const usuarioDono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-tomador-${s}@example.com`,
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

// Mesmo cuidado de actions.dados-comerciais.test.ts: um <form> de verdade
// sempre submete uma chave pra cada campo .optional() do clienteSchema
// (mesmo vazia) — formData.get() de uma chave nunca .set() devolve null, o
// que quebra os campos opcionais do zod.
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

describe("atualizarCliente — retemImpostos/tipoTomador (achado A9 da Parte 4)", () => {
  it(
    "grava retemImpostos=true e tipoTomador=PJ_PRIVADA",
    async () => {
      const f = await criarFixture();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioDonoId } })) as never
      );

      const fd = formDataBase(f.clienteId, { tipoTomador: "PJ_PRIVADA" });
      fd.set("retemImpostos", "on");
      const resultado = await atualizarCliente(null, fd);

      expect(resultado.ok).toBe(true);
      const cliente = await prisma.cliente.findUniqueOrThrow({ where: { id: f.clienteId } });
      expect(cliente.retemImpostos).toBe(true);
      expect(cliente.tipoTomador).toBe("PJ_PRIVADA");
      expect(cliente.tipoTomadorOutro).toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "campos ausentes: retemImpostos fica false e tipoTomador fica null — comportamento de hoje, sem regressão",
    async () => {
      const f = await criarFixture();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioDonoId } })) as never
      );

      const resultado = await atualizarCliente(null, formDataBase(f.clienteId));

      expect(resultado.ok).toBe(true);
      const cliente = await prisma.cliente.findUniqueOrThrow({ where: { id: f.clienteId } });
      expect(cliente.retemImpostos).toBe(false);
      expect(cliente.tipoTomador).toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    'tipoTomador=OUTRO sem tipoTomadorOutro é rejeitado',
    async () => {
      const f = await criarFixture();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioDonoId } })) as never
      );

      const resultado = await atualizarCliente(null, formDataBase(f.clienteId, { tipoTomador: "OUTRO" }));

      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toContain("Outro");
      const cliente = await prisma.cliente.findUniqueOrThrow({ where: { id: f.clienteId } });
      expect(cliente.tipoTomador).toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "tipoTomador=OUTRO com tipoTomadorOutro preenchido grava os dois",
    async () => {
      const f = await criarFixture();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioDonoId } })) as never
      );

      const resultado = await atualizarCliente(
        null,
        formDataBase(f.clienteId, { tipoTomador: "OUTRO", tipoTomadorOutro: "Cooperativa" })
      );

      expect(resultado.ok).toBe(true);
      const cliente = await prisma.cliente.findUniqueOrThrow({ where: { id: f.clienteId } });
      expect(cliente.tipoTomador).toBe("OUTRO");
      expect(cliente.tipoTomadorOutro).toBe("Cooperativa");
    },
    TIMEOUT_MS
  );

  it(
    "rejeita tipoTomador fora do enum (ex: POST forjado)",
    async () => {
      const f = await criarFixture();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioDonoId } })) as never
      );

      const resultado = await atualizarCliente(
        null,
        formDataBase(f.clienteId, { tipoTomador: "ALIENIGENA" })
      );

      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toContain("Tipo de tomador");
      const cliente = await prisma.cliente.findUniqueOrThrow({ where: { id: f.clienteId } });
      expect(cliente.tipoTomador).toBeNull();
    },
    TIMEOUT_MS
  );
});
