"use client";

import { useActionState, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { editarContratoFornecimento, alternarAtivoContratoFornecimento } from "../actions";
import { UNIDADES_COMPRA, ROTULO_UNIDADE_COMPRA, type UnidadeCompra } from "@/lib/unidade-compra";

type Material = {
  id: string;
  nome: string;
  variantes: { id: string; rotulo: string }[];
};

export function ContratoForm({
  contratoId,
  fornecedores,
  materiais,
  fornecedorIdInicial,
  itemGraficaIdInicial,
  varianteIdInicial,
  precoUnitarioInicial,
  unidadeCompraInicial,
  unidadeCompraOutroInicial,
  vigenciaInicioInicial,
  vigenciaFimInicial,
  quantidadeContratadaInicial,
  quantidadeConsumida,
  condicaoPagamentoInicial,
  observacaoInicial,
  ativo,
}: {
  contratoId: string;
  fornecedores: { id: string; nome: string }[];
  materiais: Material[];
  fornecedorIdInicial: string;
  itemGraficaIdInicial: string;
  varianteIdInicial: string;
  precoUnitarioInicial: number;
  unidadeCompraInicial: UnidadeCompra;
  unidadeCompraOutroInicial: string;
  vigenciaInicioInicial: string;
  vigenciaFimInicial: string;
  quantidadeContratadaInicial: string;
  quantidadeConsumida: number;
  condicaoPagamentoInicial: string;
  observacaoInicial: string;
  ativo: boolean;
}) {
  const [state, formAction, isPending] = useActionState(editarContratoFornecimento, null);
  const [estadoAtivo, alternarAction, alternandoPending] = useActionState(
    alternarAtivoContratoFornecimento,
    null
  );
  const [itemGraficaId, setItemGraficaId] = useState(itemGraficaIdInicial);
  const [unidadeCompra, setUnidadeCompra] = useState<UnidadeCompra>(unidadeCompraInicial);

  const materialSelecionado = materiais.find((m) => m.id === itemGraficaId) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="contratoId" value={contratoId} />
        <Card className="flex flex-col gap-4 p-6">
          <Select label="Fornecedor" name="fornecedorId" defaultValue={fornecedorIdInicial} required>
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
              defaultValue={varianteIdInicial}
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
              <Input
                label="Preço unitário (R$)"
                name="precoUnitario"
                type="number"
                step="0.0001"
                min="0"
                defaultValue={precoUnitarioInicial}
                required
              />
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
                <Input
                  label="Qual? "
                  name="unidadeCompraOutro"
                  type="text"
                  maxLength={60}
                  defaultValue={unidadeCompraOutroInicial}
                />
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="min-w-[160px] flex-1">
              <Input
                label="Vigência - início"
                name="vigenciaInicio"
                type="date"
                defaultValue={vigenciaInicioInicial}
                required
              />
            </div>
            <div className="min-w-[160px] flex-1">
              <Input label="Vigência - fim" name="vigenciaFim" type="date" defaultValue={vigenciaFimInicial} required />
            </div>
          </div>

          <Input
            label="Quantidade contratada (opcional)"
            name="quantidadeContratada"
            type="number"
            step="0.0001"
            min="0"
            defaultValue={quantidadeContratadaInicial}
            hint={`Já consumido: ${quantidadeConsumida}. Deixe em branco pra um contrato sem teto de volume.`}
          />

          <Input
            label="Condição de pagamento (opcional)"
            name="condicaoPagamento"
            type="text"
            maxLength={120}
            defaultValue={condicaoPagamentoInicial}
          />

          <Textarea label="Observação (opcional)" name="observacao" maxLength={500} defaultValue={observacaoInicial} />
        </Card>
        {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}
        <Button type="submit" loading={isPending} className="self-start">
          {isPending ? "Salvando..." : "Salvar"}
        </Button>
      </form>

      <Card className="flex items-center justify-between gap-4 p-5">
        <div>
          <p className="text-sm font-medium text-slate-900 dark:text-white">
            {ativo ? "Contrato ativo" : "Contrato inativo"}
          </p>
          <p className="text-xs text-slate-500">
            {ativo
              ? "Oferecido automaticamente ao criar uma solicitação de compra pra este fornecedor/item."
              : "Some da seleção automática, mas solicitações já criadas com ele continuam no histórico. Nunca é excluído de verdade."}
          </p>
          {estadoAtivo && !estadoAtivo.ok && <p className="mt-1 text-xs text-rose-600">{estadoAtivo.mensagem}</p>}
        </div>
        <form action={alternarAction}>
          <input type="hidden" name="contratoId" value={contratoId} />
          <Button type="submit" variant="outline" loading={alternandoPending} className="shrink-0">
            {ativo ? "Desativar" : "Ativar"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
