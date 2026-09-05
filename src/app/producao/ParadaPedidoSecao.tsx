"use client";

import { useActionState, useState } from "react";
import { formatoInstanteRealComHora } from "@/lib/data";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { ROTULOS_MOTIVO_PARADA, ORDEM_MOTIVO_PARADA } from "@/lib/parada-pedido-status";
import { iniciarParadaPedido, finalizarParadaPedido } from "./parada-actions";
import type { MotivoParada } from "@/generated/prisma/enums";

// Achado C2 da auditoria de abrangência (Parte 2/Produção, 2026-09-01) — um
// pedido travado esperando papel chegar (ou o cliente responder) era
// indistinguível, na tela, de um pedido sendo produzido de verdade. Mesma
// estrutura de TerceirizacaoPedidoSecao.tsx: <details> colapsável com chip
// no summary quando há algo ATIVO, lista de histórico + formulário — mas
// sem FSM de transições (só ativa/encerrada), então bem mais simples.

export type SolicitacaoCompraOpcao = { id: string; label: string };

export type ParadaResumo = {
  id: string;
  motivo: MotivoParada;
  motivoOutro: string | null;
  solicitacaoCompraId: string | null;
  // Resolvido no servidor (join com ItemGrafica/ItemCatalogo) — mesmo
  // padrão de fornecedorNome em TerceirizacaoResumo.
  solicitacaoCompraLabel: string | null;
  iniciadaEm: string; // ISO
  finalizadaEm: string | null; // ISO
  observacao: string | null;
};

function rotuloMotivo(motivo: MotivoParada, motivoOutro: string | null): string {
  if (motivo === "OUTRO" && motivoOutro) return motivoOutro;
  return ROTULOS_MOTIVO_PARADA[motivo];
}

// "Hoje, 14:32" pro início; duração aproximada em horas/dias pra dar noção
// de "há quanto tempo" sem exigir cálculo mental de quem está lendo.
function duracaoDesde(iniciadaEm: string, ateEm: string | null): string {
  const inicio = new Date(iniciadaEm).getTime();
  const fim = ateEm ? new Date(ateEm).getTime() : Date.now();
  const horas = Math.max(0, Math.round((fim - inicio) / 3_600_000));
  if (horas < 1) return "menos de 1h";
  if (horas < 24) return `${horas}h`;
  const dias = Math.floor(horas / 24);
  const resto = horas % 24;
  return resto === 0 ? `${dias}d` : `${dias}d ${resto}h`;
}

function FormularioFinalizarParada({ parada }: { parada: ParadaResumo }) {
  const [state, formAction, pending] = useActionState(finalizarParadaPedido, null);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="paradaId" value={parada.id} />
      <Textarea
        label="Observação da resolução (opcional)"
        name="observacao"
        placeholder="Ex: material chegou, cliente aprovou por telefone..."
        maxLength={2000}
      />
      {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}
      <Button type="submit" variant="outline" loading={pending} className="self-start">
        {pending ? "Finalizando..." : "Finalizar parada"}
      </Button>
    </form>
  );
}

function LinhaParada({ parada }: { parada: ParadaResumo }) {
  const ativa = !parada.finalizadaEm;
  return (
    <div className="flex flex-col gap-2 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-slate-900 dark:text-white">
          {rotuloMotivo(parada.motivo, parada.motivoOutro)}
        </p>
        {ativa ? (
          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
            Parado há {duracaoDesde(parada.iniciadaEm, null)}
          </span>
        ) : (
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            Parado por {duracaoDesde(parada.iniciadaEm, parada.finalizadaEm)}
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium text-slate-500">Iniciada em</p>
          <p className="mt-0.5 text-slate-900 dark:text-white">
            {formatoInstanteRealComHora.format(new Date(parada.iniciadaEm))}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium text-slate-500">Finalizada em</p>
          <p className="mt-0.5 text-slate-900 dark:text-white">
            {parada.finalizadaEm ? formatoInstanteRealComHora.format(new Date(parada.finalizadaEm)) : "—"}
          </p>
        </div>
        {parada.solicitacaoCompraLabel && (
          <div className="sm:col-span-2">
            <p className="text-xs font-medium text-slate-500">Esperando a compra</p>
            <p className="mt-0.5 text-slate-900 dark:text-white">{parada.solicitacaoCompraLabel}</p>
          </div>
        )}
        {parada.observacao && (
          <div className="sm:col-span-2">
            <p className="text-xs font-medium text-slate-500">Observação</p>
            <p className="mt-0.5 whitespace-pre-wrap text-slate-900 dark:text-white">{parada.observacao}</p>
          </div>
        )}
      </div>
      {ativa && <FormularioFinalizarParada parada={parada} />}
    </div>
  );
}

function FormularioNovaParada({
  pedidoId,
  solicitacoesCompra,
}: {
  pedidoId: string;
  solicitacoesCompra: SolicitacaoCompraOpcao[];
}) {
  const [state, formAction, isPending] = useActionState(iniciarParadaPedido, null);
  const [motivo, setMotivo] = useState<MotivoParada>("AGUARDANDO_MATERIAL");

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="pedidoId" value={pedidoId} />
      <Select
        label="Por que este pedido está parado?"
        name="motivo"
        value={motivo}
        onChange={(e) => setMotivo(e.target.value as MotivoParada)}
      >
        {ORDEM_MOTIVO_PARADA.map((m) => (
          <option key={m} value={m}>
            {ROTULOS_MOTIVO_PARADA[m]}
          </option>
        ))}
      </Select>

      {motivo === "OUTRO" && (
        <Input label="Descreva o motivo" name="motivoOutro" maxLength={200} required />
      )}

      {motivo === "AGUARDANDO_MATERIAL" && solicitacoesCompra.length > 0 && (
        <Select label="Vincular a uma solicitação de compra (opcional)" name="solicitacaoCompraId" defaultValue="">
          <option value="">— Nenhuma —</option>
          {solicitacoesCompra.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </Select>
      )}

      <Textarea label="Observação (opcional)" name="observacao" maxLength={2000} />
      {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}
      <Button type="submit" variant="outline" loading={isPending} className="self-start">
        {isPending ? "Registrando..." : "Marcar como parado"}
      </Button>
    </form>
  );
}

export function ParadaPedidoSecao({
  pedidoId,
  paradas,
  solicitacoesCompra,
  podeEditar,
}: {
  pedidoId: string;
  paradas: ParadaResumo[];
  solicitacoesCompra: SolicitacaoCompraOpcao[];
  podeEditar: boolean;
}) {
  const ativa = paradas.find((p) => !p.finalizadaEm);

  return (
    <details className="group rounded-xl border border-slate-200 dark:border-slate-800">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-2.5 text-sm font-medium text-slate-600 marker:content-none hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/50">
        <span>Paradas{paradas.length > 0 && ` (${paradas.length})`}</span>
        {ativa && (
          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
            Parado — {rotuloMotivo(ativa.motivo, ativa.motivoOutro)}
          </span>
        )}
      </summary>

      <div className="flex flex-col gap-4 border-t border-slate-100 p-4 dark:border-slate-800">
        {paradas.length > 0 && (
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {paradas.map((parada) => (
              <LinhaParada key={parada.id} parada={parada} />
            ))}
          </div>
        )}

        {podeEditar && !ativa && (
          <FormularioNovaParada pedidoId={pedidoId} solicitacoesCompra={solicitacoesCompra} />
        )}
        {!podeEditar && paradas.length === 0 && (
          <p className="text-xs text-slate-500">Nenhuma parada registrada ainda.</p>
        )}
      </div>
    </details>
  );
}
