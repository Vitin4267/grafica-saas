"use client";

import { useActionState, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { gerarChave } from "@/lib/chave-local";
import { salvarFormatosFolhaPapel } from "./actions";

type LinhaFormato = { chave: string; nome: string; larguraFolha: string; alturaFolha: string };

function CampoLinha({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (valor: string) => void;
  placeholder: string;
}) {
  return (
    <input
      type="number"
      step="0.01"
      min="0.01"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
    />
  );
}

// Achado A1 da auditoria do motor de preço (2026-09-13) — sem isto, nenhuma
// tela do sistema conseguia gravar um FormatoFolha numa MATERIA_PRIMA, e o
// motor DIGITAL (que exige contexto.digital.folhas vindo do PAPEL escolhido
// no orçamento, ver src/lib/pricing/carregar.ts) morria sempre em
// MATERIAL_SEM_FOLHA. Mesmo padrão visual/estrutural de TabelaGramaturaForm
// (a outra config específica de papel, ao lado desta na tela).
export function FormatosFolhaPapelForm({
  itemGraficaId,
  linhasIniciais,
}: {
  itemGraficaId: string;
  linhasIniciais: { nome: string; larguraFolha: string; alturaFolha: string }[];
}) {
  const [linhas, setLinhas] = useState<LinhaFormato[]>(() =>
    linhasIniciais.length > 0
      ? linhasIniciais.map((l) => ({ chave: gerarChave(), ...l }))
      : [{ chave: gerarChave(), nome: "", larguraFolha: "", alturaFolha: "" }]
  );
  const [state, formAction, isPending] = useActionState(salvarFormatosFolhaPapel, null);

  const atualizar = (chave: string, campo: "nome" | "larguraFolha" | "alturaFolha", valor: string) => {
    setLinhas((atual) => atual.map((l) => (l.chave === chave ? { ...l, [campo]: valor } : l)));
  };
  const remover = (chave: string) => setLinhas((atual) => atual.filter((l) => l.chave !== chave));
  const adicionar = () =>
    setLinhas((atual) => [...atual, { chave: gerarChave(), nome: "", larguraFolha: "", alturaFolha: "" }]);

  return (
    <Card className="flex flex-col gap-5 p-6">
      <div>
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
          Formatos de folha (impressão Digital)
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Necessário só se este papel vai ser usado num produto com modelo de cálculo Digital — o
          orçamento escolhe o papel e o sistema calcula quantas peças cabem em cada formato
          cadastrado aqui (largura e altura em metros), igual já acontece com chapa e Offset.
        </p>
      </div>

      <form
        action={formAction}
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          if (linhas.some((l) => !l.nome || !l.larguraFolha || !l.alturaFolha)) {
            e.preventDefault();
          }
        }}
      >
        <input type="hidden" name="itemGraficaId" value={itemGraficaId} />
        <input
          type="hidden"
          name="formatosFolhaJson"
          value={JSON.stringify(
            linhas
              .filter((l) => l.nome && l.larguraFolha && l.alturaFolha)
              .map(({ nome, larguraFolha, alturaFolha }) => ({ nome, larguraFolha, alturaFolha }))
          )}
        />

        <div className="flex flex-col gap-3">
          {linhas.map((linha) => (
            <div key={linha.chave} className="flex items-end gap-3">
              <label className="flex flex-1 flex-col gap-1">
                <span className="text-xs text-slate-500">Nome</span>
                <input
                  type="text"
                  value={linha.nome}
                  onChange={(e) => atualizar(linha.chave, "nome", e.target.value)}
                  placeholder="ex: SRA3 32x45"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </label>
              <label className="flex w-28 flex-col gap-1">
                <span className="text-xs text-slate-500">Largura (m)</span>
                <CampoLinha
                  value={linha.larguraFolha}
                  onChange={(v) => atualizar(linha.chave, "larguraFolha", v)}
                  placeholder="0.32"
                />
              </label>
              <label className="flex w-28 flex-col gap-1">
                <span className="text-xs text-slate-500">Altura (m)</span>
                <CampoLinha
                  value={linha.alturaFolha}
                  onChange={(v) => atualizar(linha.chave, "alturaFolha", v)}
                  placeholder="0.45"
                />
              </label>
              <button
                type="button"
                onClick={() => remover(linha.chave)}
                className="rounded-lg px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50"
              >
                Remover
              </button>
            </div>
          ))}
        </div>

        <Button type="button" variant="outline" onClick={adicionar} className="self-start">
          + Adicionar formato
        </Button>

        {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}

        <Button type="submit" loading={isPending} className="self-start">
          {isPending ? "Salvando..." : "Salvar formatos de folha"}
        </Button>
      </form>
    </Card>
  );
}
