import { Card } from "@/components/ui/Card";

export function CarregandoPagina({
  maxWidth = "max-w-4xl",
}: {
  maxWidth?: string;
}) {
  return (
    <div className={`mx-auto w-full ${maxWidth} flex-1 px-6 py-10`}>
      <div className="mb-2 h-4 w-40 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
      <div className="mb-8 h-8 w-72 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
      <Card className="h-64 animate-pulse p-6">{null}</Card>
    </div>
  );
}
