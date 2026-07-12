import { AlertTriangleIcon, CheckCircleIcon, InfoIcon } from "@/components/icons";

type Variante = "error" | "success" | "warning" | "info";

const ESTILO: Record<Variante, string> = {
  error:
    "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300",
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300",
  warning:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300",
  info: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-300",
};

const ICONE: Record<Variante, typeof AlertTriangleIcon> = {
  error: AlertTriangleIcon,
  success: CheckCircleIcon,
  warning: AlertTriangleIcon,
  info: InfoIcon,
};

export function Alert({
  variant = "error",
  children,
}: {
  variant?: Variante;
  children: React.ReactNode;
}) {
  const Icone = ICONE[variant];

  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm ${ESTILO[variant]}`}
    >
      <Icone className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}
