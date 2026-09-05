"use client";

import { useActionState, useState } from "react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import {
  ORDEM_TIPO_PRESTADOR_SERVICO,
  ROTULO_TIPO_PRESTADOR_SERVICO,
} from "@/lib/tipos-prestador-servico";
import { criarPrestadorServico } from "./actions";
import type { TipoPrestadorServico } from "@/generated/prisma/enums";

export function NovoPrestadorServicoForm() {
  const [state, formAction, isPending] = useActionState(criarPrestadorServico, null);
  const [tipo, setTipo] = useState<TipoPrestadorServico>("ACABAMENTO");

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input label="Nome" name="nome" type="text" placeholder="ex: Laminadora Silva" required />

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
          placeholder="ex: manutenção de máquina"
          required
        />
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input label="CPF/CNPJ (opcional)" name="documento" type="text" placeholder="opcional" />
        <Input label="Telefone (opcional)" name="telefone" type="text" placeholder="opcional" />
      </div>

      <Input label="E-mail (opcional)" name="email" type="email" placeholder="opcional" />

      <Textarea
        label="Observações (opcional)"
        name="observacoes"
        placeholder="ex: condição de pagamento, prazo combinado..."
        hint="Os demais ajustes (ativo/inativo) você faz na tela seguinte."
      />

      {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}
      <Button type="submit" loading={isPending} className="self-start">
        {isPending ? "Criando..." : "+ Novo prestador de serviço"}
      </Button>
    </form>
  );
}
