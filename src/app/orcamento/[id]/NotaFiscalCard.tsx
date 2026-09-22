"use client";

import { useActionState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { emitirNotaFiscal, atualizarStatusNotaFiscal } from "./actions";

const ROTULO_STATUS: Record<string, string> = {
  PROCESSANDO: "Processando",
  AUTORIZADA: "Autorizada",
  REJEITADA: "Rejeitada",
  CANCELADA: "Cancelada",
  ERRO: "Erro",
};

const COR_STATUS: Record<string, string> = {
  PROCESSANDO: "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  AUTORIZADA: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  REJEITADA: "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
  CANCELADA: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
  ERRO: "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
};

// Espelha o prefixo que actions/nfe.ts (formatarMensagemErroNfe) grava em
// mensagemErro quando a SEFAZ denega a nota — diferente de uma rejeição por
// dados inválidos, denegação é bloqueio fiscal do destinatário e pode não
// sumir só corrigindo um campo. StatusNotaFiscal não tem um valor DENEGADO
// próprio (fica REJEITADA), então essa é a única forma de diferenciar aqui.
const PREFIXO_DENEGADO = "SEFAZ denegou:";

type NotaFiscalExistente = {
  id: string;
  status: string;
  chaveAcesso: string | null;
  xmlUrl: string | null;
  danfeUrl: string | null;
  mensagemErro: string | null;
};

// Feature de nota fiscal PARCIAL (2026-09-22) — um item do orçamento com o
// restante já calculado no servidor (quantidadeRestanteParaFaturar, ver
// page.tsx), pronto pra virar uma linha do formulário de emissão.
type ItemParaFaturar = {
  id: string;
  nome: string;
  quantidadeTotal: number;
  restante: number;
};

function CardNotaExistente({ nota }: { nota: NotaFiscalExistente }) {
  const [estadoAtualizacao, atualizarAction, atualizando] = useActionState(
    atualizarStatusNotaFiscal,
    null
  );

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <div className="flex items-center justify-between">
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${COR_STATUS[nota.status]}`}>
          {ROTULO_STATUS[nota.status]}
        </span>
      </div>
      {nota.chaveAcesso && (
        <p className="break-all text-xs text-slate-500">Chave de acesso: {nota.chaveAcesso}</p>
      )}
      {nota.mensagemErro && (
        <Alert variant={nota.status === "AUTORIZADA" ? "success" : "error"}>{nota.mensagemErro}</Alert>
      )}
      {nota.status === "REJEITADA" && nota.mensagemErro?.startsWith(PREFIXO_DENEGADO) && (
        <Alert variant="error">
          Essa nota foi <span className="font-medium">denegada pela SEFAZ</span>, não apenas rejeitada
          por dados inválidos — geralmente é um bloqueio fiscal do destinatário (ex.: CNPJ irregular).
          Pode ser necessário regularizar a situação do cliente antes de emitir de novo.
        </Alert>
      )}
      {nota.status === "AUTORIZADA" && (nota.xmlUrl || nota.danfeUrl) && (
        <div className="flex gap-4 text-sm font-medium text-teal-700 dark:text-teal-400">
          {nota.danfeUrl && (
            <a href={nota.danfeUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
              Baixar DANFE (PDF)
            </a>
          )}
          {nota.xmlUrl && (
            <a href={nota.xmlUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
              Baixar XML
            </a>
          )}
        </div>
      )}
      {nota.status === "PROCESSANDO" && (
        <form action={atualizarAction}>
          <input type="hidden" name="notaFiscalId" value={nota.id} />
          {estadoAtualizacao && !estadoAtualizacao.ok && <Alert variant="error">{estadoAtualizacao.mensagem}</Alert>}
          <Button type="submit" variant="outline" loading={atualizando} className="mt-1">
            {atualizando ? "Consultando..." : "Atualizar status"}
          </Button>
        </form>
      )}
    </div>
  );
}

export function NotaFiscalCard({
  orcamentoId,
  notasFiscais,
  itens,
  pendencias,
}: {
  orcamentoId: string;
  notasFiscais: NotaFiscalExistente[];
  itens: ItemParaFaturar[];
  pendencias: string[];
}) {
  const [estadoEmissao, emitirAction, emitindo] = useActionState(emitirNotaFiscal, null);
  const itensComRestante = itens.filter((item) => item.restante > 0);

  return (
    <Card className="mb-6 p-5">
      <p className="mb-3 text-sm font-medium text-slate-500">Nota fiscal</p>

      {notasFiscais.length > 0 && (
        <div className="mb-4 flex flex-col gap-3">
          {notasFiscais.map((nota) => (
            <CardNotaExistente key={nota.id} nota={nota} />
          ))}
        </div>
      )}

      {itensComRestante.length === 0 ? (
        notasFiscais.length === 0 && (
          <p className="text-sm text-slate-500">Nenhum item pra faturar.</p>
        )
      ) : pendencias.length > 0 ? (
        <Alert variant="error">
          <span className="font-medium">Falta configurar antes de emitir:</span>
          <ul className="mt-1 list-disc pl-4">
            {pendencias.map((pendencia) => (
              <li key={pendencia}>{pendencia}</li>
            ))}
          </ul>
        </Alert>
      ) : (
        <form action={emitirAction} className="flex flex-col gap-3">
          <input type="hidden" name="orcamentoId" value={orcamentoId} />
          <p className="text-xs text-slate-500">
            {notasFiscais.length > 0
              ? "Ainda falta faturar parte deste orçamento — escolha a quantidade de cada item pra incluir nesta nota."
              : "Escolha a quantidade de cada item pra incluir nesta nota (pré-preenchida com o total, edite pra emitir uma nota parcial)."}
          </p>
          <div className="flex flex-col gap-2">
            {itensComRestante.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 text-sm">
                <label htmlFor={`quantidade_${item.id}`} className="min-w-0 flex-1 truncate" title={item.nome}>
                  {item.nome}
                  <span className="ml-1 text-xs text-slate-500">
                    (restam {item.restante} de {item.quantidadeTotal})
                  </span>
                </label>
                <input
                  id={`quantidade_${item.id}`}
                  name={`quantidade_${item.id}`}
                  type="number"
                  min={0}
                  max={item.restante}
                  step="any"
                  defaultValue={item.restante}
                  className="w-24 rounded-md border border-slate-300 px-2 py-1 text-right text-sm dark:border-slate-600 dark:bg-slate-800"
                />
              </div>
            ))}
          </div>
          {estadoEmissao && !estadoEmissao.ok && <Alert variant="error">{estadoEmissao.mensagem}</Alert>}
          <Button type="submit" loading={emitindo} className="mt-1">
            {emitindo ? "Emitindo..." : "Emitir nota fiscal"}
          </Button>
        </form>
      )}
    </Card>
  );
}
