"use client";

import { useActionState, useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { formatoMoeda } from "@/lib/moeda";
import { formatoData } from "@/lib/data";
import { registrarCotacaoFornecedor, definirCotacaoVencedora, excluirCotacaoFornecedor } from "../actions";

export type Cotacao = {
  id: string;
  fornecedorId: string;
  fornecedorNome: string;
  precoUnitario: number;
  valorTotal: number;
  prazoEntregaDias: number | null;
  condicaoPagamento: string | null;
  validaAte: string | null; // ISO, data-pura
  frete: number | null;
  observacao: string | null;
  vencedora: boolean;
  registradaPorNome: string;
};

// "Última cotação conhecida" de cada fornecedor pra ESTE item/variante,
// olhando o histórico de outras solicitações — usado só pra pré-preencher o
// formulário abaixo (ver buscarUltimasCotacoesPorItem).
export type UltimaCotacaoConhecida = {
  precoUnitario: number;
  condicaoPagamento: string | null;
  prazoEntregaDias: number | null;
  frete: number | null;
};

// Mapa de cotação (achado A4 da auditoria de abrangência, Parte 3/Compras):
// lista as cotações já registradas pra esta solicitação lado a lado (preço,
// prazo, condição de pagamento), permite marcar a vencedora e, quando ainda
// editável, adicionar/atualizar uma cotação — pré-preenchida com o último
// preço já visto daquele fornecedor pra este mesmo item, se houver.
export function CotacoesFornecedorCard({
  solicitacaoId,
  editavel,
  fornecedores,
  cotacoes,
  ultimasPorFornecedor,
  quantidadeSolicitada,
  unidade,
}: {
  solicitacaoId: string;
  editavel: boolean;
  fornecedores: { id: string; nome: string }[];
  cotacoes: Cotacao[];
  ultimasPorFornecedor: Record<string, UltimaCotacaoConhecida>;
  quantidadeSolicitada: number;
  unidade: string;
}) {
  const cotacoesOrdenadas = useMemo(
    () => [...cotacoes].sort((a, b) => a.precoUnitario - b.precoUnitario),
    [cotacoes]
  );
  const maisBarataId = cotacoesOrdenadas[0]?.id ?? null;

  return (
    <Card className="flex flex-col gap-5 p-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">Cotações de fornecedor</h2>
        <p className="mt-1 text-sm text-slate-500">
          Registre o preço, prazo e condição de pagamento de cada fornecedor consultado e marque a vencedora antes
          de aprovar.
        </p>
      </div>

      {cotacoesOrdenadas.length === 0 ? (
        <p className="text-sm text-slate-500">Nenhuma cotação registrada ainda.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Fornecedor</th>
                <th className="px-3 py-2 text-right">Preço unit.</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2">Prazo</th>
                <th className="px-3 py-2">Condição</th>
                <th className="px-3 py-2">Válida até</th>
                {editavel && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {cotacoesOrdenadas.map((cotacao) => (
                <LinhaCotacao
                  key={cotacao.id}
                  solicitacaoId={solicitacaoId}
                  cotacao={cotacao}
                  editavel={editavel}
                  ehMaisBarata={cotacao.id === maisBarataId}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editavel && (
        <NovaCotacaoForm
          solicitacaoId={solicitacaoId}
          fornecedores={fornecedores}
          cotacoes={cotacoes}
          ultimasPorFornecedor={ultimasPorFornecedor}
          quantidadeSolicitada={quantidadeSolicitada}
          unidade={unidade}
        />
      )}
    </Card>
  );
}

function LinhaCotacao({
  solicitacaoId,
  cotacao,
  editavel,
  ehMaisBarata,
}: {
  solicitacaoId: string;
  cotacao: Cotacao;
  editavel: boolean;
  ehMaisBarata: boolean;
}) {
  const [stateVencedora, formActionVencedora, pendingVencedora] = useActionState(definirCotacaoVencedora, null);
  const [stateExcluir, formActionExcluir, pendingExcluir] = useActionState(excluirCotacaoFornecedor, null);

  return (
    <tr className={cotacao.vencedora ? "bg-teal-50/60 dark:bg-teal-950/20" : undefined}>
      <td className="px-3 py-2 font-medium text-slate-900 dark:text-white">
        {cotacao.fornecedorNome}
        <div className="mt-0.5 flex flex-wrap gap-1">
          {cotacao.vencedora && (
            <span className="rounded-full bg-teal-100 px-2 py-0.5 text-xs font-medium text-teal-700 dark:bg-teal-950/60 dark:text-teal-400">
              vencedora
            </span>
          )}
          {ehMaisBarata && !cotacao.vencedora && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              mais barata
            </span>
          )}
        </div>
      </td>
      <td className="px-3 py-2 text-right text-slate-600 dark:text-slate-300">
        {formatoMoeda.format(cotacao.precoUnitario)}
      </td>
      <td className="px-3 py-2 text-right text-slate-600 dark:text-slate-300">
        {formatoMoeda.format(cotacao.valorTotal)}
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-slate-500">
        {cotacao.prazoEntregaDias !== null ? `${cotacao.prazoEntregaDias} dia(s)` : "—"}
      </td>
      <td className="px-3 py-2 text-slate-500">{cotacao.condicaoPagamento ?? "—"}</td>
      <td className="px-3 py-2 whitespace-nowrap text-slate-500">
        {cotacao.validaAte ? formatoData.format(new Date(cotacao.validaAte)) : "—"}
      </td>
      {editavel && (
        <td className="px-3 py-2">
          <div className="flex items-center justify-end gap-2">
            {!cotacao.vencedora && (
              <form action={formActionVencedora}>
                <input type="hidden" name="solicitacaoId" value={solicitacaoId} />
                <input type="hidden" name="cotacaoId" value={cotacao.id} />
                <Button
                  type="submit"
                  variant="outline"
                  loading={pendingVencedora}
                  className="px-2.5 py-1.5 text-xs"
                >
                  Marcar vencedora
                </Button>
              </form>
            )}
            <form action={formActionExcluir}>
              <input type="hidden" name="solicitacaoId" value={solicitacaoId} />
              <input type="hidden" name="cotacaoId" value={cotacao.id} />
              <Button
                type="submit"
                variant="outline"
                loading={pendingExcluir}
                className="border-rose-300 px-2.5 py-1.5 text-xs text-rose-700 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-300"
              >
                Excluir
              </Button>
            </form>
          </div>
          {stateVencedora && !stateVencedora.ok && (
            <p className="mt-1 text-right text-xs text-rose-600">{stateVencedora.mensagem}</p>
          )}
          {stateExcluir && !stateExcluir.ok && (
            <p className="mt-1 text-right text-xs text-rose-600">{stateExcluir.mensagem}</p>
          )}
        </td>
      )}
    </tr>
  );
}

function NovaCotacaoForm({
  solicitacaoId,
  fornecedores,
  cotacoes,
  ultimasPorFornecedor,
  quantidadeSolicitada,
  unidade,
}: {
  solicitacaoId: string;
  fornecedores: { id: string; nome: string }[];
  cotacoes: Cotacao[];
  ultimasPorFornecedor: Record<string, UltimaCotacaoConhecida>;
  quantidadeSolicitada: number;
  unidade: string;
}) {
  const [state, formAction, pending] = useActionState(registrarCotacaoFornecedor, null);
  const [fornecedorId, setFornecedorId] = useState(fornecedores[0]?.id ?? "");

  const cotacaoExistente = cotacoes.find((c) => c.fornecedorId === fornecedorId) ?? null;
  const ultimaConhecida = !cotacaoExistente ? (ultimasPorFornecedor[fornecedorId] ?? null) : null;

  // Prioridade de pré-preenchimento: cotação já registrada nesta solicitação
  // (editar) > último preço conhecido deste fornecedor pra este item (achado
  // A4: "Pré-preencher com o último preço de cada fornecedor") > vazio.
  const precoSugerido = cotacaoExistente?.precoUnitario ?? ultimaConhecida?.precoUnitario ?? undefined;
  const totalSugerido =
    cotacaoExistente?.valorTotal ??
    (ultimaConhecida ? Number((ultimaConhecida.precoUnitario * quantidadeSolicitada).toFixed(2)) : undefined);
  const prazoSugerido = cotacaoExistente?.prazoEntregaDias ?? ultimaConhecida?.prazoEntregaDias ?? undefined;
  const condicaoSugerida = cotacaoExistente?.condicaoPagamento ?? ultimaConhecida?.condicaoPagamento ?? undefined;
  const freteSugerido = cotacaoExistente?.frete ?? ultimaConhecida?.frete ?? undefined;

  if (fornecedores.length === 0) {
    return (
      <p className="border-t border-slate-100 pt-4 text-xs text-slate-500 dark:border-slate-800">
        Cadastre um fornecedor antes de registrar uma cotação.
      </p>
    );
  }

  return (
    <form
      // key força reset dos defaultValue quando troca de fornecedor — os
      // campos abaixo são não-controlados (defaultValue), então precisam
      // remontar pra refletir a nova sugestão.
      key={fornecedorId}
      action={formAction}
      className="flex flex-col gap-4 border-t border-slate-100 pt-4 dark:border-slate-800"
    >
      <input type="hidden" name="solicitacaoId" value={solicitacaoId} />

      <Select
        label="Fornecedor"
        name="fornecedorId"
        value={fornecedorId}
        onChange={(e) => setFornecedorId(e.target.value)}
      >
        {fornecedores.map((fornecedor) => (
          <option key={fornecedor.id} value={fornecedor.id}>
            {fornecedor.nome}
            {cotacoes.some((c) => c.fornecedorId === fornecedor.id) ? " (já cotado — editar)" : ""}
          </option>
        ))}
      </Select>

      {ultimaConhecida && (
        <p className="text-xs text-slate-500">
          Última cotação conhecida deste fornecedor pra este item: {formatoMoeda.format(ultimaConhecida.precoUnitario)}
          {unidade ? ` por ${unidade}` : ""}
          {ultimaConhecida.condicaoPagamento ? ` · ${ultimaConhecida.condicaoPagamento}` : ""}
          {ultimaConhecida.prazoEntregaDias !== null ? ` · ${ultimaConhecida.prazoEntregaDias} dia(s)` : ""}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <div className="w-40">
          <Input
            label={`Preço unit. (R$${unidade ? `/${unidade}` : ""})`}
            name="precoUnitario"
            type="number"
            step="0.0001"
            min="0"
            defaultValue={precoSugerido}
            required
          />
        </div>
        <div className="w-40">
          <Input
            label="Valor total (R$)"
            name="valorTotal"
            type="number"
            step="0.01"
            min="0"
            defaultValue={totalSugerido}
            required
          />
        </div>
        <div className="w-32">
          <Input
            label="Prazo (dias)"
            name="prazoEntregaDias"
            type="number"
            step="1"
            min="0"
            defaultValue={prazoSugerido}
          />
        </div>
        <div className="w-40">
          <Input label="Frete (R$)" name="frete" type="number" step="0.01" min="0" defaultValue={freteSugerido} />
        </div>
        <div className="w-40">
          <Input label="Válida até" name="validaAte" type="date" />
        </div>
      </div>

      <Input
        label="Condição de pagamento (opcional)"
        name="condicaoPagamento"
        type="text"
        maxLength={120}
        defaultValue={condicaoSugerida ?? ""}
        placeholder="Ex: boleto 30 dias, à vista, 30/60/90"
      />

      <Textarea label="Observação (opcional)" name="observacao" maxLength={500} />

      {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}

      <Button type="submit" loading={pending} className="self-start">
        {pending ? "Salvando..." : cotacaoExistente ? "Atualizar cotação" : "Registrar cotação"}
      </Button>
    </form>
  );
}
