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
    { nome: "Papel Couché 300g", precoCompra: 0.42, estoqueAtual: 5000, estoqueMinimo: 500 },
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
