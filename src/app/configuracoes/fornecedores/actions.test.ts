import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de src/app/financeiro/actions.conta-financeira-filial.test.ts)
// — cobre o achado A5 da Parte 3 (Compras) da auditoria de abrangência
// (pesquisa-abrangencia-modulos.md): cadastro enriquecido de Fornecedor
// (email, telefone, categoria, condição de pagamento padrão, prazo de
// entrega médio, pedido mínimo) + unicidade de documento por gráfica.
// FALHA ESPERADA até a migration 20260909100000_fornecedor_enriquecido ser
// aplicada ao banco (mesmo padrão já documentado em
// actions.baixa-parcial.test.ts).
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
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
import { criarFornecedor, editarFornecedor } from "./actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const graficaIdsParaLimpar: string[] = [];

async function criarFixture() {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Fornecedor A5 ${s}`, slug: `teste-fornecedor-a5-${s}` },
  });
  const dono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-fornecedor-a5-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });

  graficaIdsParaLimpar.push(grafica.id);
  return { graficaId: grafica.id, usuarioId: dono.id, sufixo: s };
}

function formDataDe(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [chave, valor] of Object.entries(campos)) fd.set(chave, valor);
  return fd;
}

async function logarComo(usuarioId: string) {
  vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
    (await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } })) as never
  );
}

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.despesa.deleteMany({ where: { graficaId } });
    await prisma.fornecedor.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
}, TIMEOUT_MS);

describe("criarFornecedor — cadastro enriquecido (achado A5 da Parte 3/Compras)", () => {
  it(
    "grava email/telefone/categoria/condição de pagamento/prazo/pedido mínimo",
    async () => {
      const f = await criarFixture();
      await logarComo(f.usuarioId);

      // criarFornecedor chama redirect() no sucesso (nunca retorna
      // {ok:true} nesse caminho — redirect() sempre lança, mesmo padrão já
      // estabelecido em criarColaborador/actions.test.ts).
      await expect(
        criarFornecedor(
          null,
          formDataDe({
            nome: `Arclad ${f.sufixo}`,
            email: "compras@arclad.com.br",
            telefone: "(11) 4000-0000",
            categoria: "TINTA_VERNIZ",
            condicaoPagamentoPadrao: "BOLETO_30_60_90",
            prazoEntregaMedioDias: "7",
            pedidoMinimoValor: "500.5",
          })
        )
      ).rejects.toThrow("NEXT_REDIRECT");

      const fornecedor = await prisma.fornecedor.findFirstOrThrow({
        where: { graficaId: f.graficaId, nome: `Arclad ${f.sufixo}` },
      });
      expect(fornecedor.email).toBe("compras@arclad.com.br");
      expect(fornecedor.telefone).toBe("(11) 4000-0000");
      expect(fornecedor.categoria).toBe("TINTA_VERNIZ");
      expect(fornecedor.condicaoPagamentoPadrao).toBe("BOLETO_30_60_90");
      expect(fornecedor.prazoEntregaMedioDias).toBe(7);
      expect(Number(fornecedor.pedidoMinimoValor)).toBeCloseTo(500.5);
    },
    TIMEOUT_MS
  );

  it(
    "sem nenhum campo novo enviado, todos ficam null — comportamento mínimo preservado",
    async () => {
      const f = await criarFixture();
      await logarComo(f.usuarioId);

      await expect(
        criarFornecedor(null, formDataDe({ nome: `Fornecedor mínimo ${f.sufixo}` }))
      ).rejects.toThrow("NEXT_REDIRECT");

      const fornecedor = await prisma.fornecedor.findFirstOrThrow({
        where: { graficaId: f.graficaId, nome: `Fornecedor mínimo ${f.sufixo}` },
      });
      expect(fornecedor.email).toBeNull();
      expect(fornecedor.telefone).toBeNull();
      expect(fornecedor.categoria).toBeNull();
      expect(fornecedor.condicaoPagamentoPadrao).toBeNull();
      expect(fornecedor.prazoEntregaMedioDias).toBeNull();
      expect(fornecedor.pedidoMinimoValor).toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    'categoria=OUTRO sem categoriaOutro é rejeitado',
    async () => {
      const f = await criarFixture();
      await logarComo(f.usuarioId);

      const resultado = await criarFornecedor(
        null,
        formDataDe({ nome: `Fornecedor outro ${f.sufixo}`, categoria: "OUTRO" })
      );

      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toContain('"Outro"');
    },
    TIMEOUT_MS
  );

  it(
    'categoria=OUTRO com categoriaOutro preenchido grava normalmente',
    async () => {
      const f = await criarFixture();
      await logarComo(f.usuarioId);

      await expect(
        criarFornecedor(
          null,
          formDataDe({
            nome: `Fornecedor outro válido ${f.sufixo}`,
            categoria: "OUTRO",
            categoriaOutro: "Reposição de peças de máquina",
          })
        )
      ).rejects.toThrow("NEXT_REDIRECT");

      const fornecedor = await prisma.fornecedor.findFirstOrThrow({
        where: { graficaId: f.graficaId, nome: `Fornecedor outro válido ${f.sufixo}` },
      });
      expect(fornecedor.categoria).toBe("OUTRO");
      expect(fornecedor.categoriaOutro).toBe("Reposição de peças de máquina");
    },
    TIMEOUT_MS
  );
});

describe("Fornecedor.documento — unicidade por gráfica (achado A5 da Parte 3/Compras)", () => {
  it(
    "editarFornecedor: dois fornecedores da MESMA gráfica não podem ter o mesmo documento",
    async () => {
      const f = await criarFixture();
      await logarComo(f.usuarioId);
      const documento = `1${Date.now()}`;

      const primeiro = await prisma.fornecedor.create({
        data: { graficaId: f.graficaId, nome: `Fornecedor 1 ${f.sufixo}`, documento },
      });
      const segundo = await prisma.fornecedor.create({
        data: { graficaId: f.graficaId, nome: `Fornecedor 2 ${f.sufixo}` },
      });

      const resultado = await editarFornecedor(
        null,
        formDataDe({
          fornecedorId: segundo.id,
          nome: `Fornecedor 2 ${f.sufixo}`,
          documento,
        })
      );

      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toContain("CNPJ/CPF");
      // primeiro fornecedor não foi afetado
      const inalterado = await prisma.fornecedor.findUniqueOrThrow({ where: { id: primeiro.id } });
      expect(inalterado.documento).toBe(documento);
    },
    TIMEOUT_MS
  );

  it(
    "duas gráficas DIFERENTES podem ter fornecedor com o mesmo documento (isolamento de tenant)",
    async () => {
      const f1 = await criarFixture();
      const f2 = await criarFixture();
      const documento = `2${Date.now()}`;

      await prisma.fornecedor.create({
        data: { graficaId: f1.graficaId, nome: `Fornecedor grafica 1 ${f1.sufixo}`, documento },
      });

      await logarComo(f2.usuarioId);
      await expect(
        criarFornecedor(null, formDataDe({ nome: `Fornecedor grafica 2 ${f2.sufixo}` }))
      ).rejects.toThrow("NEXT_REDIRECT");
      const criado = await prisma.fornecedor.findFirstOrThrow({
        where: { graficaId: f2.graficaId, nome: `Fornecedor grafica 2 ${f2.sufixo}` },
      });

      const editado = await editarFornecedor(
        null,
        formDataDe({ fornecedorId: criado.id, nome: criado.nome, documento })
      );
      expect(editado.ok).toBe(true);
    },
    TIMEOUT_MS
  );

  it(
    "múltiplos fornecedores da mesma gráfica SEM documento coexistem normalmente (NULL não colide em UNIQUE)",
    async () => {
      const f = await criarFixture();
      await logarComo(f.usuarioId);

      await expect(
        criarFornecedor(null, formDataDe({ nome: `Sem doc 1 ${f.sufixo}` }))
      ).rejects.toThrow("NEXT_REDIRECT");
      await expect(
        criarFornecedor(null, formDataDe({ nome: `Sem doc 2 ${f.sufixo}` }))
      ).rejects.toThrow("NEXT_REDIRECT");

      const total = await prisma.fornecedor.count({
        where: { graficaId: f.graficaId, documento: null },
      });
      expect(total).toBe(2);
    },
    TIMEOUT_MS
  );
});

describe("editarFornecedor — tenant isolation (achado A5 da Parte 3/Compras)", () => {
  it(
    "não encontra/edita fornecedor de outra gráfica",
    async () => {
      const f = await criarFixture();
      const outra = await criarFixture();
      const fornecedorAlheio = await prisma.fornecedor.create({
        data: { graficaId: outra.graficaId, nome: `Fornecedor alheio ${outra.sufixo}` },
      });

      await logarComo(f.usuarioId);
      const resultado = await editarFornecedor(
        null,
        formDataDe({
          fornecedorId: fornecedorAlheio.id,
          nome: "Tentativa de invasão",
          telefone: "000",
        })
      );

      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toContain("não encontrado");
      const inalterado = await prisma.fornecedor.findUniqueOrThrow({ where: { id: fornecedorAlheio.id } });
      expect(inalterado.nome).toBe(`Fornecedor alheio ${outra.sufixo}`);
      expect(inalterado.telefone).toBeNull();
    },
    TIMEOUT_MS
  );
});
