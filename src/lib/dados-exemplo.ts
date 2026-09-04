import "server-only";

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import type { SegmentoGrafica } from "@/generated/prisma/enums";
import { calcularItemOrcamento, type DadosItemOrcamento } from "@/lib/orcamento-precificacao";
import { D } from "@/lib/pricing/decimal";
import { ehViolacaoDeChaveEstrangeira } from "@/lib/prisma-conflito";

// Dados de exemplo pra /comecar: um conjunto mínimo e COERENTE (máquina +
// matéria-prima quando o modelo exige + produto avançado + produto simples +
// acabamentos) que faz o motor de precificação (src/lib/pricing) produzir um
// orçamento de verdade, sem precisar o usuário configurar nada antes de ver o
// produto funcionando. Achado A6 da Parte 6 da auditoria de abrangência
// (2026-08-27): existe mais de um PACOTE, escolhido por Grafica.segmento —
// ver PACOTES_POR_SEGMENTO/resolverPacote no fim do arquivo. Antes desta
// feature havia só um pacote (o de baixo, hoje "padrão"), calibrado no
// perfil da gráfica-piloto (rótulos/etiquetas) e mostrado pra QUALQUER
// tenant — continua sendo o fallback pra segmento=null ou sem pacote
// dedicado. Achado F9 da mesma Parte 7 (2026-08-31) estendeu isso: o pacote
// do `segmento` PRINCIPAL continua decidindo o orçamento de demonstração
// gerado, mas o catálogo criado ganha um extra ADITIVO por
// `Grafica.segmentosSecundarios` — ver resolverPacotesSecundarios.
//
// Marcação/remoção: o schema não tem um campo "éExemplo" (fora do território
// desta feature alterar prisma/schema.prisma pra adicionar um, além do
// achado A6). A marcação é por NOME: todo registro criado aqui carrega o
// prefixo abaixo. Além disso, todo ItemCatalogo criado é PRIVADO desta
// gráfica (graficaId preenchido, nunca o catálogo mestre) — assim a limpeza
// nunca afeta outra gráfica nem corre o risco de colidir com um ItemGrafica
// real que o usuário venha a criar depois escolhendo um item do catálogo
// mestre com nome parecido. O CLIENTE de exemplo é compartilhado por todos
// os pacotes (só uma gráfica carrega um pacote por vez, então não há
// colisão) — é ele quem marca "dados de exemplo já carregados".
export const PREFIXO_EXEMPLO = "[Exemplo] ";

const NOME_CLIENTE = `${PREFIXO_EXEMPLO}Cliente Demonstração`;

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

// Descreve um pacote de exemplo completo: o catálogo que ele cria (dentro da
// MESMA transação do cliente, ver carregarDadosExemplo) e os dados de
// orçamento prontos pra exercitar o produto avançado e o produto simples
// (ver gerarOrcamentoExemplo). Cada pacote escolhe o modelo de cálculo mais
// representativo do segmento — não precisa ser Offset: M2/SERIGRAFIA etc.
// servem igual de "motor avançado" pro tour.
type PacoteExemplo = {
  nomeProdutoAvancado: string;
  nomeProdutoSimples: string;
  criarCatalogo: (tx: Prisma.TransactionClient, graficaId: string) => Promise<void>;
  dadosAvancado: DadosItemOrcamento;
  dadosSimples: DadosItemOrcamento;
};

const DADOS_ITEM_VAZIO: DadosItemOrcamento = {
  quantidade: 1,
  larguraCm: null,
  alturaCm: null,
  corFrente: null,
  corVerso: null,
  acabamentoIds: [],
  papelId: null,
  quantidadeCores: null,
  custoFaca: null,
  custoFrete: null,
  numeroCoresFlexo: null,
  numeroCliques: null,
  numeroSetups: null,
  numeroPontos: null,
  tempoEstimadoMin: null,
  metrosCorte: null,
  horasEstimadas: null,
  custoAquisicaoUnitario: null,
  materialFornecidoPeloCliente: false,
  margemLucroOverride: null,
};

// ---------------------------------------------------------------------------
// Pacote PADRÃO — perfil rótulos/etiquetas + offset comercial (o pacote
// original, calibrado na gráfica-piloto). Fallback pra segmento=null (tenant
// anterior a este campo, ou que não respondeu) e pra qualquer segmento sem
// pacote dedicado abaixo.
// ---------------------------------------------------------------------------

const NOME_PRENSA_PADRAO = `${PREFIXO_EXEMPLO}Prensa Offset`;
const NOME_PAPEL_PADRAO = `${PREFIXO_EXEMPLO}Papel Couché`;
const NOME_PRODUTO_OFFSET_PADRAO = `${PREFIXO_EXEMPLO}Cartão de Visita`;
const NOME_PRODUTO_SIMPLES_PADRAO = `${PREFIXO_EXEMPLO}Panfleto A5`;
const NOME_ACABAMENTO_LAMINACAO_PADRAO = `${PREFIXO_EXEMPLO}Laminação Fosca`;
const NOME_ACABAMENTO_CORTE_PADRAO = `${PREFIXO_EXEMPLO}Corte Reto`;
const NOME_ACABAMENTO_VINCO_PADRAO = `${PREFIXO_EXEMPLO}Vinco / Dobra`;

