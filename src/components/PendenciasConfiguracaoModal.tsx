"use client";

import { useActionState, useEffect, useState } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { useAoMudar } from "@/lib/hooks/useAoMudar";
import type { PendenciaConfiguracao } from "@/lib/pendencias-configuracao";
import { obterPendenciasConfiguracao, responderPendenciaBobina } from "./PendenciasConfiguracaoModal.actions";

// Widget autossuficiente, sem props — mesmo padrão de ChatAssistente.tsx:
// evita ter que passar prop nova em ~40 páginas que já renderizam <UserNav>.
// Se checa sozinho no mount (Server Action re-deriva usuário/papel da
// sessão — nunca confia em nada vindo do cliente) e só renderiza algo se
// houver pendência de verdade pro DONO logado resolver.
export function PendenciasConfiguracaoModal() {
  const [pendencias, setPendencias] = useState<PendenciaConfiguracao[]>([]);
  const [indice, setIndice] = useState(0);
  const [fechadoNestaSessao, setFechadoNestaSessao] = useState(false);
  const [state, formAction, isPending] = useActionState(responderPendenciaBobina, null);

  useEffect(() => {
    obterPendenciasConfiguracao().then(setPendencias);
  }, []);

  // Sucesso avança pra próxima pendência do array (ou some, se era a
  // última) — sem recarregar a lista inteira do servidor.
  useAoMudar(state, (estado) => {
    if (estado?.ok) setIndice((i) => i + 1);
  });

  if (fechadoNestaSessao || pendencias.length === 0 || indice >= pendencias.length) {
    return null;
  }

  const pendencia = pendencias[indice];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Configuração pendente"
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900">
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-teal-600 dark:text-teal-400">
          {pendencias.length > 1 ? `Pendência ${indice + 1} de ${pendencias.length}` : "Falta configurar"}
        </p>

        {pendencia.tipo === "BOBINA_ETIQUETA_FALTANDO" && (
          <form action={formAction} className="flex flex-col gap-4">
            <input type="hidden" name="itemGraficaId" value={pendencia.itemGraficaId} />
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Largura da bobina — {pendencia.nomeProduto}
            </h2>
            <p className="text-sm text-slate-500">
              Esse produto usa cálculo por rolo, mas ainda não tem a largura da bobina de
              papel configurada — sem isso não dá pra montar orçamento com ele. Qual a
              largura da bobina que a prensa usa?
            </p>
            <Input
              label="Largura da bobina (m)"
              name="larguraNominal"
              type="number"
              step="0.01"
              min="0.01"
              required
              autoFocus
              placeholder="ex: 0.33"
            />
            {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setFechadoNestaSessao(true)}
                className="text-xs font-medium text-slate-500 hover:text-slate-700 hover:underline dark:text-slate-400 dark:hover:text-slate-200"
              >
                Depois
              </button>
              <Button type="submit" loading={isPending}>
                {isPending ? "Salvando..." : "Salvar"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
