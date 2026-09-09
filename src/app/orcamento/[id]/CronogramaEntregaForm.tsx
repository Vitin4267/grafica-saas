"use client";

import { useActionState, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { formatoData } from "@/lib/data";
import {
  adicionarEntregaProgramadaOrcamento,
  editarEntregaProgramadaOrcamento,
  removerEntregaProgramadaOrcamento,
} from "./actions";

export type LinhaCronogramaEntrega = {
  id: string;
  quantidade: number;
  // "AAAA-MM-DD", já pronto pro <input type="date"> (ver dataParaInputValue
  // no Server Component que monta esta prop) — null quando não preenchida.
  dataPrevista: string | null;
  localEntrega: string | null;
  observacao: string | null;
};

// Achado B3/Parte 1 da auditoria de abrangência (versão contratual
// reduzida, 2026-09-09) — cronograma de entrega COMBINADO com o cliente
// ("produz 60.000 rótulos agora, entrega 10.000/mês por 6 meses"), o
// modelo de negócio real de gráfica de embalagem/rótulo (cliente-piloto
// Assus Graphics). Puramente CONTRATUAL/INFORMATIVO: aparece no PDF/link
// público como cronograma exibido, mas NUNCA cria Entrega/ContaReceber e
// NUNCA muda StatusPedido — ver comentário completo no model
// OrcamentoEntregaProgramada (schema 09-orcamento.prisma). Editável a
// QUALQUER status do orçamento, mesmo padrão de EditarDadosGeraisOrcamentoForm
// (frete/transportadora/local de entrega também costumam ser combinados só
// depois da aprovação).
export function CronogramaEntregaForm({
  orcamentoId,
  linhas,
  quantidadeTotalOrcamento,
  maxLinhas,
}: {
  orcamentoId: string;
  linhas: LinhaCronogramaEntrega[];
  quantidadeTotalOrcamento: number;
  maxLinhas: number;
}) {
  const [state, formAction, isPending] = useActionState(adicionarEntregaProgramadaOrcamento, null);
  const [estadoEdicao, acaoEditar, isPendingEdicao] = useActionState(
    editarEntregaProgramadaOrcamento,
    null
  );
  const [estadoRemocao, acaoRemover] = useActionState(removerEntregaProgramadaOrcamento, null);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [linhaEmEdicaoId, setLinhaEmEdicaoId] = useState<string | null>(null);

  // Recalculado no cliente só pra exibição imediata (feedback visual) — a
  // validação de VERDADE é sempre refeita no servidor (ver
  // validarSomaCronogramaEntrega em src/lib/orcamento-entrega-programada.ts),
  // esta soma aqui nunca decide se um submit é aceito.
  const soma = linhas.reduce((acumulado, linha) => acumulado + linha.quantidade, 0);
  const faltam = quantidadeTotalOrcamento - soma;

  return (
    <Card className="mb-6 p-5">
      <p className="mb-1 text-sm font-medium text-slate-500">
        Cronograma de entrega{" "}
        <span className="font-normal text-slate-400">
          (combinado comercial — não gera entrega física nem cobrança automaticamente)
        </span>
      </p>
      {quantidadeTotalOrcamento > 0 && linhas.length > 0 && (
        <p className="mb-3 text-xs text-slate-400">
          {soma.toLocaleString("pt-BR")} de {quantidadeTotalOrcamento.toLocaleString("pt-BR")} unidades
          no cronograma
          {faltam > 0 && ` — faltam ${faltam.toLocaleString("pt-BR")}`}
          {faltam === 0 && " — cronograma completo"}
        </p>
      )}

      {linhas.length > 0 && (
        <ul className="mb-3 flex flex-col gap-2">
          {linhas.map((linha) =>
            linhaEmEdicaoId === linha.id ? (
              <li
                key={linha.id}
                className="rounded-xl border border-teal-200 p-3 dark:border-teal-800"
              >
                <form action={acaoEditar} className="flex flex-col gap-3">
                  <input type="hidden" name="entregaProgramadaId" value={linha.id} />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Input
                      label="Quantidade"
                      name="quantidade"
                      type="number"
                      step="1"
                      min={1}
                      required
                      defaultValue={linha.quantidade}
                    />
                    <Input
                      label="Data prevista"
                      name="dataPrevista"
                      type="date"
                      defaultValue={linha.dataPrevista ?? ""}
                    />
                    <Input
                      label="Local de entrega"
                      name="localEntrega"
                      defaultValue={linha.localEntrega ?? ""}
                    />
                  </div>
                  <Textarea
                    label="Observação"
                    name="observacao"
                    rows={2}
                    defaultValue={linha.observacao ?? ""}
                  />
                  <div className="flex gap-2">
                    <Button type="submit" variant="outline" loading={isPendingEdicao}>
                      Salvar
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setLinhaEmEdicaoId(null)}>
                      Cancelar
                    </Button>
                  </div>
                </form>
              </li>
            ) : (
              <li
                key={linha.id}
                className="flex items-start justify-between gap-3 border-t border-slate-100 pt-2 text-sm first:border-t-0 first:pt-0 dark:border-slate-800"
              >
                <div>
                  <p className="font-medium text-slate-800 dark:text-slate-100">
                    {linha.quantidade.toLocaleString("pt-BR")} unidades
                    {linha.dataPrevista &&
                      ` — ${formatoData.format(new Date(`${linha.dataPrevista}T00:00:00Z`))}`}
                  </p>
                  {(linha.localEntrega || linha.observacao) && (
                    <p className="text-xs text-slate-500">
                      {[linha.localEntrega, linha.observacao].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setLinhaEmEdicaoId(linha.id)}
                    className="text-xs font-medium text-teal-700 hover:underline dark:text-teal-400"
                  >
                    Editar
                  </button>
                  <form action={acaoRemover}>
                    <input type="hidden" name="entregaProgramadaId" value={linha.id} />
                    <Button
                      type="submit"
                      variant="ghost"
                      className="h-auto px-0 py-0 text-xs font-medium text-rose-600 hover:underline"
                    >
                      Remover
                    </Button>
                  </form>
                </div>
              </li>
            )
          )}
        </ul>
      )}

      {estadoEdicao && !estadoEdicao.ok && (
        <div className="mb-3">
          <Alert variant="error">{estadoEdicao.mensagem}</Alert>
        </div>
      )}
      {estadoRemocao && !estadoRemocao.ok && (
        <div className="mb-3">
          <Alert variant="error">{estadoRemocao.mensagem}</Alert>
        </div>
      )}

      {linhas.length >= maxLinhas ? (
        <p className="text-xs text-slate-400">
          Este orçamento já tem o máximo de {maxLinhas} linhas de cronograma.
        </p>
      ) : !mostrarForm ? (
        <button
          type="button"
          onClick={() => setMostrarForm(true)}
          className="text-xs font-medium text-teal-700 hover:underline dark:text-teal-400"
        >
          + Adicionar linha de cronograma
        </button>
      ) : (
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="orcamentoId" value={orcamentoId} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Input label="Quantidade" name="quantidade" type="number" step="1" min={1} required />
            <Input label="Data prevista" name="dataPrevista" type="date" />
            <Input label="Local de entrega" name="localEntrega" />
          </div>
          <Textarea label="Observação" name="observacao" rows={2} />
          <div className="flex items-center gap-2">
            <Button type="submit" loading={isPending} variant="outline">
              {isPending ? "Salvando..." : "Adicionar"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setMostrarForm(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}

      {state && !state.ok && (
        <div className="mt-3">
          <Alert variant="error">{state.mensagem}</Alert>
        </div>
      )}
      {state && state.ok && (
        <div className="mt-3">
          <Alert variant="success">{state.mensagem}</Alert>
        </div>
      )}
    </Card>
  );
}
