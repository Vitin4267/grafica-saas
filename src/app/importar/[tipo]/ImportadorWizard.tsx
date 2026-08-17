"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { useAoMudar } from "@/lib/hooks/useAoMudar";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import type { CampoImportacao } from "@/lib/importacao/campos";
import type { TipoImportacaoPlanilha } from "@/generated/prisma/enums";
import { solicitarMapeamento, confirmarEImportar } from "../actions";

type Etapa = "upload" | "mapeamento" | "resultado";

// Dados da sugestão da IA que precisam sobreviver à transição pro passo 2 —
// useActionState(solicitarMapeamento) já É essa informação, mas o passo 2
// precisa poder EDITAR a seleção de campo por coluna (Select controlado),
// então guarda uma cópia local mutável em vez de renderizar direto a partir
// do estado da action (esse é read-only). Ver useAoMudar em
// src/lib/hooks/useAoMudar.ts.
type DadosMapeamento = {
  importacaoId: string;
  cabecalhos: string[];
  linhasAmostra: string[][];
  linhasTotal: number;
};

const ROTA_MODULO: Record<TipoImportacaoPlanilha, string> = {
  CLIENTES: "/clientes",
  CATALOGO: "/catalogo",
  PEDIDOS: "/orcamento",
};

const ROTULO_MODULO: Record<TipoImportacaoPlanilha, string> = {
  CLIENTES: "Ver clientes",
  CATALOGO: "Ver catálogo",
  PEDIDOS: "Ver orçamentos",
};

const ROTULO_CONFIANCA: Record<string, string> = {
  alta: "confiança alta",
  media: "confiança média",
  baixa: "confiança baixa",
};
const COR_CONFIANCA: Record<string, string> = {
  media: "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  baixa: "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
};

