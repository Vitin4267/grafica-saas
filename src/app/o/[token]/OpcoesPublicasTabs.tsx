"use client";

import { useState } from "react";
import { formatoMoeda } from "@/lib/moeda";
import { converterDeCm, ROTULO_UNIDADE_DIMENSAO, type UnidadeDimensao } from "@/lib/unidade-dimensao";
import { Card } from "@/components/ui/Card";
import { EtiquetaResumo, type EtiquetaResumoDados } from "@/app/orcamento/[id]/EtiquetaResumo";
import { RespostaPublica } from "./RespostaPublica";

export type ItemOpcaoPublica = {
  id: string;
  nome: string;
  quantidade: number;
  precoUnitario: string;
  precoTotal: string;
  larguraCm: number | null;
  alturaCm: number | null;
  unidadeDimensao: UnidadeDimensao;
  cores: string | null;
  acabamento: string | null;
  etiqueta: EtiquetaResumoDados | null;
};

export type OpcaoPublica = {
  // id === null pra opção-base ("Opção A", nunca tem linha em
  // OrcamentoOpcao — ver comentário do model no schema.prisma).
  id: string | null;
  nome: string;
  total: string;
  itens: ItemOpcaoPublica[];
};

// Só renderizado quando o orçamento TEM opções alternativas (ver
// src/lib/orcamento-opcoes.ts) — orçamento de opção única continua com a
// renderização de sempre em page.tsx, sem passar por este componente.
// Dono das abas (Opção A / B / C...) e de qual opcaoId vai no formulário de
// aprovação — RespostaPublica é renderizado AQUI DENTRO (não solto em
// page.tsx) porque o opcaoId escolhido tem que nascer sincronizado com a aba
// visível.
export function OpcoesPublicasTabs({
  token,
  nomeSugerido,
  opcoes,
  mostrarResposta,
  mostrarEspecificacoesTecnicas,
}: {
  token: string;
  nomeSugerido: string | null;
  // Opção-base sempre em opcoes[0] (id: null) — quem chama (page.tsx) monta
  // o array nessa ordem.
  opcoes: OpcaoPublica[];
  // status === "ENVIADO" && !expirado — mesma condição que já existia pra
  // mostrar RespostaPublica antes desta feature.
  mostrarResposta: boolean;
  // ParametrosGrafica.mostrarEspecificacoesTecnicas, já resolvido (default
  // true aplicado) por quem chama — ver page.tsx.
  mostrarEspecificacoesTecnicas: boolean;
}) {
  const [abaSelecionada, setAbaSelecionada] = useState(0);
  const opcao = opcoes[abaSelecionada] ?? opcoes[0];

  return (
    <>
      {opcoes.length > 1 && (
        <div className="mb-4 flex gap-2 overflow-x-auto">
          {opcoes.map((o, indice) => (
            <button
              key={o.id ?? "base"}
              type="button"
              onClick={() => setAbaSelecionada(indice)}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                indice === abaSelecionada
                  ? "bg-teal-600 text-white"
                  : "bg-white text-slate-600 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
            >
              {o.nome}
            </button>
          ))}
        </div>
      )}

      {/* Nunca renderiza item.breakdown aqui — custo de material, margens etc.
          são dado comercial sensível da gráfica, não algo que o cliente final vê. */}
      <Card className="mb-6 divide-y divide-slate-100 dark:divide-slate-800">
        {opcao.itens.map((item) => (
          <div key={item.id} className="flex flex-col gap-2 p-5">
            <div className="flex items-center justify-between gap-4">
              <p className="font-medium text-slate-900 dark:text-white">{item.nome}</p>
              <p className="font-semibold text-slate-900 dark:text-white">
                {formatoMoeda.format(Number(item.precoTotal))}
              </p>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
              <span>Qtd: {item.quantidade}</span>
              {item.larguraCm && item.alturaCm && (
                <span>
                  {converterDeCm(item.larguraCm, item.unidadeDimensao)} ×{" "}
                  {converterDeCm(item.alturaCm, item.unidadeDimensao)}{" "}
                  {ROTULO_UNIDADE_DIMENSAO[item.unidadeDimensao]}
                </span>
              )}
              {item.cores && <span>Cores: {item.cores}</span>}
              {item.acabamento && <span>Acabamento: {item.acabamento}</span>}
              <span>Unitário: {formatoMoeda.format(Number(item.precoUnitario))}</span>
            </div>
            {item.etiqueta && mostrarEspecificacoesTecnicas && (
              <EtiquetaResumo etiqueta={item.etiqueta} />
            )}
          </div>
        ))}
      </Card>

      <Card className="mb-6 flex items-center justify-between p-5">
        <p className="text-sm font-medium text-slate-500">Total — {opcao.nome}</p>
        <p className="text-2xl font-bold text-slate-900 dark:text-white">
          {formatoMoeda.format(Number(opcao.total))}
        </p>
      </Card>

      {mostrarResposta && (
        <RespostaPublica token={token} nomeSugerido={nomeSugerido} opcaoId={opcao.id} />
      )}
    </>
  );
}
