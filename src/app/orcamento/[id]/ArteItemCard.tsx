"use client";

import { useActionState, useState, type ChangeEvent } from "react";
import { useAoMudar } from "@/lib/hooks/useAoMudar";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { PreflightAvisos } from "@/components/ui/PreflightAvisos";
import { validarArquivoArte } from "@/lib/upload-validacao";
import type { AvisoPreflight } from "@/lib/preflight";
import { formatoInstanteRealComHora } from "@/lib/data";
import { enviarArteItem, removerArteItem } from "./actions";

export type ArteItemDados = {
  url: string;
  versao: number;
  aprovadaEm: Date | null;
  comentarioCliente: string | null;
  respondidaPor: string | null;
  preflightAvisos: AvisoPreflight[];
};

// Achado F5 da auditoria de abrangência (Parte 7) — cartão de arte POR ITEM,
// irmão de AnaliseTintaCard.tsx (mesmo padrão de card por OrcamentoItem) e
// gêmeo simplificado de EnviarArteForm.tsx (producao) — sem link de
// aprovação pública próprio: a aprovação por item acontece no MESMO link
// /a/[token] do pedido (ver comentário no model ArteItem no schema), então
// aqui só mostra "aprovada"/"aguardando"/"pediu alteração", nunca um botão
// de copiar link. Aparece independente do orçamento estar em RASCUNHO ou já
// aprovado — diferente de OrcamentoEnviarArteForm (cabeçalho, só RASCUNHO),
// arte por item continua útil depois da aprovação (é quando ela passa a
// gatear avancarStatusPedido).
export function ArteItemCard({
  orcamentoItemId,
  arte,
}: {
  orcamentoItemId: string;
  arte: ArteItemDados | null;
}) {
  const [state, formAction, isPending] = useActionState(enviarArteItem, null);
  const [estadoRemover, removerAction, removendoArte] = useActionState(removerArteItem, null);
  const [mostrarUpload, setMostrarUpload] = useState(!arte);
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);

  function handleArquivoChange(evento: ChangeEvent<HTMLInputElement>) {
    const arquivo = evento.target.files?.[0];
    if (!arquivo) {
      setErroArquivo(null);
      return;
    }
    const validacao = validarArquivoArte(arquivo);
    setErroArquivo(validacao.ok ? null : validacao.mensagem);
  }

  // Mesmo cuidado de EnviarArteForm.tsx/OrcamentoEnviarArteForm.tsx: sem
  // isso o formulário de upload ficaria aberto pra sempre depois de um envio
  // com sucesso (o prop novo chega via revalidatePath, mas mostrarUpload só
  // é inicializado uma vez no mount).
  useAoMudar(state, (state) => {
    if (state?.ok) setMostrarUpload(false);
  });

  return (
    <Card className="flex flex-col gap-3 p-4">
      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
        Arte deste item {arte && arte.versao > 1 ? `(v${arte.versao})` : ""}
      </p>

      {arte && !mostrarUpload ? (
        <div className="flex flex-col gap-2">
          {arte.comentarioCliente && !arte.aprovadaEm && (
            <Alert variant="warning">
              <strong>Cliente pediu alteração:</strong> {arte.comentarioCliente}
            </Alert>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <a
              href={arte.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 hover:underline dark:bg-slate-800 dark:text-slate-200"
            >
              Ver arquivo
            </a>
            {arte.aprovadaEm ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                Arte aprovada
              </span>
            ) : (
              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                Aguardando aprovação do cliente
              </span>
            )}
            <Button type="button" variant="ghost" onClick={() => setMostrarUpload(true)}>
              Reenviar
            </Button>
            <form action={removerAction}>
              <input type="hidden" name="orcamentoItemId" value={orcamentoItemId} />
              <button
                type="submit"
                disabled={removendoArte}
                onClick={(evento) => {
                  if (!confirm("Remover a arte deste item? Você pode enviar outra depois.")) {
                    evento.preventDefault();
                  }
                }}
                className="text-xs text-slate-400 underline decoration-dotted underline-offset-2 hover:text-red-600 disabled:opacity-50 dark:text-slate-500 dark:hover:text-red-400"
              >
                {removendoArte ? "Removendo..." : "Remover"}
              </button>
            </form>
          </div>

          {arte.aprovadaEm && arte.respondidaPor && (
            <p className="text-xs text-slate-500">
              Aprovada por {arte.respondidaPor} em {formatoInstanteRealComHora.format(arte.aprovadaEm)}
            </p>
          )}
        </div>
      ) : (
        <form action={formAction} className="flex flex-col gap-2">
          <input type="hidden" name="orcamentoItemId" value={orcamentoItemId} />
          <div className="flex flex-wrap items-end gap-2">
            <Input
              label="Arquivo de arte deste item (PDF, JPG ou PNG, até 30MB)"
              name="arquivo"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              required
              onChange={handleArquivoChange}
              className="max-w-xs"
            />
            <Button type="submit" variant="outline" loading={isPending} disabled={!!erroArquivo}>
              Enviar arte
            </Button>
            {arte && (
              <Button type="button" variant="ghost" onClick={() => setMostrarUpload(false)}>
                Cancelar
              </Button>
            )}
          </div>
          {erroArquivo && <p className="text-xs text-rose-600">{erroArquivo}</p>}
        </form>
      )}

      {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}
      {estadoRemover && !estadoRemover.ok && <Alert variant="error">{estadoRemover.mensagem}</Alert>}

      <PreflightAvisos avisos={arte?.preflightAvisos ?? []} />
    </Card>
  );
}
