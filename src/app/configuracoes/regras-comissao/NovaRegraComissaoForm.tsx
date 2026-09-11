"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { criarRegraComissao } from "./actions";

export function NovaRegraComissaoForm({
  usuarios,
  itensCatalogo,
}: {
  usuarios: { id: string; nome: string }[];
  itensCatalogo: { id: string; nome: string; categoria: string }[];
}) {
  const [state, formAction, isPending] = useActionState(criarRegraComissao, null);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Select label="Vendedor" name="usuarioId" defaultValue="" hint="Em branco = qualquer vendedor">
          <option value="">Qualquer vendedor</option>
          {usuarios.map((u) => (
            <option key={u.id} value={u.id}>
              {u.nome}
            </option>
          ))}
        </Select>

        <Select
          label="Produto/matéria-prima"
          name="itemCatalogoId"
          defaultValue=""
          hint="Em branco = qualquer item"
        >
          <option value="">Qualquer item</option>
          {itensCatalogo.map((i) => (
            <option key={i.id} value={i.id}>
              {i.nome} ({i.categoria})
            </option>
          ))}
        </Select>
      </div>

      <Input
        label="Categoria do catálogo"
        name="tipoItem"
        placeholder="ex: Cartão de Visita — em branco = qualquer categoria"
        hint="Precisa bater exatamente com a categoria cadastrada no item (Catálogo)."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Margem mínima (fração)"
          name="margemMinPercent"
          type="number"
          step="0.0001"
          min="0"
          max="1"
          placeholder="ex: 0.30 = 30%"
        />
        <Input
          label="Margem máxima (fração)"
          name="margemMaxPercent"
          type="number"
          step="0.0001"
          min="0"
          max="1"
          placeholder="em branco = sem teto"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Percentual de comissão (fração)"
          name="percentual"
          type="number"
          step="0.0001"
          min="0.0001"
          max="1"
          placeholder="ex: 0.08 = 8%"
          required
        />
        <Select
          label="Base de cálculo"
          name="baseCalculo"
          defaultValue=""
          hint="Em branco = usa a política padrão da gráfica"
        >
          <option value="">Padrão da gráfica</option>
          <option value="VALOR">% sobre o valor do orçamento</option>
          <option value="LUCRO">% sobre o lucro (valor − custo)</option>
        </Select>
      </div>

      <Input
        label="Prioridade (desempate)"
        name="prioridade"
        type="number"
        step="1"
        defaultValue="0"
        hint="Só decide entre regras IGUALMENTE específicas — maior vence."
      />

      {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}
      <Button type="submit" loading={isPending} className="self-start">
        {isPending ? "Cadastrando..." : "+ Nova regra"}
      </Button>
    </form>
  );
}
