import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type { OrigemConfirmacaoEtapa, StatusPedido } from "@/generated/prisma/enums";
import { validarSelecaoMaquinaOpcional } from "@/lib/manutencao-maquina";

// Achado B1/B2 da Parte 2 (Produção) da auditoria de abrangência: histórico
// de transição de etapa (ApontamentoEtapa), com a máquina que produziu cada
// etapa quando aplicável. Este módulo concentra a lógica pura/compartilhada
// entre os 3 canais que abrem/fecham apontamentos (painel autenticado
// /producao, link público /p/[token], QR /q/[token] — ver
// src/app/producao/status-transicao.ts) e os 2 pontos que criam o Pedido
// (aprovação do orçamento, autenticada e pública).

export type SelecaoMaquina = {
  prensaId: string | null;
  maquinaFlexografiaId: string | null;
  equipamentoId: string | null;
  impressoraDigitalId: string | null;
  maquinaSetupPorPecaId: string | null;
};

export const SELECAO_MAQUINA_VAZIA: SelecaoMaquina = {
  prensaId: null,
  maquinaFlexografiaId: null,
  equipamentoId: null,
  impressoraDigitalId: null,
  maquinaSetupPorPecaId: null,
};

// Os 5 campos possíveis de máquina num ApontamentoEtapa — mesmo padrão de
// CAMPOS_MAQUINA em configuracoes/maquinas/manutencao/actions.ts (não
// reaproveitado literalmente de lá porque aquele array é local ao módulo de
// manutenção; a FORMA é idêntica de propósito). `existe` confirma que o id
// pertence à gráfica do PEDIDO antes de gravar — nunca confia num id vindo
// direto do form sem essa checagem (mesmo cuidado de iniciarManutencao).
export const CAMPOS_MAQUINA_APONTAMENTO = [
  {
    campo: "prensaId",
    rotulo: "Prensa",
    existe: (id: string, graficaId: string) => prisma.prensa.findFirst({ where: { id, graficaId }, select: { id: true, nome: true } }),
  },
  {
    campo: "maquinaFlexografiaId",
    rotulo: "Máquina de flexografia",
    existe: (id: string, graficaId: string) =>
      prisma.maquinaFlexografia.findFirst({ where: { id, graficaId }, select: { id: true, nome: true } }),
  },
  {
    campo: "equipamentoId",
    rotulo: "Equipamento",
    existe: (id: string, graficaId: string) => prisma.equipamento.findFirst({ where: { id, graficaId }, select: { id: true, nome: true } }),
  },
  {
    campo: "impressoraDigitalId",
    rotulo: "Impressora digital",
    existe: (id: string, graficaId: string) =>
      prisma.impressoraDigital.findFirst({ where: { id, graficaId }, select: { id: true, nome: true } }),
  },
  {
    campo: "maquinaSetupPorPecaId",
    rotulo: "Máquina",
    existe: (id: string, graficaId: string) =>
      prisma.maquinaSetupPorPeca.findFirst({ where: { id, graficaId }, select: { id: true, nome: true } }),
  },
] as const satisfies {
  campo: keyof SelecaoMaquina;
  rotulo: string;
  existe: (id: string, graficaId: string) => Promise<{ id: string; nome: string } | null>;
}[];

// Extrai a seleção de máquina de um FormData (os 5 campos, cada um lido com
// `?? ""` — mesmo tratamento pra ausente/vazio, ver pegadinha de
// FormData.get documentada na tarefa) e valida "no máximo 1 preenchida" +
// existência na gráfica do pedido. Usado só pelo canal autenticado (APP) —
// os canais público/QR não coletam máquina (ver relatório da tarefa),
// então nunca chamam isto, sempre passam SELECAO_MAQUINA_VAZIA direto.
export async function extrairEValidarSelecaoMaquina(
  formData: FormData,
  graficaId: string
): Promise<{ ok: true; selecao: SelecaoMaquina } | { ok: false; mensagem: string }> {
  const idsPorCampo = CAMPOS_MAQUINA_APONTAMENTO.map(({ campo }) => String(formData.get(campo) ?? "").trim());
  const validacao = validarSelecaoMaquinaOpcional(idsPorCampo);
  if (!validacao.ok) return validacao;

  const selecao: SelecaoMaquina = { ...SELECAO_MAQUINA_VAZIA };
  const indice = idsPorCampo.findIndex((v) => v.length > 0);
  if (indice === -1) return { ok: true, selecao };

  const { campo, rotulo, existe } = CAMPOS_MAQUINA_APONTAMENTO[indice];
  const maquina = await existe(idsPorCampo[indice], graficaId);
  if (!maquina) return { ok: false, mensagem: `${rotulo} não encontrada.` };
  selecao[campo] = idsPorCampo[indice];
  return { ok: true, selecao };
}

