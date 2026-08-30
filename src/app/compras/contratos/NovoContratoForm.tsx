"use client";

import { useActionState, useState } from "react";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { criarContratoFornecimento } from "./actions";
import { UNIDADES_COMPRA, ROTULO_UNIDADE_COMPRA, type UnidadeCompra } from "@/lib/unidade-compra";

type Material = {
  id: string;
  nome: string;
  variantes: { id: string; rotulo: string }[];
};

export function NovoContratoForm({
  fornecedores,
  materiais,
}: {
  fornecedores: { id: string; nome: string }[];
  materiais: Material[];
}) {
  const [state, formAction, pending] = useActionState(criarContratoFornecimento, null);
  const [itemGraficaId, setItemGraficaId] = useState("");
  const [unidadeCompra, setUnidadeCompra] = useState<UnidadeCompra>("UNIDADE");

  const materialSelecionado = materiais.find((m) => m.id === itemGraficaId) ?? null;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Select label="Fornecedor" name="fornecedorId" defaultValue="" required>
        <option value="" disabled>
          Selecione...
        </option>
        {fornecedores.map((fornecedor) => (
          <option key={fornecedor.id} value={fornecedor.id}>
            {fornecedor.nome}
          </option>
        ))}
      </Select>

      <Select
        label="Matéria-prima (opcional)"
        name="itemGraficaId"
        value={itemGraficaId}
        onChange={(e) => setItemGraficaId(e.target.value)}
        hint="Deixe em branco pra um contrato que cobre qualquer matéria-prima deste fornecedor."
      >
        <option value="">Qualquer matéria-prima (contrato coringa)</option>
        {materiais.map((material) => (
          <option key={material.id} value={material.id}>
            {material.nome}
          </option>
        ))}
      </Select>

      {materialSelecionado && materialSelecionado.variantes.length > 0 && (
        <Select
          label="Variante (opcional)"
          name="varianteId"
          defaultValue=""
          hint="Deixe em branco pra cobrir qualquer variante desta matéria-prima."
        >
          <option value="">Qualquer variante</option>
          {materialSelecionado.variantes.map((variante) => (
            <option key={variante.id} value={variante.id}>
              {variante.rotulo}
            </option>
          ))}
        </Select>
      )}

      <div className="flex flex-wrap gap-3">
        <div className="w-40">
          <Input label="Preço unitário (R$)" name="precoUnitario" type="number" step="0.0001" min="0" required />
        </div>
        <div className="min-w-[160px] flex-1">
          <Select
            label="Unidade de compra"
            name="unidadeCompra"
            value={unidadeCompra}
            onChange={(e) => setUnidadeCompra(e.target.value as UnidadeCompra)}
            hint="Só informativo — o preço acima já deve ser por unidade de estoque."
          >
            {UNIDADES_COMPRA.map((u) => (
              <option key={u} value={u}>
                {ROTULO_UNIDADE_COMPRA[u]}
              </option>
            ))}
          </Select>
        </div>
        {unidadeCompra === "OUTRO" && (
          <div className="min-w-[160px] flex-1">
            <Input label="Qual? " name="unidadeCompraOutro" type="text" maxLength={60} />
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="min-w-[160px] flex-1">
          <Input label="Vigência - início" name="vigenciaInicio" type="date" required />
        </div>
        <div className="min-w-[160px] flex-1">
          <Input label="Vigência - fim" name="vigenciaFim" type="date" required />
        </div>
      </div>

      <Input
        label="Quantidade contratada (opcional)"
        name="quantidadeContratada"
        type="number"
        step="0.0001"
        min="0"
        hint="Teto de volume do contrato — deixe em branco pra um contrato sem teto (só preço travado)."
      />

      <Input
        label="Condição de pagamento (opcional)"
        name="condicaoPagamento"
        type="text"
        maxLength={120}
        placeholder="ex: boleto 30/60/90"
      />

      <Textarea label="Observação (opcional)" name="observacao" maxLength={500} />

      {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}

      <Button type="submit" loading={pending} className="self-start">
        {pending ? "Criando..." : "+ Novo contrato"}
      </Button>
    </form>
  );
}
