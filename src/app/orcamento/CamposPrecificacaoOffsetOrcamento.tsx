"use client";

import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { CampoAjuda } from "@/components/ui/CampoAjuda";
import type { PapelDisponivel } from "./CamposPrecificacaoEtiquetaOrcamento";

// Achado N8 da auditoria de código (2026-09-04) — no Offset, papel e
// gramatura já são propriedade FIXA do produto (configurados uma vez em
// Catálogo, diferente do Digital/etiqueta acima, que não têm nenhum papel
// fixo). Por isso os dois campos aqui são OPCIONAIS: em branco = usa o que
// está cadastrado no produto (comportamento de sempre) — só preencha pra
// cotar ESTE orçamento num papel/gramatura diferente (ex: mesmo folder em
// couché 90g, 115g ou 150g). Reaproveita o MESMO estado `papelId` de
// precificacaoEtiqueta/Digital (campo único e compartilhado no backend —
// nunca dois motores ativos ao mesmo tempo no mesmo item, ver
// src/lib/orcamento-precificacao.ts), mas a gramatura é um campo NOVO,
// específico do Offset.
export function CamposPrecificacaoOffsetOrcamento({
  papeisDisponiveis,
  papelId,
  gramaturaGm2,
  onChangePapelId,
  onChangeGramaturaGm2,
}: {
  papeisDisponiveis: PapelDisponivel[];
  papelId: string;
  gramaturaGm2: string;
  onChangePapelId: (papelId: string) => void;
  onChangeGramaturaGm2: (gramaturaGm2: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-slate-300 p-4 dark:border-slate-700">
      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
        Papel/gramatura deste orçamento (opcional)
      </p>
      <span className="text-xs text-slate-500">
        Deixe em branco pra usar o papel e a gramatura cadastrados no produto — só preencha pra cotar
        este orçamento num papel ou numa gramatura diferente (ex: o mesmo produto em couché 90g, 115g
        ou 150g).
      </span>

      {papeisDisponiveis.length > 0 && (
        <Select
          label="Papel"
          value={papelId}
          onChange={(e) => onChangePapelId(e.target.value)}
        >
          <option value="">Usar o papel cadastrado no produto</option>
          {papeisDisponiveis.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </Select>
      )}

      <Input
        label={
          <>
            Gramatura (g/m²)
            <CampoAjuda texto="Sobrepõe a gramatura cadastrada no produto só neste orçamento — útil pra cotar o mesmo produto em espessuras diferentes de papel sem precisar cadastrar um produto novo pra cada uma." />
          </>
        }
        type="number"
        min={1}
        step="0.1"
        value={gramaturaGm2}
        onChange={(e) => onChangeGramaturaGm2(e.target.value)}
        placeholder="opcional — usa a gramatura do produto"
      />
    </div>
  );
}
