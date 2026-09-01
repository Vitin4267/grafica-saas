import type { ReactNode, TextareaHTMLAttributes } from "react";

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  // ReactNode (não só string) pra permitir `label={<>Texto <CampoAjuda .../></>}`
  // — ver src/components/ui/CampoAjuda.tsx. Uma string continua funcionando
  // igual antes.
  label: ReactNode;
  hint?: string;
};

export function Textarea({ label, hint, id, className = "", rows = 3, ...props }: TextareaProps) {
  const textareaId = id ?? props.name;

  return (
    <label htmlFor={textareaId} className="flex flex-col gap-1.5">
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">
        {label}
      </span>
      <textarea
        id={textareaId}
        rows={rows}
        className={`w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-slate-900 placeholder:text-slate-400 transition-shadow focus:border-teal-500 focus:ring-4 focus:ring-teal-500/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${className}`}
        {...props}
      />
      {hint && <span className="text-xs text-slate-500">{hint}</span>}
    </label>
  );
}
