"use client";

import { useActionState, useState } from "react";
import { formatoInstanteRealComHora, dataParaInputValue } from "@/lib/data";
import { formatoMoeda } from "@/lib/moeda";
import { StatusBadge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import {
  TRANSICOES_VALIDAS,
  ROTULOS_SITUACAO_TERCEIRIZACAO,
  ROTULO_PROXIMA_ETAPA,
  type SituacaoTerceirizacao,
} from "@/lib/terceirizacao-status";
import { criarTerceirizacao, avancarTerceirizacao } from "./terceirizacao-actions";
import { emitirNfeRemessaTerceirizacao } from "./terceirizacao-nfe-actions";

export type FornecedorOpcao = { id: string; nome: string };

// Achado R3 da auditoria de abrangência (rodada 20, 2026-09-03) — resultado
// estruturado da emissão da NF-e de remessa (ver EtapaTerceirizada.remessaNfe*
// no schema). null = nunca emitida por aqui (notaRemessa em texto livre
// continua sendo o único registro, se houver).
export type RemessaNfeResumo = {
  status: string; // StatusNotaFiscal
  numero: string | null;
  chaveAcesso: string | null;
  xmlUrl: string | null;
  danfeUrl: string | null;
  mensagemErro: string | null;
};

export type TerceirizacaoResumo = {
  id: string;
  situacao: SituacaoTerceirizacao;
  fornecedorId: string | null;
  fornecedorNome: string; // resolvido no servidor: Fornecedor.nome ?? EtapaTerceirizada.fornecedorNome
  enviadoEm: string | null; // ISO
  previsaoRetorno: string | null; // "AAAA-MM-DD"
  retornadoEm: string | null; // ISO
  valorAcordado: number | null;
  valorFinal: number | null;
  notaRemessa: string | null;
  notaRetorno: string | null;
  observacao: string | null;
  // Achado R3 — fornecedor CADASTRADO (fornecedorId setado) com CNPJ/CPF e
  // endereço completos (ver fornecedorProntoParaNfe em src/lib/nota-fiscal.ts)
  // — gate fino do botão "Emitir NF-e de remessa", resolvido no servidor.
  fornecedorProntoParaNfe: boolean;
  remessaNfe: RemessaNfeResumo | null;
};

const ROTULO_STATUS_NFE: Record<string, string> = {
  PROCESSANDO: "Processando",
  AUTORIZADA: "Autorizada",
  REJEITADA: "Rejeitada",
  CANCELADA: "Cancelada",
  ERRO: "Erro",
};

const COR_STATUS_NFE: Record<string, string> = {
  PROCESSANDO: "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  AUTORIZADA: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  REJEITADA: "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
  CANCELADA: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
  ERRO: "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
};

// Formulário de emissão da NF-e de remessa (achado R3) — só aparece quando
// focusNfeConfigurado (gate coarse, grafica-level) e fornecedorProntoParaNfe
// (fornecedor cadastrado com CNPJ/CPF + endereço completos). A checagem FINA
// (dados fiscais da gráfica/filial completos) roda dentro da própria Server
// Action — aqui só evita mostrar o formulário pra quem claramente não pode
// usá-lo ainda.
function FormularioEmissaoNfeRemessa({ etapa }: { etapa: TerceirizacaoResumo }) {
  const [state, formAction, pending] = useActionState(emitirNfeRemessaTerceirizacao, null);

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <input type="hidden" name="etapaId" value={etapa.id} />
      <p className="text-xs font-medium text-slate-500">Emitir NF-e de remessa (CFOP 5901/6901)</p>
      <Input
        label="O que está sendo enviado"
        name="descricao"
        placeholder="Ex: Chapas de papel cartão pra laminação"
        maxLength={200}
        required
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input label="NCM" name="ncm" placeholder="Ex: 48109000" required />
        <Input
          label="Valor da mercadoria enviada"
          name="valor"
          type="number"
          step="0.01"
          min="0.01"
          defaultValue={etapa.valorAcordado !== null ? String(etapa.valorAcordado) : undefined}
          required
        />
      </div>
      <Input
        label="Situação tributária do ICMS (CST ou CSOSN)"
        name="icmsSituacaoTributaria"
        placeholder="Ex: 51 (diferimento) ou 400 (não tributada) — consulte seu contador"
        required
      />
      {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}
      <Button type="submit" variant="outline" loading={pending} className="self-start">
        {pending ? "Emitindo..." : "Emitir NF-e de remessa"}
      </Button>
    </form>
  );
}

