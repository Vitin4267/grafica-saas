"use client";

import { Select } from "@/components/ui/Select";
import type { PapelDisponivel } from "./CamposPrecificacaoEtiquetaOrcamento";

// Achado N4 da auditoria de código (2026-09-04) — o motor Digital passou a
// fazer imposição igual ao Offset (lê os FormatoFolha do papel escolhido pra
// calcular quantas peças cabem por folha), então precisa que o vendedor
// escolha o papel/substrato NESTE orçamento — mesmo padrão de
// CamposPrecificacaoEtiquetaOrcamento (o papel do Offset/etiqueta também é
// escolhido por orçamento, não fixo no produto), mas sem quantidade de
// cores/faca — esses campos são específicos do motor de clichê de etiqueta.
// Reaproveita o MESMO estado `papelId` de precificacaoEtiqueta (não um campo
// novo) — no backend, `DadosItemOrcamento.papelId` já é um único campo
// compartilhado entre os dois motores (nunca ativos ao mesmo tempo no mesmo
// item), ver src/lib/orcamento-precificacao.ts.
export function CamposPrecificacaoDigitalOrcamento({
  papeisDisponiveis,
  papelId,
  onChange,
}: {
  papeisDisponiveis: PapelDisponivel[];
  papelId: string;
  onChange: (papelId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-slate-300 p-4 dark:border-slate-700">
      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
        Papel/substrato deste orçamento
      </p>

      {papeisDisponiveis.length === 0 ? (
        <span className="text-xs text-slate-500">
          Nenhuma matéria-prima de papel cadastrada ainda — cadastre em Catálogo. O papel precisa ter
          pelo menos um formato de folha cadastrado (aba &quot;Formatos de folha&quot; do papel) pra
          calcular quantas peças cabem por folha.
        </span>
      ) : (
        <Select label="Papel" value={papelId} onChange={(e) => onChange(e.target.value)} required>
          <option value="" disabled>
            Selecione o papel
          </option>
          {papeisDisponiveis.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
              {p.precoCompra ? ` — R$ ${p.precoCompra}/folha` : ""}
            </option>
          ))}
        </Select>
      )}
    </div>
  );
}
