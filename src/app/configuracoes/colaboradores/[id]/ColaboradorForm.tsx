"use client";

import { useActionState, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { ORDEM_TIPO_COLABORADOR, ROTULO_TIPO_COLABORADOR } from "@/lib/tipos-colaborador";
import { editarColaborador, alternarAtivoColaborador } from "../actions";
import type { TipoColaborador } from "@/generated/prisma/enums";

type ValoresColaborador = {
  nome: string;
  tipo: TipoColaborador;
  tipoOutro: string | null;
  telefone: string | null;
  ativo: boolean;
};

export function ColaboradorForm({
  colaboradorId,
  valoresIniciais,
}: {
  colaboradorId: string;
  valoresIniciais: ValoresColaborador;
}) {
  const [state, formAction, isPending] = useActionState(editarColaborador, null);
  const [estadoAtivo, alternarAction, alternandoPending] = useActionState(
    alternarAtivoColaborador,
    null
  );
  const [tipo, setTipo] = useState<TipoColaborador>(valoresIniciais.tipo);

  return (
    <div className="flex flex-col gap-6">
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="colaboradorId" value={colaboradorId} />
        <Card className="flex flex-col gap-4 p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Nome" name="nome" type="text" defaultValue={valoresIniciais.nome} required />

            <Select
              label="Tipo"
              name="tipo"
              value={tipo}
              onChange={(e) => setTipo(e.target.value as TipoColaborador)}
            >
              {ORDEM_TIPO_COLABORADOR.map((valor) => (
                <option key={valor} value={valor}>
                  {ROTULO_TIPO_COLABORADOR[valor]}
                </option>
              ))}
            </Select>
          </div>

          {tipo === "OUTRO" && (
            <Input
              label="Descreva o tipo"
              name="tipoOutro"
              type="text"
              defaultValue={valoresIniciais.tipoOutro ?? ""}
              required
            />
          )}

          <Input
            label="Telefone (opcional)"
            name="telefone"
            type="text"
            defaultValue={valoresIniciais.telefone ?? ""}
          />
        </Card>
        {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}
        <Button type="submit" loading={isPending} className="self-start">
          {isPending ? "Salvando..." : "Salvar"}
        </Button>
      </form>

      <Card className="flex items-center justify-between gap-4 p-5">
        <div>
          <p className="text-sm font-medium text-slate-900 dark:text-white">
            {valoresIniciais.ativo ? "Colaborador ativo" : "Colaborador inativo"}
          </p>
          <p className="text-xs text-slate-500">
            {valoresIniciais.ativo
              ? "Aparece pra seleção ao preencher o motorista de uma entrega."
              : "Some da seleção pra novo uso, mas entregas já vinculadas continuam no histórico. Nunca é excluído de verdade."}
          </p>
          {estadoAtivo && !estadoAtivo.ok && (
            <p className="mt-1 text-xs text-rose-600">{estadoAtivo.mensagem}</p>
          )}
        </div>
        <form action={alternarAction}>
          <input type="hidden" name="colaboradorId" value={colaboradorId} />
          <Button type="submit" variant="outline" loading={alternandoPending} className="shrink-0">
            {valoresIniciais.ativo ? "Desativar" : "Ativar"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
