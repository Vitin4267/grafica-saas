"use client";

import { useActionState } from "react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { salvarLogo, removerLogo } from "./actions";

export function IdentidadeForm({ logoUrlAtual }: { logoUrlAtual: string | null }) {
  const [stateSalvar, formActionSalvar, isPendingSalvar] = useActionState(salvarLogo, null);
  const [stateRemover, formActionRemover, isPendingRemover] = useActionState(removerLogo, null);

  return (
    <Card className="flex flex-col gap-4 p-6">
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">Logo da gráfica</h2>

      {logoUrlAtual && (
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- arquivo vem de URL externa (Vercel Blob), fora do domínio otimizável pelo next/image */}
          <img
            src={logoUrlAtual}
            alt="Logo atual"
            className="h-16 w-16 rounded-lg border border-slate-200 object-contain dark:border-slate-800"
          />
          <form action={formActionRemover}>
            <Button type="submit" variant="ghost" loading={isPendingRemover}>
              Remover logo
            </Button>
          </form>
        </div>
      )}
      {stateRemover && !stateRemover.ok && <Alert variant="error">{stateRemover.mensagem}</Alert>}

      <form action={formActionSalvar} className="flex flex-wrap items-end gap-3">
        <Input
          label={logoUrlAtual ? "Trocar logo (PNG, JPG ou WEBP)" : "Enviar logo (PNG, JPG ou WEBP)"}
          name="arquivo"
          type="file"
          accept=".png,.jpg,.jpeg,.webp"
          required
          className="max-w-xs"
        />
        <Button type="submit" loading={isPendingSalvar}>
          {logoUrlAtual ? "Trocar" : "Salvar logo"}
        </Button>
      </form>

      {stateSalvar && (
        <Alert variant={stateSalvar.ok ? "success" : "error"}>{stateSalvar.mensagem}</Alert>
      )}
    </Card>
  );
}
