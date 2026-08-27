"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { useAoMudar } from "@/lib/hooks/useAoMudar";
import type { PendenciaConfiguracao } from "@/lib/pendencias-configuracao";
import { obterPendenciasConfiguracao, responderPendenciaBobina } from "./PendenciasConfiguracaoModal.actions";

const SELETOR_FOCAVEL =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

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
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    obterPendenciasConfiguracao().then(setPendencias);
  }, []);

  // Sucesso avança pra próxima pendência do array (ou some, se era a
  // última) — sem recarregar a lista inteira do servidor.
  useAoMudar(state, (estado) => {
    if (estado?.ok) setIndice((i) => i + 1);
  });

  const aberto = !fechadoNestaSessao && pendencias.length > 0 && indice < pendencias.length;
  const aoFechar = () => setFechadoNestaSessao(true);

  // Trava o foco dentro do modal (Tab/Shift+Tab cicla nas bordas) e fecha
  // com Esc — sem isso o teclado alcança a página coberta pelo overlay.
  useEffect(() => {
    if (!aberto) return;

    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") {
        aoFechar();
        return;
      }
      if (e.key !== "Tab" || !containerRef.current) return;
      const focaveis = containerRef.current.querySelectorAll<HTMLElement>(SELETOR_FOCAVEL);
      if (focaveis.length === 0) return;
      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];
      if (e.shiftKey && document.activeElement === primeiro) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primeiro.focus();
      }
    }

    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aberto]);

  // Reforça o foco no primeiro campo ao avançar de pendência — quando o
  // próximo item reaproveita o mesmo <Input autoFocus>, o autoFocus não
  // dispara de novo porque o nó DOM não é remontado.
  useEffect(() => {
    if (!aberto) return;
    containerRef.current?.querySelector<HTMLElement>(SELETOR_FOCAVEL)?.focus();
  }, [aberto, indice]);

  if (!aberto) {
    return null;
  }

  const pendencia = pendencias[indice];

  return (
    <div
      ref={containerRef}
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
                onClick={aoFechar}
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

        {pendencia.tipo === "PAPEL_MATERIA_PRIMA_FALTANDO" && (
          <div className="flex flex-col gap-4">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Matéria-prima de papel — {pendencia.nomeProduto}
            </h2>
            <p className="text-sm text-slate-500">
              Esse produto usa clichê de etiqueta, mas a gráfica ainda não tem nenhuma
              matéria-prima de papel ativa cadastrada — sem isso o seletor de papel do
              orçamento aparece vazio. Cadastre pelo menos uma matéria-prima de papel em
              Catálogo pra poder usar este produto.
            </p>
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={aoFechar}
                className="text-xs font-medium text-slate-500 hover:text-slate-700 hover:underline dark:text-slate-400 dark:hover:text-slate-200"
              >
                Depois
              </button>
              <Link
                href="/catalogo"
                onClick={aoFechar}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm shadow-teal-600/20 transition-colors hover:bg-teal-700"
              >
                Ir pro Catálogo
              </Link>
            </div>
          </div>
        )}

        {pendencia.tipo === "MAQUINA_NAO_VINCULADA" && (
          <div className="flex flex-col gap-4">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Máquina não configurada — {pendencia.nomeProduto}
            </h2>
            <p className="text-sm text-slate-500">
              Esse produto usa um modelo de cálculo que depende de uma máquina (prensa,
              impressora ou equipamento) configurada, mas nenhuma está vinculada ainda —
              sem isso o motor de preço não consegue montar um orçamento com ele. Escolha
              a máquina na tela do produto, em Catálogo.
            </p>
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={aoFechar}
                className="text-xs font-medium text-slate-500 hover:text-slate-700 hover:underline dark:text-slate-400 dark:hover:text-slate-200"
              >
                Depois
              </button>
              <Link
                href={`/catalogo/${pendencia.itemGraficaId}`}
                onClick={aoFechar}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm shadow-teal-600/20 transition-colors hover:bg-teal-700"
              >
                Configurar máquina
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
