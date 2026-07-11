"use client";

import { useActionState } from "react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { salvarAssistente } from "./actions";

export function AssistenteForm({
  webhookUrlMascarada,
}: {
  webhookUrlMascarada: string | null;
}) {
  const [state, formAction, isPending] = useActionState(salvarAssistente, null);

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
        <div>
          <p className="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">
            O que a gente envia (POST, JSON):
          </p>
          <pre className="overflow-x-auto rounded-lg bg-slate-950 p-4 text-xs text-slate-100">
{`{
  "pergunta": "Como eu emito nota fiscal?",
  "pagina": "Orçamento",
  "graficaNome": "Gráfica Vitor Ltda"
}`}
          </pre>
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">
            O que seu workflow precisa devolver (JSON):
          </p>
          <pre className="overflow-x-auto rounded-lg bg-slate-950 p-4 text-xs text-slate-100">
{`{
  "resposta": "Pra emitir nota fiscal, abra o orçamento aprovado e clique em..."
}`}
          </pre>
        </div>
        <p className="text-xs text-slate-500">
          Seu workflow tem até 15 segundos pra responder — depois disso
          mostramos um erro amigável pro usuário. Se o corpo devolvido não for
          um JSON válido, usamos o texto puro da resposta como fallback.
        </p>
      </Card>

      {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}

      <Button type="submit" loading={isPending} className="self-start">
        {isPending ? "Salvando..." : "Salvar assistente"}
      </Button>
    </form>
  );
}
