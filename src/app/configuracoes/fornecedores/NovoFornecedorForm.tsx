"use client";

import { useActionState, useState } from "react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import {
  ORDEM_CATEGORIA_FORNECEDOR,
  ROTULO_CATEGORIA_FORNECEDOR,
  ORDEM_CONDICAO_PAGAMENTO_FORNECEDOR,
  ROTULO_CONDICAO_PAGAMENTO_FORNECEDOR,
} from "@/lib/tipos-fornecedor";
import { criarFornecedor } from "./actions";

export function NovoFornecedorForm() {
  const [state, formAction, isPending] = useActionState(criarFornecedor, null);
  const [categoria, setCategoria] = useState("");
  const [condicaoPagamento, setCondicaoPagamento] = useState("");

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Input
        label="Nome"
        name="nome"
        type="text"
        placeholder="ex: Arclad"
        required
      />
      <Input
        label="Contato (opcional)"
        name="contato"
        type="text"
        placeholder="ex: telefone, e-mail ou observação"
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input label="E-mail (opcional)" name="email" type="email" placeholder="opcional" />
        <Input label="Telefone (opcional)" name="telefone" type="text" placeholder="opcional" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Select
          label="Categoria (opcional)"
          name="categoria"
          value={categoria}
          onChange={(e) => setCategoria(e.target.value)}
        >
          <option value="">Não classificado</option>
          {ORDEM_CATEGORIA_FORNECEDOR.map((valor) => (
            <option key={valor} value={valor}>
              {ROTULO_CATEGORIA_FORNECEDOR[valor]}
            </option>
          ))}
        </Select>
        <Select
          label="Condição de pagamento padrão (opcional)"
          name="condicaoPagamentoPadrao"
          value={condicaoPagamento}
          onChange={(e) => setCondicaoPagamento(e.target.value)}
        >
          <option value="">Não definida</option>
          {ORDEM_CONDICAO_PAGAMENTO_FORNECEDOR.map((valor) => (
            <option key={valor} value={valor}>
              {ROTULO_CONDICAO_PAGAMENTO_FORNECEDOR[valor]}
            </option>
          ))}
        </Select>
      </div>

      {categoria === "OUTRO" && (
        <Input
          label="Descreva a categoria"
          name="categoriaOutro"
          type="text"
          placeholder="ex: reposição de peças"
          required
        />
      )}
      {condicaoPagamento === "OUTRO" && (
        <Input
          label="Descreva a condição de pagamento"
          name="condicaoPagamentoPadraoOutro"
          type="text"
          placeholder="ex: 15 dias após entrega"
          required
        />
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Prazo de entrega médio, em dias (opcional)"
          name="prazoEntregaMedioDias"
          type="number"
          min="0"
          step="1"
          placeholder="opcional"
        />
        <Input
          label="Pedido mínimo, em R$ (opcional)"
          name="pedidoMinimoValor"
          type="number"
          min="0"
          step="0.01"
          placeholder="opcional"
        />
      </div>

      <p className="text-xs text-slate-500">
        Os demais ajustes (CNPJ, endereço, ativo/inativo) você faz na tela seguinte.
      </p>
      {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}
      <Button type="submit" loading={isPending} className="self-start">
        {isPending ? "Criando..." : "+ Novo fornecedor"}
      </Button>
    </form>
  );
}
