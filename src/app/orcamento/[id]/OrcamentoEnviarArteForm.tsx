"use client";

import { useActionState, useState, type ChangeEvent } from "react";
import { useAoMudar } from "@/lib/hooks/useAoMudar";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { PreflightAvisos } from "@/components/ui/PreflightAvisos";
import { validarArquivoArte } from "@/lib/upload-validacao";
import type { AvisoPreflight } from "@/lib/preflight";
import { enviarArteOrcamento, removerArteOrcamento } from "./actions";

// Só aparece com o orçamento em RASCUNHO (ver page.tsx) — gate de negócio
// real fica nas próprias Server Actions, aqui é só a UI de anexar/remover o
// arquivo. Bem mais simples que EnviarArteForm.tsx (produção): sem estado de
// "aguardando aprovação do cliente", comentário ou link de aprovação
// pública — isso é exclusivo do fluxo de Pedido; aqui a arte é só mostrada
// pro cliente (visualização) no link público do orçamento (/o/[token]).
export function OrcamentoEnviarArteForm({
  orcamentoId,
  arteUrl,
  preflightAvisos,
}: {
  orcamentoId: string;
  arteUrl: string | null;
  // Achados do preflight automático (ver src/lib/preflight.ts) sobre a arte
  // ATUAL deste orçamento — recalculado do zero a cada reenvio.
  preflightAvisos: AvisoPreflight[];
}) {
  const [state, formAction, isPending] = useActionState(enviarArteOrcamento, null);
  const [estadoRemover, removerAction, removendoArte] = useActionState(removerArteOrcamento, null);
  const [mostrarUpload, setMostrarUpload] = useState(!arteUrl);
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);

  // Valida tipo/tamanho já na escolha do arquivo, antes de submeter — mesmo
  // cuidado de EnviarArteForm.tsx (producao): sem isso, um arquivo grande
  // demais só falhava no servidor sem mensagem amigável.
  function handleArquivoChange(evento: ChangeEvent<HTMLInputElement>) {
    const arquivo = evento.target.files?.[0];
    if (!arquivo) {
      setErroArquivo(null);
      return;
    }
    const validacao = validarArquivoArte(arquivo);
    setErroArquivo(validacao.ok ? null : validacao.mensagem);
  }

  // Depois de um envio/reenvio bem-sucedido, volta pra visão "arte anexada"
  // — sem isso o formulário de upload ficaria aberto pra sempre depois de um
  // envio com sucesso (mesmo cuidado de EnviarArteForm.tsx).
  useAoMudar(state, (state) => {
    if (state?.ok) setMostrarUpload(false);
  });

  return (
    <div className="flex flex-col gap-2">
      {arteUrl && !mostrarUpload ? (
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={arteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:underline dark:bg-emerald-950/50 dark:text-emerald-300"
          >
            Arte anexada
          </a>
          <Button type="button" variant="ghost" onClick={() => setMostrarUpload(true)}>
            Substituir
          </Button>
          <form action={removerAction}>
            <input type="hidden" name="orcamentoId" value={orcamentoId} />
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
          <input type="hidden" name="orcamentoId" value={orcamentoId} />
          <div className="flex flex-wrap items-end gap-2">
            <Input
              label="Arte do orçamento (PDF, JPG ou PNG, até 30MB)"
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
      {state && !state.ok && (
        <Alert variant="error">{state.mensagem}</Alert>
      )}
      {estadoRemover && !estadoRemover.ok && (
        <Alert variant="error">{estadoRemover.mensagem}</Alert>
      )}
      {/* Achados do preflight automático — mostrado sempre que há arte
          anexada com achados, nunca bloqueia envio/aprovação. */}
      <PreflightAvisos avisos={preflightAvisos} />
    </div>
  );
}