type CampoMaquinaItem = "prensaId" | "maquinaFlexografiaId" | "impressoraDigitalId" | "maquinaSetupPorPecaId";
const CAMPOS_MAQUINA_ITEM: CampoMaquinaItem[] = [
  "prensaId",
  "maquinaFlexografiaId",
  "impressoraDigitalId",
  "maquinaSetupPorPecaId",
];

export type SugestaoMaquina = { campo: CampoMaquinaItem; id: string } | null;

// "Sugestão padrão pré-preenchida a partir da máquina que o ItemGrafica usou
// na precificação" (achado B2, item 6 do enunciado da tarefa). Decisão de
// escopo: usa a máquina do PRIMEIRO item do pedido que tiver alguma máquina
// configurada (prensaId/maquinaFlexografiaId/impressoraDigitalId/
// maquinaSetupPorPecaId — ItemGrafica não tem equipamentoId, só
// RegistroManutencao/ApontamentoEtapa têm, então equipamento NUNCA entra na
// sugestão). Se outro item do MESMO pedido tiver uma máquina DIFERENTE
// (campo ou id diferente), a sugestão vira ambígua e a função devolve
// null — nunca escolhe "no escuro" entre duas máquinas divergentes; o
// operador decide sem nenhum valor pré-selecionado nesse caso.
export function sugerirMaquinaPedido(
  itens: { itemGrafica: Record<CampoMaquinaItem, string | null> }[]
): SugestaoMaquina {
  let sugestao: SugestaoMaquina = null;
  for (const item of itens) {
    const encontrado = CAMPOS_MAQUINA_ITEM.map((campo) => ({ campo, id: item.itemGrafica[campo] })).find(
      (c) => c.id !== null
    );
    if (!encontrado || encontrado.id === null) continue;
    if (sugestao === null) {
      sugestao = { campo: encontrado.campo, id: encontrado.id };
    } else if (sugestao.campo !== encontrado.campo || sugestao.id !== encontrado.id) {
      return null;
    }
  }
  return sugestao;
}

// Abre o apontamento da PRIMEIRA etapa (sempre ARTE) na criação do Pedido —
// chamado de dentro da mesma transação de aprovação do orçamento (autenticada
// em src/app/orcamento/[id]/actions.ts e pública em src/app/o/[token]/actions.ts).
// Idempotente por necessidade: as duas chamadoras usam `tx.pedido.upsert`
// com `update: {}`, então rodam de novo em toda re-submissão (duplo clique,
// retry) sem essa função saber se o upsert acabou de CRIAR o pedido ou só
// tocou um já existente. ARTE é sempre o primeiro e único ponto de entrada
// da FSM (nunca reentra, ver SEQUENCIA_STATUS_PEDIDO) — "nenhum apontamento
// ainda pra este pedidoId" é equivalente a "acabou de nascer".
export async function abrirApontamentoInicialSeNecessario(
  tx: Prisma.TransactionClient,
  params: { graficaId: string; pedidoId: string; origemConfirmacao: OrigemConfirmacaoEtapa }
): Promise<void> {
  const existente = await tx.apontamentoEtapa.findFirst({
    where: { pedidoId: params.pedidoId },
    select: { id: true },
  });
  if (existente) return;
  await tx.apontamentoEtapa.create({
    data: {
      graficaId: params.graficaId,
      pedidoId: params.pedidoId,
      status: "ARTE",
      origemConfirmacao: params.origemConfirmacao,
    },
  });
}

// Contexto que avancarStatusPedido (src/app/producao/status-transicao.ts)
// recebe de cada um dos 3 canais (painel autenticado, link público, QR de
// chão de fábrica) pra abrir o ApontamentoEtapa da etapa que o pedido acabou
// de ENTRAR. operadorId/operadorNomeDeclarado/selecaoMaquina são opcionais —
// só o canal APP preenche operadorId e (nas etapas com "motor")
// selecaoMaquina; LINK_PUBLICO/QR_ETIQUETA nunca coletam máquina (decisão de
// escopo desta tarefa, ver relatório) e não têm usuário autenticado.
export type ContextoOrigemAvanco = {
  origemConfirmacao: OrigemConfirmacaoEtapa;
  operadorId?: string | null;
  operadorNomeDeclarado?: string | null;
  selecaoMaquina?: SelecaoMaquina;
};

