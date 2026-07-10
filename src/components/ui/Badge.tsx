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

const CORES_PEDIDO: Record<string, string> = {
  FILA: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  IMPRESSAO: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  ACABAMENTO: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  PRONTO: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  ENTREGUE: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
};

const ROTULOS_PEDIDO: Record<string, string> = {
  FILA: "Na fila",
  IMPRESSAO: "Impressão",
  ACABAMENTO: "Acabamento",
  PRONTO: "Pronto",
  ENTREGUE: "Entregue",
};

export function StatusBadge({
  status,
  tipo = "orcamento",
}: {
  status: string;
  tipo?: "orcamento" | "pedido";
}) {
  const cores = tipo === "pedido" ? CORES_PEDIDO : CORES_ORCAMENTO;
  const rotulos = tipo === "pedido" ? ROTULOS_PEDIDO : ROTULOS_ORCAMENTO;
  const fallback = tipo === "pedido" ? CORES_PEDIDO.FILA : CORES_ORCAMENTO.RASCUNHO;

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
