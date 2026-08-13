"use client";

import { useActionState, useState } from "react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { editarDadosGeraisOrcamento } from "./actions";

const OPCOES_TIPO_PEDIDO: [string, string][] = [
  ["MODELO_NOVO", "Modelo novo"],
  ["REPETICAO_SEM_ALTERACAO", "Repetição sem alteração"],
  ["REPETICAO_COM_ALTERACAO", "Repetição com alteração"],
];
const OPCOES_FRETE: [string, string][] = [
  ["EMITENTE", "Emitente"],
  ["DESTINATARIO", "Destinatário"],
];
const ROTULO_TIPO_PEDIDO = Object.fromEntries(OPCOES_TIPO_PEDIDO);
const ROTULO_FRETE = Object.fromEntries(OPCOES_FRETE);

type DadosGerais = {
  vendedor: string | null;
  tipoPedido: string | null;
  contatoNome: string | null;
  contatoEmail: string | null;
  condicoesPagamento: string | null;
  frete: string | null;
  transportadora: string | null;
  localEntrega: string | null;
  observacoes: string | null;
};

// Bloco de campos gerais do pedido — editável a qualquer status do
// orçamento (ver comentário em editarDadosGeraisOrcamento, actions.ts): não
// mexe em total nem no que o cliente já viu. Mesmo padrão de
// editar-no-lugar de TrocarClienteForm.tsx, só que mostrando um resumo
// (não só um botão) quando não está editando, já que aqui são vários campos.
export function EditarDadosGeraisOrcamentoForm({
  orcamentoId,
  dados,
}: {
  orcamentoId: string;
  dados: DadosGerais;
}) {
  const [state, formAction, isPending] = useActionState(editarDadosGeraisOrcamento, null);
  const [editando, setEditando] = useState(false);

  const linhas: [string, string][] = [
    dados.vendedor ? (["Vendedor", dados.vendedor] as [string, string]) : null,
    dados.tipoPedido ? (["Tipo de pedido", ROTULO_TIPO_PEDIDO[dados.tipoPedido] ?? dados.tipoPedido] as [string, string]) : null,
    dados.contatoNome ? (["Contato", dados.contatoNome] as [string, string]) : null,
    dados.contatoEmail ? (["E-mail de contato", dados.contatoEmail] as [string, string]) : null,
    dados.condicoesPagamento ? (["Condições de pagamento", dados.condicoesPagamento] as [string, string]) : null,
    dados.frete ? (["Frete", ROTULO_FRETE[dados.frete] ?? dados.frete] as [string, string]) : null,
    dados.transportadora ? (["Transportadora", dados.transportadora] as [string, string]) : null,
    dados.localEntrega ? (["Local de entrega", dados.localEntrega] as [string, string]) : null,
    dados.observacoes ? (["Observações internas", dados.observacoes] as [string, string]) : null,
  ].filter((l): l is [string, string] => l !== null);

  if (!editando) {
    return (
      <div className="flex flex-col gap-3">
        {linhas.length > 0 ? (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {linhas.map(([rotulo, valor]) => (
              <div key={rotulo}>
                <dt className="text-slate-500">{rotulo}</dt>
                <dd className="font-medium text-slate-800 dark:text-slate-100">{valor}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-slate-500">Nenhum dado geral preenchido ainda.</p>
        )}
        <button
          type="button"
          onClick={() => setEditando(true)}
          className="self-start text-xs font-medium text-teal-700 hover:underline dark:text-teal-400"
        >
          {linhas.length > 0 ? "Editar dados do pedido" : "+ adicionar vendedor, frete, condições de pagamento..."}
        </button>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="orcamentoId" value={orcamentoId} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input label="Vendedor" name="vendedor" defaultValue={dados.vendedor ?? ""} />
        <Select label="Tipo de pedido" name="tipoPedido" defaultValue={dados.tipoPedido ?? ""}>
          <option value="">não informado</option>
          {OPCOES_TIPO_PEDIDO.map(([v, rotulo]) => (
            <option key={v} value={v}>
              {rotulo}
            </option>
          ))}
        </Select>
        <Input
          label="Contato do pedido"
          name="contatoNome"
          defaultValue={dados.contatoNome ?? ""}
          hint="Pessoa de contato deste pedido, se diferente do cadastro do cliente"
        />
        <Input
          label="E-mail de contato"
          name="contatoEmail"
          type="email"
          defaultValue={dados.contatoEmail ?? ""}
        />
        <Input
          label="Condições de pagamento"
          name="condicoesPagamento"
          defaultValue={dados.condicoesPagamento ?? ""}
          placeholder="ex: 28/35ddl"
        />
        <Select label="Frete" name="frete" defaultValue={dados.frete ?? ""}>
          <option value="">não informado</option>
          {OPCOES_FRETE.map(([v, rotulo]) => (
            <option key={v} value={v}>
              {rotulo}
            </option>
          ))}
        </Select>
        <Input label="Transportadora" name="transportadora" defaultValue={dados.transportadora ?? ""} />
        <Input label="Local de entrega" name="localEntrega" defaultValue={dados.localEntrega ?? ""} />
      </div>
      <Textarea
        label="Observações internas"
        name="observacoes"
        defaultValue={dados.observacoes ?? ""}
        hint="Só aparece pra sua gráfica — nunca no PDF nem no link do cliente."
      />
      <div className="flex items-center gap-2">
        <Button type="submit" variant="outline" loading={isPending}>
          {isPending ? "Salvando..." : "Salvar"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setEditando(false)}>
          Cancelar
        </Button>
      </div>
      {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}
    </form>
  );
}
