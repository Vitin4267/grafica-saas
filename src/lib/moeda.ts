// Formatador de moeda único (pt-BR/BRL), reaproveitado em toda tela que exibe
// valores em R$ — evita reimplementar o mesmo Intl.NumberFormat em cada
// arquivo (server e client component podem importar, Intl existe nos dois).
export const formatoMoeda = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
