"use client";

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { StatusPedido } from "@/generated/prisma/enums";
import { SEQUENCIA_STATUS_PEDIDO, ROTULOS_STATUS_PEDIDO } from "@/lib/producao-estagios";
import { formatoMoeda } from "@/lib/moeda";
import { useAoMudar } from "@/lib/hooks/useAoMudar";
import { avancarPedido } from "./actions";
import { ModalConfirmarImpressao } from "./KanbanConfirmarImpressao";

// Versão condensada do que PedidoLinha.tsx mostra — só o suficiente pra
// reconhecer o pedido e decidir se arrasta. Nada de lançar custo, aprovar
// arte etc. aqui dentro; quem quiser isso clica em "Ver detalhes" e cai na
// visão de lista completa (ou no orçamento).
export type PedidoKanban = {
  id: string;
  orcamentoId: string;
  clienteNome: string;
  itensResumo: string;
  status: StatusPedido;
  chipAtraso: ReactNode;
  // null quando o usuário não tem CUSTOS.podeVer — mesma regra de
  // producao/page.tsx (nunca manda o valor real pro client nesse caso).
  valorTotal: number | null;
  lucro: number | null;
  // Responsável atribuído (ResponsavelEstagio) pela etapa ATUAL deste
  // pedido — mesmo campo que libera AvancarPedidoButton em PedidoLinha.tsx
  // sem PRODUCAO.podeEditar completo. Nunca relevante pra FILA.
  souResponsavelDesteStatus: boolean;
};

// Só as colunas "ativas" — Entregue/Cancelado são fim de linha, mesmo
// espírito de STATUS_FINALIZADOS em producao/page.tsx, e não aparecem aqui
// porque pedidosKanban (montado na page) já nem inclui esses status.
const COLUNAS: StatusPedido[] = SEQUENCIA_STATUS_PEDIDO.filter((status) => status !== "ENTREGUE");

// A máquina de estado é linear e só anda pra frente (StatusPedido: FILA →
// IMPRESSAO → ACABAMENTO → PRONTO → ENTREGUE) — este é o único lugar do
// Kanban que decide "pra onde este card pode ir", reaproveitando a mesma
// sequência que avancarStatusPedido usa no servidor (defesa em profundidade,
// não a única linha de defesa: o servidor rejeita de qualquer forma).
function proximoStatus(status: StatusPedido): StatusPedido | null {
  const indice = SEQUENCIA_STATUS_PEDIDO.indexOf(status);
  if (indice === -1 || indice === SEQUENCIA_STATUS_PEDIDO.length - 1) return null;
  return SEQUENCIA_STATUS_PEDIDO[indice + 1];
}

// Mesma regra de permissão que já decide se PedidoLinha.tsx mostra
// IniciarImpressaoBotao/AvancarPedidoButton — FILA não é uma etapa
// "atribuível" (ver ESTAGIOS_ATRIBUIVEIS em lib/producao-estagios.ts), então
// só quem tem PRODUCAO.podeEditar completo pode iniciar a impressão. Nas
// outras colunas, um responsável só por aquela etapa também pode arrastar.
function podeArrastar(pedido: PedidoKanban, podeEditar: boolean): boolean {
  if (pedido.status === "FILA") return podeEditar;
  return podeEditar || pedido.souResponsavelDesteStatus;
}