export function ImportadorWizard({ tipo, campos }: { tipo: TipoImportacaoPlanilha; campos: CampoImportacao[] }) {
  const [etapa, setEtapa] = useState<Etapa>("upload");
  const [dadosMapeamento, setDadosMapeamento] = useState<DadosMapeamento | null>(null);
  // Chave = índice da coluna (não o texto do cabeçalho — dois cabeçalhos
  // podem ter o mesmo texto, índice é sempre único).
  const [selecoes, setSelecoes] = useState<Record<number, string>>({});
  const [confiancas, setConfiancas] = useState<Record<number, string>>({});

  const [estadoMapeamento, actionMapeamento, isPendingMapeamento] = useActionState(solicitarMapeamento, null);
  const [estadoConfirmar, actionConfirmar, isPendingConfirmar] = useActionState(confirmarEImportar, null);

  // Ao chegar a sugestão da IA, copia pro estado local editável e avança pro
  // passo 2 — feito DURANTE a renderização (useAoMudar), não em useEffect
  // (ver comentário do hook).
  useAoMudar(estadoMapeamento, (estado) => {
    if (!estado?.ok) return;
    setDadosMapeamento({
      importacaoId: estado.importacaoId,
      cabecalhos: estado.cabecalhos,
      linhasAmostra: estado.linhasAmostra,
      linhasTotal: estado.linhasTotal,
    });
    const novasSelecoes: Record<number, string> = {};
    const novasConfiancas: Record<number, string> = {};
    for (const sugestao of estado.sugestoes) {
      novasSelecoes[sugestao.indice] = sugestao.campo;
      novasConfiancas[sugestao.indice] = sugestao.confianca;
    }
    setSelecoes(novasSelecoes);
    setConfiancas(novasConfiancas);
    setEtapa("mapeamento");
  });

  useAoMudar(estadoConfirmar, (estado) => {
    if (estado?.ok) setEtapa("resultado");
  });

  const camposObrigatorios = campos.filter((c) => c.obrigatorio);
  const valoresEscolhidos = new Set(Object.values(selecoes));
  const camposFaltando = camposObrigatorios.filter((c) => !valoresEscolhidos.has(c.valor));
  const podeConfirmar = camposFaltando.length === 0;

  return (
    <div className="flex flex-col gap-6">
      {etapa === "upload" && (
        <Card className="p-6">
          <form action={actionMapeamento} className="flex flex-col gap-4">
            <input type="hidden" name="tipo" value={tipo} />
            <Input label="Planilha (.xlsx ou .csv)" name="arquivo" type="file" accept=".xlsx,.csv" required />
            <p className="text-xs text-slate-500">Isso vai usar 1 das suas importações deste mês.</p>
            <Button type="submit" loading={isPendingMapeamento} className="w-fit">
              Enviar e sugerir mapeamento
            </Button>
            {isPendingMapeamento && (
              <p className="text-xs text-slate-500">Lendo a planilha e pedindo sugestão de mapeamento à IA…</p>
            )}
          </form>
          {estadoMapeamento && !estadoMapeamento.ok && (
            <div className="mt-4">
              <Alert variant="error">{estadoMapeamento.mensagem}</Alert>
            </div>
          )}
        </Card>
      )}

      {etapa === "mapeamento" && dadosMapeamento && (
        <Card className="flex flex-col gap-5 p-6">
          <div>
            <h2 className="font-semibold text-slate-900 dark:text-white">Confirme o mapeamento de colunas</h2>
            <p className="mt-1 text-sm text-slate-500">
              {dadosMapeamento.linhasTotal} {dadosMapeamento.linhasTotal === 1 ? "linha será processada" : "linhas serão processadas"}.
            </p>
          </div>

          <form action={actionConfirmar} className="flex flex-col gap-5">
            <input type="hidden" name="importacaoId" value={dadosMapeamento.importacaoId} />

            <div className="flex flex-col gap-4">
              {dadosMapeamento.cabecalhos.map((cabecalho, indice) => {
                const amostra = dadosMapeamento.linhasAmostra
                  .map((linha) => linha[indice])
                  .filter((valor): valor is string => Boolean(valor))
                  .slice(0, 5);
                const confianca = confiancas[indice];

                return (
                  <div key={indice} className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                    <input type="hidden" name="coluna" value={cabecalho} />
                    <input type="hidden" name="campo" value={selecoes[indice] ?? "ignorar"} />
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="min-w-[220px] flex-1">
                        <Select
                          label={cabecalho || `Coluna ${indice + 1}`}
                          id={`campo-${indice}`}
                          value={selecoes[indice] ?? "ignorar"}
                          onChange={(evento) =>
                            setSelecoes((anterior) => ({ ...anterior, [indice]: evento.target.value }))
                          }
                        >
                          {campos.map((campo) => (
                            <option key={campo.valor} value={campo.valor}>
                              {campo.rotulo}
                            </option>
                          ))}
                        </Select>
                      </div>
                      {confianca && confianca !== "alta" && (
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-medium ${COR_CONFIANCA[confianca] ?? ""}`}
                        >
                          {ROTULO_CONFIANCA[confianca] ?? confianca}
                        </span>
                      )}
                    </div>
                    <p className="mt-2 truncate text-xs text-slate-500">
                      {amostra.length > 0 ? `Exemplos: ${amostra.join(" · ")}` : "Sem exemplos nesta coluna."}
                    </p>
                  </div>
                );
              })}
            </div>

            {!podeConfirmar && (
              <Alert variant="warning">
                Mapeie pelo menos uma coluna para: {camposFaltando.map((c) => c.rotulo).join(", ")}.
              </Alert>
            )}
            {estadoConfirmar && !estadoConfirmar.ok && <Alert variant="error">{estadoConfirmar.mensagem}</Alert>}

            <div className="flex items-center gap-3">
              <Button type="submit" loading={isPendingConfirmar} disabled={!podeConfirmar}>
                Confirmar e importar
              </Button>
              <Button type="button" variant="ghost" onClick={() => setEtapa("upload")}>
                Cancelar
              </Button>
            </div>
          </form>
        </Card>
      )}

      {etapa === "resultado" && estadoConfirmar?.ok && (
        <Card className="flex flex-col gap-4 p-6">
          <Alert variant="success">{estadoConfirmar.linhasImportadas} registros importados.</Alert>

          {estadoConfirmar.linhasComErro > 0 && (
            <>
              <Alert variant="warning">
                {estadoConfirmar.linhasComErro}{" "}
                {estadoConfirmar.linhasComErro === 1 ? "linha não pôde ser importada" : "linhas não puderam ser importadas"}.
              </Alert>
              <details className="text-sm text-slate-600 dark:text-slate-300">
                <summary className="cursor-pointer font-medium">Ver detalhes dos erros</summary>
                <ul className="mt-2 flex flex-col gap-1 text-xs text-slate-500">
                  {estadoConfirmar.erros.map((erro, indice) => (
                    <li key={indice}>
                      Linha {erro.linha}: {erro.mensagem}
                    </li>
                  ))}
                </ul>
              </details>
            </>
          )}

          <div className="flex items-center gap-4">
            <Link href={ROTA_MODULO[tipo]} className="text-sm font-medium text-teal-700 hover:underline dark:text-teal-400">
              {ROTULO_MODULO[tipo]}
            </Link>
            <Link href="/importar" className="text-sm font-medium text-slate-600 hover:underline dark:text-slate-300">
              Nova importação
            </Link>
          </div>
        </Card>
      )}
    </div>
  );
}
