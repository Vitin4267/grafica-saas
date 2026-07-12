"use client";

import { useActionState } from "react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { salvarAutomacao } from "./actions";

export function AutomacaoForm({
  webhookUrlMascarada,
}: {
  webhookUrlMascarada: string | null;
}) {
  const [state, formAction, isPending] = useActionState(salvarAutomacao, null);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <Card className="flex flex-col gap-4 p-6">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">
          Webhook do n8n
        </h2>
        <Input
          label="URL do webhook"
          name="webhookUrl"
          type="password"
          placeholder={
            webhookUrlMascarada
              ? `Salvo: ${webhookUrlMascarada} — deixe em branco pra manter`
              : "https://sua-instancia.n8n.cloud/webhook/..."
          }
          hint="Precisa ser https. Nunca reexibimos a URL salva por completo — só o domínio."
        />
      </Card>

      <Card className="flex flex-col gap-4 p-6">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">
          Contrato do webhook
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Um único webhook recebe todo tipo de evento — o campo{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-800">
            tipo
          </code>{" "}
          diz qual é. No seu workflow n8n, use um nó Switch logo na entrada
          pra rotear cada tipo pro sub-workflow certo.
        </p>
        <div>
          <p className="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">
            Formato do envelope (POST, JSON) — sempre igual, muda só o{" "}
            <code>tipo</code> e o <code>dados</code>:
          </p>
          <pre className="overflow-x-auto rounded-lg bg-slate-950 p-4 text-xs text-slate-100">
{`{
  "idEvento": "evt_5b6f2e1a-...",
  "tipo": "pedido_status_mudou",
  "timestamp": "2026-07-11T19:22:51.000Z",
  "versao": 1,
  "dados": { "...": "..." }
}`}
          </pre>
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">
            <code>tipo: &quot;pedido_status_mudou&quot;</code> — um pedido
            avançou de status em Produção. <code>dados</code>:
          </p>
          <pre className="overflow-x-auto rounded-lg bg-slate-950 p-4 text-xs text-slate-100">
{`{
  "graficaNome": "Gráfica Vitor Ltda",
  "clienteNome": "Padaria Bom Pão",
  "clienteTelefone": "5541999998888",
  "statusAnterior": "IMPRESSAO",
  "statusNovo": "PRONTO",
  "orcamentoId": "clx1a2b3c..."
}`}
          </pre>
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">
            <code>tipo: &quot;estoque_critico&quot;</code> — um material cruzou
            o estoque mínimo cadastrado. <code>dados</code>:
          </p>
          <pre className="overflow-x-auto rounded-lg bg-slate-950 p-4 text-xs text-slate-100">
{`{
  "graficaNome": "Gráfica Vitor Ltda",
  "itemNome": "Papel Couché 300g",
  "estoqueAtual": 8.5,
  "estoqueMinimo": 10
}`}
          </pre>
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">
            <code>tipo: &quot;pedido_atrasado&quot;</code> — um pedido passou
            do prazo de entrega e ainda não foi entregue. <code>dados</code>:
          </p>
          <pre className="overflow-x-auto rounded-lg bg-slate-950 p-4 text-xs text-slate-100">
{`{
  "graficaNome": "Gráfica Vitor Ltda",
  "clienteNome": "Padaria Bom Pão",
  "clienteTelefone": "5541999998888",
  "status": "IMPRESSAO",
  "prazoEntrega": "2026-07-10",
  "diasAtraso": 2,
  "orcamentoId": "clx1a2b3c..."
}`}
          </pre>
          <p className="mt-1.5 text-xs text-slate-500">
            Disparado uma única vez por pedido (não repete a cada dia de
            atraso) — só quando um prazo de entrega foi informado na
            aprovação do orçamento.
          </p>
        </div>
        <p className="text-xs text-slate-500">
          Nenhum desses três eventos espera resposta — disparamos e seguimos
          em frente mesmo que seu workflow demore ou falhe, pra nunca travar
          o uso do sistema.
        </p>
      </Card>

      {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}

      <Button type="submit" loading={isPending} className="self-start">
        {isPending ? "Salvando..." : "Salvar automação"}
      </Button>
    </form>
  );
}
