import "server-only";

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { calcularItemOrcamento } from "@/lib/orcamento-precificacao";
import { D } from "@/lib/pricing/decimal";

// Dados de exemplo pra /comecar: um conjunto mínimo e COERENTE (prensa + papel
// com tabela de preço + formato de folha + produto Offset + produto Simples +
// acabamentos) que faz o motor de precificação (src/lib/pricing) produzir um
// orçamento de verdade, sem precisar o usuário configurar nada antes de ver o
// produto funcionando.
//
// Marcação/remoção: o schema não tem um campo "éExemplo" (fora do território
// desta feature alterar prisma/schema.prisma pra adicionar um). A marcação é
// por NOME: todo registro criado aqui carrega o prefixo abaixo. Além disso,
// todo ItemCatalogo criado é PRIVADO desta gráfica (graficaId preenchido,
// nunca o catálogo mestre) — assim a limpeza nunca afeta outra gráfica nem
// corre o risco de colidir com um ItemGrafica real que o usuário venha a criar
// depois escolhendo um item do catálogo mestre com nome parecido.
export const PREFIXO_EXEMPLO = "[Exemplo] ";

const NOME_CLIENTE = `${PREFIXO_EXEMPLO}Cliente Demonstração`;
const NOME_PRENSA = `${PREFIXO_EXEMPLO}Prensa Offset`;
const NOME_PAPEL = `${PREFIXO_EXEMPLO}Papel Couché`;
const NOME_PRODUTO_OFFSET = `${PREFIXO_EXEMPLO}Cartão de Visita`;
const NOME_PRODUTO_SIMPLES = `${PREFIXO_EXEMPLO}Panfleto A5`;
const NOME_ACABAMENTO_LAMINACAO = `${PREFIXO_EXEMPLO}Laminação Fosca`;
const NOME_ACABAMENTO_CORTE = `${PREFIXO_EXEMPLO}Corte Reto`;
const NOME_ACABAMENTO_VINCO = `${PREFIXO_EXEMPLO}Vinco / Dobra`;

// Formato de folha "Fechada 66x96" com gramatura 300g/m² — mesma combinação
// usada em prisma/seed.ts (já validada em produção): a peça de cartão de
// visita (9x5cm) cabe várias vezes nessa folha (96 up, confirmado com um
// script tsx temporário que rodou carregarDadosExemplo + gerarOrcamentoExemplo
// contra o banco real antes de entregar esta feature — preço final saiu > 0
// sem ErroPrecificacao).
const PAPEL_GRAMATURAS = [
  { gramatura: 90, precoKg: 12.5 },
  { gramatura: 115, precoKg: 12.9 },
  { gramatura: 150, precoKg: 13.4 },
  { gramatura: 250, precoKg: 14.8 },
  { gramatura: 300, precoKg: 15.6 },
];

export type ResultadoCarregarExemplo =
  | { ok: true; jaCarregado: boolean }
  | { ok: false; mensagem: string };

// Idempotente: usa o cliente de exemplo como marcador de "já carregado" —
// se ele já existe, não recria nada (evita duplicar catálogo a cada clique).
export async function existemDadosExemplo(graficaId: string): Promise<boolean> {
  const cliente = await prisma.cliente.findFirst({
    where: { graficaId, nome: NOME_CLIENTE },
    select: { id: true },
  });
  return cliente !== null;
}

