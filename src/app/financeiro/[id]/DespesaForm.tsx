"use client";

import { useActionState, useState } from "react";
import { useAoMudar } from "@/lib/hooks/useAoMudar";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { ConfirmarExclusao } from "@/components/ui/ConfirmarExclusao";
import { CampoCategoriaDespesa } from "../CampoCategoriaDespesa";
import { ROTULO_PERIODICIDADE } from "../periodicidade";
import { editarDespesa, excluirDespesa, marcarComoPaga, marcarComoPendente } from "../actions";

const ROTULO_FORMA: Record<string, string> = {
  DINHEIRO: "Dinheiro",
  PIX: "Pix",
  CARTAO: "Cartão",
  BOLETO: "Boleto",
  TRANSFERENCIA: "Transferência",
  OUTRO: "Outro",
};

// "Outro — cheque pré-datado" em vez de só "Outro", quando há detalhe salvo.
function rotuloForma(forma: string, detalhe: string | null) {
  const rotulo = ROTULO_FORMA[forma] ?? forma;
  return forma === "OUTRO" && detalhe ? `${rotulo} — ${detalhe}` : rotulo;
}

type ValoresDespesa = {
  descricao: string;
  categoria: string;
  categoriaCustoId: string | null;
  valor: string;
  vencimento: string;
  periodicidade: string;
  recorrenciaAteEm: string | null;
  valorVariavel: boolean;
};

export function DespesaForm({
  despesaId,
  valoresIniciais,
  categoriasCusto,
  status,
  saldo,
  pagoEm,
  formaPagamento,
  formaPagamentoDetalhe,
  recorrente,
  podeEditar,
}: {
  despesaId: string;
  valoresIniciais: ValoresDespesa;
  categoriasCusto: { id: string; nome: string }[];
  status: "PENDENTE" | "PARCIAL" | "PAGA";
  // Saldo em aberto — sempre calculado (achado A8 da Parte 4), nunca
  // armazenado. Igual ao valor cheio pra despesa PENDENTE.
  saldo: string;
  pagoEm: string | null;
  formaPagamento: string | null;
  formaPagamentoDetalhe: string | null;
  recorrente: boolean;
  podeEditar: boolean;
}) {
  const [state, formAction, isPending] = useActionState(editarDespesa, null);
  const [estadoExclusao, excluirAction, excluindo] = useActionState(excluirDespesa, null);
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);
  const [recorrenteAtivo, setRecorrenteAtivo] = useState(recorrente);

  useAoMudar(estadoExclusao, (estadoExclusao) => {
    if (estadoExclusao && !estadoExclusao.ok) setConfirmandoExclusao(false);
  });
  const [estadoPaga, pagaAction, marcandoPaga] = useActionState(marcarComoPaga, null);
  const [estadoPendente, pendenteAction, marcandoPendente] = useActionState(marcarComoPendente, null);
  const [formaEscolhida, setFormaEscolhida] = useState("PIX");

  if (!podeEditar) {
    return (
      <Card className="flex flex-col gap-2 p-6 text-sm">
        <p className="text-slate-500">
          Categoria: {valoresIniciais.categoria || "—"} · Valor:{" "}
          {Number(valoresIniciais.valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
        </p>
        <p className="text-slate-500">Vencimento: {valoresIniciais.vencimento}</p>
        <p className="text-slate-500">
          Status:{" "}
          {status === "PAGA"
            ? `Paga em ${pagoEm}${formaPagamento ? ` (${rotuloForma(formaPagamento, formaPagamentoDetalhe)})` : ""}`
            : status === "PARCIAL"
              ? `Parcial · falta ${Number(saldo).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`
              : "Pendente"}
          {recorrente
            ? ` · 🔁 ${ROTULO_PERIODICIDADE[valoresIniciais.periodicidade as keyof typeof ROTULO_PERIODICIDADE] ?? "Recorrente"}`
            : ""}
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
              {formaPagamento && ` · ${rotuloForma(formaPagamento, formaPagamentoDetalhe)}`}
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
          <p className="text-sm font-medium text-slate-500">
            {status === "PARCIAL"
              ? `Registrar pagamento — falta ${Number(saldo).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`
              : "Marcar como paga"}
          </p>
          <form action={pagaAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="despesaId" value={despesaId} />
            {/* Valor editável (achado A8 da Parte 4) — pré-preenchido com o
                saldo em aberto (valor cheio pra despesa PENDENTE). Deixar
                como está e enviar continua fechando a despesa inteira,
                exatamente como antes; reduzir o valor registra um pagamento
                parcial. */}
            <Input
              label="Valor pago (R$)"
              name="valor"
              type="number"
              step="0.01"
              min="0.01"
              max={saldo}
              defaultValue={saldo}
              className="w-32"
            />
            <Select
              label="Forma de pagamento"
              name="formaPagamento"
              value={formaEscolhida}
              onChange={(evento) => setFormaEscolhida(evento.target.value)}
              className="flex-1"
            >
              {Object.entries(ROTULO_FORMA).map(([valor, rotulo]) => (
                <option key={valor} value={valor}>
                  {rotulo}
                </option>
              ))}
            </Select>
            {formaEscolhida === "OUTRO" && (
              <Input
                label="Detalhe"
                name="formaPagamentoDetalhe"
                type="text"
                placeholder="ex: cheque pré-datado"
                className="flex-1"
              />
            )}
            <Button type="submit" loading={marcandoPaga}>
              {marcandoPaga ? "Salvando..." : "Registrar pagamento"}
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
            <CampoCategoriaDespesa
              categorias={categoriasCusto}
              categoriaCustoIdInicial={valoresIniciais.categoriaCustoId}
              categoriaInicial={valoresIniciais.categoria}
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
            checked={recorrenteAtivo}
            onChange={(evento) => setRecorrenteAtivo(evento.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
          />
          <span>
            <span className="block font-medium text-slate-700 dark:text-slate-200">
              Repetir
            </span>
            <span className="block text-xs text-slate-500">
              Desmarcar encerra a série — as ocorrências já lançadas continuam existindo, só
              para de gerar as próximas.
            </span>
          </span>
        </label>

        {recorrenteAtivo && (
          <div className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700 sm:grid-cols-2">
            <Select
              label="Repete a cada"
              name="periodicidade"
              defaultValue={valoresIniciais.periodicidade}
            >
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
              defaultValue={valoresIniciais.recorrenciaAteEm ?? ""}
              hint="Em branco = sem data pra parar"
            />
            <label className="flex items-start gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                name="valorVariavel"
                defaultChecked={valoresIniciais.valorVariavel}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
              />
              <span>
                <span className="block font-medium text-slate-700 dark:text-slate-200">
                  Valor variável a cada ocorrência
                </span>
                <span className="block text-xs text-slate-500">
                  Pra conta que muda de valor (ex: luz, água) — cada ocorrência nova nasce "a
                  confirmar" (R$ 0,00) até você editar o valor real.
                </span>
              </span>
            </label>
          </div>
        )}

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
