"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useAoMudar } from "@/lib/hooks/useAoMudar";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { ConfirmarExclusao } from "@/components/ui/ConfirmarExclusao";
import { formatoMoeda } from "@/lib/moeda";
import { formatoData, dataEhPassado } from "@/lib/data";
import { registrarBaixaContaReceber, cancelarContaReceber } from "./actions";
import { RetencoesContaReceber } from "./RetencoesContaReceber";

// Achado A11 da Parte 4 da auditoria de abrangência (2026-09-08) — CARTAO
// continua na lista (legado) ao lado dos valores novos e específicos.
const ROTULO_FORMA: Record<string, string> = {
  DINHEIRO: "Dinheiro",
  PIX: "Pix",
  CARTAO: "Cartão (genérico)",
  CARTAO_CREDITO: "Cartão de crédito",
  CARTAO_DEBITO: "Cartão de débito",
  BOLETO: "Boleto",
  CHEQUE: "Cheque",
  TRANSFERENCIA: "Transferência",
  OUTRO: "Outro",
};

type ContaReceber = {
  id: string;
  descricao: string;
  valor: string;
  // Saldo em aberto — sempre calculado (achado A8 da Parte 4), nunca
  // armazenado. Igual a `valor` pra conta PENDENTE (nenhuma baixa ainda).
  saldo: string;
  vencimento: string; // ISO
  status: "PENDENTE" | "PARCIAL" | "RECEBIDO" | "CANCELADO";
  recebidoEm: string | null;
  orcamentoId: string;
  clienteNome: string;
  // Achado A9 da Parte 4 da auditoria de abrangência (2026-09-09) — versão
  // declarativa de retenção de imposto na fonte (ver
  // RetencoesContaReceber.tsx).
  valorRetencoes: string;
  clienteRetemImpostos: boolean;
  retencoes: {
    id: string;
    tributo: string;
    tributoOutro: string | null;
    percentual: string;
    valor: string;
  }[];
};

function statusPill(conta: ContaReceber) {
  if (conta.status === "RECEBIDO") {
    return (
      <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
        Recebido
      </span>
    );
  }
  if (conta.status === "CANCELADO") {
    return (
      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
        Cancelado
      </span>
    );
  }
  if (conta.status === "PARCIAL") {
    return (
      <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700 dark:bg-sky-950/50 dark:text-sky-300">
        Parcial · falta {formatoMoeda.format(Number(conta.saldo))}
      </span>
    );
  }
  if (dataEhPassado(new Date(conta.vencimento))) {
    return (
      <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
        Vencido
      </span>
    );
  }
  return (
    <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
      Pendente
    </span>
  );
}

