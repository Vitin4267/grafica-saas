"use client";

import { useActionState, useState, type ChangeEvent } from "react";
import { useAoMudar } from "@/lib/hooks/useAoMudar";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { CopiarLinkButton } from "@/app/orcamento/[id]/CopiarLinkButton";
import { validarArquivoArte } from "@/lib/upload-validacao";
import { enviarArte, removerArte } from "./actions";

// Só aparece com o pedido em ARTE (ver PedidoLinha) — gate de negócio real
// fica em avancarPedido (producao/actions.ts): aqui é só a UI de enviar o
// arquivo e compartilhar o link de aprovação, nunca o que decide se a
// impressão pode começar.
export function EnviarArteForm({
  pedidoId,
  arteUrl,
  arteAprovadaEm,
  arteComentarioCliente,
  linkArtePublico,
}: {
  pedidoId: string;
  arteUrl: string | null;
  arteAprovadaEm: Date | null;
  arteComentarioCliente: string | null;
  linkArtePublico: string | null;
}) {
  const [state, formAction, isPending] = useActionState(enviarArte, null);
  const [estadoRemover, removerAction, removendoArte] = useActionState(removerArte, null);
  const [mostrarUpload, setMostrarUpload] = useState(!arteUrl);
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);

  // Valida tipo/tamanho já na escolha do arquivo, antes de submeter — sem
  // isso, um arquivo grande demais só falhava no servidor (Next rejeita o
  // corpo da Server Action antes até de enviarArte rodar, sem mensagem
  // amigável nenhuma; ver next.config.ts serverActions.bodySizeLimit).
  function handleArquivoChange(evento: ChangeEvent<HTMLInputElement>) {
    const arquivo = evento.target.files?.[0];
    if (!arquivo) {
      setErroArquivo(null);
      return;
    }
    const validacao = validarArquivoArte(arquivo);
    setErroArquivo(validacao.ok ? null : validacao.mensagem);
  }

  // Depois de um envio/reenvio bem-sucedido, volta pra visão "aguardando
  // aprovação" — mesmo cuidado de useAoMudar já usado em PedidoLinha pro
  // cancelamento (sem isso o formulário de upload ficaria aberto pra
  // sempre depois de um envio com sucesso).
  useAoMudar(state, (state) => {
    if (state?.ok) setMostrarUpload(false);
  });

  if (arteAprovadaEm) {
    return (
      <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
        Arte aprovada
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {arteComentarioCliente && (
        <Alert variant="warning">
          <strong>Cliente pediu alteração:</strong> {arteComentarioCliente}
        </Alert>
      )}

      {arteUrl && !mostrarUpload ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
            Aguardando aprovação do cliente
          </span>
          {linkArtePublico && (
            <CopiarLinkButton valor={linkArtePublico} label="Copiar link da arte" />
          )}
          <Button type="button" variant="ghost" onClick={() => setMostrarUpload(true)}>
            Reenviar arte
          </Button>
          <form action={removerAction}>
            <input type="hidden" name="pedidoId" value={pedidoId} />
            <button
              type="submit"
              disabled={removendoArte}
              onClick={(evento) => {
                if (!confirm("Remover esta arte? Você pode enviar outra depois.")) {
                  evento.preventDefault();
                }
              }}
              className="text-xs text-slate-400 underline decoration-dotted underline-offset-2 hover:text-red-600 disabled:opacity-50 dark:text-slate-500 dark:hover:text-red-400"
            >
              {removendoArte ? "Removendo..." : "Remover arte"}
            </button>
          </form>
        </div>
      ) : (
        <form action={formAction} className="flex flex-col gap-2">
          <input type="hidden" name="pedidoId" value={pedidoId} />
          <div className="flex flex-wrap items-end gap-2">
            <Input
              label="Arquivo de arte (PDF, JPG ou PNG, até 30MB)"
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
            {arteUrl && (
              <Button type="button" variant="ghost" onClick={() => setMostrarUpload(false)}>
                Cancelar
              </Button>
            )}
          </div>
          {erroArquivo && <p className="text-xs text-rose-600">{erroArquivo}</p>}
        </form>
      )}
      {state && !state.ok && <p className="text-xs text-rose-600">{state.mensagem}</p>}
      {estadoRemover && !estadoRemover.ok && <p className="text-xs text-rose-600">{estadoRemover.mensagem}</p>}
    </div>
  );
}
