import { AlertTriangleIcon, CheckCircleIcon } from "@/components/icons";

export function Alert({
  variant = "error",
  children,
}: {
  variant?: "error" | "success";
  children: React.ReactNode;
}) {
  const isError = variant === "error";

  return (
    <div
      role={isError ? "alert" : "status"}
      className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm ${
        isError
          ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300"
          : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300"
      }`}
    >
      {isError ? (
        <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" />
      ) : (
        <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
      )}
      <span>{children}</span>
    </div>
  );
}
