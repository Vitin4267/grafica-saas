"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { criarCategoriaCusto } from "./actions";

export function NovaCategoriaCustoForm() {
  const [state, formAction, isPending] = useActionState(criarCategoriaCusto, null);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Input
        label="Nome"
        name="nome"
        type="text"
        placeholder="ex: Papel especial"
        required
        hint="Os demais ajustes (ativa/inativa) você faz na tela seguinte."
      />
      {/* Achado A2 da Parte 4 da auditoria de abrangência (2026-09-05) —
          opcional aqui (default VARIAVEL no schema se não escolher). */}
      <Select label="Natureza do custo" name="natureza" defaultValue="VARIAVEL">
        <option value="VARIAVEL">Variável (muda com a produção)</option>
        <option value="FIXO">Fixo (existe independente de produzir)</option>
        <option value="SEMIVARIAVEL">Semivariável (parte fixa, parte varia)</option>
      </Select>
      {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}
      <Button type="submit" loading={isPending} className="self-start">
        {isPending ? "Criando..." : "+ Nova categoria"}
      </Button>
    </form>
  );
}
