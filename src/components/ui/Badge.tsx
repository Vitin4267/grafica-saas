const CORES_ORCAMENTO: Record<string, string> = {
  RASCUNHO: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  ENVIADO: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  APROVADO: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  REJEITADO: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
};

const ROTULOS_ORCAMENTO: Record<string, string> = {
  RASCUNHO: "Rascunho",
  ENVIADO: "Enviado",
  APROVADO: "Aprovado",
  REJEITADO: "Rejeitado",
};

// 8 estágios (visão de produto 2026-08-21, ver StatusPedido no schema) — as
// cores seguem a ordem de progresso do pipeline (cinza → azul → âmbar →
// violeta → índigo → ciano → azul-céu → verde), CANCELADO sempre vermelho.
const CORES_PEDIDO: Record<string, string> = {
  ARTE: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  CLICHE_FACA: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  PRODUCAO: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  ACABAMENTO: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  CONFERENCIA: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  EMBALAGEM: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
  EXPEDICAO: "bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300",
  ENTREGUE: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  CANCELADO: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
};

const ROTULOS_PEDIDO: Record<string, string> = {
  ARTE: "Arte",
  CLICHE_FACA: "Clichê/Faca",
  PRODUCAO: "Produção",
  ACABAMENTO: "Acabamento",
  CONFERENCIA: "Conferência",
  EMBALAGEM: "Embalagem",
  EXPEDICAO: "Expedição",
  ENTREGUE: "Entregue",
  CANCELADO: "Cancelado",
};

const CORES_COMPRA: Record<string, string> = {
  SOLICITADO: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  COTANDO: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  APROVADO: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  COMPRADO: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  RECEBIDO: "bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300",
  CONFERIDO: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  CANCELADO: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
};

const ROTULOS_COMPRA: Record<string, string> = {
  SOLICITADO: "Solicitado",
  COTANDO: "Cotando",
  APROVADO: "Aprovado",
  COMPRADO: "Comprado",
  RECEBIDO: "Recebido",
  CONFERIDO: "Conferido",
  CANCELADO: "Cancelado",
};

const CORES_ENTREGA: Record<string, string> = {
  AGUARDANDO: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  EM_TRANSITO: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  ENTREGUE: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  PROBLEMA: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
};

const ROTULOS_ENTREGA: Record<string, string> = {
  AGUARDANDO: "Aguardando",
  EM_TRANSITO: "Em trânsito",
  ENTREGUE: "Entregue",
  PROBLEMA: "Problema",
};

export function StatusBadge({
  status,
  tipo = "orcamento",
}: {
  status: string;
  tipo?: "orcamento" | "pedido" | "compra" | "entrega";
}) {
  const mapaCores = { pedido: CORES_PEDIDO, compra: CORES_COMPRA, entrega: CORES_ENTREGA, orcamento: CORES_ORCAMENTO };
  const mapaRotulos = { pedido: ROTULOS_PEDIDO, compra: ROTULOS_COMPRA, entrega: ROTULOS_ENTREGA, orcamento: ROTULOS_ORCAMENTO };
  const cores = mapaCores[tipo];
  const rotulos = mapaRotulos[tipo];
  const fallback = tipo === "pedido" ? CORES_PEDIDO.ARTE : tipo === "compra" ? CORES_COMPRA.SOLICITADO : tipo === "entrega" ? CORES_ENTREGA.AGUARDANDO : CORES_ORCAMENTO.RASCUNHO;

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
        cores[status] ?? fallback
      }`}
    >
      {rotulos[status] ?? status}
    </span>
  );
}
