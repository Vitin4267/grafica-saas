"use client";

import { useActionState, useState } from "react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { CampoAjuda } from "@/components/ui/CampoAjuda";
import { ROTULO_PAPEL } from "@/lib/papel-usuario";
import type { TipoAlcada, PapelUsuario } from "@/generated/prisma/enums";
import { criarAlcada } from "./actions";

const PAPEIS: PapelUsuario[] = ["DONO", "ADMIN", "OPERADOR"];

export function NovaAlcadaForm({
  tipo,
  usuarios,
}: {
  tipo: TipoAlcada;
  usuarios: { id: string; nome: string; papel: string }[];
}) {
  const [state, formAction, isPending] = useActionState(criarAlcada, null);
  const [alvo, setAlvo] = useState<"PAPEL" | "USUARIO">("PAPEL");

  const unidade = tipo === "DESCONTO_ORCAMENTO" ? "%" : "R$";

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="tipo" value={tipo} />

      <div className="flex flex-col gap-1.5">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">
          Alçada por
          <CampoAjuda texto="Papel cobre todo mundo com esse papel de uma vez (ex: todo OPERADOR). Usuário específico é uma exceção pontual — ex: um vendedor sênior com alçada maior que o resto do papel dele. Só pode escolher um dos dois." />
        </span>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input
              type="radio"
              name="alvo"
              value="PAPEL"
              checked={alvo === "PAPEL"}
              onChange={() => setAlvo("PAPEL")}
              className="h-4 w-4 border-slate-300 text-teal-600 focus:ring-teal-500"
            />
            Papel
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input
              type="radio"
              name="alvo"
              value="USUARIO"
              checked={alvo === "USUARIO"}
              onChange={() => setAlvo("USUARIO")}
              className="h-4 w-4 border-slate-300 text-teal-600 focus:ring-teal-500"
            />
            Usuário específico
          </label>
        </div>
      </div>

      {alvo === "PAPEL" ? (
        <Select label="Papel" name="papel" defaultValue="OPERADOR" required>
          {PAPEIS.map((p) => (
            <option key={p} value={p}>
              {ROTULO_PAPEL[p] ?? p}
            </option>
          ))}
        </Select>
      ) : (
        <Select label="Usuário" name="usuarioId" required defaultValue="">
          <option value="" disabled>
            Selecione um usuário
          </option>
          {usuarios.map((u) => (
            <option key={u.id} value={u.id}>
              {u.nome} ({ROTULO_PAPEL[u.papel] ?? u.papel})
            </option>
          ))}
        </Select>
      )}

      <Input
        label={`Limite (${unidade})`}
        name="limite"
        type="number"
        step={tipo === "DESCONTO_ORCAMENTO" ? "0.1" : "0.01"}
        min="0.01"
        max={tipo === "DESCONTO_ORCAMENTO" ? "100" : undefined}
        placeholder={tipo === "DESCONTO_ORCAMENTO" ? "ex: 10" : "ex: 500"}
        hint={
          tipo === "DESCONTO_ORCAMENTO"
            ? "Percentual de desconto que este papel/usuário pode aplicar sozinho, sem precisar de mais ninguém."
            : "Valor em reais que este papel/usuário pode aprovar sozinho numa solicitação de compra."
        }
        required
      />

      {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}
      <Button type="submit" loading={isPending} className="self-start">
        {isPending ? "Cadastrando..." : "+ Nova alçada"}
      </Button>
    </form>
  );
}
