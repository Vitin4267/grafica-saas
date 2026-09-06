"use client";

import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { CampoAjuda } from "@/components/ui/CampoAjuda";
import { corEspecialLinhaInicial, type CamposCorEspecial } from "./cor-especial-campos";
import type { CorEspecialDisponivel } from "@/lib/orcamento-cor-especial";

const VALOR_TEXTO_LIVRE = "";

function LinhaCorEspecial({
  linha,
  disponiveis,
  onAlterar,
  onRemover,
}: {
  linha: CamposCorEspecial;
  disponiveis: CorEspecialDisponivel[];
  onAlterar: (novo: Partial<CamposCorEspecial>) => void;
  onRemover: () => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-2 dark:bg-slate-800/50">
      {disponiveis.length > 0 && (
        <div className="w-56">
          <Select
            label="Da biblioteca do cliente"
            value={linha.corEspecialId}
            onChange={(e) => {
              const corEspecialId = e.target.value;
              if (corEspecialId === VALOR_TEXTO_LIVRE) {
                onAlterar({ corEspecialId: "" });
                return;
              }
              const escolhida = disponiveis.find((c) => c.id === corEspecialId);
              onAlterar({
                corEspecialId,
                nomeDeclarado: escolhida ? `${escolhida.nome} — ${escolhida.referencia}` : linha.nomeDeclarado,
                salvarNaBiblioteca: false,
              });
            }}
          >
            <option value={VALOR_TEXTO_LIVRE}>— digitar um nome novo —</option>
            {disponiveis.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome} — {c.referencia}
              </option>
            ))}
          </Select>
        </div>
      )}
      <div className="w-56">
        <Input
          label="Nome/referência da cor"
          value={linha.nomeDeclarado}
          onChange={(e) => onAlterar({ nomeDeclarado: e.target.value })}
          placeholder='ex: "PANTONE 485 C"'
        />
      </div>
      {!linha.corEspecialId && (
        <label className="flex items-center gap-2 pb-2 text-xs text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={linha.salvarNaBiblioteca}
            onChange={(e) => onAlterar({ salvarNaBiblioteca: e.target.checked })}
            className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
          />
          Salvar na biblioteca do cliente
        </label>
      )}
      <button
        type="button"
        onClick={onRemover}
        className="rounded-lg px-2 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50"
      >
        Remover
      </button>
    </div>
  );
}

// Achado F8 da auditoria de abrangência (Parte 7) — bloco de cor(es)
// especial/Pantone deste item (0 a N linhas, mesmo padrão de lista de
// LinhaHotStamping em CamposEtiquetaOrcamento.tsx). Ao contrário de
// hotStampings (exclusivo do bloco de etiqueta, só M2), este componente é
// standalone e independente de modeloCalculo — cor especial se aplica a
// qualquer motor. `disponiveis` vem vazio quando o cliente do orçamento
// ainda não tem biblioteca própria (ou quando o fluxo que renderiza isto —
// ex: Calculadora, antes de escolher o cliente — não tem como buscá-la
// ainda): nesse caso o <Select> nem aparece, sobra só o texto livre.
export function CamposCorEspecialOrcamento({
  linhas,
  disponiveis,
  onChange,
}: {
  linhas: CamposCorEspecial[];
  disponiveis: CorEspecialDisponivel[];
  onChange: (novo: CamposCorEspecial[]) => void;
}) {
  const alterar = (chave: string, novo: Partial<CamposCorEspecial>) =>
    onChange(linhas.map((l) => (l.chave === chave ? { ...l, ...novo } : l)));
  const remover = (chave: string) => onChange(linhas.filter((l) => l.chave !== chave));
  const adicionar = () => onChange([...linhas, corEspecialLinhaInicial()]);

  return (
    <div className="flex flex-col gap-2">
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">
        Cor especial (Pantone)
        <CampoAjuda texto="Cor especial não é a mesma coisa que a QUANTIDADE de cores (Offset/Flexografia) — é QUAL cor: o nome/referência exato que o cliente aprovou (ex: 'PANTONE 485 C'). Um item pode usar mais de uma cor especial (ex: logo + fundo). Escolha da biblioteca do cliente quando já existir, ou digite um nome novo." />
      </span>
      {linhas.map((linha) => (
        <LinhaCorEspecial
          key={linha.chave}
          linha={linha}
          disponiveis={disponiveis}
          onAlterar={(novo) => alterar(linha.chave, novo)}
          onRemover={() => remover(linha.chave)}
        />
      ))}
      <Button
        type="button"
        variant="outline"
        onClick={adicionar}
        className="self-start !px-3 !py-1.5 text-xs"
      >
        + adicionar cor especial
      </Button>
    </div>
  );
}
