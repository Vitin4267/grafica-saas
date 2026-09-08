"use client";

import { useActionState, useState } from "react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { ORDEM_TIPO_COLABORADOR, ROTULO_TIPO_COLABORADOR } from "@/lib/tipos-colaborador";
import { criarColaborador } from "./actions";
import type { TipoColaborador } from "@/generated/prisma/enums";

export function NovoColaboradorForm() {
  const [state, formAction, isPending] = useActionState(criarColaborador, null);
  const [tipo, setTipo] = useState<TipoColaborador>("MOTORISTA");

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input label="Nome" name="nome" type="text" placeholder="ex: Carlos Silva" required />

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
          placeholder="ex: auxiliar de expedição"
          required
        />
      )}

      <Input
        label="Telefone (opcional)"
        name="telefone"
        type="text"
        placeholder="ex: (11) 91234-5678"
        hint="Os demais ajustes (ativo/inativo) você faz na tela seguinte."
      />

      {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}
      <Button type="submit" loading={isPending} className="self-start">
        {isPending ? "Criando..." : "+ Novo colaborador"}
      </Button>
    </form>
  );
}
