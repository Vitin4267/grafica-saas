import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de actions.prazo-estimado.test.ts/actions.duplicar.test.ts
// neste mesmo diretório) — cobre o achado F8 da Parte 7 da auditoria de
// abrangência (pesquisa-abrangencia-modulos.md): biblioteca de cor especial/
// Pantone do cliente (CorEspecialCliente) + QUAL cor um item de orçamento usa
// (OrcamentoItemCor). Cobre adicionarItemOrcamento/editarOrcamento (texto
// livre, biblioteca existente, "salvar na biblioteca", isolamento de
// tenant/cliente) e duplicarOrcamento ("Pedir de novo" copia literalmente).
//
// SÓ RODA DE VERDADE depois que a migration
// prisma/migrations/20260905200000_cor_especial_cliente/migration.sql tiver
// sido aplicada no banco (tabelas "cores_especiais_cliente" e
// "orcamento_item_cores" ainda não existem até lá).
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));

// duplicarOrcamento navega pro novo orçamento no caminho de sucesso via
// redirect(), que fora de uma requisição Next.js de verdade lança
// NEXT_REDIRECT — mesmo padrão de actions.duplicar.test.ts.
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
import { adicionarItemOrcamento, editarOrcamento, duplicarOrcamento } from "./actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

type Fixture = {
  graficaId: string;
  usuarioId: string;
  clienteId: string;
  outroClienteId: string;
  itemGraficaId: string;
  orcamentoId: string;
};

const graficaIdsParaLimpar: string[] = [];