export function KanbanBoard({
  pedidos,
  podeEditar,
  podeVerCustos,
  responsaveisPorEtapa,
}: {
  pedidos: PedidoKanban[];
  podeEditar: boolean;
  podeVerCustos: boolean;
  // Nomes de quem está atribuído a cada etapa (ver ResponsavelEstagio,
  // configurado em /usuarios) — mostrado no cabeçalho da coluna, já que é
  // uma característica da ETAPA, não de um pedido individual. Sempre
  // ausente/[] pra FILA (não é etapa atribuível, ver ESTAGIOS_ATRIBUIVEIS).
  responsaveisPorEtapa: Partial<Record<StatusPedido, string[]>>;
}) {
  // Status otimista aplicado localmente enquanto a Server Action ainda não
  // confirmou — os dados "de verdade" continuam vindo do servidor via
  // `pedidos` (avancarStatusPedido chama revalidatePath("/producao") no
  // final, o que troca essas props automaticamente). Erro = removido aqui
  // pra o card voltar pro lugar original; sucesso = removido assim que o
  // servidor confirmar (ver useEffect abaixo).
  const [overrides, setOverrides] = useState<Record<string, StatusPedido>>({});
  const [erros, setErros] = useState<Record<string, string>>({});
  const [pendentes, setPendentes] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pedidoConfirmando, setPedidoConfirmando] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Ajuste de estado durante a renderização (não em useEffect, ver
  // lib/hooks/useAoMudar.ts) — dispara só quando a REFERÊNCIA de `pedidos`
  // muda, o que só acontece quando o servidor de fato revalidou a página com
  // dados novos (interações puramente locais, tipo arrastar, não mudam essa
  // referência).
  useAoMudar(pedidos, (pedidosNovos) => {
    setOverrides((atual) => {
      let mudou = false;
      const novo = { ...atual };
      for (const pedido of pedidosNovos) {
        if (novo[pedido.id] !== undefined && novo[pedido.id] === pedido.status) {
          delete novo[pedido.id];
          mudou = true;
        }
      }
      return mudou ? novo : atual;
    });
  });

  const pedidosPorId = new Map(pedidos.map((pedido) => [pedido.id, pedido]));
  const pedidosComStatusEfetivo = pedidos.map((pedido) => ({
    ...pedido,
    status: overrides[pedido.id] ?? pedido.status,
  }));

  const pedidoArrastando = activeId
    ? (() => {
        const base = pedidosPorId.get(activeId);
        return base ? { ...base, status: overrides[activeId] ?? base.status } : null;
      })()
    : null;
  const proximoDoArrastando = pedidoArrastando ? proximoStatus(pedidoArrastando.status) : null;

  // Pointer (mouse/touch) com pequena distância de ativação pra não atrapalhar
  // o clique em "Ver detalhes" dentro do card, e Keyboard (Tab até o card,
  // espaço pra pegar, setas pra mover entre colunas, espaço de novo pra
  // soltar) — dnd-kit já anuncia essas instruções via aria-live por padrão,
  // então registrar o sensor é o que faz elas funcionarem de verdade.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor)
  );

  async function moverPedido(pedidoId: string, destino: StatusPedido) {
    setErros((atual) => {
      const novo = { ...atual };
      delete novo[pedidoId];
      return novo;
    });
    setOverrides((atual) => ({ ...atual, [pedidoId]: destino }));
    setPendentes((atual) => new Set(atual).add(pedidoId));

    const formData = new FormData();
    formData.set("pedidoId", pedidoId);
    const resultado = await avancarPedido(null, formData);

    setPendentes((atual) => {
      const novo = new Set(atual);
      novo.delete(pedidoId);
      return novo;
    });

    if (!resultado.ok) {
      // revalidatePath não roda quando a action falha — sem desfazer o
      // override aqui, o card ficaria preso na coluna errada pra sempre.
      setOverrides((atual) => {
        const novo = { ...atual };
        delete novo[pedidoId];
        return novo;
      });
      setErros((atual) => ({ ...atual, [pedidoId]: resultado.mensagem }));
    }
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const pedidoId = String(active.id);
    const pedido = pedidosPorId.get(pedidoId);
    if (!pedido || pendentes.has(pedidoId)) return;

    const statusAtual = overrides[pedidoId] ?? pedido.status;
    const destino = over.id as StatusPedido;
    const proximo = proximoStatus(statusAtual);

    // Defesa em profundidade: além do `disabled` das colunas durante o
    // arraste (que já impede over.id de ser um destino inválido na maioria
    // dos casos), confere de novo aqui antes de disparar qualquer coisa.
    if (!proximo || destino !== proximo) return;
    if (!podeArrastar(pedido, podeEditar)) return;

    // FILA→IMPRESSAO baixa estoque automaticamente e pode envolver perda de
    // material — precisa abrir o MESMO fluxo de confirmação que
    // IniciarImpressaoBotao usa na lista (ver KanbanConfirmarImpressao.tsx),
    // nunca completar a transição direto feito as outras.
    if (statusAtual === "FILA" && proximo === "IMPRESSAO") {
      setPedidoConfirmando(pedidoId);
      return;
    }

    startTransition(() => {
      void moverPedido(pedidoId, proximo);
    });
  }

  return (
    <div>
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {COLUNAS.map((status) => (
            <KanbanColuna
              key={status}
              status={status}
              pedidos={pedidosComStatusEfetivo.filter((pedido) => pedido.status === status)}
              disabled={activeId === null || proximoDoArrastando !== status}
              destaqueValido={activeId !== null && proximoDoArrastando === status}
              podeEditar={podeEditar}
              podeVerCustos={podeVerCustos}
              pendentes={pendentes}
              erros={erros}
              responsaveis={responsaveisPorEtapa[status] ?? []}
            />
          ))}
        </div>
        <DragOverlay>
          {pedidoArrastando ? (
            <KanbanCardConteudo pedido={pedidoArrastando} podeVerCustos={podeVerCustos} arrastando />
          ) : null}
        </DragOverlay>
      </DndContext>

      {pedidoConfirmando && (
        <ModalConfirmarImpressao pedidoId={pedidoConfirmando} onFechar={() => setPedidoConfirmando(null)} />
      )}
    </div>
  );
}

