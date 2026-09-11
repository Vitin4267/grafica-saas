"use client";

import { useActionState, useState } from "react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { formatoMoeda } from "@/lib/moeda";
import { CampoCategoriaDespesa } from "./CampoCategoriaDespesa";
import { ROTULO_PERIODICIDADE } from "./periodicidade";
import { criarDespesa } from "./actions";

export function NovaDespesaForm({
  categoriasCusto,
  filiais = [],
  fornecedores = [],
  pedidos = [],
}: {
  categoriasCusto: { id: string; nome: string }[];
  filiais?: { id: string; nome: string }[];
  // Achado A5 da Parte 3 (Compras) da auditoria de abrangência (2026-09-09).
  fornecedores?: { id: string; nome: string }[];
  // Achado Fin-A1 da Parte 4 da auditoria de abrangência (2026-09-11).
  pedidos?: { id: string; clienteNome: string }[];
}) {
  const [state, formAction, isPending] = useActionState(criarDespesa, null);
  const [recorrente, setRecorrente] = useState(false);
  // Só pra decidir se mostra o aviso "isso também vai lançar um custo neste
  // pedido" (ver criarCustoAutomaticoDespesa em src/lib/custo-pedido.ts) —
  // nenhum dos três estados aqui é enviado ao servidor por conta própria,
  // são os próprios campos do form (name="categoriaCustoId"/"pedidoId"/
  // "valor") que já fazem isso.
  const [categoriaCustoId, setCategoriaCustoId] = useState("");
  const [pedidoId, setPedidoId] = useState("");
  const [valorDigitado, setValorDigitado] = useState("");
  const vaiEspelharCusto = categoriaCustoId !== "" && pedidoId !== "" && Number(valorDigitado) > 0;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Descrição"
          name="descricao"
          type="text"
          placeholder="ex: Papel Couché 300g - Distribuidora X"
          required
          className="sm:col-span-2"
        />
        <CampoCategoriaDespesa categorias={categoriasCusto} onSelecaoMudar={setCategoriaCustoId} />
        <Input
          label="Valor (R$)"
          name="valor"
          type="number"
          step="0.01"
          min="0.01"
          required
          value={valorDigitado}
          onChange={(evento) => setValorDigitado(evento.target.value)}
        />
        <Input label="Vencimento" name="vencimento" type="date" required className="sm:col-span-2" />
        {pedidos.length > 0 && (
          <Select
            label="Vincular a um pedido (opcional)"
            name="pedidoId"
            value={pedidoId}
            onChange={(evento) => setPedidoId(evento.target.value)}
            className="sm:col-span-2"
          >
            <option value="">Sem pedido específico</option>
            {pedidos.map((pedido) => (
              <option key={pedido.id} value={pedido.id}>
                {pedido.clienteNome} — {pedido.id.slice(-8)}
              </option>
            ))}
          </Select>
        )}
        {vaiEspelharCusto && (
          <div className="sm:col-span-2">
            <Alert variant="info">
              Isso também vai lançar um custo de {formatoMoeda.format(Number(valorDigitado))} neste pedido.
            </Alert>
          </div>
        )}
        {filiais.length > 0 && (
          <Select label="Filial (opcional)" name="filialId" defaultValue="" className="sm:col-span-2">
            <option value="">Sem filial específica</option>
            {filiais.map((filial) => (
              <option key={filial.id} value={filial.id}>
                {filial.nome}
              </option>
            ))}
          </Select>
        )}
        {fornecedores.length > 0 && (
          <Select
            label="Fornecedor (opcional)"
            name="fornecedorId"
            defaultValue=""
            className="sm:col-span-2"
          >
            <option value="">Sem fornecedor específico</option>
            {fornecedores.map((fornecedor) => (
              <option key={fornecedor.id} value={fornecedor.id}>
                {fornecedor.nome}
              </option>
            ))}
          </Select>
        )}
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="recorrente"
          checked={recorrente}
          onChange={(evento) => setRecorrente(evento.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
        />
        <span>
          <span className="block font-medium text-slate-700 dark:text-slate-200">
            Repetir
          </span>
          <span className="block text-xs text-slate-500">
            Pra conta fixa (aluguel, internet) — lança sozinha no mesmo dia, sem
            precisar recadastrar.
          </span>
        </span>
      </label>
      {recorrente && (
        <div className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700 sm:grid-cols-2">
          <Select label="Repete a cada" name="periodicidade" defaultValue="MENSAL">
            {Object.entries(ROTULO_PERIODICIDADE).map(([valor, rotulo]) => (
              <option key={valor} value={valor}>
                {rotulo}
              </option>
            ))}
          </Select>
          <Input
            label="Repetir até (opcional)"
            name="recorrenciaAteEm"
            type="date"
            hint="Em branco = sem data pra parar"
          />
          <label className="flex items-start gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              name="valorVariavel"
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
            />
            <span>
              <span className="block font-medium text-slate-700 dark:text-slate-200">
                Valor variável a cada ocorrência
              </span>
              <span className="block text-xs text-slate-500">
                Pra conta que muda de valor (ex: luz, água) — cada ocorrência nasce "a
                confirmar" (R$ 0,00) até você editar o valor real.
              </span>
            </span>
          </label>
        </div>
      )}
      {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}
      <Button type="submit" loading={isPending} className="self-start">
        {isPending ? "Cadastrando..." : "+ Nova despesa"}
      </Button>
    </form>
  );
}
