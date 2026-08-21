"use client";

import { useActionState, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { criarSolicitacaoCompra } from "../actions";

type Material = {
  id: string;
  nome: string;
  unidade: string;
  variantes: { id: string; rotulo: string }[];
};

export function NovaSolicitacaoForm({
  materiais,
  fornecedores,
  itemGraficaIdInicial,
  varianteIdInicial,
}: {
  materiais: Material[];
  // Fornecedores ativos da gráfica — "Ainda não definido" é sempre válido
  // (a solicitação pode nascer em SOLICITADO/COTANDO sem fornecedor, ver
  // model SolicitacaoCompra no schema).
  fornecedores: { id: string; nome: string }[];
  itemGraficaIdInicial: string;
  varianteIdInicial: string;
}) {
  const [state, formAction, pending] = useActionState(criarSolicitacaoCompra, null);
  const [itemGraficaId, setItemGraficaId] = useState(itemGraficaIdInicial || materiais[0]?.id || "");
  const [varianteId, setVarianteId] = useState(varianteIdInicial);

  const materialSelecionado = materiais.find((m) => m.id === itemGraficaId) ?? null;

  return (
    <Card className="p-6">
      <form action={formAction} className="flex flex-col gap-4">
        <Select
          label="Matéria-prima"
          name="itemGraficaId"
          value={itemGraficaId}
          onChange={(e) => {
            setItemGraficaId(e.target.value);
            setVarianteId("");
          }}
          required
        >
          {materiais.map((material) => (
            <option key={material.id} value={material.id}>
              {material.nome}
            </option>
          ))}
        </Select>

        {materialSelecionado && materialSelecionado.variantes.length > 0 && (
          <Select
            label="Variante"
            name="varianteId"
            value={varianteId}
            onChange={(e) => setVarianteId(e.target.value)}
            required
          >
            <option value="">Selecione...</option>
            {materialSelecionado.variantes.map((variante) => (
              <option key={variante.id} value={variante.id}>
                {variante.rotulo}
              </option>
            ))}
          </Select>
        )}

        <div className="flex flex-wrap gap-3">
          <div className="w-40">
            <Input
              label={`Quantidade${materialSelecionado?.unidade ? ` (${materialSelecionado.unidade})` : ""}`}
              name="quantidade"
              type="number"
              step="0.0001"
              min="0"
              required
            />
          </div>
          <div className="w-44">
            <Input
              label="Valor estimado (R$, opcional)"
              name="valorEstimado"
              type="number"
              step="0.01"
              min="0"
            />
          </div>
          <div className="min-w-[200px] flex-1">
            <Select label="Fornecedor (opcional)" name="fornecedorId" defaultValue="">
              <option value="">Ainda não definido</option>
              {fornecedores.map((fornecedor) => (
                <option key={fornecedor.id} value={fornecedor.id}>
                  {fornecedor.nome}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <Textarea label="Observação (opcional)" name="observacao" maxLength={500} />

        {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}

        <Button type="submit" loading={pending} className="self-start">
          {pending ? "Criando..." : "Criar solicitação"}
        </Button>
      </form>
    </Card>
  );
}
