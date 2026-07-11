import type { ReactNode } from "react";
import Link from "next/link";
import { Card } from "./Card";

type Tone = "neutral" | "positive";

const TONE_ICONE: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
  positive: "bg-teal-50 text-teal-600 dark:bg-teal-950 dark:text-teal-400",
};

export function StatTile({
  label,
  value,
  caption,
  icon,
  href,
  tone = "neutral",
  size = "md",
}: {
  label: string;
  value: string;
  caption?: string;
  icon?: ReactNode;
  href?: string;
  tone?: Tone;
  size?: "md" | "lg";
}) {
  const conteudo = (
    <Card
      className={`flex h-full flex-col gap-3 p-5 transition-colors ${
        href ? "hover:border-teal-300 dark:hover:border-teal-700" : ""
      } ${size === "lg" ? "sm:p-8" : ""}`}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500">{label}</p>
        {icon && (
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${TONE_ICONE[tone]}`}
          >
            {icon}
          </span>
        )}
      </div>
      <p
        className={`font-bold text-slate-900 dark:text-white ${
          size === "lg" ? "text-3xl sm:text-4xl" : "text-2xl"
        }`}
      >
        {value}
      </p>
      {caption && <p className="text-xs text-slate-500">{caption}</p>}
    </Card>
  );

  if (!href) return conteudo;

  return (
    <Link href={href} className="block h-full">
      {conteudo}
    </Link>
  );
}
