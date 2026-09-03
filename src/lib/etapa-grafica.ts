import "server-only";
import { prisma } from "@/lib/prisma";
import type { StatusPedido } from "@/generated/prisma/enums";
import {
  SEQUENCIA_STATUS_PEDIDO,
  ROTULOS_STATUS_PEDIDO,
  ESTAGIOS_ATRIBUIVEIS as ESTAGIOS_ATRIBUIVEIS_PADRAO,
} from "@/lib/producao-estagios";

// Achado A1 da auditoria de abrangência (Parte 2/Produção,
// pesquisa-abrangencia-modulos.md), Fase 1 — resolve, por gráfica, a
// sequência/rótulos/estágios que src/lib/producao-estagios.ts entregava
// antes como constantes fixas. Fonte de verdade em tempo de execução: model
// EtapaGrafica (bootstrap lazy — ver garantirEtapasGraficaPadrao abaixo,
// MESMO padrão de garantirCategoriasCustoPadrao em src/lib/custo-pedido.ts).

// ARTE nunca pode ficar inativa: é o status @default(ARTE) de todo Pedido
// novo (Pedido.status no schema) — desligá-la faria avancarStatusPedido
// receber um pedido recém-criado com status fora da sequência resolvida
// (indexOf -1, "Status do pedido inválido"). PRODUCAO nunca pode ficar
// inativa: é o destino cuja ENTRADA dispara a baixa de estoque automática
// (ver criarCustoAutomaticoConsumo/status-transicao.ts) — sem ela sempre
// presente na sequência, a transição que baixa estoque poderia deixar de
// existir e o material nunca seria descontado. ENTREGUE nunca pode ficar
// inativa: é o status terminal que um bom punhado de código fora desta
// sequência confere LITERALMENTE (STATUS_FINALIZADOS em producao/page.tsx,
// alerta-atraso.ts/alerta-prazo-email.ts excluindo pedido "ativo" com
// `notIn: ["ENTREGUE", "CANCELADO"]", podeCancelar em PedidoLinha.tsx) — se
// pudesse ser desativada, um pedido desta gráfica jamais alcançaria
// literalmente "ENTREGUE" (pararia pra sempre na última etapa ativa antes
// dela), e todo esse código literal pensaria pra sempre que o pedido segue
// "em aberto". Validado nas server actions de /configuracoes/etapas-producao
// (não só na UI).
export const ETAPAS_SEMPRE_ATIVAS: readonly StatusPedido[] = ["ARTE", "PRODUCAO", "ENTREGUE"];

// Mesmo conjunto que já excluía ARTE/CLICHE_FACA/ENTREGUE do
// ESTAGIOS_ATRIBUIVEIS padrão (ver producao-estagios.ts) — reaproveitado
// aqui, não redigitado, pra nunca divergir do motivo de produto original
// (ARTE é inicial; CLICHE_FACA baixa estoque e não pode ser confirmada sem
// login; ENTREGUE/CANCELADO são terminais).
const STATUS_ATRIBUIVEIS_PADRAO = new Set<StatusPedido>(
  ESTAGIOS_ATRIBUIVEIS_PADRAO.map((estagio) => estagio.valor)
);

// Idempotente: só cria as 8 linhas (uma por valor de StatusPedido, exceto
// CANCELADO — que nunca faz parte da sequência linear, ver comentário do
// enum no schema) se a gráfica ainda não tem NENHUMA EtapaGrafica. Todas
// nascem ativa=true/rotulo=null/ordem=posição em SEQUENCIA_STATUS_PEDIDO —
// ou seja, o bootstrap não muda absolutamente nada do comportamento
// observável no momento em que roda; só cria a linha que a tela de
// configuração (e o resolver abaixo) passam a poder editar dali em diante.
export async function garantirEtapasGraficaPadrao(graficaId: string): Promise<void> {
  const existentes = await prisma.etapaGrafica.count({ where: { graficaId } });
  if (existentes > 0) return;

  await prisma.etapaGrafica.createMany({
    data: SEQUENCIA_STATUS_PEDIDO.map((status, indice) => ({
      graficaId,
      status,
      ordem: indice,
    })),
  });
}

