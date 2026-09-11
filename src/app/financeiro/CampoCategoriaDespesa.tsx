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
  onSelecaoMudar,
}: {
  categorias: { id: string; nome: string }[];
  categoriaCustoIdInicial?: string | null;
  categoriaInicial?: string | null;
  // Achado Fin-A1 da Parte 4 da auditoria de abrangência (2026-09-11) —
  // opcional: quem precisa saber a categoria escolhida SEM tornar este
  // componente controlado por fora (ex: NovaDespesaForm/DespesaForm, pro
  // aviso "isso também vai lançar um custo neste pedido", que só faz sentido
  // quando a categoria vem da lista — "Outra" digitada nunca casa com
  // CategoriaCusto.id, então nunca teria como onde lançar o custo).
  onSelecaoMudar?: (categoriaCustoId: string) => void;
}) {
  const [selecao, setSelecao] = useState(categoriaCustoIdInicial ?? VALOR_OUTRA);
  const usandoOutra = selecao === VALOR_OUTRA;

  return (
    <>
      <Select
        label="Categoria"
        name="categoriaCustoId"
        value={selecao}
        onChange={(evento) => {
          setSelecao(evento.target.value);
          onSelecaoMudar?.(evento.target.value);
        }}
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
