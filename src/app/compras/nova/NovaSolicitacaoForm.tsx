"use client";

import { useActionState, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { formatoMoeda } from "@/lib/moeda";
import { formatoInstanteReal } from "@/lib/data";
import { chaveComparativo } from "@/lib/comparativo-fornecedores";
import { criarSolicitacaoCompra } from "../actions";

type Material = {
  id: string;
  nome: string;
  unidade: string;
  variantes: { id: string; rotulo: string }[];
};

// Versão serializada (datas em ISO) de LinhaComparativoFornecedor — ver
// comparativo-fornecedores.ts pra lógica de agrupamento/ordenação.
type LinhaComparativo = {
  fornecedorId: string;
  fornecedorNome: string;
  ultimoPreco: number;
  ultimaCompraEm: string;
  historico: { preco: number; data: string }[];
};

export function NovaSolicitacaoForm({
  materiais,
  fornecedores,
  itemGraficaIdInicial,
  varianteIdInicial,
  comparativoPorChave,
}: {
  materiais: Material[];
  // Fornecedores ativos da gráfica — "Ainda não definido" é sempre válido
  // (a solicitação pode nascer em SOLICITADO/COTANDO sem fornecedor, ver
  // model SolicitacaoCompra no schema).
  fornecedores: { id: string; nome: string }[];
  itemGraficaIdInicial: string;
  varianteIdInicial: string;
  // Comparativo de preço por fornecedor de CADA matéria-prima/variante ativa
  // da gráfica, já calculado no servidor (ver page.tsx) — chaveado por
  // varianteId quando existe, senão itemGraficaId (mesma convenção de
  // chaveComparativo). Trocar a seleção no formulário só troca qual entrada
  // deste objeto é exibida, sem round-trip ao servidor.
  comparativoPorChave: Record<string, LinhaComparativo[]>;
}) {
  const [state, formAction, pending] = useActionState(criarSolicitacaoCompra, null);
  const [itemGraficaId, setItemGraficaId] = useState(itemGraficaIdInicial || materiais[0]?.id || "");
  const [varianteId, setVarianteId] = useState(varianteIdInicial);

  const materialSelecionado = materiais.find((m) => m.id === itemGraficaId) ?? null;

  // Enquanto a matéria-prima tem variante mas nenhuma foi escolhida ainda,
  // não faz sentido comparar preço (o preço é POR variante, ex: chapa 2mm ×
  // 5mm) — só mostra o comparativo quando a chave está totalmente resolvida.
  const aguardandoVariante = (materialSelecionado?.variantes.length ?? 0) > 0 && !varianteId;
  const comparativo =
    materialSelecionado && !aguardandoVariante
      ? (comparativoPorChave[chaveComparativo(materialSelecionado.id, varianteId || null)] ?? [])
      : [];

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

        {materialSelecionado && !aguardandoVariante && (
          <ComparativoFornecedoresCard
            unidade={materialSelecionado.unidade}
            linhas={comparativo}
            aindaSemHistorico={comparativo.length === 0}
          />
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

// Comparativo de preço entre fornecedores que já venderam a matéria-prima/
// variante selecionada, do mais barato pro mais caro — ajuda a decidir com
// quem cotar ANTES de preencher fornecedor/quantidade abaixo. Dado vem
// pronto do servidor (ver comparativoPorChave), aqui é só formatação.
function ComparativoFornecedoresCard({
  unidade,
  linhas,
  aindaSemHistorico,
}: {
  unidade: string;
  linhas: LinhaComparativo[];
  aindaSemHistorico: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800">
      <p className="border-b border-slate-200 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800">
        Comparativo de fornecedores{unidade ? ` (preço por ${unidade})` : ""}
      </p>
      {aindaSemHistorico ? (
        <p className="px-4 py-4 text-sm text-slate-500">
          Nenhuma compra registrada ainda pra este item — o comparativo aparece assim que a primeira
          solicitação for recebida com fornecedor e valor pago.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Fornecedor</th>
                <th className="px-4 py-2 text-right">Último preço</th>
                <th className="px-4 py-2">Última compra</th>
                <th className="px-4 py-2">Histórico</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {linhas.map((linha, indice) => (
                <tr key={linha.fornecedorId}>
                  <td className="px-4 py-2 font-medium text-slate-900 dark:text-white">
                    {linha.fornecedorNome}
                    {indice === 0 && (
                      <span className="ml-2 rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700 dark:bg-teal-950/40 dark:text-teal-400">
                        mais barato
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right text-slate-600 dark:text-slate-300">
                    {formatoMoeda.format(linha.ultimoPreco)}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap text-slate-500">
                    {formatoInstanteReal.format(new Date(linha.ultimaCompraEm))}
                  </td>
                  <td className="px-4 py-2 text-slate-500">
                    {linha.historico.map((h) => formatoMoeda.format(h.preco)).join(" · ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
