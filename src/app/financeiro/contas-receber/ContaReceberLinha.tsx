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
import {
  registrarBaixaContaReceber,
  cancelarContaReceber,
  marcarContaReceberEmCobranca,
  marcarContaReceberPerda,
  liberarLimiteContaReceberPerda,
} from "./actions";
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
  status: "PENDENTE" | "PARCIAL" | "RECEBIDO" | "CANCELADO" | "EM_COBRANCA" | "PERDA";
  recebidoEm: string | null;
  // Achado N23 da Parte 9 da auditoria de código (2026-09-12) — null enquanto
  // ninguém revisou manualmente: a conta continua bloqueando limite de
  // crédito do cliente mesmo já marcada como PERDA (ver
  // calcularExposicaoCreditoCliente). Só relevante quando status=PERDA.
  limiteLiberadoEm: string | null;
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
  {/* Achado A5 da Parte 4 — status honesto: distingue calote (PERDA) de
      erro de digitação/pedido cancelado (CANCELADO acima), e sinaliza que a
      conta entrou num processo de cobrança (EM_COBRANCA), sem escalonamento
      automático nenhum por trás (ver actions.ts). */}
  if (conta.status === "PERDA") {
    return (
      <span className="rounded-full bg-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
        Perda
      </span>
    );
  }
  if (conta.status === "EM_COBRANCA") {
    return (
      <span className="rounded-full bg-orange-100 px-2.5 py-1 text-xs font-medium text-orange-700 dark:bg-orange-950/50 dark:text-orange-300">
        Em cobrança
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
  multaAtrasoPercent = 0,
  jurosMoraMensalPercent = 0,
}: {
  conta: ContaReceber;
  podeEditar: boolean;
  // Achado A11 da Parte 4 da auditoria de abrangência (2026-09-08) — só
  // alimenta o pré-preenchimento OPCIONAL do campo "Taxa" abaixo.
  taxasFormaPagamento?: { forma: string; percentual: string }[];
  // Achado A5 da Parte 4 da auditoria de abrangência (2026-09-09) —
  // ParametrosGrafica.multaAtrasoPercent/jurosMoraMensalPercent, só pra
  // pré-preencher (sempre editável) os campos "Juros"/"Multa" abaixo quando
  // a conta já está vencida. 0 = gráfica sem parâmetro configurado, campos
  // nascem em branco (comportamento de hoje, sem sugestão nenhuma).
  multaAtrasoPercent?: number;
  jurosMoraMensalPercent?: number;
}) {
  const [estadoRecebido, acaoRecebido, marcandoRecebido] = useActionState(registrarBaixaContaReceber, null);
  const [estadoCancelar, acaoCancelar, cancelando] = useActionState(cancelarContaReceber, null);
  const [estadoEmCobranca, acaoEmCobranca, marcandoEmCobranca] = useActionState(
    marcarContaReceberEmCobranca,
    null
  );
  const [estadoPerda, acaoPerda, marcandoPerda] = useActionState(marcarContaReceberPerda, null);
  const [estadoLiberarLimite, acaoLiberarLimite, liberandoLimite] = useActionState(
    liberarLimiteContaReceberPerda,
    null
  );
  const [confirmandoCancelamento, setConfirmandoCancelamento] = useState(false);
  const [confirmandoPerda, setConfirmandoPerda] = useState(false);
  const [valorRecebido, setValorRecebido] = useState(conta.saldo);
  const [valorTaxa, setValorTaxa] = useState("");

  // Achado A5 da Parte 4 — dias de atraso (mesmo cálculo de calcularAging em
  // src/lib/exportacao-financeira.ts, versão local só pra sugestão de UI:
  // não precisa da precisão de data-pura UTC exata, é sempre editável
  // depois). <= 0 = ainda não venceu, sem sugestão.
  const diasAtraso = Math.max(
    0,
    Math.round((Date.now() - new Date(conta.vencimento).getTime()) / (24 * 60 * 60 * 1000))
  );
  const [valorMulta, setValorMulta] = useState(() => {
    if (diasAtraso <= 0 || multaAtrasoPercent <= 0) return "";
    const base = Number(conta.saldo);
    return Number.isFinite(base) && base > 0 ? ((base * multaAtrasoPercent) / 100).toFixed(2) : "";
  });
  const [valorJuros, setValorJuros] = useState(() => {
    if (diasAtraso <= 0 || jurosMoraMensalPercent <= 0) return "";
    const base = Number(conta.saldo);
    return Number.isFinite(base) && base > 0
      ? ((base * jurosMoraMensalPercent * diasAtraso) / 100 / 30).toFixed(2)
      : "";
  });

  useAoMudar(estadoCancelar, (estado) => {
    if (estado && !estado.ok) setConfirmandoCancelamento(false);
  });
  useAoMudar(estadoPerda, (estado) => {
    if (estado && !estado.ok) setConfirmandoPerda(false);
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
        (conta.status === "PENDENTE" || conta.status === "PARCIAL" || conta.status === "EM_COBRANCA") &&
        !confirmandoCancelamento &&
        !confirmandoPerda && (
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
              {/* Achado A5 da Parte 4 — juros/multa, mesmo padrão de "Taxa
                  cobrada" acima: pré-preenchido a partir de
                  ParametrosGrafica.multaAtrasoPercent/jurosMoraMensalPercent
                  quando a conta está vencida, sempre editável. "0"/vazio
                  preserva o comportamento de hoje (nenhum juros/multa
                  registrado). Nunca calculado/aplicado sozinho pelo servidor. */}
              <div className="flex flex-col gap-1">
                <label htmlFor={`multa-${conta.id}`} className="text-xs font-medium text-slate-500">
                  Multa
                </label>
                <input
                  id={`multa-${conta.id}`}
                  type="number"
                  name="valorMulta"
                  step="0.01"
                  min="0"
                  value={valorMulta}
                  onChange={(evento) => setValorMulta(evento.target.value)}
                  placeholder="0,00"
                  className="w-24 rounded-md border border-slate-300 px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor={`juros-${conta.id}`} className="text-xs font-medium text-slate-500">
                  Juros
                </label>
                <input
                  id={`juros-${conta.id}`}
                  type="number"
                  name="valorJuros"
                  step="0.01"
                  min="0"
                  value={valorJuros}
                  onChange={(evento) => setValorJuros(evento.target.value)}
                  placeholder="0,00"
                  className="w-24 rounded-md border border-slate-300 px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                />
              </div>
              <Button type="submit" variant="outline" loading={marcandoRecebido}>
                {marcandoRecebido ? "Registrando..." : "Registrar recebimento"}
              </Button>
            </form>
            {/* Achado A5 da Parte 4 — status honesto: marcar como em
                cobrança (só a partir de PENDENTE/PARCIAL — uma conta já em
                cobrança não precisa do botão de novo) e marcar como perda
                (calote reconhecido, distinto de "Cancelar" que é erro de
                digitação/pedido cancelado). Nenhuma das duas ações dispara
                nenhum e-mail/webhook — é só o registro manual do status. */}
            {(conta.status === "PENDENTE" || conta.status === "PARCIAL") && (
              <form action={acaoEmCobranca}>
                <input type="hidden" name="id" value={conta.id} />
                <Button type="submit" variant="outline" loading={marcandoEmCobranca} className="!py-1.5 text-xs">
                  {marcandoEmCobranca ? "Marcando..." : "Marcar em cobrança"}
                </Button>
              </form>
            )}
            <button
              type="button"
              onClick={() => setConfirmandoPerda(true)}
              className="text-xs font-medium text-slate-600 hover:underline dark:text-slate-400"
            >
              Marcar como perda
            </button>
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

      {/* Achado N23 da Parte 9 da auditoria de código (2026-09-12) — revisão
          manual explícita, separada do write-off (botão "Marcar como
          perda" acima): só a partir daqui a conta some de
          calcularExposicaoCreditoCliente e o cliente pode comprar a prazo
          de novo. Marcar como PERDA nunca libera limite sozinho. */}
      {podeEditar && conta.status === "PERDA" && (
        <div className="border-t border-slate-100 pt-3 dark:border-slate-800">
          {conta.limiteLiberadoEm ? (
            <p className="text-xs text-slate-500">
              Limite de crédito liberado em {formatoData.format(new Date(conta.limiteLiberadoEm))}.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs text-slate-500">
                Limite de crédito do cliente continua bloqueado por este valor até revisão manual.
              </p>
              <form action={acaoLiberarLimite}>
                <input type="hidden" name="id" value={conta.id} />
                <Button type="submit" variant="outline" loading={liberandoLimite} className="!py-1.5 text-xs">
                  {liberandoLimite ? "Liberando..." : "Liberar limite de crédito"}
                </Button>
              </form>
            </div>
          )}
          {estadoLiberarLimite && !estadoLiberarLimite.ok && (
            <p className="mt-1 text-xs text-rose-600">{estadoLiberarLimite.mensagem}</p>
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
      {confirmandoPerda && (
        <div className="border-t border-slate-100 pt-3 dark:border-slate-800">
          <ConfirmarExclusao
            pergunta={`Marcar a conta a receber "${conta.descricao}" (${formatoMoeda.format(Number(conta.valor))}) como perda? Isso reconhece que esse dinheiro não vai mais ser recebido.`}
            onCancelar={() => setConfirmandoPerda(false)}
            formAction={acaoPerda}
            campos={{ id: conta.id }}
            rotuloBotao="Marcar como perda"
            pendente={marcandoPerda}
          />
        </div>
      )}
      {estadoCancelar && !estadoCancelar.ok && !confirmandoCancelamento && (
        <p className="text-xs text-rose-600">{estadoCancelar.mensagem}</p>
      )}
      {estadoEmCobranca && !estadoEmCobranca.ok && (
        <p className="text-xs text-rose-600">{estadoEmCobranca.mensagem}</p>
      )}
      {estadoPerda && !estadoPerda.ok && !confirmandoPerda && (
        <p className="text-xs text-rose-600">{estadoPerda.mensagem}</p>
      )}
    </Card>
  );
}
