export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold ${className}`}>
      <span className="text-slate-900 dark:text-slate-50">
        Graf<span className="text-teal-600">Pro</span>
      </span>
    </span>
  );
}
