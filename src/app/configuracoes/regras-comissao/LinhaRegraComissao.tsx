"use client";

import { useActionState, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Alert } from "@/components/ui/Alert";
import type { BaseComissao } from "@/generated/prisma/enums";
import { editarRegraComissao, alternarAtivaRegraComissao, excluirRegraComissao } from "./actions";

const ROTULO_BASE: Record<string, string> = {
  VALOR: "sobre valor",
  LUCRO: "sobre lucro",
};

type Regra = {
  id: string;
  prioridade: number;
  usuarioId: string | null;
  usuarioNome: string | null;
  itemCatalogoId: string | null;
  itemNome: string | null;
  tipoItem: string | null;
  margemMinPercent: number | null;
  margemMaxPercent: number | null;
  percentual: number;
  baseCalculo: BaseComissao | null;
  ativa: boolean;
};

function descreverFiltros(regra: Regra): string {
  const partes: string[] = [];
  partes.push(regra.usuarioNome ? `vendedor ${regra.usuarioNome}` : "qualquer vendedor");
  if (regra.itemNome) partes.push(`item ${regra.itemNome}`);
  if (regra.tipoItem) partes.push(`categoria "${regra.tipoItem}"`);
  if (regra.margemMinPercent !== null || regra.margemMaxPercent !== null) {
    const min = regra.margemMinPercent !== null ? `${(regra.margemMinPercent * 100).toFixed(0)}%` : "0%";
    const max = regra.margemMaxPercent !== null ? `${(regra.margemMaxPercent * 100).toFixed(0)}%` : "∞";
    partes.push(`margem ${min}–${max}`);
  }
  return partes.join(" · ");
}

export function LinhaRegraComissao({
  regra,
  usuarios,
  itensCatalogo,
  podeEditar,
}: {
  regra: Regra;
  usuarios: { id: string; nome: string }[];
  itensCatalogo: { id: string; nome: string; categoria: string }[];
  podeEditar: boolean;
}) {
  const [editando, setEditando] = useState(false);
  const [stateEditar, formActionEditar, isPendingEditar] = useActionState(editarRegraComissao, null);
  const [stateAtiva, formActionAtiva, isPendingAtiva] = useActionState(alternarAtivaRegraComissao, null);
  const [stateExcluir, formActionExcluir, isPendingExcluir] = useActionState(excluirRegraComissao, null);

  if (editando) {
    return (
      <Card className="p-5">
        <form action={formActionEditar} className="flex flex-col gap-4">
          <input type="hidden" name="regraId" value={regra.id} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Select label="Vendedor" name="usuarioId" defaultValue={regra.usuarioId ?? ""}>
              <option value="">Qualquer vendedor</option>
              {usuarios.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nome}
                </option>
              ))}
            </Select>
            <Select label="Produto/matéria-prima" name="itemCatalogoId" defaultValue={regra.itemCatalogoId ?? ""}>
              <option value="">Qualquer item</option>
              {itensCatalogo.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.nome} ({i.categoria})
                </option>
              ))}
            </Select>
          </div>
          <Input label="Categoria do catálogo" name="tipoItem" defaultValue={regra.tipoItem ?? ""} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Margem mínima (fração)"
              name="margemMinPercent"
              type="number"
              step="0.0001"
              min="0"
              max="1"
              defaultValue={regra.margemMinPercent ?? ""}
            />
            <Input
              label="Margem máxima (fração)"
              name="margemMaxPercent"
              type="number"
              step="0.0001"
              min="0"
              max="1"
              defaultValue={regra.margemMaxPercent ?? ""}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Percentual de comissão (fração)"
              name="percentual"
              type="number"
              step="0.0001"
              min="0.0001"
              max="1"
              defaultValue={regra.percentual}
              required
            />
            <Select label="Base de cálculo" name="baseCalculo" defaultValue={regra.baseCalculo ?? ""}>
              <option value="">Padrão da gráfica</option>
              <option value="VALOR">% sobre o valor do orçamento</option>
              <option value="LUCRO">% sobre o lucro (valor − custo)</option>
            </Select>
          </div>
          <Input label="Prioridade (desempate)" name="prioridade" type="number" step="1" defaultValue={regra.prioridade} />

          {stateEditar && !stateEditar.ok && <Alert variant="error">{stateEditar.mensagem}</Alert>}
          <div className="flex gap-2">
            <Button type="submit" loading={isPendingEditar}>
              Salvar
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditando(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      </Card>
    );
  }

  return (
    <Card className={`flex items-center justify-between gap-4 p-5 ${!regra.ativa ? "opacity-60" : ""}`}>
      <div>
        <p className="font-medium text-slate-900 dark:text-white">
          {(regra.percentual * 100).toFixed(2)}% {ROTULO_BASE[regra.baseCalculo ?? ""] ?? "base padrão"}
          {!regra.ativa && (
            <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-normal text-slate-500 dark:bg-slate-800">
              desativada
            </span>
          )}
        </p>
        <p className="text-xs text-slate-500">{descreverFiltros(regra)}</p>
        {regra.prioridade !== 0 && (
          <p className="text-xs text-slate-400">Prioridade {regra.prioridade}</p>
        )}
      </div>
      {podeEditar && (
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" className="px-3 py-1.5 text-xs" onClick={() => setEditando(true)}>
            Editar
          </Button>
          <form action={formActionAtiva}>
            <input type="hidden" name="regraId" value={regra.id} />
            <Button type="submit" variant="outline" loading={isPendingAtiva} className="px-3 py-1.5 text-xs">
              {regra.ativa ? "Desativar" : "Ativar"}
            </Button>
          </form>
          <form
            action={formActionExcluir}
            onSubmit={(evento) => {
              if (!window.confirm("Excluir esta regra de comissão?")) evento.preventDefault();
            }}
          >
            <input type="hidden" name="regraId" value={regra.id} />
            <Button
              type="submit"
              variant="ghost"
              loading={isPendingExcluir}
              className="px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-950/50"
            >
              Excluir
            </Button>
          </form>
        </div>
      )}
      {stateAtiva && !stateAtiva.ok && <Alert variant="error">{stateAtiva.mensagem}</Alert>}
      {stateExcluir && !stateExcluir.ok && <Alert variant="error">{stateExcluir.mensagem}</Alert>}
    </Card>
  );
}