// Mostra o resultado da emissão estruturada (achado R3) quando existe, com
// link pra DANFE/XML depois de autorizada, e opção de tentar de novo quando
// rejeitada/erro. Mesmo padrão visual de NotaFiscalCard.tsx.
function RemessaNfeStatus({
  etapa,
  podeEditar,
  focusNfeConfigurado,
}: {
  etapa: TerceirizacaoResumo;
  podeEditar: boolean;
  focusNfeConfigurado: boolean;
}) {
  const remessaNfe = etapa.remessaNfe;

  if (remessaNfe) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-medium text-slate-500">NF-e de remessa</p>
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${COR_STATUS_NFE[remessaNfe.status]}`}>
            {ROTULO_STATUS_NFE[remessaNfe.status] ?? remessaNfe.status}
          </span>
        </div>
        {remessaNfe.chaveAcesso && (
          <p className="break-all text-xs text-slate-500">Chave de acesso: {remessaNfe.chaveAcesso}</p>
        )}
        {remessaNfe.mensagemErro && (
          <Alert variant={remessaNfe.status === "AUTORIZADA" ? "success" : "error"}>{remessaNfe.mensagemErro}</Alert>
        )}
        {remessaNfe.status === "AUTORIZADA" && (remessaNfe.xmlUrl || remessaNfe.danfeUrl) && (
          <div className="flex gap-4 text-sm font-medium text-teal-700 dark:text-teal-400">
            {remessaNfe.danfeUrl && (
              <a href={remessaNfe.danfeUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
                Baixar DANFE (PDF)
              </a>
            )}
            {remessaNfe.xmlUrl && (
              <a href={remessaNfe.xmlUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
                Baixar XML
              </a>
            )}
          </div>
        )}
        {podeEditar && (remessaNfe.status === "REJEITADA" || remessaNfe.status === "ERRO") && (
          <FormularioEmissaoNfeRemessa etapa={etapa} />
        )}
      </div>
    );
  }

  if (!podeEditar) return null;
  if (!focusNfeConfigurado) return null;
  if (!etapa.fornecedorProntoParaNfe) {
    return (
      <p className="text-xs text-slate-500">
        {etapa.fornecedorId
          ? "Cadastre CNPJ/CPF e endereço completos deste fornecedor em Configurações → Fornecedores pra habilitar a emissão automática de NF-e de remessa."
          : "Emissão automática de NF-e de remessa só está disponível pra fornecedor cadastrado, não pra nome digitado."}
      </p>
    );
  }
  return <FormularioEmissaoNfeRemessa etapa={etapa} />;
}

// Achado E1 da auditoria de abrangência (Parte 2/Produção, 2026-09-01) — nada
// no schema modelava um pedido que sai fisicamente da gráfica pra uma
// operação terceirizada (laminação, UV, acabamento de livro etc.) e volta
// depois. Diferente de EntregaPedidoSecao (1:1 com o pedido), um pedido pode
// ter VÁRIAS terceirizações ao longo da produção (ex: capa laminada fora e,
// depois, acabamento de livro também fora) — por isso esta seção sempre
// mostra "Registrar nova terceirização", nunca esconde atrás de "já existe
// uma".

function FormularioAvancoTerceirizacao({ etapa }: { etapa: TerceirizacaoResumo }) {
  const [state, formAction, pending] = useActionState(avancarTerceirizacao, null);
  const [stateProblema, formActionProblema, pendingProblema] = useActionState(avancarTerceirizacao, null);

  const proximasSituacoes = TRANSICOES_VALIDAS[etapa.situacao].filter((s) => s !== "PROBLEMA");
  const podeMarcarProblema = TRANSICOES_VALIDAS[etapa.situacao].includes("PROBLEMA");
  const [proximaSituacao, setProximaSituacao] = useState<SituacaoTerceirizacao | null>(proximasSituacoes[0] ?? null);
  const [observacaoProblema, setObservacaoProblema] = useState("");

  const mostraPrevisaoRetorno = proximaSituacao === "ENVIADO";
  const mostraRetorno = proximaSituacao === "RETORNADO";

  return (
    <div className="flex flex-col gap-4">
      {proximaSituacao && (
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="etapaId" value={etapa.id} />

          {proximasSituacoes.length > 1 ? (
            <Select
              label="Mudar para"
              name="proximaSituacao"
              value={proximaSituacao}
              onChange={(e) => setProximaSituacao(e.target.value as SituacaoTerceirizacao)}
            >
              {proximasSituacoes.map((situacao) => (
                <option key={situacao} value={situacao}>
                  {ROTULOS_SITUACAO_TERCEIRIZACAO[situacao]}
                </option>
              ))}
            </Select>
          ) : (
            <input type="hidden" name="proximaSituacao" value={proximaSituacao} />
          )}

          {mostraPrevisaoRetorno && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input
                label="Previsão de retorno (opcional)"
                name="previsaoRetorno"
                type="date"
                defaultValue={etapa.previsaoRetorno ?? ""}
              />
              <Input label="Nº nota de remessa (opcional)" name="notaRemessa" defaultValue={etapa.notaRemessa ?? ""} />
            </div>
          )}

          {mostraRetorno && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input
                label="Valor final pago (opcional)"
                name="valorFinal"
                type="number"
                step="0.01"
                min="0"
                placeholder={etapa.valorAcordado !== null ? String(etapa.valorAcordado) : undefined}
              />
              <Input label="Nº nota de retorno (opcional)" name="notaRetorno" defaultValue={etapa.notaRetorno ?? ""} />
            </div>
          )}

          {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}

          <Button type="submit" variant="outline" loading={pending} className="self-start">
            {pending
              ? "Salvando..."
              : (ROTULO_PROXIMA_ETAPA[etapa.situacao] ?? `Marcar como ${ROTULOS_SITUACAO_TERCEIRIZACAO[proximaSituacao]}`)}
          </Button>
        </form>
      )}

      {podeMarcarProblema && (
        <form
          action={formActionProblema}
          className="flex flex-col gap-2 border-t border-slate-100 pt-3 dark:border-slate-800"
        >
          <input type="hidden" name="etapaId" value={etapa.id} />
          <input type="hidden" name="proximaSituacao" value="PROBLEMA" />
          <Textarea
            label="Reportar problema"
            name="observacao"
            placeholder="Ex: terceiro atrasou, material voltou com defeito, fornecedor sumiu..."
            value={observacaoProblema}
            onChange={(e) => setObservacaoProblema(e.target.value)}
            maxLength={2000}
          />
          {stateProblema && !stateProblema.ok && <Alert variant="error">{stateProblema.mensagem}</Alert>}
          <Button
            type="submit"
            variant="ghost"
            loading={pendingProblema}
            disabled={!observacaoProblema.trim()}
            className="self-start !text-rose-600 hover:!bg-rose-50 dark:!text-rose-400 dark:hover:!bg-rose-950/50"
          >
            Reportar problema
          </Button>
        </form>
      )}
    </div>
  );
}

function LinhaTerceirizacao({
  etapa,
  podeEditar,
  focusNfeConfigurado,
}: {
  etapa: TerceirizacaoResumo;
  podeEditar: boolean;
  focusNfeConfigurado: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-slate-900 dark:text-white">{etapa.fornecedorNome}</p>
        <StatusBadge status={etapa.situacao} tipo="terceirizacao" />
      </div>
      <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium text-slate-500">Enviado em</p>
          <p className="mt-0.5 text-slate-900 dark:text-white">
            {etapa.enviadoEm ? formatoInstanteRealComHora.format(new Date(etapa.enviadoEm)) : "—"}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium text-slate-500">Previsão de retorno</p>
          <p className="mt-0.5 text-slate-900 dark:text-white">
            {etapa.previsaoRetorno
              ? new Date(`${etapa.previsaoRetorno}T00:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "UTC" })
              : "Sem previsão"}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium text-slate-500">Retornado em</p>
          <p className="mt-0.5 text-slate-900 dark:text-white">
            {etapa.retornadoEm ? formatoInstanteRealComHora.format(new Date(etapa.retornadoEm)) : "—"}
          </p>
        </div>
        {(etapa.valorAcordado !== null || etapa.valorFinal !== null) && (
          <div>
            <p className="text-xs font-medium text-slate-500">Valor</p>
            <p className="mt-0.5 text-slate-900 dark:text-white">
              {etapa.valorFinal !== null
                ? formatoMoeda.format(etapa.valorFinal)
                : etapa.valorAcordado !== null
                  ? `${formatoMoeda.format(etapa.valorAcordado)} (acordado)`
                  : "—"}
            </p>
          </div>
        )}
        {(etapa.notaRemessa || etapa.notaRetorno) && (
          <div>
            <p className="text-xs font-medium text-slate-500">Notas fiscais</p>
            <p className="mt-0.5 text-slate-900 dark:text-white">
              {etapa.notaRemessa && `Remessa: ${etapa.notaRemessa}`}
              {etapa.notaRemessa && etapa.notaRetorno && " · "}
              {etapa.notaRetorno && `Retorno: ${etapa.notaRetorno}`}
            </p>
          </div>
        )}
        {etapa.observacao && (
          <div className="sm:col-span-2">
            <p className="text-xs font-medium text-slate-500">Observação</p>
            <p className="mt-0.5 whitespace-pre-wrap text-slate-900 dark:text-white">{etapa.observacao}</p>
          </div>
        )}
      </div>

      {/* Achado R3 — emissão estruturada da NF-e de remessa. Continua
          disponível até RETORNADO (uma remessa pode ser emitida a
          qualquer momento antes do ciclo fechar), nunca depois. */}
      {etapa.situacao !== "RETORNADO" && (
        <RemessaNfeStatus etapa={etapa} podeEditar={podeEditar} focusNfeConfigurado={focusNfeConfigurado} />
      )}

      {/* key={etapa.situacao}: mesmo motivo de EntregaPedidoSecao.tsx — força
          remount do formulário a cada transição, senão o useState de
          proximaSituacao (inicializado só na primeira montagem) fica preso
          na situação anterior depois de um submit bem-sucedido. */}
      {podeEditar && etapa.situacao !== "RETORNADO" && (
        <FormularioAvancoTerceirizacao key={etapa.situacao} etapa={etapa} />
      )}
      {etapa.situacao === "RETORNADO" && (
        <p className="text-xs text-slate-500">Retornado — nenhuma ação disponível.</p>
      )}
    </div>
  );
}