export async function carregarDadosExemplo(graficaId: string): Promise<ResultadoCarregarExemplo> {
  if (await existemDadosExemplo(graficaId)) {
    return { ok: true, jaCarregado: true };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.cliente.create({
        data: {
          graficaId,
          nome: NOME_CLIENTE,
          email: "cliente.exemplo@demonstracao.com.br",
          telefone: "(11) 99999-0000",
        },
      });

      const prensa = await tx.prensa.create({
        data: {
          graficaId,
          nome: NOME_PRENSA,
          custoHoraMaq: 150,
          torres: 4,
          custoChapa: 25,
          folhasAcerto: 150,
          tempoAcertoH: 0.5,
          custoMilheiroRod: 40,
          rodagemMinima: 50,
          perdaPercentPadrao: 0.03,
        },
      });

      // Papel (matéria-prima) com tabela de preço por gramatura — o produto
      // Offset abaixo referencia este item via papelId e escolhe 300g/m².
      const itemCatalogoPapel = await tx.itemCatalogo.create({
        data: {
          graficaId,
          tipo: "MATERIA_PRIMA",
          categoria: "Papéis",
          nome: NOME_PAPEL,
          unidade: "FOLHA",
        },
      });
      const papel = await tx.itemGrafica.create({
        data: {
          graficaId,
          itemCatalogoId: itemCatalogoPapel.id,
          precoCompra: 0.42,
          tabelaPrecoPapel: { createMany: { data: PAPEL_GRAMATURAS } },
        },
      });

      // Produto Offset — o item que exercita o motor avançado de verdade
      // (nesting em folha, chapas, rodagem, setup — ver src/lib/pricing/offset.ts).
      const itemCatalogoOffset = await tx.itemCatalogo.create({
        data: {
          graficaId,
          tipo: "PRODUTO",
          categoria: "Papelaria e Impressos",
          nome: NOME_PRODUTO_OFFSET,
        },
      });
      await tx.itemGrafica.create({
        data: {
          graficaId,
          itemCatalogoId: itemCatalogoOffset.id,
          precoVenda: 0.45, // referência — o motor Offset recalcula o preço real por pedido
          modeloCalculo: "OFFSET",
          gramaturaGm2: 300,
          papelId: papel.id,
          prensaId: prensa.id,
          formatosFolha: {
            create: [{ nome: "Fechada 66x96", larguraFolha: 0.66, alturaFolha: 0.96 }],
          },
        },
      });

      // Produto Simples — o caminho fácil, preço direto sem motor avançado.
      const itemCatalogoSimples = await tx.itemCatalogo.create({
        data: {
          graficaId,
          tipo: "PRODUTO",
          categoria: "Papelaria e Impressos",
          nome: NOME_PRODUTO_SIMPLES,
        },
      });
      await tx.itemGrafica.create({
        data: {
          graficaId,
          itemCatalogoId: itemCatalogoSimples.id,
          precoCompra: 0.06,
          precoVenda: 0.18,
          modeloCalculo: "SIMPLES",
        },
      });

      // Três acabamentos de exemplo (SERVICO + ConfiguracaoAcabamento) — mostram
      // as opções de baseCobranca/estagio do motor. Não fazem parte do orçamento
      // de exemplo gerado (o cálculo de item hoje não anexa acabamentos, ver
      // calcularItemOrcamento em src/lib/orcamento-precificacao.ts), mas ficam
      // disponíveis no catálogo pra o usuário já ver como configurar os dele.
      const acabamentos: {
        nome: string;
        categoria: string;
        unidade: "METRO_QUADRADO" | "UNIDADE";
        precoCompra: number;
        precoVenda: number;
        baseCobranca: "M2" | "UNIDADE";
        estagio: "PRE_REFILE" | "POS_REFILE";
        custoSetup: number;
        custoMinimo: number;
      }[] = [
        {
          nome: NOME_ACABAMENTO_LAMINACAO,
          categoria: "Acabamento",
          unidade: "METRO_QUADRADO",
          precoCompra: 2.0,
          precoVenda: 8.0,
          baseCobranca: "M2",
          estagio: "PRE_REFILE",
          custoSetup: 0,
          custoMinimo: 15,
        },
        {
          nome: NOME_ACABAMENTO_CORTE,
          categoria: "Acabamento",
          unidade: "UNIDADE",
          precoCompra: 0.02,
          precoVenda: 0.1,
          baseCobranca: "UNIDADE",
          estagio: "POS_REFILE",
          custoSetup: 5,
          custoMinimo: 10,
        },
        {
          nome: NOME_ACABAMENTO_VINCO,
          categoria: "Acabamento",
          unidade: "UNIDADE",
          precoCompra: 0.03,
          precoVenda: 0.12,
          baseCobranca: "UNIDADE",
          estagio: "POS_REFILE",
          custoSetup: 5,
          custoMinimo: 10,
        },
      ];

      for (const a of acabamentos) {
        const itemCatalogo = await tx.itemCatalogo.create({
          data: {
            graficaId,
            tipo: "SERVICO",
            categoria: a.categoria,
            nome: a.nome,
            unidade: a.unidade,
          },
        });
        await tx.itemGrafica.create({
          data: {
            graficaId,
            itemCatalogoId: itemCatalogo.id,
            precoCompra: a.precoCompra,
            precoVenda: a.precoVenda,
            configuracaoAcabamento: {
              create: {
                baseCobranca: a.baseCobranca,
                estagio: a.estagio,
                custoSetup: a.custoSetup,
                custoMinimo: a.custoMinimo,
              },
            },
          },
        });
      }
    });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      // Corrida entre dois cliques/abas: outra chamada concorrente já criou os
      // dados de exemplo primeiro — não é erro do ponto de vista do usuário.
      return { ok: true, jaCarregado: true };
    }
    throw erro;
  }

  return { ok: true, jaCarregado: false };
}

