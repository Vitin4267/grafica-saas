import type { ReactNode, SelectHTMLAttributes } from "react";

export function Select({
  label,
  hint,
  children,
  id,
  className = "",
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  // ReactNode (não só string) pra permitir `label={<>Texto <CampoAjuda .../></>}`
  // — ver src/components/ui/CampoAjuda.tsx. Uma string continua funcionando
  // igual antes.
  label: ReactNode;
  hint?: string;
  children: ReactNode;
}) {
  const selectId = id ?? props.name;

  return (
    <label htmlFor={selectId} className="flex flex-col gap-1.5">
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">
        {label}
      </span>
      <div className="relative">
        <select
          id={selectId}
          className={`w-full appearance-none rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 pr-10 text-slate-900 transition-shadow focus:border-teal-500 focus:ring-4 focus:ring-teal-500/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${className}`}
          {...props}
        >
          {children}
        </select>
        <svg
          aria-hidden
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="pointer-events-none absolute inset-y-0 right-3 my-auto h-4 w-4 text-slate-400"
        >
          <path d="m5.5 8 4.5 4.5L14.5 8" />
        </svg>
      </div>
      {hint && <span className="text-xs text-slate-500">{hint}</span>}
    </label>
  );
}