// Select value "" = nenhum fornecedor cadastrado escolhido — mesmo sentinel
// que a action já trata como null (String(...).trim() || null), sem
// precisar de nenhuma tradução extra no submit.
function FormularioNovaTerceirizacao({ pedidoId, fornecedores }: { pedidoId: string; fornecedores: FornecedorOpcao[] }) {
  const [state, formAction, isPending] = useActionState(criarTerceirizacao, null);
  const [fornecedorId, setFornecedorId] = useState("");

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="pedidoId" value={pedidoId} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Select
          label="Fornecedor cadastrado (opcional)"
          name="fornecedorId"
          value={fornecedorId}
          onChange={(e) => setFornecedorId(e.target.value)}
        >
          <option value="">— Não cadastrado —</option>
          {fornecedores.map((fornecedor) => (
            <option key={fornecedor.id} value={fornecedor.id}>
              {fornecedor.nome}
            </option>
          ))}
        </Select>
        {fornecedorId === "" && (
          <Input label="Nome do terceiro" name="fornecedorNome" maxLength={160} placeholder="Ex: Laminações Fulano" />
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Input label="Previsão de retorno (opcional)" name="previsaoRetorno" type="date" defaultValue={dataParaInputValue(new Date())} />
        <Input label="Valor acordado (opcional)" name="valorAcordado" type="number" step="0.01" min="0" />
        <Input label="Nº nota de remessa (opcional)" name="notaRemessa" />
      </div>
      <Textarea label="Observação (opcional)" name="observacao" maxLength={2000} />
      {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}
      <Button type="submit" variant="outline" loading={isPending} className="self-start">
        {isPending ? "Registrando..." : "Registrar terceirização"}
      </Button>
    </form>
  );
}

export function TerceirizacaoPedidoSecao({
  pedidoId,
  terceirizacoes,
  fornecedores,
  podeEditar,
  focusNfeConfigurado,
}: {
  pedidoId: string;
  terceirizacoes: TerceirizacaoResumo[];
  fornecedores: FornecedorOpcao[];
  podeEditar: boolean;
  // Achado R3 — token da Focus NFe configurado (ver comentário em
  // PedidoLinha.tsx).
  focusNfeConfigurado: boolean;
}) {
  const ativa = terceirizacoes.find((t) => t.situacao === "ENVIADO");

  return (
    <details className="group rounded-xl border border-slate-200 dark:border-slate-800">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-2.5 text-sm font-medium text-slate-600 marker:content-none hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/50">
        <span>Terceirização{terceirizacoes.length > 0 && ` (${terceirizacoes.length})`}</span>
        {ativa && (
          <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
            No terceiro
            {ativa.previsaoRetorno
              ? ` — retorna ${new Date(`${ativa.previsaoRetorno}T00:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "UTC", day: "2-digit", month: "2-digit" })}`
              : " — sem previsão"}
          </span>
        )}
      </summary>

      <div className="flex flex-col gap-4 border-t border-slate-100 p-4 dark:border-slate-800">
        {terceirizacoes.length > 0 && (
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {terceirizacoes.map((etapa) => (
              <LinhaTerceirizacao
                key={etapa.id}
                etapa={etapa}
                podeEditar={podeEditar}
                focusNfeConfigurado={focusNfeConfigurado}
              />
            ))}
          </div>
        )}

        {podeEditar ? (
          <FormularioNovaTerceirizacao pedidoId={pedidoId} fornecedores={fornecedores} />
        ) : (
          terceirizacoes.length === 0 && <p className="text-xs text-slate-500">Nenhuma terceirização registrada ainda.</p>
        )}
      </div>
    </details>
  );
}
