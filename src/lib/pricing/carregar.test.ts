import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { carregarContextoPrecificacao, resolverConfigAcabamentos } from "./carregar";
import { ErroPrecificacao } from "./erros";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de src/lib/pedido-aprovacao.test.ts) — cobre as 2 branches
// novas de carregarContextoPrecificacao (Feature A): DIGITAL e os 3 modelos
// de setup-por-peça (testados via SERIGRAFIA, já que os 3 compartilham o
// mesmo branch no código). Cada cenário cobre "máquina não configurada"
// (erro) e "caminho feliz" (contexto carregado corretamente do banco).
const TIMEOUT_MS = 30_000;

const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const graficaIdsParaLimpar: string[] = [];

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.itemGrafica.deleteMany({ where: { graficaId } });
    await prisma.itemCatalogo.deleteMany({ where: { graficaId } });
    await prisma.impressoraDigital.deleteMany({ where: { graficaId } });
    await prisma.maquinaSetupPorPeca.deleteMany({ where: { graficaId } });
    await prisma.parametrosGrafica.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
}, TIMEOUT_MS);

async function criarGrafica() {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Carregar Contexto ${s}`, slug: `teste-carregar-contexto-${s}` },
  });
  graficaIdsParaLimpar.push(grafica.id);
  return { grafica, s };
}

describe(
  "carregarContextoPrecificacao — DIGITAL",
  () => {
    it(
      "lança IMPRESSORA_DIGITAL_NAO_CONFIGURADA quando o produto não tem impressora vinculada",
      async () => {
        const { grafica, s } = await criarGrafica();
        const catalogo = await prisma.itemCatalogo.create({
          data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Cartão", nome: `Cartão Digital ${s}` },
        });
        const produto = await prisma.itemGrafica.create({
          data: {
            graficaId: grafica.id,
            itemCatalogoId: catalogo.id,
            modeloCalculo: "DIGITAL",
            precoCompra: 0.3,
            // impressoraDigitalId propositalmente ausente
          },
        });

        await expect(carregarContextoPrecificacao(produto.id, grafica.id)).rejects.toMatchObject({
          codigo: "IMPRESSORA_DIGITAL_NAO_CONFIGURADA",
        });
        await expect(carregarContextoPrecificacao(produto.id, grafica.id)).rejects.toBeInstanceOf(
          ErroPrecificacao
        );
      },
      TIMEOUT_MS
    );

    // Achado N4 da auditoria de código (2026-09-04) — o motor Digital passou
    // a fazer imposição igual ao Offset: precisa de um papel (matéria-prima)
    // escolhido NO ORÇAMENTO (dadosDigital), do qual vêm os FormatoFolha.
    it(
      "lança DIGITAL_SEM_PAPEL quando a impressora está configurada mas nenhum papel foi escolhido no orçamento",
      async () => {
        const { grafica, s } = await criarGrafica();
        const impressora = await prisma.impressoraDigital.create({
          data: { graficaId: grafica.id, nome: `HP Indigo ${s}`, custoPorClique: 0.08 },
        });
        const catalogo = await prisma.itemCatalogo.create({
          data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Cartão", nome: `Cartão Digital ${s}` },
        });
        const produto = await prisma.itemGrafica.create({
          data: {
            graficaId: grafica.id,
            itemCatalogoId: catalogo.id,
            modeloCalculo: "DIGITAL",
            impressoraDigitalId: impressora.id,
          },
        });

        await expect(carregarContextoPrecificacao(produto.id, grafica.id)).rejects.toMatchObject({
          codigo: "DIGITAL_SEM_PAPEL",
        });
      },
      TIMEOUT_MS
    );

    it(
      "lança PAPEL_INVALIDO quando o papelId informado não existe ou não é MATERIA_PRIMA ativa",
      async () => {
        const { grafica, s } = await criarGrafica();
        const impressora = await prisma.impressoraDigital.create({
          data: { graficaId: grafica.id, nome: `HP Indigo ${s}`, custoPorClique: 0.08 },
        });
        const catalogo = await prisma.itemCatalogo.create({
          data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Cartão", nome: `Cartão Digital ${s}` },
        });
        const produto = await prisma.itemGrafica.create({
          data: {
            graficaId: grafica.id,
            itemCatalogoId: catalogo.id,
            modeloCalculo: "DIGITAL",
            impressoraDigitalId: impressora.id,
          },
        });

        await expect(
          carregarContextoPrecificacao(produto.id, grafica.id, undefined, { papelId: "id-que-nao-existe" })
        ).rejects.toMatchObject({ codigo: "PAPEL_INVALIDO" });
      },
      TIMEOUT_MS
    );

    it(
      "caminho feliz: carrega folhas + custoPorFolha do papel escolhido no orçamento e os parâmetros da impressora vinculada",
      async () => {
        const { grafica, s } = await criarGrafica();
        const impressora = await prisma.impressoraDigital.create({
          data: { graficaId: grafica.id, nome: `HP Indigo ${s}`, custoPorClique: 0.08 },
        });
        const catalogoPapel = await prisma.itemCatalogo.create({
          data: { graficaId: grafica.id, tipo: "MATERIA_PRIMA", categoria: "Papéis", nome: `Couché Digital ${s}` },
        });
        const papel = await prisma.itemGrafica.create({
          data: {
            graficaId: grafica.id,
            itemCatalogoId: catalogoPapel.id,
            modeloCalculo: "SIMPLES",
            precoCompra: 0.8, // custo por FOLHA (achado N4)
            formatosFolha: {
              create: [{ nome: `SRA3 ${s}`, larguraFolha: 0.32, alturaFolha: 0.45 }],
            },
          },
        });
        const catalogo = await prisma.itemCatalogo.create({
          data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Cartão", nome: `Cartão Digital ${s}` },
        });
        const produto = await prisma.itemGrafica.create({
          data: {
            graficaId: grafica.id,
            itemCatalogoId: catalogo.id,
            modeloCalculo: "DIGITAL",
            impressoraDigitalId: impressora.id,
          },
        });

        const contexto = await carregarContextoPrecificacao(produto.id, grafica.id, undefined, {
          papelId: papel.id,
        });

        expect(contexto.digital?.custoPorFolha).toBe(0.8);
        expect(contexto.digital?.folhas).toHaveLength(1);
        expect(contexto.digital?.folhas[0]).toMatchObject({
          nome: `SRA3 ${s}`,
          larguraFolha: 0.32,
          alturaFolha: 0.45,
        });
        expect(contexto.parametrosImpressoraDigital).toMatchObject({ custoPorClique: 0.08 });
        expect(contexto.impressoraDigitalUsada).toMatchObject({ id: impressora.id, nome: impressora.nome });
      },
      TIMEOUT_MS
    );
  }
);

describe(
  "carregarContextoPrecificacao — setup-por-peça (SERIGRAFIA/SUBLIMACAO/ESTAMPAGEM_QUENTE)",
  () => {
    it(
      "lança MAQUINA_SETUP_POR_PECA_NAO_CONFIGURADA quando o produto não tem máquina vinculada",
      async () => {
        const { grafica, s } = await criarGrafica();
        const catalogo = await prisma.itemCatalogo.create({
          data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Camiseta", nome: `Camiseta Serigrafia ${s}` },
        });
        const produto = await prisma.itemGrafica.create({
          data: {
            graficaId: grafica.id,
            itemCatalogoId: catalogo.id,
            modeloCalculo: "SERIGRAFIA",
            // maquinaSetupPorPecaId propositalmente ausente
          },
        });

        await expect(carregarContextoPrecificacao(produto.id, grafica.id)).rejects.toMatchObject({
          codigo: "MAQUINA_SETUP_POR_PECA_NAO_CONFIGURADA",
        });
      },
      TIMEOUT_MS
    );

    it(
      "caminho feliz: carrega os parâmetros da máquina vinculada (custoPorSetup/custoPorPeca/custoMinimo)",
      async () => {
        const { grafica, s } = await criarGrafica();
        const maquina = await prisma.maquinaSetupPorPeca.create({
          data: {
            graficaId: grafica.id,
            nome: `Carrossel 6 cores ${s}`,
            tipoProcesso: "SERIGRAFIA",
            custoPorSetup: 80,
            custoPorPeca: 3.5,
            custoMinimo: 150,
          },
        });
        const catalogo = await prisma.itemCatalogo.create({
          data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Camiseta", nome: `Camiseta Serigrafia ${s}` },
        });
        const produto = await prisma.itemGrafica.create({
          data: {
            graficaId: grafica.id,
            itemCatalogoId: catalogo.id,
            modeloCalculo: "SERIGRAFIA",
            maquinaSetupPorPecaId: maquina.id,
          },
        });

        const contexto = await carregarContextoPrecificacao(produto.id, grafica.id);

        expect(contexto.parametrosMaquinaSetupPorPeca).toMatchObject({
          custoPorSetup: 80,
          custoPorPeca: 3.5,
          custoMinimo: 150,
        });
        expect(contexto.maquinaSetupPorPecaUsada).toMatchObject({ id: maquina.id, nome: maquina.nome });
      },
      TIMEOUT_MS
    );

    it(
      "SUBLIMACAO e ESTAMPAGEM_QUENTE também carregam pelo mesmo branch (não só SERIGRAFIA)",
      async () => {
        const { grafica, s } = await criarGrafica();
        const maquina = await prisma.maquinaSetupPorPeca.create({
          data: {
            graficaId: grafica.id,
            nome: `Prensa térmica ${s}`,
            tipoProcesso: "SUBLIMACAO",
            custoPorSetup: 10,
            custoPorPeca: 2,
            custoMinimo: 40,
          },
        });
        const catalogo = await prisma.itemCatalogo.create({
          data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Caneca", nome: `Caneca Sublimação ${s}` },
        });
        const produto = await prisma.itemGrafica.create({
          data: {
            graficaId: grafica.id,
            itemCatalogoId: catalogo.id,
            modeloCalculo: "SUBLIMACAO",
            maquinaSetupPorPecaId: maquina.id,
          },
        });

        const contexto = await carregarContextoPrecificacao(produto.id, grafica.id);

        expect(contexto.parametrosMaquinaSetupPorPeca).toMatchObject({ custoPorSetup: 10, custoPorPeca: 2 });
      },
      TIMEOUT_MS
    );
  }
);

describe(
  "resolverConfigAcabamentos — achado N16 (filtro de ativo)",
  () => {
    async function criarAcabamento(graficaId: string, s: string, ativo: boolean) {
      const catalogo = await prisma.itemCatalogo.create({
        data: { graficaId, tipo: "SERVICO", categoria: "Acabamento", nome: `Laminação ${s}` },
      });
      return prisma.itemGrafica.create({
        data: {
          graficaId,
          itemCatalogoId: catalogo.id,
          modeloCalculo: "M2",
          ativo,
          precoCompra: 2,
          configuracaoAcabamento: {
            create: { baseCobranca: "M2", estagio: "POS_REFILE", custoSetup: 10, custoMinimo: 5 },
          },
        },
      });
    }

    it(
      "acabamento ativo aparece nas opções (resolve normalmente)",
      async () => {
        const { grafica, s } = await criarGrafica();
        const acabamento = await criarAcabamento(grafica.id, s, true);

        const resolvidos = await resolverConfigAcabamentos([acabamento.id], grafica.id);

        expect(resolvidos).toHaveLength(1);
        expect(resolvidos[0]).toMatchObject({
          itemGraficaId: acabamento.id,
          baseCobranca: "M2",
          custoUnitario: 2,
          custoSetup: 10,
          custoMinimo: 5,
        });
      },
      TIMEOUT_MS
    );

    it(
      "acabamento desativado não aparece mais nas opções (lança CUSTO_INVALIDO)",
      async () => {
        const { grafica, s } = await criarGrafica();
        const acabamento = await criarAcabamento(grafica.id, s, false);

        await expect(resolverConfigAcabamentos([acabamento.id], grafica.id)).rejects.toMatchObject({
          codigo: "CUSTO_INVALIDO",
        });
        await expect(resolverConfigAcabamentos([acabamento.id], grafica.id)).rejects.toBeInstanceOf(
          ErroPrecificacao
        );
      },
      TIMEOUT_MS
    );
  }
);

describe(
  "carregarContextoPrecificacao — M2 / ConfiguracaoEmenda (achado A9)",
  () => {
    it(
      "sem ConfiguracaoEmenda cadastrada: contexto.m2.configuracaoEmenda fica undefined (comportamento de hoje)",
      async () => {
        const { grafica, s } = await criarGrafica();
        const catalogo = await prisma.itemCatalogo.create({
          data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Lona", nome: `Backdrop ${s}` },
        });
        const produto = await prisma.itemGrafica.create({
          data: {
            graficaId: grafica.id,
            itemCatalogoId: catalogo.id,
            modeloCalculo: "M2",
            precoCompra: 20,
            custoImpressaoM2: 8,
            areaMinimaFaturavel: 0.5,
            bobinas: { create: [{ larguraNominal: 1.5, refile: 0.02 }] },
          },
        });

        const contexto = await carregarContextoPrecificacao(produto.id, grafica.id);

        expect(contexto.m2?.configuracaoEmenda).toBeUndefined();
      },
      TIMEOUT_MS
    );

    it(
      "com ConfiguracaoEmenda cadastrada: contexto.m2.configuracaoEmenda vem preenchido do banco",
      async () => {
        const { grafica, s } = await criarGrafica();
        const catalogo = await prisma.itemCatalogo.create({
          data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Lona", nome: `Backdrop com emenda ${s}` },
        });
        const produto = await prisma.itemGrafica.create({
          data: {
            graficaId: grafica.id,
            itemCatalogoId: catalogo.id,
            modeloCalculo: "M2",
            precoCompra: 20,
            custoImpressaoM2: 8,
            areaMinimaFaturavel: 0.5,
            bobinas: { create: [{ larguraNominal: 1.5, refile: 0.02 }] },
            configuracaoEmenda: {
              create: { custoPorMetroLinear: 15, sobreposicaoM: 0.05 },
            },
          },
        });

        const contexto = await carregarContextoPrecificacao(produto.id, grafica.id);

        expect(contexto.m2?.configuracaoEmenda).toMatchObject({
          custoPorMetroLinear: 15,
          sobreposicaoM: 0.05,
        });
      },
      TIMEOUT_MS
    );
  }
);

describe(
  "carregarContextoPrecificacao — OFFSET / origem do preço do papel (achado N12)",
  () => {
    async function criarProdutoOffset(
      grafica: { id: string },
      s: string,
      opts: { gramaturasCadastradas: number[]; gramaturaEscolhida: number }
    ) {
      const prensa = await prisma.prensa.create({
        data: { graficaId: grafica.id, nome: `Prensa Offset ${s}` },
      });
      const catalogoPapel = await prisma.itemCatalogo.create({
        data: { graficaId: grafica.id, tipo: "MATERIA_PRIMA", categoria: "Papel", nome: `Couché ${s}` },
      });
      const papel = await prisma.itemGrafica.create({
        data: {
          graficaId: grafica.id,
          itemCatalogoId: catalogoPapel.id,
          modeloCalculo: "SIMPLES",
          tabelaPrecoPapel: {
            create: opts.gramaturasCadastradas.map((gramatura) => ({
              gramatura,
              precoKg: 10 + gramatura / 100,
            })),
          },
        },
      });
      const catalogoProduto = await prisma.itemCatalogo.create({
        data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Livro", nome: `Livro Offset ${s}` },
      });
      const produto = await prisma.itemGrafica.create({
        data: {
          graficaId: grafica.id,
          itemCatalogoId: catalogoProduto.id,
          modeloCalculo: "OFFSET",
          prensaId: prensa.id,
          papelId: papel.id,
          gramaturaGm2: opts.gramaturaEscolhida,
          formatosFolha: { create: [{ nome: `Fechada ${s}`, larguraFolha: 0.66, alturaFolha: 0.96 }] },
        },
      });
      return produto;
    }

    it(
      "gramatura cadastrada exatamente: contexto.offset.origemPrecoPapel = EXATO e gramaturaBasePapel = a própria gramatura",
      async () => {
        const { grafica, s } = await criarGrafica();
        const produto = await criarProdutoOffset(grafica, s, {
          gramaturasCadastradas: [90, 150, 300],
          gramaturaEscolhida: 150,
        });

        const contexto = await carregarContextoPrecificacao(produto.id, grafica.id);

        expect(contexto.offset).toMatchObject({
          origemPrecoPapel: "EXATO",
          gramaturaBasePapel: 150,
          precoPorKg: 11.5,
        });
      },
      TIMEOUT_MS
    );

    it(
      "gramatura NÃO cadastrada: cai no fallback e contexto.offset.origemPrecoPapel = APROXIMADO, com gramaturaBasePapel da linha realmente usada (não a gramatura pedida)",
      async () => {
        const { grafica, s } = await criarGrafica();
        // 75 não está cadastrado — 90 é o mais próximo (distância 15 vs 45 de 120).
        const produto = await criarProdutoOffset(grafica, s, {
          gramaturasCadastradas: [90, 120],
          gramaturaEscolhida: 75,
        });

        const contexto = await carregarContextoPrecificacao(produto.id, grafica.id);

        expect(contexto.offset).toMatchObject({
          origemPrecoPapel: "APROXIMADO",
          gramaturaBasePapel: 90,
          precoPorKg: 10.9,
          gramaturaGm2: 75, // a gramatura REAL da folha (peso) não muda, só o R$/kg usado é aproximado
        });
      },
      TIMEOUT_MS
    );

    // Achado N8 da auditoria de código (2026-09-04) — papel e gramatura do
    // Offset passam a ser sobrepostos POR ORÇAMENTO (dadosOffset), mesmo
    // padrão de dadosEtiqueta/dadosDigital acima — mas o produto continua
    // exigindo papel/gramatura fixos em Catálogo como fallback (comportamento
    // de hoje 100% preservado quando dadosOffset não vem, ou vem parcial).
    describe("papel/gramatura por orçamento (achado N8)", () => {
      it(
        "sem dadosOffset: usa o papel/gramatura FIXOS do produto, sem override nenhum (zero regressão)",
        async () => {
          const { grafica, s } = await criarGrafica();
          const produto = await criarProdutoOffset(grafica, s, {
            gramaturasCadastradas: [90, 150, 300],
            gramaturaEscolhida: 150,
          });

          const contexto = await carregarContextoPrecificacao(produto.id, grafica.id);

          expect(contexto.offset).toMatchObject({ gramaturaGm2: 150, precoPorKg: 11.5 });
          expect(contexto.offset?.papelIdOverride).toBeUndefined();
          expect(contexto.offset?.gramaturaGm2Override).toBeUndefined();
        },
        TIMEOUT_MS
      );

      it(
        "lança PAPEL_INVALIDO quando o papelId do override não existe ou não é MATERIA_PRIMA ativa",
        async () => {
          const { grafica, s } = await criarGrafica();
          const produto = await criarProdutoOffset(grafica, s, {
            gramaturasCadastradas: [150],
            gramaturaEscolhida: 150,
          });

          await expect(
            carregarContextoPrecificacao(produto.id, grafica.id, undefined, undefined, {
              papelId: "id-que-nao-existe",
            })
          ).rejects.toMatchObject({ codigo: "PAPEL_INVALIDO" });
        },
        TIMEOUT_MS
      );

      it(
        "com papel diferente escolhido no orçamento: preço vem da TABELA do papel escolhido, não do papel fixo do produto",
        async () => {
          const { grafica, s } = await criarGrafica();
          // Papel fixo do produto: 10.9/kg a 150g. Papel alternativo escolhido
          // no orçamento: 20/kg a 150g — bem diferente, pra diferença ficar óbvia.
          const produto = await criarProdutoOffset(grafica, s, {
            gramaturasCadastradas: [150],
            gramaturaEscolhida: 150,
          });
          const catalogoPapelAlt = await prisma.itemCatalogo.create({
            data: { graficaId: grafica.id, tipo: "MATERIA_PRIMA", categoria: "Papel", nome: `Reciclado ${s}` },
          });
          const papelAlternativo = await prisma.itemGrafica.create({
            data: {
              graficaId: grafica.id,
              itemCatalogoId: catalogoPapelAlt.id,
              modeloCalculo: "SIMPLES",
              tabelaPrecoPapel: { create: [{ gramatura: 150, precoKg: 20 }] },
            },
          });

          const contextoSemOverride = await carregarContextoPrecificacao(produto.id, grafica.id);
          const contextoComOverride = await carregarContextoPrecificacao(
            produto.id,
            grafica.id,
            undefined,
            undefined,
            { papelId: papelAlternativo.id }
          );

          expect(contextoSemOverride.offset?.precoPorKg).toBe(11.5); // 10 + 150/100, papel do produto
          expect(contextoComOverride.offset?.precoPorKg).toBe(20); // papel alternativo escolhido no orçamento
          expect(contextoComOverride.offset?.papelIdOverride).toBe(papelAlternativo.id);
          // Geometria de imposição (folhas) continua vindo do PRODUTO — o
          // achado é só sobre papelId/gramaturaGm2, nunca formatosFolha.
          expect(contextoComOverride.offset?.folhas).toEqual(contextoSemOverride.offset?.folhas);
        },
        TIMEOUT_MS
      );

      it(
        "com gramatura diferente escolhida no orçamento: resolverPrecoPapel usa a nova gramatura contra a MESMA tabela do papel fixo do produto",
        async () => {
          const { grafica, s } = await criarGrafica();
          const produto = await criarProdutoOffset(grafica, s, {
            gramaturasCadastradas: [90, 150, 300],
            gramaturaEscolhida: 150, // gramatura fixa do produto
          });

          const contextoSemOverride = await carregarContextoPrecificacao(produto.id, grafica.id);
          const contextoComOverride = await carregarContextoPrecificacao(
            produto.id,
            grafica.id,
            undefined,
            undefined,
            { gramaturaGm2: 300 }
          );

          expect(contextoSemOverride.offset?.gramaturaGm2).toBe(150);
          expect(contextoSemOverride.offset?.precoPorKg).toBe(11.5); // 10 + 150/100

          expect(contextoComOverride.offset?.gramaturaGm2).toBe(300);
          expect(contextoComOverride.offset?.precoPorKg).toBe(13); // 10 + 300/100
          expect(contextoComOverride.offset?.gramaturaGm2Override).toBe(300);
          // gramatura override sozinha não mexe no papel usado.
          expect(contextoComOverride.offset?.papelIdOverride).toBeUndefined();
        },
        TIMEOUT_MS
      );
    });
  }
);
