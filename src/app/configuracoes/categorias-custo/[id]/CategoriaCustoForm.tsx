"use client";

import { useActionState } from "react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { renomearCategoriaCusto, alternarAtivaCategoriaCusto } from "../actions";

type NaturezaCusto = "VARIAVEL" | "FIXO" | "SEMIVARIAVEL";

export function CategoriaCustoForm({
  categoriaId,
  nome,
  natureza,
  ativa,
}: {
  categoriaId: string;
  nome: string;
  natureza: NaturezaCusto;
  ativa: boolean;
}) {
  const [state, formAction, isPending] = useActionState(renomearCategoriaCusto, null);
  const [estadoAtiva, alternarAction, alternandoPending] = useActionState(
    alternarAtivaCategoriaCusto,
    null
  );

  return (
    <div className="flex flex-col gap-6">
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="categoriaId" value={categoriaId} />
        <Card className="flex flex-col gap-4 p-6">
          <Input label="Nome" name="nome" type="text" defaultValue={nome} required />
          <Select
            label="Natureza do custo"
            name="natureza"
            defaultValue={natureza}
            hint="Usada só pelo DRE (/financeiro/dre) pra separar custo variável de custo fixo — não muda preço nem cálculo de nenhum orçamento."
          >
            <option value="VARIAVEL">Variável (muda com a produção — papel, tinta, frete)</option>
            <option value="FIXO">Fixo (existe independente de produzir — aluguel, salário)</option>
            <option value="SEMIVARIAVEL">Semivariável (parte fixa, parte varia — energia, telefone)</option>
          </Select>
        </Card>
        {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}
        <Button type="submit" loading={isPending} className="self-start">
          {isPending ? "Salvando..." : "Salvar"}
        </Button>
      </form>

      <Card className="flex items-center justify-between gap-4 p-5">
        <div>
          <p className="text-sm font-medium text-slate-900 dark:text-white">
            {ativa ? "Categoria ativa" : "Categoria inativa"}
          </p>
          <p className="text-xs text-slate-500">
            {ativa
              ? "Aparece pra seleção ao lançar um custo real num pedido, em Produção."
              : "Some da seleção ao lançar novo custo, mas custos já lançados com ela continuam no histórico. Nunca é excluída de verdade."}
          </p>
          {estadoAtiva && !estadoAtiva.ok && (
            <p className="mt-1 text-xs text-rose-600">{estadoAtiva.mensagem}</p>
          )}
        </div>
        <form action={alternarAction}>
          <input type="hidden" name="categoriaId" value={categoriaId} />
          <Button type="submit" variant="outline" loading={alternandoPending} className="shrink-0">
            {ativa ? "Desativar" : "Ativar"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