// Fecha o apontamento aberto (finalizadoEm=null) do pedido e abre o da etapa
// que ele acabou de ENTRAR — chamado de DENTRO da mesma transação do CAS de
// avancarStatusPedido, nunca fora dela (ver comentário em ApontamentoEtapa
// no schema). `updateMany` (não `update` por id) porque, na prática, pode
// não haver NENHUM apontamento aberto ainda (pedido criado antes desta
// feature, sem backfill retroativo — ver achado B1) — nesse caso o updateMany
// só não afeta nenhuma linha, sem lançar erro.
export async function fecharEAbrirApontamento(
  tx: Prisma.TransactionClient,
  params: {
    graficaId: string;
    pedidoId: string;
    proximoStatus: StatusPedido;
  } & ContextoOrigemAvanco
): Promise<void> {
  await tx.apontamentoEtapa.updateMany({
    where: { pedidoId: params.pedidoId, finalizadoEm: null },
    data: { finalizadoEm: new Date() },
  });
  await tx.apontamentoEtapa.create({
    data: {
      graficaId: params.graficaId,
      pedidoId: params.pedidoId,
      status: params.proximoStatus,
      origemConfirmacao: params.origemConfirmacao,
      operadorId: params.operadorId ?? null,
      operadorNomeDeclarado: params.operadorNomeDeclarado ?? null,
      ...(params.selecaoMaquina ?? SELECAO_MAQUINA_VAZIA),
    },
  });
}

// As 5 máquinas possíveis, ATIVAS, da gráfica — alimenta o seletor único da
// UI (SeletorMaquina.tsx) que decompõe a escolha num dos 5 campos. Só
// máquinas ativas: uma parada/inativada não deveria continuar aparecendo
// como opção pra rodar um pedido NOVO (diferente de RegistroManutencao, que
// é sobre o passado — aqui é sobre o que o operador pode escolher agora).
export type MaquinaOpcao = { campo: keyof SelecaoMaquina; id: string; nome: string; grupo: string };

export async function listarMaquinasSelecionaveis(graficaId: string): Promise<MaquinaOpcao[]> {
  const [prensas, flexografia, digitais, setup, equipamentos] = await Promise.all([
    prisma.prensa.findMany({ where: { graficaId, ativa: true }, select: { id: true, nome: true }, orderBy: { nome: "asc" } }),
    prisma.maquinaFlexografia.findMany({ where: { graficaId, ativa: true }, select: { id: true, nome: true }, orderBy: { nome: "asc" } }),
    prisma.impressoraDigital.findMany({ where: { graficaId, ativa: true }, select: { id: true, nome: true }, orderBy: { nome: "asc" } }),
    prisma.maquinaSetupPorPeca.findMany({ where: { graficaId, ativa: true }, select: { id: true, nome: true }, orderBy: { nome: "asc" } }),
    prisma.equipamento.findMany({ where: { graficaId, ativo: true }, select: { id: true, nome: true }, orderBy: { nome: "asc" } }),
  ]);
  return [
    ...prensas.map((m) => ({ campo: "prensaId" as const, id: m.id, nome: m.nome, grupo: "Prensas" })),
    ...flexografia.map((m) => ({ campo: "maquinaFlexografiaId" as const, id: m.id, nome: m.nome, grupo: "Flexografia" })),
    ...digitais.map((m) => ({ campo: "impressoraDigitalId" as const, id: m.id, nome: m.nome, grupo: "Impressoras digitais" })),
    ...setup.map((m) => ({ campo: "maquinaSetupPorPecaId" as const, id: m.id, nome: m.nome, grupo: "Máquinas (setup por peça)" })),
    ...equipamentos.map((m) => ({ campo: "equipamentoId" as const, id: m.id, nome: m.nome, grupo: "Equipamentos" })),
  ];
}

// Divergência entre a máquina que o operador de fato selecionou num
// ApontamentoEtapa e a sugestão calculada a partir dos itens do pedido (ver
// sugerirMaquinaPedido) — usado no aviso da tela de custos/fechamento
// (achado B2, item 4 do enunciado). Sem sugestão (itens sem máquina
// configurada, ou ambígua entre itens) não há "orçado" pra comparar — nunca
// diverge nesse caso. Sem seleção no apontamento (etapa sem motor, ou canal
// que não coleta máquina) também não diverge — não dá pra avisar "rodou
// diferente" quando não se sabe onde rodou.
export function apontamentoDivergeDaSugestao(
  selecao: SelecaoMaquina,
  sugestao: SugestaoMaquina
): boolean {
  if (!sugestao) return false;
  const escolhido = CAMPOS_MAQUINA_ITEM.map((campo) => ({ campo, id: selecao[campo] })).find(
    (c) => c.id !== null
  );
  if (!escolhido || escolhido.id === null) return false;
  return escolhido.campo !== sugestao.campo || escolhido.id !== sugestao.id;
}
