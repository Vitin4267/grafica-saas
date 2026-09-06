import { type Dec, paraDecimal } from "./decimal";
import { validarPedidoEditorial } from "./validar";
import type { ContextoEditorial, PedidoEditorial } from "./tipos";

export type ResultadoEditorial = {
  numeroCadernos: number;
  paginasEfetivas: number;
  pesoMioloKg: Dec; // por exemplar
  custoPapelMiolo: Dec; // total (× Q)
  custoImpressaoMiolo: Dec; // total
  areaCapaM2: Dec; // por exemplar (capa aberta, com orelhas se houver)
  pesoCapaKg: Dec; // por exemplar
  custoPapelCapa: Dec; // total
  custoImpressaoCapa: Dec; // total
  custoEncadernacao: Dec; // total
  custoBase: Dec;
};

// Achado A10 (rota 1) da auditoria de abrangência (pesquisa-abrangencia-
// modulos.md, Parte 1, 2026-09-06): Revista, Catálogo, Livro Brochura,
// Livro Capa Dura, Apostila, Encadernação Espiral e Wire-o não eram
// precificáveis — o motor OFFSET assume uma peça plana única (um papelId,
// uma gramatura, um corFrente/corVerso), enquanto um livro tem MIOLO e CAPA
// com papel/gramatura próprios, nº de páginas e encadernação.
//
// Cálculo de cadernos: o miolo é sempre composto de CADERNOS (signatures)
// de N páginas cada (16 é o padrão mais comum do mercado brasileiro, mas
// configurável por gráfica — ver ParametrosGrafica.paginasPorCadernoPadrao).
// numeroPaginas é arredondado pra CIMA pro próximo múltiplo do tamanho do
// caderno (ex: 100 páginas com caderno de 16 → 7 cadernos → 112 páginas
// efetivas) — nunca trunca, perderia conteúdo do livro.
//
// SIMPLIFICAÇÃO DELIBERADA (documentada também no schema, enum
// ModeloCalculo.EDITORIAL): diferente de OFFSET, este motor NÃO faz
// nesting/imposição de folha de máquina (sem Prensa, sem FormatoFolha) —
// cada caderno é custeado por PESO de papel (área da página × gramatura ×
// preço/kg), não pelo aproveitamento físico real de uma folha de prensa.
// Isso resolve os 7 produtos do catálogo mestre com uma fórmula simples e
// auditável; uma extensão futura que precise de precisão de nesting real
// teria que reaproveitar calcularOffset por componente (miolo/capa), o que
// é um escopo maior deliberadamente não tentado nesta rodada.
//
// custoMiolo = custoPapelMiolo (peso do papel × preço/kg) + custoImpressaoMiolo
// (área impressa × custoImpressaoM2 do produto) — ambos × Q.
// custoCapa = mesma fórmula, mas a "página" da capa é o desenvolvimento
// ABERTO (frente + verso do livro fechado, lado a lado, já que a capa é
// impressa e cortada como uma peça só) — largura = 2× a largura do miolo +
// 2× a largura da orelha (se houver). Simplificação: não soma a largura da
// LOMBADA (dependeria da espessura do papel × nº de folhas, cálculo de
// encadernadora que a Rota 1 não tenta resolver) — capa fica levemente
// subdimensionada pra livros muito grossos, aceitável pro nível de precisão
// desta rota (documentado como gap conhecido).
// custoEncadernacao = ItemGrafica.custoEncadernacaoPorPeca × Q (fixo por
// peça, não varia por TipoEncadernacao nesta v1 — ver comentário no schema).
export function calcularEditorial(pedido: PedidoEditorial, contexto: ContextoEditorial): ResultadoEditorial {
  validarPedidoEditorial(pedido, contexto);

  const Q = pedido.quantidade;
  const paginasPorCaderno = contexto.paginasPorCaderno;
  const numeroCadernos = Math.ceil(pedido.numeroPaginas / paginasPorCaderno);
  const paginasEfetivas = numeroCadernos * paginasPorCaderno;

  const areaPaginaM2 = paraDecimal(pedido.larguraM).times(pedido.alturaM);
  // Cada folha física (leaf) tem 2 páginas (frente e verso) — o peso de
  // papel do miolo é o número de FOLHAS, não de páginas.
  const numFolhasMiolo = paraDecimal(paginasEfetivas).dividedBy(2);
  const pesoMioloKg = numFolhasMiolo.times(areaPaginaM2).times(contexto.gramaturaMioloGm2).dividedBy(1000);
  const custoPapelMiolo = pesoMioloKg.times(contexto.precoPorKgMiolo).times(Q);
  // Impressão cobra por PÁGINA (cada face impressa), não por folha —
  // paginasEfetivas já conta as duas faces de cada folha.
  const custoImpressaoMiolo = paraDecimal(paginasEfetivas)
    .times(areaPaginaM2)
    .times(contexto.custoImpressaoM2)
    .times(Q);

  const larguraOrelhaM = pedido.temOrelhas ? paraDecimal(pedido.larguraOrelhaM ?? 0) : paraDecimal(0);
  // Capa aberta: 2× a largura da página fechada (frente + verso do livro,
  // lado a lado) + 2× a orelha, quando houver.
  const larguraCapaEfetivaM = paraDecimal(pedido.larguraM).times(2).plus(larguraOrelhaM.times(2));
  const areaCapaM2 = larguraCapaEfetivaM.times(pedido.alturaM);
  const pesoCapaKg = areaCapaM2.times(contexto.gramaturaCapaGm2).dividedBy(1000);
  const custoPapelCapa = pesoCapaKg.times(contexto.precoPorKgCapa).times(Q);
  const custoImpressaoCapa = areaCapaM2.times(contexto.custoImpressaoM2).times(Q);

  const custoEncadernacao = paraDecimal(contexto.custoEncadernacaoPorPeca).times(Q);

  const custoBase = custoPapelMiolo
    .plus(custoImpressaoMiolo)
    .plus(custoPapelCapa)
    .plus(custoImpressaoCapa)
    .plus(custoEncadernacao);

  return {
    numeroCadernos,
    paginasEfetivas,
    pesoMioloKg,
    custoPapelMiolo,
    custoImpressaoMiolo,
    areaCapaM2,
    pesoCapaKg,
    custoPapelCapa,
    custoImpressaoCapa,
    custoEncadernacao,
    custoBase,
  };
}