async function criarFixture(): Promise<Fixture> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Cor Especial ${s}`, slug: `teste-cor-especial-${s}` },
  });
  graficaIdsParaLimpar.push(grafica.id);
  await prisma.parametrosGrafica.create({ data: { graficaId: grafica.id } });
  const usuario = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Usuário ${s}`,
      email: `user-cor-especial-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const cliente = await prisma.cliente.create({ data: { graficaId: grafica.id, nome: `Cliente ${s}` } });
  const outroCliente = await prisma.cliente.create({
    data: { graficaId: grafica.id, nome: `Outro Cliente ${s}` },
  });
  // Produto SIMPLES — o suficiente pra exercitar cor especial (independente
  // de modeloCalculo, nunca entra no motor de preço).
  const catalogo = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Rótulo", nome: `Item Teste ${s}` },
  });
  const itemGrafica = await prisma.itemGrafica.create({
    data: { graficaId: grafica.id, itemCatalogoId: catalogo.id, precoVenda: 10 },
  });
  const orcamento = await prisma.orcamento.create({
    data: {
      graficaId: grafica.id,
      clienteId: cliente.id,
      usuarioId: usuario.id,
      status: "RASCUNHO",
      total: 0,
    },
  });

  return {
    graficaId: grafica.id,
    usuarioId: usuario.id,
    clienteId: cliente.id,
    outroClienteId: outroCliente.id,
    itemGraficaId: itemGrafica.id,
    orcamentoId: orcamento.id,
  };
}

async function usuarioParaMock(usuarioId: string) {
  return prisma.usuario.findUniqueOrThrow({
    where: { id: usuarioId },
    include: { grafica: { include: { assinatura: true } } },
  });
}

function formDataBase(campos: Record<string, string>): FormData {
  // Superset de campos que adicionarItemOrcamento/editarOrcamento leem do
  // FormData (mesmo conjunto de actions.prazo-estimado.test.ts) — todos
  // opcionais/vazios exceto os que o teste sobrescreve.
  const base: Record<string, string> = {
    quantidade: "100",
    largura: "",
    altura: "",
    profundidade: "",
    espessuraMm: "",
    unidadeDimensao: "CM",
    corFrente: "",
    corVerso: "",
    numeroCoresFlexo: "",
    numeroCliques: "",
    numeroSetups: "",
    prazoEstimadoDias: "",
    numeroPontos: "",
    tempoEstimadoMin: "",
    metrosCorte: "",
    horasEstimadas: "",
    custoAquisicaoUnitario: "",
    materialFornecidoPeloCliente: "",
    cores: "",
    acabamento: "",
    descricaoLivre: "",
    papelId: "",
    quantidadeCores: "",
    custoFaca: "",
    custoFrete: "",
    materialSubstrato: "",
    materialSubstratoOutro: "",
    tipoAdesivo: "",
    tipoAdesivoOutro: "",
    superficieAplicacao: "",
    superficieAplicacaoOutro: "",
    formatoEtiqueta: "",
    coresRotulo: "",
    coresContraRotulo: "",
    embalagemQtdPorRolo: "",
    tubeteMedida: "",
    rotulagem: "",
    serrilha: "",
    serrilhaOutro: "",
    vernizRotuloTotal: "false",
    vernizRotuloReserva: "false",
    vernizRotuloTipo: "",
    vernizRotuloTipoOutro: "",
    vernizContraRotuloTotal: "false",
    vernizContraRotuloReserva: "false",
    vernizContraRotuloTipo: "",
    vernizContraRotuloTipoOutro: "",
    laminacaoRotulo: "",
    laminacaoRotuloOutro: "",
    laminacaoContraRotulo: "",
    laminacaoContraRotuloOutro: "",
    rebobinamento: "",
    hotStampingsJson: "[]",
    coresEspeciaisJson: "[]",
    ...campos,
  };
  const fd = new FormData();
  for (const [chave, valor] of Object.entries(base)) fd.set(chave, valor);
  return fd;
}

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.orcamentoItem.deleteMany({ where: { orcamento: { graficaId } } });
    await prisma.orcamento.deleteMany({ where: { graficaId } });
    await prisma.corEspecialCliente.deleteMany({ where: { graficaId } });
    await prisma.itemGrafica.deleteMany({ where: { graficaId } });
    await prisma.itemCatalogo.deleteMany({ where: { graficaId } });
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.parametrosGrafica.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
  redirectMock.mockClear();
}, TIMEOUT_MS);

describe("achado F8 — cor especial em adicionarItemOrcamento/editarOrcamento", () => {
  it(
    "adiciona item com cor especial em texto livre (sem biblioteca)",
    async () => {
      const f = await criarFixture();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(await usuarioParaMock(f.usuarioId));

      const resultado = await adicionarItemOrcamento(
        null,
        formDataBase({
          orcamentoId: f.orcamentoId,
          itemGraficaId: f.itemGraficaId,
          coresEspeciaisJson: JSON.stringify([
            { corEspecialId: null, nomeDeclarado: "PANTONE 485 C", salvarNaBiblioteca: false },
          ]),
        })
      );
      expect(resultado.ok).toBe(true);

      const item = await prisma.orcamentoItem.findFirstOrThrow({
        where: { orcamentoId: f.orcamentoId },
        include: { coresEspeciais: true },
      });
      expect(item.coresEspeciais).toHaveLength(1);
      expect(item.coresEspeciais[0].corEspecialId).toBeNull();
      expect(item.coresEspeciais[0].nomeDeclarado).toBe("PANTONE 485 C");

      // Texto livre não cria nenhuma entrada na biblioteca do cliente.
      const biblioteca = await prisma.corEspecialCliente.findMany({ where: { clienteId: f.clienteId } });
      expect(biblioteca).toHaveLength(0);
    },
    TIMEOUT_MS
  );

  it(
    "salvarNaBiblioteca cria a CorEspecialCliente e vincula o item a ela",
    async () => {
      const f = await criarFixture();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(await usuarioParaMock(f.usuarioId));

      const resultado = await adicionarItemOrcamento(
        null,
        formDataBase({
          orcamentoId: f.orcamentoId,
          itemGraficaId: f.itemGraficaId,
          coresEspeciaisJson: JSON.stringify([
            { corEspecialId: null, nomeDeclarado: "Azul institucional", salvarNaBiblioteca: true },
          ]),
        })
      );
      expect(resultado.ok).toBe(true);

      const biblioteca = await prisma.corEspecialCliente.findMany({ where: { clienteId: f.clienteId } });
      expect(biblioteca).toHaveLength(1);
      expect(biblioteca[0].nome).toBe("Azul institucional");

      const item = await prisma.orcamentoItem.findFirstOrThrow({
        where: { orcamentoId: f.orcamentoId },
        include: { coresEspeciais: true },
      });
      expect(item.coresEspeciais[0].corEspecialId).toBe(biblioteca[0].id);
    },
    TIMEOUT_MS
  );

  it(
    "reaproveita a biblioteca existente (mesmo nome, case-insensitive) em vez de duplicar",
    async () => {
      const f = await criarFixture();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(await usuarioParaMock(f.usuarioId));

      // Já existe uma cor cadastrada pra este cliente (ex: criada num
      // orçamento anterior).
      const corExistente = await prisma.corEspecialCliente.create({
        data: { graficaId: f.graficaId, clienteId: f.clienteId, nome: "Verde Marca", referencia: "PANTONE 355 C" },
      });

      const resultado = await adicionarItemOrcamento(
        null,
        formDataBase({
          orcamentoId: f.orcamentoId,
          itemGraficaId: f.itemGraficaId,
          coresEspeciaisJson: JSON.stringify([
            { corEspecialId: null, nomeDeclarado: "verde marca", salvarNaBiblioteca: true },
          ]),
        })
      );
      expect(resultado.ok).toBe(true);

      const biblioteca = await prisma.corEspecialCliente.findMany({ where: { clienteId: f.clienteId } });
      expect(biblioteca).toHaveLength(1); // não duplicou
      expect(biblioteca[0].id).toBe(corExistente.id);

      const item = await prisma.orcamentoItem.findFirstOrThrow({
        where: { orcamentoId: f.orcamentoId },
        include: { coresEspeciais: true },
      });
      expect(item.coresEspeciais[0].corEspecialId).toBe(corExistente.id);
    },
    TIMEOUT_MS
  );

  it(
    "escolhe uma cor já existente na biblioteca do cliente (corEspecialId direto)",
    async () => {
      const f = await criarFixture();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(await usuarioParaMock(f.usuarioId));

      const corExistente = await prisma.corEspecialCliente.create({
        data: { graficaId: f.graficaId, clienteId: f.clienteId, nome: "Vermelho Marca", referencia: "PANTONE 186 C" },
      });

      const resultado = await adicionarItemOrcamento(
        null,
        formDataBase({
          orcamentoId: f.orcamentoId,
          itemGraficaId: f.itemGraficaId,
          coresEspeciaisJson: JSON.stringify([
            { corEspecialId: corExistente.id, nomeDeclarado: "Vermelho Marca — PANTONE 186 C" },
          ]),
        })
      );
      expect(resultado.ok).toBe(true);

      const item = await prisma.orcamentoItem.findFirstOrThrow({
        where: { orcamentoId: f.orcamentoId },
        include: { coresEspeciais: true },
      });
      expect(item.coresEspeciais[0].corEspecialId).toBe(corExistente.id);
    },
    TIMEOUT_MS
  );

  it(
    "uma cor GENÉRICA da gráfica (clienteId null) também é aceita",
    async () => {
      const f = await criarFixture();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(await usuarioParaMock(f.usuarioId));

      const corGenerica = await prisma.corEspecialCliente.create({
        data: { graficaId: f.graficaId, clienteId: null, nome: "Preto Padrão", referencia: "PANTONE Black C" },
      });

      const resultado = await adicionarItemOrcamento(
        null,
        formDataBase({
          orcamentoId: f.orcamentoId,
          itemGraficaId: f.itemGraficaId,
          coresEspeciaisJson: JSON.stringify([
            { corEspecialId: corGenerica.id, nomeDeclarado: "Preto Padrão" },
          ]),
        })
      );
      expect(resultado.ok).toBe(true);
    },
    TIMEOUT_MS
  );

  it(
    "rejeita corEspecialId da biblioteca PRIVADA de OUTRO cliente (isolamento)",
    async () => {
      const f = await criarFixture();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(await usuarioParaMock(f.usuarioId));

      const corDeOutroCliente = await prisma.corEspecialCliente.create({
        data: { graficaId: f.graficaId, clienteId: f.outroClienteId, nome: "Cor do outro cliente", referencia: "X" },
      });

      const resultado = await adicionarItemOrcamento(
        null,
        formDataBase({
          orcamentoId: f.orcamentoId,
          itemGraficaId: f.itemGraficaId,
          coresEspeciaisJson: JSON.stringify([
            { corEspecialId: corDeOutroCliente.id, nomeDeclarado: "Cor do outro cliente" },
          ]),
        })
      );
      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toMatch(/não encontrada/i);

      const item = await prisma.orcamentoItem.findFirst({ where: { orcamentoId: f.orcamentoId } });
      expect(item).toBeNull(); // nada foi gravado
    },
    TIMEOUT_MS
  );

  it(
    "rejeita corEspecialId de OUTRA gráfica (isolamento de tenant)",
    async () => {
      const f = await criarFixture();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(await usuarioParaMock(f.usuarioId));

      const outraGrafica = await prisma.grafica.create({
        data: { nome: `Outra Grafica ${sufixo()}`, slug: `outra-grafica-${sufixo()}` },
      });
      const corDeOutraGrafica = await prisma.corEspecialCliente.create({
        data: { graficaId: outraGrafica.id, clienteId: null, nome: "Cor de outra grafica", referencia: "X" },
      });

      const resultado = await adicionarItemOrcamento(
        null,
        formDataBase({
          orcamentoId: f.orcamentoId,
          itemGraficaId: f.itemGraficaId,
          coresEspeciaisJson: JSON.stringify([
            { corEspecialId: corDeOutraGrafica.id, nomeDeclarado: "Cor de outra grafica" },
          ]),
        })
      );
      expect(resultado.ok).toBe(false);

      await prisma.corEspecialCliente.deleteMany({ where: { graficaId: outraGrafica.id } });
      await prisma.grafica.delete({ where: { id: outraGrafica.id } });
    },
    TIMEOUT_MS
  );

  it(
    "editarOrcamento substitui as cores especiais (apaga tudo e recria a partir do array enviado)",
    async () => {
      const f = await criarFixture();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(await usuarioParaMock(f.usuarioId));

      await adicionarItemOrcamento(
        null,
        formDataBase({
          orcamentoId: f.orcamentoId,
          itemGraficaId: f.itemGraficaId,
          coresEspeciaisJson: JSON.stringify([
            { corEspecialId: null, nomeDeclarado: "Cor original", salvarNaBiblioteca: false },
          ]),
        })
      );
      const itemOriginal = await prisma.orcamentoItem.findFirstOrThrow({
        where: { orcamentoId: f.orcamentoId },
      });

      const resultadoEdicao = await editarOrcamento(
        null,
        formDataBase({
          orcamentoId: f.orcamentoId,
          orcamentoItemId: itemOriginal.id,
          coresEspeciaisJson: JSON.stringify([
            { corEspecialId: null, nomeDeclarado: "Cor A editada", salvarNaBiblioteca: false },
            { corEspecialId: null, nomeDeclarado: "Cor B editada", salvarNaBiblioteca: false },
          ]),
        })
      );
      expect(resultadoEdicao.ok).toBe(true);

      const itemEditado = await prisma.orcamentoItem.findFirstOrThrow({
        where: { id: itemOriginal.id },
        include: { coresEspeciais: { orderBy: { nomeDeclarado: "asc" } } },
      });
      expect(itemEditado.coresEspeciais).toHaveLength(2);
      expect(itemEditado.coresEspeciais.map((c) => c.nomeDeclarado)).toEqual([
        "Cor A editada",
        "Cor B editada",
      ]);
    },
    TIMEOUT_MS
  );

  it(
    "editarOrcamento com array vazio remove todas as cores especiais do item",
    async () => {
      const f = await criarFixture();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(await usuarioParaMock(f.usuarioId));

      await adicionarItemOrcamento(
        null,
        formDataBase({
          orcamentoId: f.orcamentoId,
          itemGraficaId: f.itemGraficaId,
          coresEspeciaisJson: JSON.stringify([
            { corEspecialId: null, nomeDeclarado: "Cor a remover", salvarNaBiblioteca: false },
          ]),
        })
      );
      const itemOriginal = await prisma.orcamentoItem.findFirstOrThrow({
        where: { orcamentoId: f.orcamentoId },
      });

      await editarOrcamento(
        null,
        formDataBase({
          orcamentoId: f.orcamentoId,
          orcamentoItemId: itemOriginal.id,
          coresEspeciaisJson: "[]",
        })
      );

      const itemEditado = await prisma.orcamentoItem.findFirstOrThrow({
        where: { id: itemOriginal.id },
        include: { coresEspeciais: true },
      });
      expect(itemEditado.coresEspeciais).toHaveLength(0);
    },
    TIMEOUT_MS
  );
});

describe("achado F8 — cor especial no 'Pedir de novo' (duplicarOrcamento)", () => {
  it(
    "copia literalmente as OrcamentoItemCor do item original pro item novo",
    async () => {
      const f = await criarFixture();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(await usuarioParaMock(f.usuarioId));

      const corBiblioteca = await prisma.corEspecialCliente.create({
        data: { graficaId: f.graficaId, clienteId: f.clienteId, nome: "Cor da marca", referencia: "PANTONE 200 C" },
      });

      await adicionarItemOrcamento(
        null,
        formDataBase({
          orcamentoId: f.orcamentoId,
          itemGraficaId: f.itemGraficaId,
          coresEspeciaisJson: JSON.stringify([
            { corEspecialId: corBiblioteca.id, nomeDeclarado: "Cor da marca — PANTONE 200 C" },
            { corEspecialId: null, nomeDeclarado: "Cor avulsa digitada", salvarNaBiblioteca: false },
          ]),
        })
      );

      // Orçamento precisa estar APROVADO ou REJEITADO pra "Pedir de novo".
      await prisma.orcamento.update({ where: { id: f.orcamentoId }, data: { status: "APROVADO" } });

      await expect(
        duplicarOrcamento(null, (() => {
          const fd = new FormData();
          fd.set("orcamentoId", f.orcamentoId);
          return fd;
        })())
      ).rejects.toThrow(/^NEXT_REDIRECT:/);

      const novoOrcamentoId = (redirectMock.mock.calls[0][0] as string).split("/").pop()!;
      const itemNovo = await prisma.orcamentoItem.findFirstOrThrow({
        where: { orcamentoId: novoOrcamentoId },
        include: { coresEspeciais: { orderBy: { nomeDeclarado: "asc" } } },
      });

      expect(itemNovo.coresEspeciais).toHaveLength(2);
      const porNome = new Map(itemNovo.coresEspeciais.map((c) => [c.nomeDeclarado, c]));
      expect(porNome.get("Cor da marca — PANTONE 200 C")?.corEspecialId).toBe(corBiblioteca.id);
      expect(porNome.get("Cor avulsa digitada")?.corEspecialId).toBeNull();
    },
    TIMEOUT_MS
  );
});
