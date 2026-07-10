import type { InputHTMLAttributes, ReactNode } from "react";

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  icon?: ReactNode;
};

export function Input({ label, hint, icon, id, className = "", ...props }: InputProps) {
  const inputId = id ?? props.name;

  return (
    <label htmlFor={inputId} className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
        {label}
      </span>
      <div className="relative">
        {icon && (
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
            {icon}
          </span>
        )}
        <input
          id={inputId}
          className={`w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-slate-900 placeholder:text-slate-400 transition-shadow focus:border-teal-500 focus:ring-4 focus:ring-teal-500/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${icon ? "pl-10" : ""} ${className}`}
          {...props}
        />
      </div>
      {hint && <span className="text-xs text-slate-500">{hint}</span>}
    </label>
  );
}