export type EtapaGraficaResolvida = {
  status: StatusPedido;
  ativa: boolean;
  // Já resolvido: rótulo customizado da gráfica, ou o padrão do sistema
  // quando a gráfica não sobrescreveu (rotuloCustom null).
  rotulo: string;
  rotuloCustom: string | null;
  ordem: number;
};

export type EtapasGraficaResolvidas = {
  // As 8 etapas configuráveis (CANCELADO fica de fora, nunca teve linha em
  // EtapaGrafica), na ordem configurada — ativas E inativas, pra alimentar
  // a tela de configuração.
  todas: EtapaGraficaResolvida[];
  // Só ativa=true, ordenada — substitui SEQUENCIA_STATUS_PEDIDO em runtime.
  // avancarStatusPedido (e todo código que decidia "próximo status = índice
  // + 1 do array literal") passa a usar ISTO.
  sequencia: StatusPedido[];
  // As 8 + CANCELADO (que não é customizável, sempre o rótulo padrão) —
  // substitui ROTULOS_STATUS_PEDIDO em runtime.
  rotulos: Record<StatusPedido, string>;
  // Etapas ATIVAS que vêm antes de PRODUCAO na sequência resolvida — mesmo
  // papel de ESTAGIOS_PRE_PRODUCAO, mas correto mesmo quando CLICHE_FACA
  // (ou qualquer outra etapa antes de PRODUCAO) está desativada pra esta
  // gráfica: gate do módulo de Entrega e de "existe custo real pra
  // comparar" em custo-producao.ts.
  estagiosPreProducao: StatusPedido[];
  // Sequência resolvida menos {ARTE, CLICHE_FACA, ENTREGUE} — mesmo papel
  // de ESTAGIOS_ATRIBUIVEIS, mas reflete etapas desativadas (uma etapa
  // inativa nem chega a aparecer aqui, porque não está em `sequencia`).
  estagiosAtribuiveis: { valor: StatusPedido; rotulo: string }[];
};

// Único ponto de leitura pra tudo que hoje dependia de SEQUENCIA_STATUS_
// PEDIDO/ROTULOS_STATUS_PEDIDO/ESTAGIOS_PRE_PRODUCAO/ESTAGIOS_ATRIBUIVEIS —
// bootstrap + 1 query, todo o resto é derivado em memória. Chamadores que
// precisam de mais de um desses campos (ex: status-transicao.ts) devem
// chamar ISTO uma vez só, não um helper por campo, pra não pagar bootstrap/
// query duas vezes na mesma requisição.
export async function resolverEtapasGrafica(graficaId: string): Promise<EtapasGraficaResolvidas> {
  await garantirEtapasGraficaPadrao(graficaId);

  const linhas = await prisma.etapaGrafica.findMany({
    where: { graficaId },
    orderBy: { ordem: "asc" },
  });

  const todas: EtapaGraficaResolvida[] = linhas.map((linha) => ({
    status: linha.status,
    ativa: linha.ativa,
    rotulo: linha.rotulo ?? ROTULOS_STATUS_PEDIDO[linha.status],
    rotuloCustom: linha.rotulo,
    ordem: linha.ordem,
  }));

  const sequencia = todas.filter((etapa) => etapa.ativa).map((etapa) => etapa.status);

  // CANCELADO nunca tem linha em EtapaGrafica (não é customizável, ver
  // comentário do model) — entra aqui só com o rótulo padrão, sempre.
  const rotulos: Record<StatusPedido, string> = { ...ROTULOS_STATUS_PEDIDO };
  for (const etapa of todas) {
    rotulos[etapa.status] = etapa.rotulo;
  }

  const indiceProducao = sequencia.indexOf("PRODUCAO");
  const estagiosPreProducao = indiceProducao === -1 ? [] : sequencia.slice(0, indiceProducao);

  const estagiosAtribuiveis = sequencia
    .filter((status) => STATUS_ATRIBUIVEIS_PADRAO.has(status))
    .map((status) => ({ valor: status, rotulo: rotulos[status] }));

  return { todas, sequencia, rotulos, estagiosPreProducao, estagiosAtribuiveis };
}
