"use client";

import { useActionState } from "react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { salvarNcm } from "./actions";

export function NcmForm({
  itemCatalogoId,
  ncmAtual,
}: {
  itemCatalogoId: string;
  ncmAtual: string;
}) {
  const [state, formAction, isPending] = useActionState(salvarNcm, null);

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">
          Classificação fiscal
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          O NCM identifica esse produto pra emissão de nota fiscal. Só é
          necessário se você for usar a ferramenta de emitir nota fiscal.
        </p>
      </div>
      <form action={formAction} className="flex items-end gap-3">
        <input type="hidden" name="itemCatalogoId" value={itemCatalogoId} />
        <div className="flex-1">
          <Input label="NCM" name="ncm" defaultValue={ncmAtual} placeholder="ex: 49111090" />
        </div>
        <Button type="submit" variant="outline" loading={isPending}>
          {isPending ? "Salvando..." : "Salvar"}
        </Button>
      </form>
      {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}
    </Card>
  );
}
