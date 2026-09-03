import type { PapelUsuario, TipoAlcada } from "@/generated/prisma/enums";

// Constantes reaproveitadas pelo CRUD de /configuracoes/alcadas (listas
// fechadas + rótulo em pt-BR) — moram aqui, não em actions.ts, porque um
// arquivo "use server" só pode exportar funções async (toda constante
// exportada de lá quebraria o build).
export const PAPEIS_PARA_ALCADA: PapelUsuario[] = ["DONO", "ADMIN", "OPERADOR"];
export const TIPOS_ALCADA: TipoAlcada[] = ["DESCONTO_ORCAMENTO", "APROVACAO_COMPRA"];
export const ROTULO_TIPO_ALCADA: Record<TipoAlcada, string> = {
  DESCONTO_ORCAMENTO: "Desconto de orçamento",
  APROVACAO_COMPRA: "Aprovação de compra",
};

// Achado A4 da Parte 6 (Configurações) da auditoria de abrangência
// (pesquisa-abrangencia-modulos.md) — resolução de alçada configurável em 1
// nível (sem aprovação encadeada de propósito, ver comentário do model
// AlcadaAprovacao no schema). Duas travas hoje eram fixas em código: desconto
// de orçamento acima de ParametrosGrafica.descontoMaxSemAprovacao só
// DONO/ADMIN aprova (src/app/orcamento/[id]/actions.ts), e aprovação de
// SolicitacaoCompra não tinha teto de valor nenhum
// (src/app/compras/status-transicao.ts). Funções puras de propósito — sem
// import de Prisma/DB — pra serem testáveis sem tocar o banco; quem chama
// busca as linhas de AlcadaAprovacao e resolve o papel do usuário antes.

// Formato mínimo de uma linha de AlcadaAprovacao pras funções abaixo — os
// call sites reais passam o resultado de um `findMany` filtrado por
// `graficaId`+`tipo` (já filtrado, então não é revalidado aqui).
export type AlcadaParaResolucao = {
  papel: PapelUsuario | null;
  usuarioId: string | null;
  limite: number; // % em DESCONTO_ORCAMENTO, R$ em APROVACAO_COMPRA
};

// Resolve o limite de DESCONTO (%) que este usuário pode aplicar sozinho,
// sem precisar de mais ninguém. Prioridade: alçada do USUÁRIO específico >
// alçada do PAPEL > comportamento de HOJE (DONO/ADMIN sem teto — 100%,
// OPERADOR travado no limite global `descontoMaxSemAprovacaoPadrao` da
// gráfica) — mesma regra que já existia hardcoded em
// aplicarDescontoItemOrcamento antes desta feature. Uma gráfica que nunca
// cadastrar nenhuma AlcadaAprovacao continua com o comportamento exato de
// hoje pra todo mundo (regressão zero).
export function resolverLimiteDesconto(
  usuario: { id: string; papel: PapelUsuario },
  alcadas: AlcadaParaResolucao[],
  descontoMaxSemAprovacaoPadrao: number
): number {
  const doUsuario = alcadas.find((a) => a.usuarioId === usuario.id);
  if (doUsuario) return doUsuario.limite;

  const doPapel = alcadas.find((a) => a.papel === usuario.papel);
  if (doPapel) return doPapel.limite;

  return usuario.papel === "DONO" || usuario.papel === "ADMIN" ? 100 : descontoMaxSemAprovacaoPadrao;
}

// Resolve o limite de VALOR (R$) que este usuário pode aprovar sozinho numa
// SolicitacaoCompra. Mesma prioridade de resolverLimiteDesconto, mas o
// fallback (nenhuma alçada configurada, nem de usuário nem de papel) é
// `null` = SEM TETO — é o comportamento de hoje pra Compras: qualquer papel
// com COMPRAS.podeEditar aprova qualquer valor, não havia trava nenhuma
// antes desta feature (diferente de Desconto, que já tinha o teto global +
// DONO/ADMIN hardcoded). Uma gráfica que nunca cadastrar nenhuma
// AlcadaAprovacao(tipo=APROVACAO_COMPRA) continua sem teto pra todo mundo.
export function resolverLimiteAprovacaoCompra(
  usuario: { id: string; papel: PapelUsuario },
  alcadas: AlcadaParaResolucao[]
): number | null {
  const doUsuario = alcadas.find((a) => a.usuarioId === usuario.id);
  if (doUsuario) return doUsuario.limite;

  const doPapel = alcadas.find((a) => a.papel === usuario.papel);
  if (doPapel) return doPapel.limite;

  return null;
}