export type ResultadoLimparExemplo = { ok: boolean; mensagem: string };

// Remove SÓ os registros de exemplo desta gráfica (identificados pelo prefixo
// + graficaId). Ordem de exclusão respeita as FKs Restrict do schema (produto
// antes do papel/prensa que ele referencia, item antes do ItemCatalogo, etc.)
// — ver comentários inline. Roda em duas transações separadas de propósito:
// se a segunda falhar (ex: usuário aprovou o orçamento de exemplo e ele virou
// pedido/nota fiscal de verdade, travando a exclusão do produto por FK), a
// primeira (orçamentos de exemplo ainda em rascunho) já fica removida mesmo
// assim, e não perde depois nesse último passo.
export async function limparDadosExemplo(graficaId: string): Promise<ResultadoLimparExemplo> {
  const cliente = await prisma.cliente.findFirst({
    where: { graficaId, nome: NOME_CLIENTE },
    select: { id: true },
  });

  if (!cliente) {
    return { ok: true, mensagem: "Nenhum dado de exemplo encontrado." };
  }

  // Fase 1: orçamentos de exemplo ainda em rascunho podem ser removidos com
  // segurança (cascade cuida de OrcamentoItem/Pagamento) — mesma regra de
  // cancelarOrcamento em src/app/orcamento/[id]/actions.ts. Orçamentos já
  // aprovados/com pedido ficam de fora de propósito: viraram dados reais.
  const orcamentosRemovidos = await prisma.orcamento.deleteMany({
    where: { graficaId, clienteId: cliente.id, status: "RASCUNHO" },
  });

  // Fase 2: catálogo de exemplo (produtos, papel, acabamentos, prensa) + o
  // próprio cliente de exemplo, só se nada real ainda depende deles.
  let catalogoRemovido = true;
  try {
    await prisma.$transaction(async (tx) => {
      const itensCatalogoExemplo = await tx.itemCatalogo.findMany({
        where: { graficaId, nome: { startsWith: PREFIXO_EXEMPLO } },
        select: { id: true, nome: true },
      });
      const itemCatalogoIds = itensCatalogoExemplo.map((i) => i.id);

      const itensGraficaExemplo = await tx.itemGrafica.findMany({
        where: { graficaId, itemCatalogoId: { in: itemCatalogoIds } },
        select: { id: true, itemCatalogo: { select: { nome: true } } },
      });

      // Produtos e serviços (tudo exceto o papel) primeiro — liberam a Restrict
      // de papelId/prensaId ao serem excluídos. Cascade cuida de FormatoFolha/
      // ConfiguracaoAcabamento.
      const idsNaoPapel = itensGraficaExemplo
        .filter((i) => i.itemCatalogo.nome !== NOME_PAPEL)
        .map((i) => i.id);
      if (idsNaoPapel.length > 0) {
        await tx.itemGrafica.deleteMany({ where: { id: { in: idsNaoPapel } } });
      }

      // Papel por último entre os ItemGrafica — cascade cuida de TabelaPrecoPapel.
      const idsPapel = itensGraficaExemplo
        .filter((i) => i.itemCatalogo.nome === NOME_PAPEL)
        .map((i) => i.id);
      if (idsPapel.length > 0) {
        await tx.itemGrafica.deleteMany({ where: { id: { in: idsPapel } } });
      }

      if (itemCatalogoIds.length > 0) {
        await tx.itemCatalogo.deleteMany({ where: { id: { in: itemCatalogoIds } } });
      }

      await tx.prensa.deleteMany({ where: { graficaId, nome: NOME_PRENSA } });
      await tx.cliente.delete({ where: { id: cliente.id } });
    });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2003") {
      catalogoRemovido = false;
    } else {
      throw erro;
    }
  }

  if (!catalogoRemovido) {
    return {
      ok: true,
      mensagem:
        orcamentosRemovidos.count > 0
          ? "Orçamento de exemplo removido. Alguns itens do catálogo de exemplo continuam porque já viraram pedido ou nota fiscal reais — remova-os manualmente em /catalogo se quiser."
          : "Não foi possível remover: os dados de exemplo já viraram pedido ou nota fiscal reais. Remova-os manualmente em /catalogo se quiser.",
    };
  }

  return { ok: true, mensagem: "Dados de exemplo removidos." };
}

