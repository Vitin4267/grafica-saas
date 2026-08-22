"use client";

import { useActionState, useState } from "react";
import { formatoMoeda } from "@/lib/moeda";
import type { UnidadeDimensao } from "@/lib/unidade-dimensao";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { removerOpcaoOrcamento } from "./opcoes.actions";
import { AdicionarOpcaoForm } from "./AdicionarOpcaoForm";
import type { ItemVenda, ItemAcabamentoDisponivel } from "../SeletorItemOrcamento";
import type { PapelDisponivel } from "../CamposPrecificacaoEtiquetaOrcamento";

export type OpcaoOrcamentoResumo = {
  id: string;
  nome: string;
  total: string;
  itens: { id: string; nome: string; quantidade: number; precoTotal: string }[];
};

function BotaoRemoverOpcao({ opcaoId, nome }: { opcaoId: string; nome: string }) {
  const [confirmando, setConfirmando] = useState(false);
  const [state, formAction, isPending] = useActionState(removerOpcaoOrcamento, null);

  if (confirmando) {
    return (
      <form action={formAction} className="flex items-center gap-2">
        <input type="hidden" name="opcaoId" value={opcaoId} />
        <span className="text-xs text-slate-500">Remover &quot;{nome}&quot;?</span>
        <button
          type="submit"
          disabled={isPending}
          className="text-xs font-medium text-rose-600 hover:underline disabled:opacity-50"
        >
          {isPending ? "Removendo..." : "Confirmar"}
        </button>
        <button
          type="button"
          onClick={() => setConfirmando(false)}
          className="text-xs font-medium text-slate-500 hover:underline"
        >
          Cancelar
        </button>
      </form>
    );
  }

  return (
    <>
      {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}
      <button
        type="button"
        onClick={() => setConfirmando(true)}
        className="text-xs font-medium text-rose-600 hover:underline"
      >
        Remover opção
      </button>
    </>
  );
}

// Seção "Opções alternativas" da tela de detalhe de orçamento — lista as
// OrcamentoOpcao já criadas (ver model no schema.prisma) e, enquanto o
// orçamento está em rascunho e o teto do MVP não foi atingido, o botão pra
// adicionar mais uma. Renderiza `null` (nada) quando não há opção nenhuma e
// não é possível adicionar — mantém a tela de um orçamento comum idêntica à
// de antes desta feature.
export function OpcoesOrcamento({
  orcamentoId,
  opcoes,
  podeAdicionar,
  proximaSugestaoNome,
  itensVendaveis,
  acabamentosDisponiveis,
  papeisDisponiveis,
  unidadePadrao,
}: {
  orcamentoId: string;
  opcoes: OpcaoOrcamentoResumo[];
  podeAdicionar: boolean;
  proximaSugestaoNome: string;
  itensVendaveis: ItemVenda[];
  acabamentosDisponiveis: ItemAcabamentoDisponivel[];
  papeisDisponiveis: PapelDisponivel[];
  unidadePadrao: UnidadeDimensao;
}) {
  const [mostrandoForm, setMostrandoForm] = useState(false);

  if (opcoes.length === 0 && !podeAdicionar) return null;

  return (
    <div className="mb-6 flex flex-col gap-4">
      {opcoes.length > 0 && (
        <div>
          <p className="mb-3 text-sm font-medium text-slate-500">
            Opções alternativas — o cliente escolhe uma delas pelo link público
          </p>
          <div className="flex flex-col gap-3">
            {opcoes.map((opcao) => (
              <Card key={opcao.id} className="divide-y divide-slate-100 dark:divide-slate-800">
                <div className="flex items-center justify-between gap-4 p-4">
                  <p className="font-medium text-slate-900 dark:text-white">{opcao.nome}</p>
                  <div className="flex items-center gap-3">
                    <p className="font-semibold text-slate-900 dark:text-white">
                      {formatoMoeda.format(Number(opcao.total))}
                    </p>
                    {podeAdicionar && <BotaoRemoverOpcao opcaoId={opcao.id} nome={opcao.nome} />}
                  </div>
                </div>
                {opcao.itens.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-4 px-4 py-2.5 text-xs text-slate-500">
                    <span>
                      {item.nome} · Qtd: {item.quantidade}
                    </span>
                    <span>{formatoMoeda.format(Number(item.precoTotal))}</span>
                  </div>
                ))}
              </Card>
            ))}
          </div>
        </div>
      )}

      {podeAdicionar && !mostrandoForm && (
        <Button type="button" variant="outline" onClick={() => setMostrandoForm(true)} className="self-start">
          + Adicionar opção alternativa
        </Button>
      )}

      {podeAdicionar && mostrandoForm && (
        <AdicionarOpcaoForm
          orcamentoId={orcamentoId}
          itens={itensVendaveis}
          acabamentosDisponiveis={acabamentosDisponiveis}
          papeisDisponiveis={papeisDisponiveis}
          unidadePadrao={unidadePadrao}
          sugestaoNome={proximaSugestaoNome}
          aoCancelar={() => setMostrandoForm(false)}
        />
      )}
    </div>
  );
}