export function ContaReceberLinha({
  conta,
  podeEditar,
  taxasFormaPagamento = [],
}: {
  conta: ContaReceber;
  podeEditar: boolean;
  // Achado A11 da Parte 4 da auditoria de abrangência (2026-09-08) — só
  // alimenta o pré-preenchimento OPCIONAL do campo "Taxa" abaixo.
  taxasFormaPagamento?: { forma: string; percentual: string }[];
}) {
  const [estadoRecebido, acaoRecebido, marcandoRecebido] = useActionState(registrarBaixaContaReceber, null);
  const [estadoCancelar, acaoCancelar, cancelando] = useActionState(cancelarContaReceber, null);
  const [confirmandoCancelamento, setConfirmandoCancelamento] = useState(false);
  const [valorRecebido, setValorRecebido] = useState(conta.saldo);
  const [valorTaxa, setValorTaxa] = useState("");

  useAoMudar(estadoCancelar, (estado) => {
    if (estado && !estado.ok) setConfirmandoCancelamento(false);
  });

  // Achado A11 da Parte 4 — escolher a forma pré-preenche a taxa sugerida
  // (percentual cadastrado × valor recebido), sempre editável depois — mesmo
  // padrão de pré-preenchimento usado em PagamentosCard.tsx.
  function aoEscolherForma(forma: string) {
    const taxa = taxasFormaPagamento.find((t) => t.forma === forma);
    if (!taxa || Number(taxa.percentual) <= 0) {
      setValorTaxa("");
      return;
    }
    const valorBase = Number(valorRecebido);
    if (Number.isFinite(valorBase) && valorBase > 0) {
      setValorTaxa(((valorBase * Number(taxa.percentual)) / 100).toFixed(2));
    }
  }

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Link
            href={`/orcamento/${conta.orcamentoId}`}
            className="font-medium text-slate-900 hover:underline dark:text-white"
          >
            {conta.descricao} — {conta.clienteNome}
          </Link>
          <p className="mt-0.5 text-xs text-slate-500">
            Vence em {formatoData.format(new Date(conta.vencimento))}
            {conta.status === "RECEBIDO" && conta.recebidoEm &&
              ` · Recebido em ${formatoData.format(new Date(conta.recebidoEm))}`}
          </p>
          {estadoRecebido && !estadoRecebido.ok && (
            <p className="mt-1 text-xs text-rose-600">{estadoRecebido.mensagem}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <p className="font-semibold text-slate-900 dark:text-white">
            {formatoMoeda.format(Number(conta.valor))}
          </p>
          {statusPill(conta)}
        </div>
      </div>

      {/* Achado A9 da Parte 4 — só aparece quando faz sentido: cliente
          marcado como retentor, ou a conta já tem alguma retenção lançada
          (histórico continua visível mesmo se o cliente for editado depois
          e deixar de reter). Conta CANCELADA não ganha o formulário de
          registro novo, mas ainda mostra o que já foi lançado antes. */}
      {(conta.clienteRetemImpostos || conta.retencoes.length > 0) && (
        <RetencoesContaReceber
          contaReceberId={conta.id}
          valorBruto={Number(conta.valor)}
          valorRetencoes={Number(conta.valorRetencoes)}
          retencoes={conta.retencoes}
          podeEditar={podeEditar && conta.status !== "CANCELADO"}
        />
      )}

      {podeEditar &&
        (conta.status === "PENDENTE" || conta.status === "PARCIAL") &&
        !confirmandoCancelamento && (
          <div className="flex flex-wrap items-end gap-4 border-t border-slate-100 pt-3 dark:border-slate-800">
            <form action={acaoRecebido} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="id" value={conta.id} />
              {/* Valor editável (achado A8 da Parte 4) — pré-preenchido com o
                  saldo em aberto (valor cheio pra conta PENDENTE). Deixar como
                  está e enviar continua fechando a conta inteira, exatamente
                  como antes; reduzir o valor registra um recebimento parcial. */}
              <div className="flex flex-col gap-1">
                <label htmlFor={`valor-${conta.id}`} className="text-xs font-medium text-slate-500">
                  Valor recebido
                </label>
                <input
                  id={`valor-${conta.id}`}
                  type="number"
                  name="valor"
                  step="0.01"
                  min="0.01"
                  max={conta.saldo}
                  value={valorRecebido}
                  onChange={(evento) => setValorRecebido(evento.target.value)}
                  className="w-28 rounded-md border border-slate-300 px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                />
              </div>
              <Select
                label="Forma"
                name="forma"
                defaultValue="PIX"
                className="!py-1.5 text-xs"
                onChange={(evento) => aoEscolherForma(evento.target.value)}
              >
                {Object.entries(ROTULO_FORMA).map(([valor, rotulo]) => (
                  <option key={valor} value={valor}>
                    {rotulo}
                  </option>
                ))}
              </Select>
              {/* Achado A11 da Parte 4 — opcional, pré-preenchido a partir de
                  TaxaFormaPagamento cadastrada pra forma escolhida acima,
                  sempre editável. "0"/vazio preserva o comportamento de hoje. */}
              <div className="flex flex-col gap-1">
                <label htmlFor={`taxa-${conta.id}`} className="text-xs font-medium text-slate-500">
                  Taxa cobrada
                </label>
                <input
                  id={`taxa-${conta.id}`}
                  type="number"
                  name="valorTaxa"
                  step="0.01"
                  min="0"
                  value={valorTaxa}
                  onChange={(evento) => setValorTaxa(evento.target.value)}
                  placeholder="0,00"
                  className="w-24 rounded-md border border-slate-300 px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                />
              </div>
              <Button type="submit" variant="outline" loading={marcandoRecebido}>
                {marcandoRecebido ? "Registrando..." : "Registrar recebimento"}
              </Button>
            </form>
            {conta.status === "PENDENTE" && (
              <button
                type="button"
                onClick={() => setConfirmandoCancelamento(true)}
                className="text-xs font-medium text-rose-600 hover:underline"
              >
                Cancelar
              </button>
            )}
          </div>
        )}

      {confirmandoCancelamento && (
        <div className="border-t border-slate-100 pt-3 dark:border-slate-800">
          <ConfirmarExclusao
            pergunta={`Cancelar a conta a receber "${conta.descricao}" (${formatoMoeda.format(Number(conta.valor))})?`}
            onCancelar={() => setConfirmandoCancelamento(false)}
            formAction={acaoCancelar}
            campos={{ id: conta.id }}
            rotuloBotao="Cancelar conta"
            pendente={cancelando}
          />
        </div>
      )}
      {estadoCancelar && !estadoCancelar.ok && !confirmandoCancelamento && (
        <p className="text-xs text-rose-600">{estadoCancelar.mensagem}</p>
      )}
    </Card>
  );
}