export type ResultadoGerarOrcamentoExemplo =
  | { ok: true; orcamentoId: string }
  | { ok: false; mensagem: string };

// Cria um Orcamento REAL usando os dados de exemplo, pra o usuário ver um
// orçamento pronto em 1 clique. Carrega os dados de exemplo primeiro se ainda
// não existirem (idempotente — ver carregarDadosExemplo), então o botão
// "Gerar orçamento de exemplo" funciona mesmo se o usuário nunca clicou
// "Carregar dados de exemplo" antes.
export async function gerarOrcamentoExemplo(
  graficaId: string,
  usuarioId: string
): Promise<ResultadoGerarOrcamentoExemplo> {
  const carregou = await carregarDadosExemplo(graficaId);
  if (!carregou.ok) {
    return carregou;
  }

  const cliente = await prisma.cliente.findFirst({
    where: { graficaId, nome: NOME_CLIENTE },
  });
  const itemOffset = await prisma.itemGrafica.findFirst({
    where: { graficaId, ativo: true, itemCatalogo: { nome: NOME_PRODUTO_OFFSET } },
  });
  const itemSimples = await prisma.itemGrafica.findFirst({
    where: { graficaId, ativo: true, itemCatalogo: { nome: NOME_PRODUTO_SIMPLES } },
  });

  if (!cliente || !itemOffset || !itemSimples) {
    return {
      ok: false,
      mensagem: "Dados de exemplo incompletos — tente carregar os dados de exemplo novamente.",
    };
  }

  // Reaproveita o MESMO ponto de cálculo usado por criarOrcamento (nunca
  // duplica a lógica de precificação) — ver src/lib/orcamento-precificacao.ts.
  const resultadoOffset = await calcularItemOrcamento(itemOffset, graficaId, {
    quantidade: 5000,
    larguraCm: 9,
    alturaCm: 5,
    corFrente: 4,
    corVerso: 4,
  });
  if (!resultadoOffset.ok) {
    return { ok: false, mensagem: `Cartão de visita de exemplo: ${resultadoOffset.mensagem}` };
  }

  const resultadoSimples = await calcularItemOrcamento(itemSimples, graficaId, {
    quantidade: 1000,
    larguraCm: null,
    alturaCm: null,
    corFrente: null,
    corVerso: null,
  });
  if (!resultadoSimples.ok) {
    return { ok: false, mensagem: `Panfleto de exemplo: ${resultadoSimples.mensagem}` };
  }

  const total = new D(resultadoOffset.precoTotal).plus(resultadoSimples.precoTotal);

  const orcamento = await prisma.orcamento.create({
    data: {
      graficaId,
      clienteId: cliente.id,
      usuarioId,
      total,
      itens: {
        create: [
          {
            itemGraficaId: itemOffset.id,
            quantidade: 5000,
            larguraCm: 9,
            alturaCm: 5,
            cores: "4x4",
            precoUnitario: resultadoOffset.precoUnitario,
            precoTotal: resultadoOffset.precoTotal,
            modeloCalculo: resultadoOffset.modeloCalculo,
            corFrente: resultadoOffset.corFrente,
            corVerso: resultadoOffset.corVerso,
            breakdown: resultadoOffset.breakdown ?? undefined,
          },
          {
            itemGraficaId: itemSimples.id,
            quantidade: 1000,
            precoUnitario: resultadoSimples.precoUnitario,
            precoTotal: resultadoSimples.precoTotal,
            modeloCalculo: resultadoSimples.modeloCalculo,
          },
        ],
      },
    },
  });

  return { ok: true, orcamentoId: orcamento.id };
}
