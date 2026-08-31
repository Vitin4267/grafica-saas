"use client";

import { useActionState, useState } from "react";
import { useAoMudar } from "@/lib/hooks/useAoMudar";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { ConfirmarExclusao } from "@/components/ui/ConfirmarExclusao";
import {
  ORDEM_CATEGORIA_EQUIPAMENTO,
  ROTULO_CATEGORIA_EQUIPAMENTO,
  EXEMPLOS_MARCA_CATEGORIA_EQUIPAMENTO,
} from "@/lib/tipos-equipamento";
import { salvarEquipamento, excluirEquipamento } from "../actions";
import type { CategoriaEquipamento } from "@/generated/prisma/enums";

type ValoresEquipamento = {
  nome: string;
  ativo: boolean;
  categoria: CategoriaEquipamento;
  categoriaOutro: string | null;
  marca: string | null;
  modelo: string | null;
  larguraMaximaMm: number | null;
  tecnologiaImpressao: string | null;
};

export function EquipamentoForm({
  equipamentoId,
  valoresIniciais,
}: {
  equipamentoId: string;
  valoresIniciais: ValoresEquipamento;
}) {
  const [state, formAction, isPending] = useActionState(salvarEquipamento, null);
  const [estadoExclusao, excluirAction, excluindo] = useActionState(excluirEquipamento, null);
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);
  const [categoria, setCategoria] = useState<CategoriaEquipamento>(valoresIniciais.categoria);

  useAoMudar(estadoExclusao, (estadoExclusao) => {
    if (estadoExclusao && !estadoExclusao.ok) setConfirmandoExclusao(false);
  });

  return (
    <div className="flex flex-col gap-6">
      <form action={formAction} className="flex flex-col gap-6">
        <input type="hidden" name="equipamentoId" value={equipamentoId} />

        <Card className="flex flex-col gap-4 p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Nome" name="nome" type="text" defaultValue={valoresIniciais.nome} required />
            <label className="flex items-center gap-2 self-end pb-2.5">
              <input
                type="checkbox"
                name="ativo"
                defaultChecked={valoresIniciais.ativo}
                className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
              />
              <span className="text-sm text-slate-700 dark:text-slate-200">Equipamento ativo</span>
            </label>
          </div>

          <Select
            label="Categoria"
            name="categoria"
            value={categoria}
            onChange={(e) => setCategoria(e.target.value as CategoriaEquipamento)}
          >
            {ORDEM_CATEGORIA_EQUIPAMENTO.map((valor) => (
              <option key={valor} value={valor}>
                {ROTULO_CATEGORIA_EQUIPAMENTO[valor]}
              </option>
            ))}
          </Select>

          {categoria === "OUTRO" ? (
            <Input
              label="Descreva a categoria"
              name="categoriaOutro"
              type="text"
              defaultValue={valoresIniciais.categoriaOutro ?? ""}
              placeholder="ex: gofradeira, vincadeira..."
              required
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="Marca"
                name="marca"
                type="text"
                defaultValue={valoresIniciais.marca ?? ""}
                placeholder={EXEMPLOS_MARCA_CATEGORIA_EQUIPAMENTO[categoria]}
              />
              <Input label="Modelo" name="modelo" type="text" defaultValue={valoresIniciais.modelo ?? ""} />
            </div>
          )}

          {/* Achado A3 da Parte 7 da auditoria de abrangência — largura/
             tecnologia de impressão. Não é específico de categoria (qualquer
             Equipamento pode ter, não só IMPRESSORA_GRANDE_FORMATO), por
             isso fora do bloco condicional de categoria acima. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Largura máxima (mm)"
              name="larguraMaximaMm"
              type="number"
              step="1"
              min="1"
              defaultValue={valoresIniciais.larguraMaximaMm ?? ""}
              placeholder="ex: 1600"
            />
            <Input
              label="Tecnologia de impressão"
              name="tecnologiaImpressao"
              type="text"
              defaultValue={valoresIniciais.tecnologiaImpressao ?? ""}
              placeholder="ex: eco-solvente, UV, sublimática"
            />
          </div>
        </Card>

        {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}

        <Button type="submit" loading={isPending} className="self-start">
          {isPending ? "Salvando..." : "Salvar equipamento"}
        </Button>
      </form>

      <Card className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-900 dark:text-white">Excluir equipamento</p>
            <p className="text-xs text-slate-500">
              O histórico de manutenção deste equipamento também é apagado.
            </p>
            {estadoExclusao && !estadoExclusao.ok && (
              <p className="mt-1 text-xs text-rose-600">{estadoExclusao.mensagem}</p>
            )}
          </div>
          {!confirmandoExclusao && (
            <Button
              type="button"
              variant="outline"
              className="shrink-0 text-rose-600"
              onClick={() => setConfirmandoExclusao(true)}
            >
              Excluir
            </Button>
          )}
        </div>
        {confirmandoExclusao && (
          <ConfirmarExclusao
            pergunta={`Tem certeza que quer excluir "${valoresIniciais.nome}"? Essa ação não pode ser desfeita.`}
            onCancelar={() => setConfirmandoExclusao(false)}
            formAction={excluirAction}
            campos={{ equipamentoId }}
            rotuloBotao="Excluir equipamento"
            pendente={excluindo}
          />
        )}
      </Card>
    </div>
  );
}
