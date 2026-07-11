import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { hashPassword } from "../src/lib/auth/password";
import { CATALOGO_MESTRE } from "../src/lib/catalogo-mestre";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const SENHA_DEMO = "Demo1234!";

async function main() {
  // Catálogo mestre: global (graficaId=null), igual para todas as gráficas. Cada
  // gráfica escolhe o que usa/vende em /catalogo, então isso só precisa ser
  // semeado uma vez. Dedup feito na aplicação (não via skipDuplicates): o
  // Postgres trata NULL como distinto em índices únicos, então a constraint
  // [graficaId, tipo, nome] não pega duplicados entre linhas com graficaId=null.
  const mestreExistente = await prisma.itemCatalogo.findMany({
    where: { graficaId: null },
    select: { tipo: true, nome: true },
  });
  const chave = (tipo: string, nome: string) => `${tipo}::${nome}`;
  const jaExiste = new Set(mestreExistente.map((i) => chave(i.tipo, i.nome)));
  const itensNovos = CATALOGO_MESTRE.filter((i) => !jaExiste.has(chave(i.tipo, i.nome)));
  if (itensNovos.length > 0) {
    await prisma.itemCatalogo.createMany({ data: itensNovos });
  }
  console.log("Catálogo mestre:", itensNovos.length, "itens novos (de", CATALOGO_MESTRE.length, "no total)");

  const grafica = await prisma.grafica.upsert({
    where: { slug: "grafica-modelo" },
    update: {},
    create: {
      nome: "Gráfica Modelo",
      slug: "grafica-modelo",
    },
  });

  const senhaHashDemo = await hashPassword(SENHA_DEMO);

  await prisma.usuario.upsert({
    where: { email: "dono@graficamodelo.com.br" },
    update: { senhaHash: senhaHashDemo },
    create: {
      graficaId: grafica.id,
      nome: "Dono da Gráfica",
      email: "dono@graficamodelo.com.br",
      senhaHash: senhaHashDemo,
      papel: "DONO",
    },
  });

  await prisma.cliente.upsert({
    where: { id: "cliente-demo-seed" },
    update: {},
    create: {
      id: "cliente-demo-seed",
      graficaId: grafica.id,
      nome: "Cliente Demonstração",
      email: "cliente@exemplo.com.br",
      telefone: "(11) 99999-0000",
    },
  });

  // Seleção de exemplo: alguns produtos com preço de venda, matérias-primas com
  // preço de compra + estoque, e um serviço — mostrando os três tipos do catálogo.
  const selecoes: Array<{
    nome: string;
    precoCompra?: number;
    precoVenda?: number;
    estoqueAtual?: number;
    estoqueMinimo?: number;
  }> = [
    { nome: "Cartão de Visita", precoCompra: 0.12, precoVenda: 0.35 },
    { nome: "Banner em Lona", precoCompra: 18.5, precoVenda: 45.0 },
    { nome: "Panfleto / Flyer", precoCompra: 0.06, precoVenda: 0.18 },
    { nome: "Papel Couché", precoCompra: 0.42, estoqueAtual: 5000, estoqueMinimo: 500 },
    { nome: "Lona 440g", precoCompra: 18.5, estoqueAtual: 200, estoqueMinimo: 20 },
    { nome: "Laminação Fosca", precoVenda: 8.0 },
  ];

  for (const s of selecoes) {
    const item = await prisma.itemCatalogo.findFirstOrThrow({
      where: { nome: s.nome },
    });
    await prisma.itemGrafica.upsert({
      where: { graficaId_itemCatalogoId: { graficaId: grafica.id, itemCatalogoId: item.id } },
      update: {},
      create: {
        graficaId: grafica.id,
        itemCatalogoId: item.id,
        precoCompra: s.precoCompra,
        precoVenda: s.precoVenda,
        estoqueAtual: s.estoqueAtual,
        estoqueMinimo: s.estoqueMinimo,
      },
    });
  }

  // Parâmetros do motor de precificação avançado — cria com os defaults do schema
  // se ainda não existir (mesmo padrão self-healing de carregarParametrosTenant).
  await prisma.parametrosGrafica.upsert({
    where: { graficaId: grafica.id },
    update: {},
    create: { graficaId: grafica.id },
  });

  // Prensa offset demo — só pra Configurações > Prensas não nascer vazia pro
  // usuário explorar. Nenhum produto do seed usa OFFSET ainda, então não precisa
  // ligar a nenhum ItemGrafica.
  await prisma.prensa.upsert({
    where: { graficaId_nome: { graficaId: grafica.id, nome: "Prensa Principal" } },
    update: {},
    create: { graficaId: grafica.id, nome: "Prensa Principal" },
  });

  // "Banner em Lona" é o único item ligado ao motor avançado nesta rodada (cenário
  // M2): marca modeloCalculo=M2 e cadastra as bobinas disponíveis. O precoCompra
  // já setado acima (18.5) segue sendo o custo por m² de lona.
  const bannerLona = await prisma.itemCatalogo.findFirstOrThrow({
    where: { nome: "Banner em Lona" },
  });
  const bannerLonaGrafica = await prisma.itemGrafica.update({
    where: { graficaId_itemCatalogoId: { graficaId: grafica.id, itemCatalogoId: bannerLona.id } },
    data: {
      modeloCalculo: "M2",
      custoImpressaoM2: 6.0,
      areaMinimaFaturavel: 0.25,
    },
  });

  await prisma.bobinaMaterial.deleteMany({ where: { itemGraficaId: bannerLonaGrafica.id } });
  await prisma.bobinaMaterial.createMany({
    data: [
      { itemGraficaId: bannerLonaGrafica.id, larguraNominal: 1.0, refile: 0.02 },
      { itemGraficaId: bannerLonaGrafica.id, larguraNominal: 1.2, refile: 0.02 },
      { itemGraficaId: bannerLonaGrafica.id, larguraNominal: 1.5, refile: 0.02 },
    ],
  });

  // "Papel Couché" é o papel de demonstração: um item só, com gramaturas como
  // subtópico (TabelaPrecoPapel) em vez de um cadastro por gramatura — ver
  // src/lib/pricing/papel.ts. Preços médios de mercado, ponto de partida.
  const papelCouche = await prisma.itemCatalogo.findFirstOrThrow({
    where: { nome: "Papel Couché" },
  });
  const papelCoucheGrafica = await prisma.itemGrafica.findFirstOrThrow({
    where: { graficaId: grafica.id, itemCatalogoId: papelCouche.id },
  });
  await prisma.tabelaPrecoPapel.deleteMany({ where: { itemGraficaId: papelCoucheGrafica.id } });
  await prisma.tabelaPrecoPapel.createMany({
    data: [
      { itemGraficaId: papelCoucheGrafica.id, gramatura: 90, precoKg: 12.5 },
      { itemGraficaId: papelCoucheGrafica.id, gramatura: 115, precoKg: 12.9 },
      { itemGraficaId: papelCoucheGrafica.id, gramatura: 150, precoKg: 13.4 },
      { itemGraficaId: papelCoucheGrafica.id, gramatura: 250, precoKg: 14.8 },
      { itemGraficaId: papelCoucheGrafica.id, gramatura: 300, precoKg: 15.6 },
    ],
  });

  // "Cartão de Visita" é o único item ligado ao motor avançado no cenário Offset:
  // usa o papel acima (Couché 300g) e a prensa demo cadastrada logo acima.
  const prensaDemo = await prisma.prensa.findFirstOrThrow({
    where: { graficaId: grafica.id, nome: "Prensa Principal" },
  });
  const cartaoVisita = await prisma.itemCatalogo.findFirstOrThrow({
    where: { nome: "Cartão de Visita" },
  });
  const cartaoVisitaGrafica = await prisma.itemGrafica.update({
    where: { graficaId_itemCatalogoId: { graficaId: grafica.id, itemCatalogoId: cartaoVisita.id } },
    data: {
      modeloCalculo: "OFFSET",
      gramaturaGm2: 300,
      papelId: papelCoucheGrafica.id,
      prensaId: prensaDemo.id,
    },
  });
  await prisma.formatoFolha.deleteMany({ where: { itemGraficaId: cartaoVisitaGrafica.id } });
  await prisma.formatoFolha.createMany({
    data: [{ itemGraficaId: cartaoVisitaGrafica.id, nome: "Fechada 66x96", larguraFolha: 0.66, alturaFolha: 0.96 }],
  });

  console.log("Seed concluído:", grafica.slug);
  console.log("Login demo: dono@graficamodelo.com.br /", SENHA_DEMO);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
