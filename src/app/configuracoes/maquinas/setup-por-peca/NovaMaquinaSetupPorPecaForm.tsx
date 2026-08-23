"use client";

import { useActionState, useState } from "react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { ORDEM_PROCESSO_SETUP_POR_PECA, ROTULO_PROCESSO_SETUP_POR_PECA } from "@/lib/tipos-equipamento";
import { criarMaquinaSetupPorPeca } from "./actions";
import type { ProcessoSetupPorPeca } from "@/generated/prisma/enums";

export function NovaMaquinaSetupPorPecaForm() {
  const [state, formAction, isPending] = useActionState(criarMaquinaSetupPorPeca, null);
  const [tipoProcesso, setTipoProcesso] = useState<ProcessoSetupPorPeca>("SERIGRAFIA");

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Input
        label="Nome"
        name="nome"
        type="text"
        placeholder="ex: Carrossel serigráfico 6 cores"
        required
        hint="Os custos (setup, por peça, mínimo) você ajusta na tela seguinte."
      />
      <Select
        label="Processo"
        name="tipoProcesso"
        value={tipoProcesso}
        onChange={(e) => setTipoProcesso(e.target.value as ProcessoSetupPorPeca)}
        hint="Só produtos deste processo poderão selecionar esta máquina."
      >
        {ORDEM_PROCESSO_SETUP_POR_PECA.map((valor) => (
          <option key={valor} value={valor}>
            {ROTULO_PROCESSO_SETUP_POR_PECA[valor]}
          </option>
        ))}
      </Select>
      {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}
      <Button type="submit" loading={isPending} className="self-start">
        {isPending ? "Criando..." : "+ Nova máquina"}
      </Button>
    </form>
  );
}
