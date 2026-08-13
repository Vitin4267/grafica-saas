"use client";

import { useActionState, useState, type ChangeEvent } from "react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { ProportionBar } from "@/components/ui/ProportionBar";
import { LockIcon } from "@/components/icons";
import { validarArquivoImagemTinta } from "@/lib/upload-validacao";
import { analisarTintaItem } from "./AnaliseTinta.actions";

export type AnaliseTintaDados = {
  imagemUrlAssinada: string;
  coberturaPercentual: number;
  coberturaCiano: number | null;
  coberturaMagenta: number | null;
  coberturaAmarelo: number | null;
  coberturaPreto: number | null;
  consumoMlPorPeca: number;
  consumoMlTotal: number;
  confianca: string;
  observacao: string | null;
  quantidadeSnapshot: number;
  larguraCmSnapshot: number | null;
  alturaCmSnapshot: number | null;
  criadoPorNome: string | null;
  createdAtIso: string;
};

const ROTULO_CONFIANCA: Record<string, string> = { ALTA: "Confiança: alta", MEDIA: "Confiança: média", BAIXA: "Confiança: baixa" };
const COR_CONFIANCA: Record<string, string> = {
  ALTA: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  MEDIA: "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  BAIXA: "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
};

function formatarMl(valor: number, casas: number): string {
  return valor.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

// Cartão de "Cálculo de gasto de tinta com IA" por item de orçamento —
// recurso de plano pago (ver src/lib/billing/recursos-pagos.ts), disponível
// enquanto o orçamento não estiver REJEITADO. Puramente informativo: não
// altera preço nem estoque (ver comentário do model OrcamentoItemTinta).
export function AnaliseTintaCard({
  orcamentoItemId,
  podeUsar,
  mensagemBloqueio,
  itemAtual,
  tinta,
}: {
  orcamentoItemId: string;
  podeUsar: boolean;
  mensagemBloqueio: string | null;
  itemAtual: { quantidade: number; larguraCm: number | null; alturaCm: number | null };
  tinta: AnaliseTintaDados | null;
}) {
  const [state, formAction, isPending] = useActionState(analisarTintaItem, null);
  const [mostrarUpload, setMostrarUpload] = useState(!tinta);
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);

  function handleArquivoChange(evento: ChangeEvent<HTMLInputElement>) {
    const arquivo = evento.target.files?.[0];
    if (!arquivo) {
      setErroArquivo(null);
      return;
    }
    const validacao = validarArquivoImagemTinta(arquivo);
    setErroArquivo(validacao.ok ? null : validacao.mensagem);
  }

  if (!podeUsar) {
    return (
      <Card className="flex flex-col gap-1.5 p-4">
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" disabled>
            <LockIcon className="h-4 w-4" />
            Calcular gasto de tinta com IA
          </Button>
        </div>
        <p className="text-xs text-slate-500">{mensagemBloqueio}</p>
      </Card>
    );
  }

  const desatualizada =
    tinta !== null &&
    (tinta.quantidadeSnapshot !== itemAtual.quantidade ||
      tinta.larguraCmSnapshot !== itemAtual.larguraCm ||
      tinta.alturaCmSnapshot !== itemAtual.alturaCm);

  const faixasCobertura = [
    { chave: "ciano", rotulo: "Ciano", quantidade: tinta?.coberturaCiano ?? 0, corClasse: "bg-cyan-500" },
    { chave: "magenta", rotulo: "Magenta", quantidade: tinta?.coberturaMagenta ?? 0, corClasse: "bg-pink-500" },
    { chave: "amarelo", rotulo: "Amarelo", quantidade: tinta?.coberturaAmarelo ?? 0, corClasse: "bg-yellow-400" },
    { chave: "preto", rotulo: "Preto", quantidade: tinta?.coberturaPreto ?? 0, corClasse: "bg-slate-700 dark:bg-slate-400" },
  ];

  return (
    <Card className="flex flex-col gap-3 p-4">
      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Gasto de tinta com IA</p>

      {tinta && !mostrarUpload ? (
        <div className="flex flex-col gap-4">
          {desatualizada && (
            <Alert variant="warning">
              Esta estimativa foi feita para {tinta.quantidadeSnapshot} peças
              {tinta.larguraCmSnapshot && tinta.alturaCmSnapshot
                ? ` de ${tinta.larguraCmSnapshot} × ${tinta.alturaCmSnapshot} cm`
                : ""}
              . O item mudou desde então — refaça a análise.
            </Alert>
          )}

          <div className="flex flex-wrap items-start gap-6">
            {/* eslint-disable-next-line @next/next/no-img-element -- URL assinada temporária (Vercel Blob privado), fora do domínio otimizável pelo next/image */}
            <img
              src={tinta.imagemUrlAssinada}
              alt="Arte analisada"
              className="h-20 w-20 rounded-lg border border-slate-200 object-cover dark:border-slate-800"
            />
            <div>
              <p className="text-2xl font-bold text-slate-900 dark:text-white">
                ≈ {formatarMl(tinta.consumoMlTotal, 2)} ml de tinta no total
              </p>
              <p className="text-xs text-slate-500">
                {formatarMl(tinta.consumoMlPorPeca, 4)} ml por peça · {tinta.quantidadeSnapshot} peças
              </p>
            </div>
          </div>

          <div className="max-w-xs">
            <p className="mb-1.5 text-xs font-medium text-slate-500">Cobertura por cor</p>
            <ProportionBar faixas={faixasCobertura} total={100} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${COR_CONFIANCA[tinta.confianca] ?? ""}`}>
              {ROTULO_CONFIANCA[tinta.confianca] ?? tinta.confianca}
            </span>
          </div>
          {tinta.observacao && <p className="text-sm text-slate-600 dark:text-slate-300">{tinta.observacao}</p>}

          <p className="text-xs text-slate-400">
            Analisado em {new Date(tinta.createdAtIso).toLocaleDateString("pt-BR")}
            {tinta.criadoPorNome ? ` por ${tinta.criadoPorNome}` : ""}
          </p>

          <Button type="button" variant="ghost" className="w-fit" onClick={() => setMostrarUpload(true)}>
            Refazer análise
          </Button>
        </div>
      ) : (
        <form action={formAction} className="flex flex-col gap-2">
          <input type="hidden" name="orcamentoItemId" value={orcamentoItemId} />
          <div className="flex flex-wrap items-end gap-2">
            <Input
              label="Imagem da arte (PNG, JPG ou WEBP, até 8MB)"
              name="arquivo"
              type="file"
              accept=".png,.jpg,.jpeg,.webp"
              required
              onChange={handleArquivoChange}
              className="max-w-xs"
            />
            <Button type="submit" variant="outline" loading={isPending} disabled={!!erroArquivo}>
              Calcular gasto de tinta com IA
            </Button>
            {tinta && (
              <Button type="button" variant="ghost" onClick={() => setMostrarUpload(false)}>
                Cancelar
              </Button>
            )}
          </div>
          {erroArquivo && <p className="text-xs text-rose-600">{erroArquivo}</p>}
          {isPending && <p className="text-xs text-slate-500">Analisando a arte… isso pode levar até 40 segundos.</p>}
        </form>
      )}

      {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}
      <p className="text-xs text-slate-400">Estimativa gerada por IA a partir da imagem. Confira antes de comprar tinta.</p>
    </Card>
  );
}