function KanbanColuna({
  status,
  pedidos,
  disabled,
  destaqueValido,
  podeEditar,
  podeVerCustos,
  pendentes,
  erros,
  responsaveis,
}: {
  status: StatusPedido;
  pedidos: PedidoKanban[];
  disabled: boolean;
  destaqueValido: boolean;
  podeEditar: boolean;
  podeVerCustos: boolean;
  pendentes: Set<string>;
  erros: Record<string, string>;
  responsaveis: string[];
}) {
  // disabled=true faz esta coluna nunca virar um alvo de colisão válido
  // durante o arraste — é isso que impede soltar um card em qualquer coluna
  // que não seja exatamente a próxima etapa dele (a "não deixar soltar" da
  // regra de negócio, sem duplicar a validação do servidor).
  const { setNodeRef, isOver } = useDroppable({ id: status, disabled });
  const podeReceberAgora = destaqueValido && isOver;

  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-[180px] flex-col gap-2 rounded-2xl border p-3 transition-colors ${
        podeReceberAgora
          ? "border-teal-400 bg-teal-50/60 dark:border-teal-600 dark:bg-teal-950/30"
          : destaqueValido
            ? "border-dashed border-teal-200 bg-teal-50/20 dark:border-teal-900"
            : "border-slate-200 bg-slate-50/40 dark:border-slate-800 dark:bg-slate-900/30"
      }`}
    >
      <div className="flex flex-col gap-0.5 px-1">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            {ROTULOS_STATUS_PEDIDO[status]}
          </h2>
          <span className="text-xs text-slate-400">{pedidos.length}</span>
        </div>
        {responsaveis.length > 0 && (
          <p className="truncate text-xs text-slate-400" title={responsaveis.join(", ")}>
            Responsável: {responsaveis.join(", ")}
          </p>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2">
        {pedidos.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 p-3 text-center text-xs text-slate-400 dark:border-slate-800 dark:text-slate-600">
            Nenhum pedido aqui
          </p>
        ) : (
          pedidos.map((pedido) => (
            <KanbanCard
              key={pedido.id}
              pedido={pedido}
              podeVerCustos={podeVerCustos}
              arrastavel={podeArrastar(pedido, podeEditar) && !pendentes.has(pedido.id)}
              pendente={pendentes.has(pedido.id)}
              erro={erros[pedido.id]}
            />
          ))
        )}
      </div>
    </div>
  );
}

function KanbanCard({
  pedido,
  podeVerCustos,
  arrastavel,
  pendente,
  erro,
}: {
  pedido: PedidoKanban;
  podeVerCustos: boolean;
  arrastavel: boolean;
  pendente: boolean;
  erro?: string;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: pedido.id,
    disabled: !arrastavel,
  });

  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;

  return (
    <div ref={setNodeRef} style={style} className={isDragging ? "opacity-40" : ""}>
      <div
        {...(arrastavel ? { ...listeners, ...attributes } : {})}
        className={`${arrastavel ? "cursor-grab touch-none active:cursor-grabbing" : ""} ${
          pendente ? "pointer-events-none opacity-60" : ""
        }`}
      >
        <KanbanCardConteudo pedido={pedido} podeVerCustos={podeVerCustos} pendente={pendente} />
      </div>
      {erro && <p className="mt-1 text-xs text-rose-600">{erro}</p>}
    </div>
  );
}

function KanbanCardConteudo({
  pedido,
  podeVerCustos,
  pendente,
  arrastando,
}: {
  pedido: PedidoKanban;
  podeVerCustos: boolean;
  pendente?: boolean;
  arrastando?: boolean;
}) {
  return (
    <div
      className={`flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-sm dark:border-slate-800 dark:bg-slate-900 ${
        arrastando ? "rotate-1 shadow-lg" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium text-slate-900 dark:text-white">{pedido.clienteNome}</p>
        {pendente && <span className="shrink-0 text-xs text-slate-400">Movendo…</span>}
      </div>
      <p className="text-xs text-slate-500">{pedido.itensResumo}</p>
      {pedido.chipAtraso}
      {podeVerCustos && pedido.valorTotal !== null && (
        <p className="text-xs text-slate-600 dark:text-slate-300">
          {formatoMoeda.format(pedido.valorTotal)}
          {pedido.lucro !== null && (
            <span
              className={
                pedido.lucro >= 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-rose-600 dark:text-rose-400"
              }
            >
              {" · lucro "}
              {formatoMoeda.format(pedido.lucro)}
            </span>
          )}
        </p>
      )}
      <Link
        href={`/orcamento/${pedido.orcamentoId}`}
        className="text-xs text-teal-700 hover:underline dark:text-teal-400"
      >
        Ver detalhes
      </Link>
    </div>
  );
}
