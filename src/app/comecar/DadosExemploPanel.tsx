"use client";

import { useActionState, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { ConfirmarExclusao } from "@/components/ui/ConfirmarExclusao";
import { SparklesIcon, ArrowRightIcon } from "@/components/icons";
import {
  carregarDadosExemploAction,
  gerarOrcamentoExemploAction,
  limparDadosExemploAction,
} from "./actions";

// Menor caminho até o 1º orçamento: "Gerar orçamento de exemplo" já carrega os
// dados de exemplo sozinho se ainda não existirem (ver gerarOrcamentoExemplo em
// src/lib/dados-exemplo.ts) — um clique único leva direto pro orçamento pronto.
// "Carregar dados de exemplo" fica como passo intermediário pra quem quer
// primeiro explorar o catálogo/prensas de exemplo antes de gerar o orçamento.
export function DadosExemploPanel({
  dadosExemploCarregados,
}: {
  dadosExemploCarregados: boolean;
}) {
  const [stateCarregar, actionCarregar, pendingCarregar] = useActionState(
    carregarDadosExemploAction,
    null
  );
  const [stateGerar, actionGerar, pendingGerar] = useActionState(
    gerarOrcamentoExemploAction,
    null
  );
  const [stateLimpar, actionLimpar, pendingLimpar] = useActionState(
    limparDadosExemploAction,
    null
  );
  const [confirmandoLimpar, setConfirmandoLimpar] = useState(false);

  return (
    <Card className="flex flex-col gap-4 border-teal-200 bg-teal-50/40 p-6 dark:border-teal-900 dark:bg-teal-950/20">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300">
          <SparklesIcon className="h-5 w-5" />
        </span>
        <div>
          <h2 className="font-semibold text-slate-900 dark:text-white">
            Quer ver funcionando antes de configurar tudo?
          </h2>
          <p className="text-sm text-slate-500">
            Carregamos um cliente, uma prensa, um papel e dois produtos de exemplo (um
            simples e um com o motor de precificação avançado) — sem afetar seus dados reais.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <form action={actionGerar}>
          <Button type="submit" variant="primary" loading={pendingGerar}>
            {pendingGerar ? "Gerando..." : "Gerar orçamento de exemplo"}
            <ArrowRightIcon className="h-4 w-4" />
          </Button>
        </form>
        <form action={actionCarregar}>
          <Button type="submit" variant="outline" loading={pendingCarregar}>
            {pendingCarregar ? "Carregando..." : "Carregar dados de exemplo"}
          </Button>
        </form>
      </div>

      {stateGerar && !stateGerar.ok && <Alert variant="error">{stateGerar.mensagem}</Alert>}
      {stateCarregar && (
        <Alert variant={stateCarregar.ok ? "success" : "error"}>{stateCarregar.mensagem}</Alert>
      )}

      {dadosExemploCarregados && (
        <div className="border-t border-teal-200/60 pt-3 dark:border-teal-900/60">
          {confirmandoLimpar ? (
            <ConfirmarExclusao
              pergunta="Remover os dados de exemplo (cliente, prensa, papel, produtos e orçamento de exemplo)? Nada que você criou de verdade é afetado."
              onCancelar={() => setConfirmandoLimpar(false)}
              formAction={actionLimpar}
              campos={{}}
              rotuloBotao="Remover dados de exemplo"
              pendente={pendingLimpar}
            />
          ) : (
            <button
              type="button"
              onClick={() => setConfirmandoLimpar(true)}
              className="text-xs font-medium text-slate-500 hover:text-slate-700 hover:underline dark:text-slate-400 dark:hover:text-slate-200"
            >
              Limpar dados de exemplo
            </button>
          )}
          {stateLimpar && !confirmandoLimpar && (
            <Alert variant={stateLimpar.ok ? "success" : "error"}>{stateLimpar.mensagem}</Alert>
          )}
        </div>
      )}
    </Card>
  );
}
