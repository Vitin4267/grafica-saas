"use client";

import { useActionState, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import {
  ORDEM_TIPO_PRESTADOR_SERVICO,
  ROTULO_TIPO_PRESTADOR_SERVICO,
} from "@/lib/tipos-prestador-servico";
import { editarPrestadorServico, alternarAtivoPrestadorServico } from "../actions";
import type { TipoPrestadorServico } from "@/generated/prisma/enums";

type ValoresPrestadorServico = {
  nome: string;
  tipo: TipoPrestadorServico;
  tipoOutro: string | null;
  documento: string | null;
  telefone: string | null;
  email: string | null;
  observacoes: string | null;
  ativo: boolean;
};

export function PrestadorServicoForm({
  prestadorServicoId,
  valoresIniciais,
}: {
  prestadorServicoId: string;
  valoresIniciais: ValoresPrestadorServico;
}) {
  const [state, formAction, isPending] = useActionState(editarPrestadorServico, null);
  const [estadoAtivo, alternarAction, alternandoPending] = useActionState(
    alternarAtivoPrestadorServico,
    null
  );
  const [tipo, setTipo] = useState<TipoPrestadorServico>(valoresIniciais.tipo);

  return (
    <div className="flex flex-col gap-6">
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="prestadorServicoId" value={prestadorServicoId} />
        <Card className="flex flex-col gap-4 p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Nome" name="nome" type="text" defaultValue={valoresIniciais.nome} required />

            <Select
              label="Tipo"
              name="tipo"
              value={tipo}
              onChange={(e) => setTipo(e.target.value as TipoPrestadorServico)}
            >
              {ORDEM_TIPO_PRESTADOR_SERVICO.map((valor) => (
                <option key={valor} value={valor}>
                  {ROTULO_TIPO_PRESTADOR_SERVICO[valor]}
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

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="CPF/CNPJ (opcional)"
              name="documento"
              type="text"
              defaultValue={valoresIniciais.documento ?? ""}
            />
            <Input
              label="Telefone (opcional)"
              name="telefone"
              type="text"
              defaultValue={valoresIniciais.telefone ?? ""}
            />
          </div>

          <Input
            label="E-mail (opcional)"
            name="email"
            type="email"
            defaultValue={valoresIniciais.email ?? ""}
          />

          <Textarea
            label="Observações (opcional)"
            name="observacoes"
            defaultValue={valoresIniciais.observacoes ?? ""}
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
            {valoresIniciais.ativo ? "Prestador ativo" : "Prestador inativo"}
          </p>
          <p className="text-xs text-slate-500">
            {valoresIniciais.ativo
              ? "Cadastro de referência — aparece na listagem de prestadores enquanto ativo."
              : "Some da listagem principal, mas o cadastro nunca é excluído de verdade — reative quando precisar."}
          </p>
          {estadoAtivo && !estadoAtivo.ok && (
            <p className="mt-1 text-xs text-rose-600">{estadoAtivo.mensagem}</p>
          )}
        </div>
        <form action={alternarAction}>
          <input type="hidden" name="prestadorServicoId" value={prestadorServicoId} />
          <Button type="submit" variant="outline" loading={alternandoPending} className="shrink-0">
            {valoresIniciais.ativo ? "Desativar" : "Ativar"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
