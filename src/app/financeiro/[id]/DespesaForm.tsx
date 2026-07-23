"use client";

import { useActionState, useState } from "react";
import { useAoMudar } from "@/lib/hooks/useAoMudar";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { ConfirmarExclusao } from "@/components/ui/ConfirmarExclusao";
import { editarDespesa, excluirDespesa, marcarComoPaga, marcarComoPendente } from "../actions";

const ROTULO_FORMA: Record<string, string> = {
  DINHEIRO: "Dinheiro",
  PIX: "Pix",
  CARTAO: "Cartão",
  BOLETO: "Boleto",
  TRANSFERENCIA: "Transferência",
  OUTRO: "Outro",
};

type ValoresDespesa = {
  descricao: string;
  categoria: string;
  valor: string;
  vencimento: string;
};

export function DespesaForm({
  despesaId,
  valoresIniciais,
  status,
  pagoEm,
  formaPagamento,
  recorrente,
  podeEditar,
}: {
  despesaId: string;
  valoresIniciais: ValoresDespesa;
  status: "PENDENTE" | "PAGA";
  pagoEm: string | null;
  formaPagamento: string | null;
  recorrente: boolean;
  podeEditar: boolean;
}) {
  const [state, formAction, isPending] = useActionState(editarDespesa, null);
  const [estadoExclusao, excluirAction, excluindo] = useActionState(excluirDespesa, null);
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);

  useAoMudar(estadoExclusao, (estadoExclusao) => {
    if (estadoExclusao && !estadoExclusao.ok) setConfirmandoExclusao(false);
  });
  const [estadoPaga, pagaAction, marcandoPaga] = useActionState(marcarComoPaga, null);
  const [estadoPendente, pendenteAction, marcandoPendente] = useActionState(marcarComoPendente, null);

  if (!podeEditar) {
    return (
      <Card className="flex flex-col gap-2 p-6 text-sm">
        <p className="text-slate-500">
          Categoria: {valoresIniciais.categoria || "—"} · Valor:{" "}
          {Number(valoresIniciais.valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
        </p>
        <p className="text-slate-500">Vencimento: {valoresIniciais.vencimento}</p>
        <p className="text-slate-500">
          Status: {status === "PAGA" ? `Paga em ${pagoEm}` : "Pendente"}
          {recorrente ? " · 🔁 Recorrente" : ""}
        </p>
        <p className="mt-2 text-xs text-slate-400">Você tem acesso só de visualização a esta tela.</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {status === "PAGA" ? (
        <Card className="flex items-center justify-between gap-4 p-5">
          <div>
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
              Paga em {pagoEm}
              {formaPagamento && ` · ${ROTULO_FORMA[formaPagamento] ?? formaPagamento}`}
            </p>
            {estadoPendente && !estadoPendente.ok && (
              <p className="mt-1 text-xs text-rose-600">{estadoPendente.mensagem}</p>
            )}
          </div>
          <form action={pendenteAction}>
            <input type="hidden" name="despesaId" value={despesaId} />
            <Button type="submit" variant="outline" loading={marcandoPendente}>
              Marcar como pendente
            </Button>
          </form>
        </Card>
      ) : (
        <Card className="flex flex-col gap-3 p-5">
          <p className="text-sm font-medium text-slate-500">Marcar como paga</p>
          <form action={pagaAction} className="flex items-end gap-3">
            <input type="hidden" name="despesaId" value={despesaId} />
            <Select label="Forma de pagamento" name="formaPagamento" defaultValue="PIX" className="flex-1">
              {Object.entries(ROTULO_FORMA).map(([valor, rotulo]) => (
                <option key={valor} value={valor}>
                  {rotulo}
                </option>
              ))}
            </Select>
            <Button type="submit" loading={marcandoPaga}>
              {marcandoPaga ? "Salvando..." : "Marcar como paga"}
            </Button>
          </form>
          {estadoPaga && !estadoPaga.ok && <Alert variant="error">{estadoPaga.mensagem}</Alert>}
        </Card>
      )}

      <form action={formAction} className="flex flex-col gap-6">
        <input type="hidden" name="despesaId" value={despesaId} />
        <Card className="flex flex-col gap-4 p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Descrição"
              name="descricao"
              type="text"
              defaultValue={valoresIniciais.descricao}
              required
              className="col-span-2"
            />
            <Input
              label="Categoria (opcional)"
              name="categoria"
              type="text"
              defaultValue={valoresIniciais.categoria}
            />
            <Input
              label="Valor (R$)"
              name="valor"
              type="number"
              step="0.01"
              min="0.01"
              defaultValue={valoresIniciais.valor}
              required
            />
            <Input
              label="Vencimento"
              name="vencimento"
              type="date"
              defaultValue={valoresIniciais.vencimento}
              required
              className="col-span-2"
            />
          </div>
        </Card>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="recorrente"
            defaultChecked={recorrente}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
          />
          <span>
            <span className="block font-medium text-slate-700 dark:text-slate-200">
              Repetir todo mês
            </span>
            <span className="block text-xs text-slate-500">
              Desmarcar encerra a série — as ocorrências já lançadas continuam existindo, só
              para de gerar as próximas.
            </span>
          </span>
        </label>

        {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}

        <Button type="submit" loading={isPending} className="self-start">
          {isPending ? "Salvando..." : "Salvar despesa"}
        </Button>
      </form>

      <Card className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-900 dark:text-white">Excluir despesa</p>
            {estadoExclusao && !estadoExclusao.ok && (
              <p className="mt-1 text-xs text-rose-600">{estadoExclusao.mensagem}</p>
            )}
          </div>
          {!confirmandoExclusao && (
            <Button
              type="button"
              variant="outline"
              className="shrink-0 text-rose-600"
              onClick={() => setConfirmandoExclusao(true)}
            >
              Excluir
            </Button>
          )}
        </div>
        {confirmandoExclusao && (
          <ConfirmarExclusao
            pergunta={`Tem certeza que quer excluir "${valoresIniciais.descricao}"? Essa ação não pode ser desfeita.`}
            onCancelar={() => setConfirmandoExclusao(false)}
            formAction={excluirAction}
            campos={{ despesaId }}
            rotuloBotao="Excluir despesa"
            pendente={excluindo}
          />
        )}
      </Card>
    </div>
  );
}
