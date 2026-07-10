export default function CarregandoMeuNegocio() {
  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <div className="mb-2 h-4 w-40 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
      <div className="mb-8 h-8 w-72 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />

      <div className="h-36 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800"
          />
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="h-48 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800"
          />
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="h-48 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800"
          />
        ))}
      </div>
    </div>
  );
}
