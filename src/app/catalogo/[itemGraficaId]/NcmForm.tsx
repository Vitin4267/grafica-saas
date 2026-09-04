"use client";

import { useActionState } from "react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { CampoAjuda } from "@/components/ui/CampoAjuda";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { ORIGEM_MERCADORIA_VALORES, ROTULO_ORIGEM_MERCADORIA } from "@/lib/nota-fiscal-tabelas";
import { salvarNcm } from "./actions";

export function NcmForm({
  itemCatalogoId,
  ncmAtual,
  origemMercadoriaAtual,
}: {
  itemCatalogoId: string;
  ncmAtual: string;
  origemMercadoriaAtual: string;
}) {
  const [state, formAction, isPending] = useActionState(salvarNcm, null);

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">
          Classificação fiscal
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          NCM e origem da mercadoria identificam esse produto pra emissão de
          nota fiscal. Só é necessário se você for usar a ferramenta de
          emitir nota fiscal.
        </p>
      </div>
      <form action={formAction} className="flex flex-col gap-3">
        <input type="hidden" name="itemCatalogoId" value={itemCatalogoId} />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Input label="NCM" name="ncm" defaultValue={ncmAtual} placeholder="ex: 49111090" />
          </div>
          <div className="flex-1">
            <Select
              label={
                <>
                  Origem da mercadoria
                  <CampoAjuda texto="De onde vem o material — nacional ou importado. Errar isso faz a nota fiscal declarar o ICMS interestadual (Resolução SF 13/2012) errado. Cada opção corresponde a um código da Tabela B do CST/ICMS: Nacional é o 0; os demais são os códigos 1 a 8, na ordem desta lista." />
                </>
              }
              name="origemMercadoria"
              defaultValue={origemMercadoriaAtual}
            >
              {ORIGEM_MERCADORIA_VALORES.map((valor) => (
                <option key={valor} value={valor}>
                  {ROTULO_ORIGEM_MERCADORIA[valor]}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" variant="outline" loading={isPending}>
            {isPending ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </form>
      {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}
    </Card>
  );
}
