"use client";

import { useEffect, useState } from "react";
import { MailIcon } from "@/components/icons";
import { obterUrlSuporte } from "./SuporteLink.actions";

// Autossuficiente, sem props — mesmo padrão de ChatAssistente.tsx: evita
// prop nova em ~40 páginas que renderizam <UserNav>. Sem SUPORTE_FORM_URL
// configurada (workflow n8n ainda não existe), a Server Action devolve null
// e o link simplesmente não aparece.
export function SuporteLink() {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    obterUrlSuporte().then(setUrl);
  }, []);

  if (!url) return null;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Suporte"
      title="Suporte"
      className="rounded-xl border border-slate-200 p-2 text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
    >
      <MailIcon className="h-4 w-4" />
    </a>
  );
}
