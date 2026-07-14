import Link from "next/link";
import { Card } from "@/components/ui/Card";

// Extraído de meu-negocio/page.tsx (era CardVazio, privado a esse arquivo) —
// mesmo padrão ícone + texto + CTA, reaproveitado agora em outras telas com
// estado vazio (ver /producao). href/rotuloCta são opcionais: nem toda tela
// vazia tem um destino claro pra "ir fazer isso agora" (ex: cliente já tem o
// formulário de criação na mesma página).
export function EmptyState({
  icone,
  texto,
  href,
  rotuloCta,
}: {
  icone: React.ReactNode;
  texto: string;
  href?: string;
  rotuloCta?: string;
}) {
  return (
    <Card className="flex flex-col items-center gap-3 p-8 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800">
        {icone}
      </span>
      <p className="max-w-xs text-sm text-slate-500">{texto}</p>
      {href && rotuloCta && (
        <Link
          href={href}
          className="text-xs font-medium text-teal-700 hover:underline dark:text-teal-400"
        >
          {rotuloCta}
        </Link>
      )}
    </Card>
  );
}
