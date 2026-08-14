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

// Espelha o prefixo que actions.ts (formatarMensagemErroNfe) grava em
// mensagemErro quando a SEFAZ denega a nota — diferente de uma rejeição por
// dados inválidos, denegação é bloqueio fiscal do destinatário e pode não
// sumir só corrigindo um campo. StatusNotaFiscal não tem um valor DENEGADO
// próprio (fica REJEITADA), então essa é a única forma de diferenciar aqui.
const PREFIXO_DENEGADO = "SEFAZ denegou:";

type NotaFiscalExistente = {
  status: string;
  chaveAcesso: string | null;
  xmlUrl: string | null;
  danfeUrl: string | null;
  mensagemErro: string | null;
};

export function NotaFiscalCard({
  orcamentoId,
  notaFiscal,
  pendencias,
}: {
  orcamentoId: string;
  notaFiscal: NotaFiscalExistente | null;
  pendencias: string[];
}) {
  const [estadoEmissao, emitirAction, emitindo] = useActionState(emitirNotaFiscal, null);
  const [estadoAtualizacao, atualizarAction, atualizando] = useActionState(
    atualizarStatusNotaFiscal,
    null
  );

  return (
    <Card className="mb-6 p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-medium text-slate-500">Nota fiscal</p>
        {notaFiscal && (
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${COR_STATUS[notaFiscal.status]}`}>
            {ROTULO_STATUS[notaFiscal.status]}
          </span>
        )}
      </div>

      {!notaFiscal ? (
        pendencias.length > 0 ? (
          <Alert variant="error">
            <span className="font-medium">Falta configurar antes de emitir:</span>
            <ul className="mt-1 list-disc pl-4">
              {pendencias.map((pendencia) => (
                <li key={pendencia}>{pendencia}</li>
              ))}
            </ul>
          </Alert>
        ) : (
          <form action={emitirAction}>
            <input type="hidden" name="orcamentoId" value={orcamentoId} />
            {estadoEmissao && !estadoEmissao.ok && (
              <Alert variant="error">{estadoEmissao.mensagem}</Alert>
            )}
            <Button type="submit" loading={emitindo} className="mt-2">
              {emitindo ? "Emitindo..." : "Emitir nota fiscal"}
            </Button>
          </form>
        )
      ) : (
        <div className="flex flex-col gap-3">
          {notaFiscal.chaveAcesso && (
            <p className="break-all text-xs text-slate-500">
              Chave de acesso: {notaFiscal.chaveAcesso}
            </p>
          )}
          {notaFiscal.mensagemErro && (
            <Alert variant={notaFiscal.status === "AUTORIZADA" ? "success" : "error"}>
              {notaFiscal.mensagemErro}
            </Alert>
          )}
          {notaFiscal.status === "REJEITADA" && notaFiscal.mensagemErro?.startsWith(PREFIXO_DENEGADO) && (
            <Alert variant="error">
              Essa nota foi <span className="font-medium">denegada pela SEFAZ</span>, não apenas
              rejeitada por dados inválidos — geralmente é um bloqueio fiscal do destinatário
              (ex.: CNPJ irregular). Pode ser necessário regularizar a situação do cliente antes
              de tentar emitir de novo.
            </Alert>
          )}
          {notaFiscal.status === "AUTORIZADA" && (notaFiscal.xmlUrl || notaFiscal.danfeUrl) && (
            <div className="flex gap-4 text-sm font-medium text-teal-700 dark:text-teal-400">
              {notaFiscal.danfeUrl && (
                <a href={notaFiscal.danfeUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
                  Baixar DANFE (PDF)
                </a>
              )}
              {notaFiscal.xmlUrl && (
                <a href={notaFiscal.xmlUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
                  Baixar XML
                </a>
              )}
            </div>
          )}
          {notaFiscal.status === "PROCESSANDO" && (
            <form action={atualizarAction}>
              <input type="hidden" name="orcamentoId" value={orcamentoId} />
              {estadoAtualizacao && !estadoAtualizacao.ok && (
                <Alert variant="error">{estadoAtualizacao.mensagem}</Alert>
              )}
              <Button type="submit" variant="outline" loading={atualizando} className="mt-1">
                {atualizando ? "Consultando..." : "Atualizar status"}
              </Button>
            </form>
          )}
          {notaFiscal.status === "REJEITADA" && (
            <form action={emitirAction}>
              <input type="hidden" name="orcamentoId" value={orcamentoId} />
              {estadoEmissao && !estadoEmissao.ok && (
                <Alert variant="error">{estadoEmissao.mensagem}</Alert>
              )}
              <Button type="submit" loading={emitindo} className="mt-1">
                {emitindo ? "Emitindo..." : "Tentar emitir de novo"}
              </Button>
            </form>
          )}
        </div>
      )}
    </Card>
  );
}
