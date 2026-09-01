"use client";

import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { CampoAjuda } from "@/components/ui/CampoAjuda";

// Papel escolhido como matéria-prima NESTE orçamento (não fixo no produto,
// diferente do papelId do modelo Offset) — ver ConfiguracaoClicheEtiqueta e
// src/lib/pricing/carregar.ts.
export type PapelDisponivel = {
  id: string;
  nome: string;
  precoCompra: string | null;
};

export type CamposPrecificacaoEtiqueta = {
  papelId: string;
  quantidadeCores: string;
  custoFaca: string;
  custoFrete: string;
};

export function precificacaoEtiquetaInicial(): CamposPrecificacaoEtiqueta {
  return { papelId: "", quantidadeCores: "", custoFaca: "", custoFrete: "" };
}

// Campos do motor de clichê de etiqueta — só aparece quando o produto M2
// escolhido tem ConfiguracaoClicheEtiqueta (usaClicheEtiqueta). Papel e
// quantidade de cores entram na conta de preço (custo de material vem do
// papel escolhido, clichê é fixo por cor); faca e frete são R$ livres,
// opcionais, por item.
export function CamposPrecificacaoEtiquetaOrcamento({
  papeisDisponiveis,
  valores,
  onChange,
}: {
  papeisDisponiveis: PapelDisponivel[];
  valores: CamposPrecificacaoEtiqueta;
  onChange: (novo: CamposPrecificacaoEtiqueta) => void;
}) {
  const set =
    (campo: keyof CamposPrecificacaoEtiqueta) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      onChange({ ...valores, [campo]: e.target.value });

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-slate-300 p-4 dark:border-slate-700">
      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
        Precificação de etiqueta
      </p>

      {papeisDisponiveis.length === 0 ? (
        <span className="text-xs text-slate-500">
          Nenhuma matéria-prima de papel cadastrada ainda — cadastre em Catálogo.
        </span>
      ) : (
        <Select label="Papel" value={valores.papelId} onChange={set("papelId")} required>
          <option value="" disabled>
            Selecione o papel
          </option>
          {papeisDisponiveis.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
              {p.precoCompra ? ` — R$ ${p.precoCompra}/m²` : ""}
            </option>
          ))}
        </Select>
      )}

      <Input
        label="Quantidade de cores (clichês)"
        type="number"
        min={1}
        value={valores.quantidadeCores}
        onChange={set("quantidadeCores")}
        hint="Um clichê por cor da arte — custo fixo, não muda com a tiragem."
        required
      />

      {/* Custo de faca/frete: R$ livres, opcionais, raramente preenchidos —
          diferente de papel/quantidade de cores acima (que entram na conta
          de preço e costumam ser necessários), por isso ficam escondidos
          atrás de um "Mais opções" fechado por padrão. */}
      <details className="group rounded-xl border border-slate-200 dark:border-slate-800">
        <summary className="flex cursor-pointer list-none items-center px-3 py-2 text-xs font-medium text-slate-500 marker:content-none dark:text-slate-400">
          Mais opções
        </summary>
        <div className="grid grid-cols-1 gap-4 border-t border-slate-100 p-3 dark:border-slate-800 sm:grid-cols-2">
          <Input
            label={
              <>
                Custo da faca (R$)
                <CampoAjuda texto="Custo da faca de corte (o molde/clichê usado pra recortar o formato da etiqueta). É um ferramental que se paga uma vez só, mas normalmente é cobrado dentro do primeiro pedido que usa esse formato." />
              </>
            }
            type="number"
            min={0}
            step="0.01"
            value={valores.custoFaca}
            onChange={set("custoFaca")}
            placeholder="opcional"
          />
          <Input
            label={
              <>
                Custo de frete (R$)
                <CampoAjuda texto="Frete específico pra trazer o material ou a faca desta etiqueta — não é o frete de entrega do pedido pronto pro cliente (esse fica nos dados gerais do orçamento, em 'Frete')." />
              </>
            }
            type="number"
            min={0}
            step="0.01"
            value={valores.custoFrete}
            onChange={set("custoFrete")}
            placeholder="opcional"
          />
        </div>
      </details>
    </div>
  );
}