// Formato de folha "Fechada 66x96" com gramatura 300g/m² — mesma combinação
// usada em prisma/seed.ts (já validada em produção): a peça de cartão de
// visita (9x5cm) cabe várias vezes nessa folha (96 up, confirmado com um
// script tsx temporário que rodou carregarDadosExemplo + gerarOrcamentoExemplo
// contra o banco real antes de entregar esta feature — preço final saiu > 0
// sem ErroPrecificacao).
const PAPEL_GRAMATURAS_PADRAO = [
  { gramatura: 90, precoKg: 12.5 },
  { gramatura: 115, precoKg: 12.9 },
  { gramatura: 150, precoKg: 13.4 },
  { gramatura: 250, precoKg: 14.8 },
  { gramatura: 300, precoKg: 15.6 },
];

async function criarCatalogoPadrao(tx: Prisma.TransactionClient, graficaId: string): Promise<void> {
  const prensa = await tx.prensa.create({
    data: {
      graficaId,
      nome: NOME_PRENSA_PADRAO,
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
      nome: NOME_PAPEL_PADRAO,
      unidade: "FOLHA",
    },
  });
  const papel = await tx.itemGrafica.create({
    data: {
      graficaId,
      itemCatalogoId: itemCatalogoPapel.id,
      precoCompra: 0.42,
      tabelaPrecoPapel: { createMany: { data: PAPEL_GRAMATURAS_PADRAO } },
    },
  });

  // Produto Offset — o item que exercita o motor avançado de verdade
  // (nesting em folha, chapas, rodagem, setup — ver src/lib/pricing/offset.ts).
  const itemCatalogoOffset = await tx.itemCatalogo.create({
    data: {
      graficaId,
      tipo: "PRODUTO",
      categoria: "Papelaria e Impressos",
      nome: NOME_PRODUTO_OFFSET_PADRAO,
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
      nome: NOME_PRODUTO_SIMPLES_PADRAO,
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
  await criarAcabamentosExemplo(tx, graficaId, [
    {
      nome: NOME_ACABAMENTO_LAMINACAO_PADRAO,
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
      nome: NOME_ACABAMENTO_CORTE_PADRAO,
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
      nome: NOME_ACABAMENTO_VINCO_PADRAO,
      categoria: "Acabamento",
      unidade: "UNIDADE",
      precoCompra: 0.03,
      precoVenda: 0.12,
      baseCobranca: "UNIDADE",
      estagio: "POS_REFILE",
      custoSetup: 5,
      custoMinimo: 10,
    },
  ]);
}

const PACOTE_PADRAO: PacoteExemplo = {
  nomeProdutoAvancado: NOME_PRODUTO_OFFSET_PADRAO,
  nomeProdutoSimples: NOME_PRODUTO_SIMPLES_PADRAO,
  criarCatalogo: criarCatalogoPadrao,
  dadosAvancado: {
    ...DADOS_ITEM_VAZIO,
    quantidade: 5000,
    larguraCm: 9,
    alturaCm: 5,
    corFrente: 4,
    corVerso: 4,
  },
  dadosSimples: { ...DADOS_ITEM_VAZIO, quantidade: 1000 },
};

// ---------------------------------------------------------------------------
// Pacote COMUNICAÇÃO_VISUAL — banner em lona (M2, sem máquina própria: o
// motor M2 tira o custo de material do precoCompra do próprio produto — ver
// comentário de carregarContextoPrecificacao em src/lib/pricing/carregar.ts)
// + adesivo de recorte (SIMPLES).
// ---------------------------------------------------------------------------

const NOME_PRODUTO_BANNER = `${PREFIXO_EXEMPLO}Banner em Lona`;
const NOME_PRODUTO_ADESIVO = `${PREFIXO_EXEMPLO}Adesivo Vinil Recorte A4`;
const NOME_ACABAMENTO_ILHOS = `${PREFIXO_EXEMPLO}Ilhós`;
const NOME_ACABAMENTO_BAINHA = `${PREFIXO_EXEMPLO}Bainha/Solda de Borda`;
const NOME_ACABAMENTO_INSTALACAO = `${PREFIXO_EXEMPLO}Instalação`;

async function criarCatalogoComunicacaoVisual(
  tx: Prisma.TransactionClient,
  graficaId: string
): Promise<void> {
  // Produto M2 — sem prensa/máquina cadastrada: o custo do m² de lona vive
  // no próprio precoCompra do produto (mesmo caso "Banner em Lona" descrito
  // no comentário de carregarContextoPrecificacao), então basta uma bobina
  // pra o nesting rodar.
  const itemCatalogoBanner = await tx.itemCatalogo.create({
    data: {
      graficaId,
      tipo: "PRODUTO",
      categoria: "Comunicação Visual",
      nome: NOME_PRODUTO_BANNER,
    },
  });
  await tx.itemGrafica.create({
    data: {
      graficaId,
      itemCatalogoId: itemCatalogoBanner.id,
      precoCompra: 8.5, // custo do m² de lona
      precoVenda: 35, // referência — o motor M2 recalcula o preço real por pedido
      modeloCalculo: "M2",
      custoImpressaoM2: 8.0, // insumo de tinta digital grande formato, por m²
      areaMinimaFaturavel: 0.5,
      bobinas: {
        create: [{ larguraNominal: 1.4, refile: 0.02 }],
      },
    },
  });

  // Produto Simples — adesivo recorte vendido a preço fixo, sem motor avançado.
  const itemCatalogoAdesivo = await tx.itemCatalogo.create({
    data: {
      graficaId,
      tipo: "PRODUTO",
      categoria: "Comunicação Visual",
      nome: NOME_PRODUTO_ADESIVO,
    },
  });
  await tx.itemGrafica.create({
    data: {
      graficaId,
      itemCatalogoId: itemCatalogoAdesivo.id,
      precoCompra: 1.5,
      precoVenda: 6.0,
      modeloCalculo: "SIMPLES",
    },
  });

  await criarAcabamentosExemplo(tx, graficaId, [
    {
      nome: NOME_ACABAMENTO_ILHOS,
      categoria: "Acabamento",
      unidade: "UNIDADE",
      precoCompra: 0.3,
      precoVenda: 1.5,
      baseCobranca: "UNIDADE",
      estagio: "POS_REFILE",
      custoSetup: 0,
      custoMinimo: 10,
    },
    {
      nome: NOME_ACABAMENTO_BAINHA,
      categoria: "Acabamento",
      unidade: "METRO_QUADRADO",
      precoCompra: 1.0,
      precoVenda: 4.0,
      baseCobranca: "M2",
      estagio: "POS_REFILE",
      custoSetup: 0,
      custoMinimo: 10,
    },
    {
      nome: NOME_ACABAMENTO_INSTALACAO,
      categoria: "Acabamento",
      unidade: "UNIDADE",
      precoCompra: 0,
      precoVenda: 80,
      baseCobranca: "HORA",
      estagio: "POS_REFILE",
      custoSetup: 0,
      custoMinimo: 80,
    },
  ]);
}

const PACOTE_COMUNICACAO_VISUAL: PacoteExemplo = {
  nomeProdutoAvancado: NOME_PRODUTO_BANNER,
  nomeProdutoSimples: NOME_PRODUTO_ADESIVO,
  criarCatalogo: criarCatalogoComunicacaoVisual,
  dadosAvancado: {
    ...DADOS_ITEM_VAZIO,
    quantidade: 3,
    larguraCm: 200,
    alturaCm: 100,
  },
  dadosSimples: { ...DADOS_ITEM_VAZIO, quantidade: 20 },
};

// ---------------------------------------------------------------------------
// Pacote ESTAMPARIA_VESTUARIO — camiseta estampada em mesa serigráfica
// (SERIGRAFIA, motor de setup por peça — ver src/lib/pricing/setup-por-peca.ts)
// + caneca personalizada (SIMPLES).
// ---------------------------------------------------------------------------

const NOME_MAQUINA_SERIGRAFIA = `${PREFIXO_EXEMPLO}Mesa Serigráfica`;
const NOME_PRODUTO_CAMISETA = `${PREFIXO_EXEMPLO}Camiseta Estampada`;
const NOME_PRODUTO_CANECA = `${PREFIXO_EXEMPLO}Caneca Personalizada`;
const NOME_ACABAMENTO_SILK_COR = `${PREFIXO_EXEMPLO}Silk Adicional por Cor`;
const NOME_ACABAMENTO_NUMERACAO = `${PREFIXO_EXEMPLO}Numeração Individual`;
const NOME_ACABAMENTO_EMBALAGEM = `${PREFIXO_EXEMPLO}Dobra e Embalagem`;

async function criarCatalogoEstampariaVestuario(
  tx: Prisma.TransactionClient,
  graficaId: string
): Promise<void> {
  const maquina = await tx.maquinaSetupPorPeca.create({
    data: {
      graficaId,
      nome: NOME_MAQUINA_SERIGRAFIA,
      tipoProcesso: "SERIGRAFIA",
      custoPorSetup: 35, // custo de tela/arte por setup
      custoPorPeca: 1.2, // custo variável por peça impressa
      custoMinimo: 80, // piso do job
    },
  });

  // Produto de setup por peça — o item que exercita o motor avançado de
  // verdade pra este segmento (setup fixo + variável por peça + substrato).
  const itemCatalogoCamiseta = await tx.itemCatalogo.create({
    data: {
      graficaId,
      tipo: "PRODUTO",
      categoria: "Estamparia",
      nome: NOME_PRODUTO_CAMISETA,
    },
  });
  await tx.itemGrafica.create({
    data: {
      graficaId,
      itemCatalogoId: itemCatalogoCamiseta.id,
      precoCompra: 18, // camiseta em branco (peça)
      precoVenda: 35, // referência — o motor recalcula o preço real por pedido
      modeloCalculo: "SERIGRAFIA",
      maquinaSetupPorPecaId: maquina.id,
    },
  });

  // Produto Simples — caneca personalizada vendida a preço fixo.
  const itemCatalogoCaneca = await tx.itemCatalogo.create({
    data: {
      graficaId,
      tipo: "PRODUTO",
      categoria: "Estamparia",
      nome: NOME_PRODUTO_CANECA,
    },
  });
  await tx.itemGrafica.create({
    data: {
      graficaId,
      itemCatalogoId: itemCatalogoCaneca.id,
      precoCompra: 8,
      precoVenda: 22,
      modeloCalculo: "SIMPLES",
    },
  });

  await criarAcabamentosExemplo(tx, graficaId, [
    {
      nome: NOME_ACABAMENTO_SILK_COR,
      categoria: "Acabamento",
      unidade: "UNIDADE",
      precoCompra: 0.5,
      precoVenda: 2.0,
      baseCobranca: "UNIDADE",
      estagio: "POS_REFILE",
      custoSetup: 15,
      custoMinimo: 0,
    },
    {
      nome: NOME_ACABAMENTO_NUMERACAO,
      categoria: "Acabamento",
      unidade: "UNIDADE",
      precoCompra: 0.2,
      precoVenda: 1.0,
      baseCobranca: "UNIDADE",
      estagio: "POS_REFILE",
      custoSetup: 0,
      custoMinimo: 5,
    },
    {
      nome: NOME_ACABAMENTO_EMBALAGEM,
      categoria: "Acabamento",
      unidade: "UNIDADE",
      precoCompra: 0,
      precoVenda: 60,
      baseCobranca: "HORA",
      estagio: "POS_REFILE",
      custoSetup: 0,
      custoMinimo: 20,
    },
  ]);
}

const PACOTE_ESTAMPARIA_VESTUARIO: PacoteExemplo = {
  nomeProdutoAvancado: NOME_PRODUTO_CAMISETA,
  nomeProdutoSimples: NOME_PRODUTO_CANECA,
  criarCatalogo: criarCatalogoEstampariaVestuario,
  dadosAvancado: { ...DADOS_ITEM_VAZIO, quantidade: 50, numeroSetups: 1 },
  dadosSimples: { ...DADOS_ITEM_VAZIO, quantidade: 20 },
};

// ---------------------------------------------------------------------------
// Pacote BRINDES_PERSONALIZADOS — caneta e chaveiro personalizados (SIMPLES,
// com baseCompra + impressão/sublimação mínima). Brindes corporativos,
// presentes, promocionais — geralmente comprados semiacabados e personalizados.
// ---------------------------------------------------------------------------

const NOME_PRODUTO_CANETA_BRINDE = `${PREFIXO_EXEMPLO}Caneta Azul Personalizada`;
const NOME_PRODUTO_CHAVEIRO_BRINDE = `${PREFIXO_EXEMPLO}Chaveiro Acrílico Gravado`;
const NOME_ACABAMENTO_GRAVACAO_BRINDE = `${PREFIXO_EXEMPLO}Gravação a Laser`;
const NOME_ACABAMENTO_EMBALAGEM_BRINDE = `${PREFIXO_EXEMPLO}Embalagem Personalizada`;

async function criarCatalogoBrindesPersonalizados(
  tx: Prisma.TransactionClient,
  graficaId: string
): Promise<void> {
  // Produto Simples — caneta personalizada, preço fixo por unidade.
  const itemCatalogoCaneta = await tx.itemCatalogo.create({
    data: {
      graficaId,
      tipo: "PRODUTO",
      categoria: "Brindes",
      nome: NOME_PRODUTO_CANETA_BRINDE,
    },
  });
  await tx.itemGrafica.create({
    data: {
      graficaId,
      itemCatalogoId: itemCatalogoCaneta.id,
      precoCompra: 2.5, // caneta em branco
      precoVenda: 8.5, // referência — vendida com personalização mínima
      modeloCalculo: "SIMPLES",
    },
  });

  // Produto Simples — chaveiro de acrílico com gravação, preço fixo.
  const itemCatalogoChaveiro = await tx.itemCatalogo.create({
    data: {
      graficaId,
      tipo: "PRODUTO",
      categoria: "Brindes",
      nome: NOME_PRODUTO_CHAVEIRO_BRINDE,
    },
  });
  await tx.itemGrafica.create({
    data: {
      graficaId,
      itemCatalogoId: itemCatalogoChaveiro.id,
      precoCompra: 3.8,
      precoVenda: 14.5,
      modeloCalculo: "SIMPLES",
    },
  });

  await criarAcabamentosExemplo(tx, graficaId, [
    {
      nome: NOME_ACABAMENTO_GRAVACAO_BRINDE,
      categoria: "Acabamento",
      unidade: "UNIDADE",
      precoCompra: 0.8,
      precoVenda: 2.5,
      baseCobranca: "UNIDADE",
      estagio: "POS_REFILE",
      custoSetup: 15,
      custoMinimo: 20,
    },
    {
      nome: NOME_ACABAMENTO_EMBALAGEM_BRINDE,
      categoria: "Acabamento",
      unidade: "UNIDADE",
      precoCompra: 0.3,
      precoVenda: 1.5,
      baseCobranca: "UNIDADE",
      estagio: "POS_REFILE",
      custoSetup: 0,
      custoMinimo: 10,
    },
  ]);
}

const PACOTE_BRINDES_PERSONALIZADOS: PacoteExemplo = {
  nomeProdutoAvancado: NOME_PRODUTO_CANETA_BRINDE,
  nomeProdutoSimples: NOME_PRODUTO_CHAVEIRO_BRINDE,
  criarCatalogo: criarCatalogoBrindesPersonalizados,
  dadosAvancado: { ...DADOS_ITEM_VAZIO, quantidade: 500 },
  dadosSimples: { ...DADOS_ITEM_VAZIO, quantidade: 200 },
};

// ---------------------------------------------------------------------------
// Pacote CORTE_LASER_ACRILICO — display/troféu em acrílico (M2 por área de
// material cortado) + luminária de corte a laser (SIMPLES). Equipamento
// principal é o laser (máquina de corte com potência/velocidade/foco).
// ---------------------------------------------------------------------------

const NOME_MAQUINA_LASER = `${PREFIXO_EXEMPLO}Cortadora Laser CO2`;
const NOME_PRODUTO_DISPLAY_ACRILICO = `${PREFIXO_EXEMPLO}Display em Acrílico Cristal`;
const NOME_PRODUTO_LUMINARIA_LASER = `${PREFIXO_EXEMPLO}Luminária de Corte a Laser`;
const NOME_ACABAMENTO_POLIMENTO_LASER = `${PREFIXO_EXEMPLO}Polimento de Borda`;
const NOME_ACABAMENTO_GRAVACAO_LASER = `${PREFIXO_EXEMPLO}Gravação Profunda`;

async function criarCatalogoCorteAcrilico(
  tx: Prisma.TransactionClient,
  graficaId: string
): Promise<void> {
  const maquina = await tx.prensa.create({
    data: {
      graficaId,
      nome: NOME_MAQUINA_LASER,
      custoHoraMaq: 180, // laser é caro por hora
      torres: 1,
      custoChapa: 35, // "chapa" de acrílico na máquina
      folhasAcerto: 3, // menos acerto em laser
      tempoAcertoH: 0.25,
      custoMilheiroRod: 50, // não se aplica bem a laser, mas segue modelo Offset
      rodagemMinima: 1,
      perdaPercentPadrao: 0.02,
    },
  });

  // Produto M2 — display de acrílico (precisa de folha/bobina, usa modelo Offset
  // adaptado). Na prática, o laser corta a peça de um painel de acrílico, então
  // a área de material é o que interessa (M2).
  const itemCatalogoDisplay = await tx.itemCatalogo.create({
    data: {
      graficaId,
      tipo: "PRODUTO",
      categoria: "Corte a Laser",
      nome: NOME_PRODUTO_DISPLAY_ACRILICO,
    },
  });
  await tx.itemGrafica.create({
    data: {
      graficaId,
      itemCatalogoId: itemCatalogoDisplay.id,
      precoCompra: 25, // custo de folha/painel de acrílico cristal por m²
      precoVenda: 85, // referência — o motor M2 recalcula
      modeloCalculo: "M2",
      custoImpressaoM2: 15, // insumo laser (gastos com tubo/lentes)
      areaMinimaFaturavel: 0.1,
      bobinas: {
        create: [{ larguraNominal: 0.6, refile: 0.01 }],
      },
    },
  });

  // Produto Simples — luminária de corte a laser, vendida como peça pronta.
  const itemCatalogoLuminaria = await tx.itemCatalogo.create({
    data: {
      graficaId,
      tipo: "PRODUTO",
      categoria: "Corte a Laser",
      nome: NOME_PRODUTO_LUMINARIA_LASER,
    },
  });
  await tx.itemGrafica.create({
    data: {
      graficaId,
      itemCatalogoId: itemCatalogoLuminaria.id,
      precoCompra: 12,
      precoVenda: 45,
      modeloCalculo: "SIMPLES",
    },
  });

  await criarAcabamentosExemplo(tx, graficaId, [
    {
      nome: NOME_ACABAMENTO_POLIMENTO_LASER,
      categoria: "Acabamento",
      unidade: "METRO_QUADRADO",
      precoCompra: 2.5,
      precoVenda: 10,
      baseCobranca: "M2",
      estagio: "POS_REFILE",
      custoSetup: 0,
      custoMinimo: 15,
    },
    {
      nome: NOME_ACABAMENTO_GRAVACAO_LASER,
      categoria: "Acabamento",
      unidade: "UNIDADE",
      precoCompra: 1.5,
      precoVenda: 6.0,
      baseCobranca: "UNIDADE",
      estagio: "POS_REFILE",
      custoSetup: 25,
      custoMinimo: 30,
    },
  ]);
}

const PACOTE_CORTE_LASER_ACRILICO: PacoteExemplo = {
  nomeProdutoAvancado: NOME_PRODUTO_DISPLAY_ACRILICO,
  nomeProdutoSimples: NOME_PRODUTO_LUMINARIA_LASER,
  criarCatalogo: criarCatalogoCorteAcrilico,
  dadosAvancado: {
    ...DADOS_ITEM_VAZIO,
    quantidade: 10,
    larguraCm: 30,
    alturaCm: 20,
  },
  dadosSimples: { ...DADOS_ITEM_VAZIO, quantidade: 5 },
};

// ---------------------------------------------------------------------------
// Pacote EMBALAGEM_CARTONAGEM — caixa de papelão personalizada (M2, similar
// a banner) + saco de papel com logotipo (SIMPLES). Máquina: não tem máquina
// dedicada (terceiriza corte/dobra), só precisa de material (papelão, tinta).
// ---------------------------------------------------------------------------

const NOME_PRODUTO_CAIXA_PAPELAO = `${PREFIXO_EXEMPLO}Caixa de Papelão Personalizada`;
const NOME_PRODUTO_SACO_PAPEL = `${PREFIXO_EXEMPLO}Saco de Papel com Logo`;
const NOME_ACABAMENTO_MONTAGEM_CAIXA = `${PREFIXO_EXEMPLO}Montagem e Colagem`;
const NOME_ACABAMENTO_IMPRESSAO_DETALHE = `${PREFIXO_EXEMPLO}Impressão Detalhe Cor`;

async function criarCatalogoEmbalagemCartonagem(
  tx: Prisma.TransactionClient,
  graficaId: string
): Promise<void> {
  // Produto M2 — caixa de papelão (modelo similar a Banner: custo no precoCompra,
  // sem máquina própria — o motor M2 tira de precoCompra do produto).
  const itemCatalogoCaixa = await tx.itemCatalogo.create({
    data: {
      graficaId,
      tipo: "PRODUTO",
      categoria: "Embalagem",
      nome: NOME_PRODUTO_CAIXA_PAPELAO,
    },
  });
  await tx.itemGrafica.create({
    data: {
      graficaId,
      itemCatalogoId: itemCatalogoCaixa.id,
      precoCompra: 4.5, // custo de papelão/material por m²
      precoVenda: 18, // referência — o motor M2 recalcula
      modeloCalculo: "M2",
      custoImpressaoM2: 3.5, // tinta offset/flexo para embalagem
      areaMinimaFaturavel: 0.25,
      bobinas: {
        create: [{ larguraNominal: 1.2, refile: 0.02 }],
      },
    },
  });

  // Produto Simples — saco de papel com logo.
  const itemCatalogoSaco = await tx.itemCatalogo.create({
    data: {
      graficaId,
      tipo: "PRODUTO",
      categoria: "Embalagem",
      nome: NOME_PRODUTO_SACO_PAPEL,
    },
  });
  await tx.itemGrafica.create({
    data: {
      graficaId,
      itemCatalogoId: itemCatalogoSaco.id,
      precoCompra: 0.5,
      precoVenda: 2.2,
      modeloCalculo: "SIMPLES",
    },
  });

  await criarAcabamentosExemplo(tx, graficaId, [
    {
      nome: NOME_ACABAMENTO_MONTAGEM_CAIXA,
      categoria: "Acabamento",
      unidade: "UNIDADE",
      precoCompra: 0.4,
      precoVenda: 2.0,
      baseCobranca: "UNIDADE",
      estagio: "POS_REFILE",
      custoSetup: 10,
      custoMinimo: 20,
    },
    {
      nome: NOME_ACABAMENTO_IMPRESSAO_DETALHE,
      categoria: "Acabamento",
      unidade: "METRO_QUADRADO",
      precoCompra: 1.2,
      precoVenda: 5.0,
      baseCobranca: "M2",
      estagio: "PRE_REFILE",
      custoSetup: 0,
      custoMinimo: 15,
    },
  ]);
}

const PACOTE_EMBALAGEM_CARTONAGEM: PacoteExemplo = {
  nomeProdutoAvancado: NOME_PRODUTO_CAIXA_PAPELAO,
  nomeProdutoSimples: NOME_PRODUTO_SACO_PAPEL,
  criarCatalogo: criarCatalogoEmbalagemCartonagem,
  dadosAvancado: {
    ...DADOS_ITEM_VAZIO,
    quantidade: 1000,
    larguraCm: 40,
    alturaCm: 30,
  },
  dadosSimples: { ...DADOS_ITEM_VAZIO, quantidade: 5000 },
};

// ---------------------------------------------------------------------------
// Helpers compartilhados por todos os pacotes
// ---------------------------------------------------------------------------

type AcabamentoExemplo = {
  nome: string;
  categoria: string;
  unidade: "METRO_QUADRADO" | "UNIDADE";
  precoCompra: number;
  precoVenda: number;
  baseCobranca: "M2" | "UNIDADE" | "HORA";
  estagio: "PRE_REFILE" | "POS_REFILE";
  custoSetup: number;
  custoMinimo: number;
};

// SERVICO + ConfiguracaoAcabamento — mostram as opções de baseCobranca/
// estagio do motor. Não fazem parte do orçamento de exemplo gerado (o
// cálculo de item hoje não anexa acabamentos, ver calcularItemOrcamento em
// src/lib/orcamento-precificacao.ts), mas ficam disponíveis no catálogo pra
// o usuário já ver como configurar os dele.
async function criarAcabamentosExemplo(
  tx: Prisma.TransactionClient,
  graficaId: string,
  acabamentos: AcabamentoExemplo[]
): Promise<void> {
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
}

// Mapeia o segmento da gráfica pro pacote dedicado — só os segmentos com
// motor de cálculo claramente diferente do padrão ganharam pacote próprio
// até agora; os demais (ROTULOS_ETIQUETAS, OFFSET_COMERCIAL, EDITORIAL_LIVRO,
// GRAFICA_RAPIDA, OUTRO) caem no PACOTE_PADRAO — é razoavelmente
// representativo pra todos eles (motor Offset + Simples). Achado E4 (Parte 7):
// adicionados BRINDES_PERSONALIZADOS, CORTE_LASER_ACRILICO,
// EMBALAGEM_CARTONAGEM com pacotes dedicados.
const PACOTES_POR_SEGMENTO: Partial<Record<SegmentoGrafica, PacoteExemplo>> = {
  COMUNICACAO_VISUAL: PACOTE_COMUNICACAO_VISUAL,
  ESTAMPARIA_VESTUARIO: PACOTE_ESTAMPARIA_VESTUARIO,
  BRINDES_PERSONALIZADOS: PACOTE_BRINDES_PERSONALIZADOS,
  CORTE_LASER_ACRILICO: PACOTE_CORTE_LASER_ACRILICO,
  EMBALAGEM_CARTONAGEM: PACOTE_EMBALAGEM_CARTONAGEM,
};

async function resolverPacote(graficaId: string): Promise<PacoteExemplo> {
  const grafica = await prisma.grafica.findUnique({
    where: { id: graficaId },
    select: { segmento: true },
  });
  if (!grafica?.segmento) return PACOTE_PADRAO;
  return PACOTES_POR_SEGMENTO[grafica.segmento] ?? PACOTE_PADRAO;
}

// Achado F9 da Parte 7 da auditoria de abrangência (2026-08-31) — consumo
// ADITIVO de `Grafica.segmentosSecundarios` (ver comentário do campo no
// schema: nunca restritivo). O pacote PRINCIPAL continua decidindo o
// cliente/orçamento de demonstração (gerarOrcamentoExemplo só usa
// `pacote.dadosAvancado`/`dadosSimples` do pacote de `resolverPacote`
// acima) — isto só ACRESCENTA catálogo extra dos segmentos secundários que
// tenham pacote dedicado em PACOTES_POR_SEGMENTO, pra a gráfica híbrida ver
// produtos de exemplo mais parecidos com o negócio real dela. Nunca troca
// nem esconde nada do pacote principal, nunca remove um pacote secundário
// igual ao principal (dedupe evita criar o mesmo catálogo 2x, o que
// colidiria na constraint @@unique([graficaId, tipo, nome])).
async function resolverPacotesSecundarios(graficaId: string): Promise<PacoteExemplo[]> {
  const grafica = await prisma.grafica.findUnique({
    where: { id: graficaId },
    select: { segmento: true, segmentosSecundarios: true },
  });
  if (!grafica || grafica.segmentosSecundarios.length === 0) return [];

  const pacotePrincipal = grafica.segmento ? PACOTES_POR_SEGMENTO[grafica.segmento] : undefined;
  const vistos = new Set<PacoteExemplo>();
  const extras: PacoteExemplo[] = [];
  for (const segmentoSecundario of grafica.segmentosSecundarios) {
    const pacote = PACOTES_POR_SEGMENTO[segmentoSecundario];
    // Sem pacote dedicado (ex: os 5 valores novos do achado F9 ainda não têm
    // PacoteExemplo próprio) ou igual ao principal/já incluído — pula, nunca
    // duplica o PACOTE_PADRAO à toa (colidiria com o catálogo que o pacote
    // principal já criou, já que os dois usam os MESMOS nomes de produto).
    if (!pacote || pacote === pacotePrincipal || vistos.has(pacote)) continue;
    vistos.add(pacote);
    extras.push(pacote);
  }
  return extras;
}

export async function carregarDadosExemplo(graficaId: string): Promise<ResultadoCarregarExemplo> {
  if (await existemDadosExemplo(graficaId)) {
    return { ok: true, jaCarregado: true };
  }

  const pacote = await resolverPacote(graficaId);
  // Achado F9 — catálogo extra dos segmentos secundários, só ADITIVO (ver
  // comentário de resolverPacotesSecundarios acima). Lista vazia (gráfica
  // sem segmentosSecundarios, ou sem pacote dedicado pra nenhum deles) é o
  // caso comum de hoje — o loop abaixo não roda nada a mais nesse caso.
  const pacotesSecundarios = await resolverPacotesSecundarios(graficaId);

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

      await pacote.criarCatalogo(tx, graficaId);
      for (const pacoteSecundario of pacotesSecundarios) {
        await pacoteSecundario.criarCatalogo(tx, graficaId);
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
// + graficaId) — genérico o bastante pra limpar QUALQUER pacote (padrão,
// comunicação visual, estamparia...), já que todos marcam seus registros com
// o mesmo PREFIXO_EXEMPLO. Ordem de exclusão respeita as FKs Restrict do
// schema (produto antes da matéria-prima/máquina que ele referencia, item
// antes do ItemCatalogo, etc.) — ver comentários inline. Roda em duas
// transações separadas de propósito: se a segunda falhar (ex: usuário
// aprovou o orçamento de exemplo e ele virou pedido/nota fiscal de verdade,
// travando a exclusão do produto por FK), a primeira (orçamentos de exemplo
// ainda em rascunho) já fica removida mesmo assim, e não perde depois nesse
// último passo.
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

  // Fase 2: catálogo de exemplo (produtos, matéria-prima, acabamentos,
  // máquinas) + o próprio cliente de exemplo, só se nada real ainda depende
  // deles.
  let catalogoRemovido = true;
  try {
    await prisma.$transaction(async (tx) => {
      const itensCatalogoExemplo = await tx.itemCatalogo.findMany({
        where: { graficaId, nome: { startsWith: PREFIXO_EXEMPLO } },
        select: { id: true },
      });
      const itemCatalogoIds = itensCatalogoExemplo.map((i) => i.id);

      const itensGraficaExemplo = await tx.itemGrafica.findMany({
        where: { graficaId, itemCatalogoId: { in: itemCatalogoIds } },
        select: { id: true, itemCatalogo: { select: { tipo: true } } },
      });

      // Produtos e serviços primeiro — liberam a Restrict de papelId/
      // prensaId/maquinaSetupPorPecaId ao serem excluídos. Cascade cuida de
      // FormatoFolha/ConfiguracaoAcabamento/BobinaMaterial.
      const idsNaoMateriaPrima = itensGraficaExemplo
        .filter((i) => i.itemCatalogo.tipo !== "MATERIA_PRIMA")
        .map((i) => i.id);
      if (idsNaoMateriaPrima.length > 0) {
        await tx.itemGrafica.deleteMany({ where: { id: { in: idsNaoMateriaPrima } } });
      }

      // Matéria-prima (ex: papel do pacote padrão) por último entre os
      // ItemGrafica — cascade cuida de TabelaPrecoPapel.
      const idsMateriaPrima = itensGraficaExemplo
        .filter((i) => i.itemCatalogo.tipo === "MATERIA_PRIMA")
        .map((i) => i.id);
      if (idsMateriaPrima.length > 0) {
        await tx.itemGrafica.deleteMany({ where: { id: { in: idsMateriaPrima } } });
      }

      if (itemCatalogoIds.length > 0) {
        await tx.itemCatalogo.deleteMany({ where: { id: { in: itemCatalogoIds } } });
      }

      // Sem segmentosSecundarios (achado F9), só existe registro em UM destes
      // dois por gráfica (o pacote principal usa prensa OU máquina de setup
      // por peça, nunca os dois) — com segmentosSecundarios ambos podem ter
      // linha de verdade (ex: principal=PACOTE_PADRAO + secundário=
      // ESTAMPARIA_VESTUARIO). deleteMany com startsWith cobre os dois casos
      // igual — nunca é erro limpar zero linhas.
      await tx.prensa.deleteMany({ where: { graficaId, nome: { startsWith: PREFIXO_EXEMPLO } } });
      await tx.maquinaSetupPorPeca.deleteMany({
        where: { graficaId, nome: { startsWith: PREFIXO_EXEMPLO } },
      });
      await tx.cliente.delete({ where: { id: cliente.id } });
    });
  } catch (erro) {
    if (ehViolacaoDeChaveEstrangeira(erro)) {
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

  const pacote = await resolverPacote(graficaId);

  const cliente = await prisma.cliente.findFirst({
    where: { graficaId, nome: NOME_CLIENTE },
  });
  const itemAvancado = await prisma.itemGrafica.findFirst({
    where: { graficaId, ativo: true, itemCatalogo: { nome: pacote.nomeProdutoAvancado } },
  });
  const itemSimples = await prisma.itemGrafica.findFirst({
    where: { graficaId, ativo: true, itemCatalogo: { nome: pacote.nomeProdutoSimples } },
  });

  if (!cliente || !itemAvancado || !itemSimples) {
    return {
      ok: false,
      mensagem: "Dados de exemplo incompletos — tente carregar os dados de exemplo novamente.",
    };
  }

  // Reaproveita o MESMO ponto de cálculo usado por criarOrcamento (nunca
  // duplica a lógica de precificação) — ver src/lib/orcamento-precificacao.ts.
  const resultadoAvancado = await calcularItemOrcamento(itemAvancado, graficaId, pacote.dadosAvancado);
  if (!resultadoAvancado.ok) {
    return { ok: false, mensagem: `${pacote.nomeProdutoAvancado}: ${resultadoAvancado.mensagem}` };
  }

  const resultadoSimples = await calcularItemOrcamento(itemSimples, graficaId, pacote.dadosSimples);
  if (!resultadoSimples.ok) {
    return { ok: false, mensagem: `${pacote.nomeProdutoSimples}: ${resultadoSimples.mensagem}` };
  }

  const total = new D(resultadoAvancado.precoTotal).plus(resultadoSimples.precoTotal);

  // Snapshot legível de cores (ex: "4x4") só faz sentido pro modelo OFFSET —
  // qualquer outro modelo grava `cores: null`, mesmo comportamento de
  // sempre pro produto simples.
  const coresTexto =
    pacote.dadosAvancado.corFrente !== null
      ? `${pacote.dadosAvancado.corFrente}x${pacote.dadosAvancado.corVerso ?? 0}`
      : null;

  const orcamento = await prisma.orcamento.create({
    data: {
      graficaId,
      clienteId: cliente.id,
      usuarioId,
      total,
      itens: {
        create: [
          {
            itemGraficaId: itemAvancado.id,
            quantidade: pacote.dadosAvancado.quantidade,
            larguraCm: pacote.dadosAvancado.larguraCm,
            alturaCm: pacote.dadosAvancado.alturaCm,
            cores: coresTexto,
            precoUnitario: resultadoAvancado.precoUnitario,
            precoTotal: resultadoAvancado.precoTotal,
            modeloCalculo: resultadoAvancado.modeloCalculo,
            corFrente: resultadoAvancado.corFrente,
            corVerso: resultadoAvancado.corVerso,
            numeroSetups: resultadoAvancado.numeroSetups,
            breakdown: resultadoAvancado.breakdown ?? undefined,
          },
          {
            itemGraficaId: itemSimples.id,
            quantidade: pacote.dadosSimples.quantidade,
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
