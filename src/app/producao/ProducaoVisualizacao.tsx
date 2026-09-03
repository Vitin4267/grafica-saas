"use client";

import { useState, type ReactNode } from "react";
import { KanbanBoard, type PedidoKanban } from "./KanbanBoard";
import type { StatusPedido } from "@/generated/prisma/enums";

// A lista (PedidoLinha.tsx e tudo que ela carrega — chip de atraso, custo,
// arte etc.) chega PRONTA do Server Component (producao/page.tsx) via
// `lista`, não reescrita aqui. As duas visões ficam montadas ao mesmo tempo
// (alterna com CSS, não com render condicional) pra não perder estado local
// — ex: um "Cancelar pedido?" aberto na lista — só por trocar de aba.
export function ProducaoVisualizacao({
  lista,
  pedidosKanban,
  podeEditar,
  podeVerCustos,
  responsaveisPorEtapa,
  sequencia,
  rotulos,
}: {
  lista: ReactNode;
  pedidosKanban: PedidoKanban[];
  podeEditar: boolean;
  podeVerCustos: boolean;
  responsaveisPorEtapa: Partial<Record<StatusPedido, string[]>>;
  // Achado A1 (Fase 1) — repassado direto pro KanbanBoard, ver comentário
  // lá (src/app/producao/KanbanBoard.tsx).
  sequencia: StatusPedido[];
  rotulos: Record<StatusPedido, string>;
}) {
  const [visao, setVisao] = useState<"lista" | "quadro">("lista");

  return (
    <div>
      <div className="mb-6 inline-flex rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
        <button
          type="button"
          onClick={() => setVisao("lista")}
          aria-pressed={visao === "lista"}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            visao === "lista"
              ? "bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300"
              : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
          }`}
        >
          Lista
        </button>
        <button
          type="button"
          onClick={() => setVisao("quadro")}
          aria-pressed={visao === "quadro"}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            visao === "quadro"
              ? "bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300"
              : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
          }`}
        >
          Quadro
        </button>
      </div>

      <div className={visao === "lista" ? "" : "hidden"}>{lista}</div>
      <div className={visao === "quadro" ? "" : "hidden"}>
        <KanbanBoard
          pedidos={pedidosKanban}
          podeEditar={podeEditar}
          podeVerCustos={podeVerCustos}
          responsaveisPorEtapa={responsaveisPorEtapa}
          sequencia={sequencia}
          rotulos={rotulos}
        />
      </div>
    </div>
  );
}
