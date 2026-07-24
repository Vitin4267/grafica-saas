"use client";

import { useActionState, useState, type ChangeEvent } from "react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { validarArquivoLogo } from "@/lib/upload-validacao";
import { salvarLogo, removerLogo } from "./actions";

export function IdentidadeForm({ logoUrlAtual }: { logoUrlAtual: string | null }) {
  const [stateSalvar, formActionSalvar, isPendingSalvar] = useActionState(salvarLogo, null);
  const [stateRemover, formActionRemover, isPendingRemover] = useActionState(removerLogo, null);
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);

  // Mesma ideia de EnviarArteForm.tsx: valida antes de submeter, pra nunca
  // depender do limite de corpo da Server Action pra avisar o usuário.
  function handleArquivoChange(evento: ChangeEvent<HTMLInputElement>) {
    const arquivo = evento.target.files?.[0];
    if (!arquivo) {
      setErroArquivo(null);
      return;
    }
    const validacao = validarArquivoLogo(arquivo);
    setErroArquivo(validacao.ok ? null : validacao.mensagem);
  }

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

      <form action={formActionSalvar} className="flex flex-col gap-2">
        <div className="flex flex-wrap items-end gap-3">
          <Input
            label={
              logoUrlAtual
                ? "Trocar logo (PNG, JPG ou WEBP, até 3MB)"
                : "Enviar logo (PNG, JPG ou WEBP, até 3MB)"
            }
            name="arquivo"
            type="file"
            accept=".png,.jpg,.jpeg,.webp"
            required
            onChange={handleArquivoChange}
            className="max-w-xs"
          />
          <Button type="submit" loading={isPendingSalvar} disabled={!!erroArquivo}>
            {logoUrlAtual ? "Trocar" : "Salvar logo"}
          </Button>
        </div>
        {erroArquivo && <p className="text-xs text-rose-600">{erroArquivo}</p>}
      </form>

      {stateSalvar && (
        <Alert variant={stateSalvar.ok ? "success" : "error"}>{stateSalvar.mensagem}</Alert>
      )}
    </Card>
  );
}
