import { PrinterIcon } from "./icons";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold ${className}`}>
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-600 text-white shadow-sm shadow-teal-600/30">
        <PrinterIcon className="h-5 w-5" strokeWidth={2} />
      </span>
      <span className="text-slate-900 dark:text-slate-50">
        Graf<span className="text-teal-600">Pro</span>
      </span>
    </span>
  );
}
