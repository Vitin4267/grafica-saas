"use client";

import { useState } from "react";
import { LockIcon, EyeIcon, EyeOffIcon } from "@/components/icons";

export function PasswordInput({
  label,
  hint,
  name,
  ...props
}: {
  label: string;
  hint?: string;
  name: string;
  required?: boolean;
  minLength?: number;
  autoComplete?: string;
}) {
  const [visivel, setVisivel] = useState(false);

  return (
    <label htmlFor={name} className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
        {label}
      </span>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
          <LockIcon className="h-4 w-4" />
        </span>
        <input
          id={name}
          name={name}
          type={visivel ? "text" : "password"}
          className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 pl-10 pr-10 text-slate-900 placeholder:text-slate-400 transition-shadow focus:border-teal-500 focus:ring-4 focus:ring-teal-500/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisivel((v) => !v)}
          aria-label={visivel ? "Ocultar senha" : "Mostrar senha"}
          className="absolute inset-y-0 right-3 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
        >
          {visivel ? (
            <EyeOffIcon className="h-4 w-4" />
          ) : (
            <EyeIcon className="h-4 w-4" />
          )}
        </button>
      </div>
      {hint && <span className="text-xs text-slate-500">{hint}</span>}
    </label>
  );
}
