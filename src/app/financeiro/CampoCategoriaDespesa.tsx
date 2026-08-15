"use client";

import { useState } from "react";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";

// Select de categorias já cadastradas em CategoriaCusto (mesmas usadas em
// custo de pedido) + opção de digitar uma categoria nova/personalizada —
// nunca uma lista fechada, senão volta o mesmo problema de agrupamento que
// motivou a ligação Despesa -> CategoriaCusto (ver AGENTS deste PR). Quando
// uma categoria da lista é escolhida, a action grava categoriaCustoId E
// espelha o nome dela em `categoria` (texto) — esse componente só cuida de
// mostrar/esconder o campo de texto livre.
const VALOR_OUTRA = "";

export function CampoCategoriaDespesa({
  categorias,
  categoriaCustoIdInicial,
  categoriaInicial,
}: {
  categorias: { id: string; nome: string }[];
  categoriaCustoIdInicial?: string | null;
  categoriaInicial?: string | null;
}) {
  const [selecao, setSelecao] = useState(categoriaCustoIdInicial ?? VALOR_OUTRA);
  const usandoOutra = selecao === VALOR_OUTRA;

  return (
    <>
      <Select
        label="Categoria"
        name="categoriaCustoId"
        value={selecao}
        onChange={(evento) => setSelecao(evento.target.value)}
      >
        <option value={VALOR_OUTRA}>Outra (digitar)</option>
        {categorias.map((categoria) => (
          <option key={categoria.id} value={categoria.id}>
            {categoria.nome}
          </option>
        ))}
      </Select>
      {usandoOutra && (
        <Input
          label="Categoria (opcional)"
          name="categoria"
          type="text"
          placeholder="ex: Fornecedor, Aluguel"
          defaultValue={categoriaInicial ?? ""}
        />
      )}
    </>
  );
}
