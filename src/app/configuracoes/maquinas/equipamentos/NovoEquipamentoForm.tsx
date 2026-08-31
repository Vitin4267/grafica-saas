"use client";

import { useActionState, useState } from "react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import {
  ORDEM_CATEGORIA_EQUIPAMENTO,
  ROTULO_CATEGORIA_EQUIPAMENTO,
  EXEMPLOS_MARCA_CATEGORIA_EQUIPAMENTO,
} from "@/lib/tipos-equipamento";
import { criarEquipamento } from "./actions";
import type { CategoriaEquipamento } from "@/generated/prisma/enums";

export function NovoEquipamentoForm() {
  const [state, formAction, isPending] = useActionState(criarEquipamento, null);
  const [categoria, setCategoria] = useState<CategoriaEquipamento>("GUILHOTINA");

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Input label="Nome" name="nome" type="text" placeholder="ex: Guilhotina da bancada 2" required />

      <Select
        label="Categoria"
        name="categoria"
        value={categoria}
        onChange={(e) => setCategoria(e.target.value as CategoriaEquipamento)}
      >
        {ORDEM_CATEGORIA_EQUIPAMENTO.map((valor) => (
          <option key={valor} value={valor}>
            {ROTULO_CATEGORIA_EQUIPAMENTO[valor]}
          </option>
        ))}
      </Select>

      {categoria === "OUTRO" ? (
        <Input
          label="Descreva a categoria"
          name="categoriaOutro"
          type="text"
          placeholder="ex: gofradeira, vincadeira..."
          required
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Marca"
            name="marca"
            type="text"
            placeholder={EXEMPLOS_MARCA_CATEGORIA_EQUIPAMENTO[categoria]}
          />
          <Input label="Modelo" name="modelo" type="text" />
        </div>
      )}

      {/* Achado A3 da Parte 7 da auditoria de abrangência — largura/
         tecnologia de impressão. Não é específico de categoria (qualquer
         Equipamento pode ter, não só IMPRESSORA_GRANDE_FORMATO), por isso
         fora do bloco condicional de categoria acima. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Largura máxima (mm)"
          name="larguraMaximaMm"
          type="number"
          step="1"
          min="1"
          placeholder="ex: 1600"
        />
        <Input
          label="Tecnologia de impressão"
          name="tecnologiaImpressao"
          type="text"
          placeholder="ex: eco-solvente, UV, sublimática"
        />
      </div>

      {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}
      <Button type="submit" loading={isPending} className="self-start">
        {isPending ? "Criando..." : "+ Novo equipamento"}
      </Button>
    </form>
  );
}
