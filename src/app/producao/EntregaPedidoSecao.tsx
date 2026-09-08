"use client";

import { useActionState, useState } from "react";
import { formatoInstanteRealComHora } from "@/lib/data";
import { StatusBadge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { TRANSICOES_VALIDAS, ROTULOS_STATUS_ENTREGA, ROTULO_PROXIMA_ETAPA, type StatusEntrega } from "@/lib/entrega-status";
import { criarEntrega, avancarEntrega } from "./entrega-actions";

export type EntregaResumo = {
  id: string;
  status: StatusEntrega;
  motorista: string | null;
  // Achado D1 da auditoria de abrangência (Parte 4/Qualidade-pessoas) —
  // vínculo INFORMATIVO opcional com Colaborador (tipo=MOTORISTA), convive
  // com `motorista` acima (snapshot em texto, o que de fato é lido em
  // qualquer tela) — mesmo padrão de contatoClienteId/transportadoraId. Só
  // usado aqui pra pré-selecionar o <select> abaixo ao reabrir o form.
  motoristaColaboradorId: string | null;
  dataSaida: string | null; // ISO
  dataEntrega: string | null; // ISO
  observacoes: string | null;
};

// Achado D1 — Colaborador ATIVO tipo=MOTORISTA, pra popular o <select>
// opcional abaixo (ver comentário completo em producao/page.tsx).
export type ColaboradorMotoristaOpcao = { id: string; nome: string };

// Formulário de avanço/desvio — só renderizado quando existe entrega e ela
// não está em status terminal (ENTREGUE). Mesma separação de
// AcoesSolicitacaoForm.tsx (src/app/compras/[id]/AcoesSolicitacaoForm.tsx):
// caminho "normal" (select + botão) e caminho lateral (PROBLEMA) como um
// formulário próprio, nunca escondido dentro do mesmo select — um desvio
// pra PROBLEMA é uma ação bem diferente de avançar a etapa.
function FormularioAvancoEntrega({
  entrega,
  colaboradoresMotoristas,
}: {
  entrega: EntregaResumo;
  colaboradoresMotoristas: ColaboradorMotoristaOpcao[];
}) {
  const [state, formAction, pending] = useActionState(avancarEntrega, null);
  const [stateProblema, formActionProblema, pendingProblema] = useActionState(avancarEntrega, null);

  const proximosStatus = TRANSICOES_VALIDAS[entrega.status].filter((s) => s !== "PROBLEMA");
  const podeMarcarProblema = TRANSICOES_VALIDAS[entrega.status].includes("PROBLEMA");
  const [proximoStatus, setProximoStatus] = useState<StatusEntrega | null>(proximosStatus[0] ?? null);
  const [observacaoProblema, setObservacaoProblema] = useState("");
  // Achado D1 — mesmo padrão de aoEscolherTransportadora em
  // EditarDadosGeraisOrcamentoForm.tsx: escolher no <select> só PRÉ-PREENCHE
  // o texto livre abaixo, que continua editável e é o que de fato é gravado.
  const [motorista, setMotorista] = useState(entrega.motorista ?? "");
  const [motoristaColaboradorId, setMotoristaColaboradorId] = useState(
    entrega.motoristaColaboradorId ?? ""
  );

  function aoEscolherColaborador(id: string) {
    setMotoristaColaboradorId(id);
    const colaborador = colaboradoresMotoristas.find((c) => c.id === id);
    if (colaborador) {
      setMotorista(colaborador.nome);
    }
  }

  const mostraMotorista = proximoStatus === "EM_TRANSITO";

  return (
    <div className="flex flex-col gap-4">
      {proximoStatus && (
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="entregaId" value={entrega.id} />

          {proximosStatus.length > 1 ? (
            <Select
              label="Mudar para"
              name="proximoStatus"
              value={proximoStatus}
              onChange={(e) => setProximoStatus(e.target.value as StatusEntrega)}
            >
              {proximosStatus.map((status) => (
                <option key={status} value={status}>
                  {ROTULOS_STATUS_ENTREGA[status]}
                </option>
              ))}
            </Select>
          ) : (
            <input type="hidden" name="proximoStatus" value={proximoStatus} />
          )}

          {mostraMotorista && (
            <>
              {colaboradoresMotoristas.length > 0 && (
                <Select
                  label="Motorista cadastrado"
                  name="motoristaColaboradorId"
                  value={motoristaColaboradorId}
                  onChange={(e) => aoEscolherColaborador(e.target.value)}
                  hint="Escolher preenche o campo abaixo — que continua editável"
                >
                  <option value="">digitar manualmente</option>
                  {colaboradoresMotoristas.map((colaborador) => (
                    <option key={colaborador.id} value={colaborador.id}>
                      {colaborador.nome}
                    </option>
                  ))}
                </Select>
              )}
              <Input
                label="Motorista (opcional)"
                name="motorista"
                maxLength={120}
                value={motorista}
                onChange={(e) => setMotorista(e.target.value)}
                placeholder="Nome de quem vai levar"
              />
            </>
          )}

          {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}

          <Button type="submit" variant="outline" loading={pending} className="self-start">
            {pending
              ? "Salvando..."
              : (ROTULO_PROXIMA_ETAPA[entrega.status] ?? `Marcar como ${ROTULOS_STATUS_ENTREGA[proximoStatus]}`)}
          </Button>
        </form>
      )}

      {podeMarcarProblema && (
        <form
          action={formActionProblema}
          className="flex flex-col gap-2 border-t border-slate-100 pt-3 dark:border-slate-800"
        >
          <input type="hidden" name="entregaId" value={entrega.id} />
          <input type="hidden" name="proximoStatus" value="PROBLEMA" />
          <Textarea
            label="Reportar problema"
            name="observacoes"
            placeholder="Ex: cliente ausente, endereço incorreto, atraso do motorista..."
            value={observacaoProblema}
            onChange={(e) => setObservacaoProblema(e.target.value)}
            maxLength={500}
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

// Seção de entrega estruturada de um pedido — status próprio (AGUARDANDO →
// EM_TRANSITO → ENTREGUE, mais o desvio lateral PROBLEMA), substituindo o
// texto livre de Orcamento.frete/transportadora/localEntrega por algo com
// histórico e auditoria. Fica dentro de um <details> (mesmo padrão de
// CustosPedidoSecao.tsx) e só é renderizada pelo pai (PedidoLinha.tsx)
// quando o pedido já saiu da pré-produção (ARTE/CLICHE_FACA, ver
// ESTAGIOS_PRE_PRODUCAO em src/lib/producao-estagios.ts) — antes disso não
// há nada físico ainda pra sair pra entrega.
export function EntregaPedidoSecao({
  pedidoId,
  entrega,
  podeEditar,
  colaboradoresMotoristas,
}: {
  pedidoId: string;
  entrega: EntregaResumo | null;
  podeEditar: boolean;
  // Achado D1 da auditoria de abrangência (Parte 4/Qualidade-pessoas) —
  // Colaboradores ATIVOS tipo=MOTORISTA da gráfica (grafica-wide, buscados
  // uma vez em producao/page.tsx). [] é o comportamento de sempre: o
  // <select> opcional simplesmente não aparece, só o texto livre de sempre.
  colaboradoresMotoristas: ColaboradorMotoristaOpcao[];
}) {
  const [state, formAction, isPending] = useActionState(criarEntrega, null);
  const [motoristaCriacao, setMotoristaCriacao] = useState("");
  const [motoristaColaboradorIdCriacao, setMotoristaColaboradorIdCriacao] = useState("");

  function aoEscolherColaboradorCriacao(id: string) {
    setMotoristaColaboradorIdCriacao(id);
    const colaborador = colaboradoresMotoristas.find((c) => c.id === id);
    if (colaborador) {
      setMotoristaCriacao(colaborador.nome);
    }
  }

  return (
    <details className="group rounded-xl border border-slate-200 dark:border-slate-800">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-2.5 text-sm font-medium text-slate-600 marker:content-none hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/50">
        <span>Entrega</span>
        {entrega && <StatusBadge status={entrega.status} tipo="entrega" />}
      </summary>

      <div className="flex flex-col gap-4 border-t border-slate-100 p-4 dark:border-slate-800">
        {entrega ? (
          <>
            <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium text-slate-500">Motorista</p>
                <p className="mt-0.5 text-slate-900 dark:text-white">{entrega.motorista ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Saída</p>
                <p className="mt-0.5 text-slate-900 dark:text-white">
                  {entrega.dataSaida ? formatoInstanteRealComHora.format(new Date(entrega.dataSaida)) : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Entrega</p>
                <p className="mt-0.5 text-slate-900 dark:text-white">
                  {entrega.dataEntrega ? formatoInstanteRealComHora.format(new Date(entrega.dataEntrega)) : "—"}
                </p>
              </div>
              {entrega.observacoes && (
                <div className="sm:col-span-2">
                  <p className="text-xs font-medium text-slate-500">Observações</p>
                  <p className="mt-0.5 whitespace-pre-wrap text-slate-900 dark:text-white">{entrega.observacoes}</p>
                </div>
              )}
            </div>

            {/* key={entrega.status}: força remount a cada mudança de status —
                sem isso, o useState de proximoStatus dentro do formulário
                (inicializado só na primeira montagem) ficava com o valor do
                status ANTERIOR depois de uma transição bem-sucedida (ex:
                depois de AGUARDANDO→EM_TRANSITO, o próximo submit ainda
                mandava "EM_TRANSITO" em vez de "ENTREGUE", porque só o
                texto do botão usava entrega.status direto — o campo hidden
                usava o state velho). Bug real encontrado testando na mão. */}
            {podeEditar && entrega.status !== "ENTREGUE" && (
              <FormularioAvancoEntrega
                key={entrega.status}
                entrega={entrega}
                colaboradoresMotoristas={colaboradoresMotoristas}
              />
            )}
            {entrega.status === "ENTREGUE" && (
              <p className="text-xs text-slate-500">Entregue — nenhuma ação disponível.</p>
            )}
          </>
        ) : podeEditar ? (
          <form action={formAction} className="flex flex-col gap-3">
            <input type="hidden" name="pedidoId" value={pedidoId} />
            {colaboradoresMotoristas.length > 0 && (
              <Select
                label="Motorista cadastrado"
                name="motoristaColaboradorId"
                value={motoristaColaboradorIdCriacao}
                onChange={(e) => aoEscolherColaboradorCriacao(e.target.value)}
                hint="Escolher preenche o campo abaixo — que continua editável"
              >
                <option value="">digitar manualmente</option>
                {colaboradoresMotoristas.map((colaborador) => (
                  <option key={colaborador.id} value={colaborador.id}>
                    {colaborador.nome}
                  </option>
                ))}
              </Select>
            )}
            <Input
              label="Motorista (opcional)"
              name="motorista"
              maxLength={120}
              value={motoristaCriacao}
              onChange={(e) => setMotoristaCriacao(e.target.value)}
              placeholder="Nome de quem vai levar"
            />
            {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}
            <Button type="submit" variant="outline" loading={isPending} className="self-start">
              {isPending ? "Criando..." : "Registrar entrega"}
            </Button>
          </form>
        ) : (
          <p className="text-xs text-slate-500">Nenhuma entrega registrada ainda.</p>
        )}
      </div>
    </details>
  );
}
