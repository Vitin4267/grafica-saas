"use client";

import { useActionState, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { CampoAjuda } from "@/components/ui/CampoAjuda";
import { avancarSolicitacaoCompra } from "../actions";
import { ROTULOS_STATUS_SOLICITACAO_COMPRA, type StatusSolicitacaoCompra } from "@/lib/compras-status";

const formatoQuantidade = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4 });

// Campos contextuais: só aparecem quando fazem sentido pro próximo status
// escolhido (ver DadosTransicaoCompra em ../status-transicao.ts) — um
// campo que não aparece no DOM não entra na FormData, e a action trata
// isso como "não mexer" nesse campo.
//
// fornecedor: escondido quando vem de COTANDO→APROVADO — nesse caso o
// fornecedor é decidido pela cotação vencedora marcada no card de Cotações
// acima (ver avancarStatusCompra em ../status-transicao.ts, achado A4 da
// auditoria de abrangência), não faz mais sentido escolher de novo aqui.
// SOLICITADO→APROVADO direto (pulando cotação) continua mostrando o campo
// normalmente, do jeito que sempre funcionou.
function camposContextuais(status: StatusSolicitacaoCompra, statusAtual: StatusSolicitacaoCompra) {
  return {
    fornecedor: status === "APROVADO" && statusAtual !== "COTANDO",
    valorFinal: status === "COMPRADO",
    // Achado A2 da auditoria de abrangência (Parte 3/Compras, 2026-09-06) —
    // mesmo passo do formulário que já pede valorFinal (a nota fiscal de
    // compra costuma chegar com frete/IPI/desconto discriminados).
    custoAquisicao: status === "COMPRADO",
    documento: status === "COMPRADO" || status === "RECEBIDO",
    // Achado A7 da auditoria de abrangência (Parte 3/Compras, 2026-09-07) —
    // proximoStatus é sempre "RECEBIDO" (tanto vindo de COMPRADO quanto
    // reabrindo a partir de RECEBIDO_PARCIAL, ver ROTULO_PROXIMA_ETAPA em
    // src/lib/compras-status.ts) — nos dois casos o form pede quanto chegou
    // de verdade nesta confirmação.
    recebimento: status === "RECEBIDO",
  };
}

export function AcoesSolicitacaoForm({
  solicitacaoId,
  statusAtual,
  proximosStatus,
  podeCancelar,
  fornecedorAtualId,
  valorEstimado,
  documentoAtual,
  fornecedores,
  geraMovimentacaoEstoque,
  quantidadeSolicitada,
  quantidadeJaRecebida,
  unidade,
}: {
  solicitacaoId: string;
  statusAtual: StatusSolicitacaoCompra;
  // Transições válidas a partir do status atual, já sem CANCELADO (ver
  // TRANSICOES_VALIDAS em src/lib/compras-status.ts) — CANCELADO ganha seu
  // próprio botão/formulário separado abaixo, de propósito (ação
  // destrutiva não deveria ser só "mais uma opção" no mesmo select).
  proximosStatus: StatusSolicitacaoCompra[];
  podeCancelar: boolean;
  fornecedorAtualId: string | null;
  valorEstimado: number | null;
  documentoAtual: string | null;
  fornecedores: { id: string; nome: string }[];
  // Achado A1 da auditoria de abrangência (Parte 3/Compras, 2026-09-06) —
  // true só quando tipoCompra=MATERIA_PRIMA com item de catálogo (ver
  // geraMovimentacaoEstoque em ../status-transicao.ts) — decide a
  // mensagem exibida ao escolher RECEBIDO logo abaixo.
  geraMovimentacaoEstoque: boolean;
  // Achado A7 da auditoria de abrangência (Parte 3/Compras, 2026-09-07) —
  // recebimento parcial: `quantidadeSolicitada` é o total pedido,
  // `quantidadeJaRecebida` é o acumulado já confirmado ANTES desta ação
  // (null = nenhuma confirmação ainda) — juntos calculam o "restante
  // esperado" que pré-preenche o campo de quantidade recebida abaixo.
  quantidadeSolicitada: number;
  quantidadeJaRecebida: number | null;
  unidade: string;
}) {
  const [state, formAction, pending] = useActionState(avancarSolicitacaoCompra, null);
  const [stateCancelar, formActionCancelar, pendingCancelar] = useActionState(avancarSolicitacaoCompra, null);
  const [proximoStatus, setProximoStatus] = useState<StatusSolicitacaoCompra | null>(proximosStatus[0] ?? null);

  const campos = proximoStatus ? camposContextuais(proximoStatus, statusAtual) : null;
  const vindoDeCotacao = statusAtual === "COTANDO" && proximoStatus === "APROVADO";
  // Achado A7 da auditoria de abrangência (Parte 3/Compras, 2026-09-07) —
  // sugestão de quanto falta chegar, só pra PRÉ-PREENCHER o campo (editável
  // — quem confere pode digitar outro valor, inclusive maior/menor, o que
  // dispara a exigência de observação de divergência no servidor).
  const quantidadeRestante = Math.max(0, quantidadeSolicitada - (quantidadeJaRecebida ?? 0));

  return (
    <Card className="flex flex-col gap-6 p-6">
      {proximoStatus && (
        <div className="flex flex-col gap-4">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">Avançar status</h2>
          <form action={formAction} className="flex flex-col gap-4">
            <input type="hidden" name="solicitacaoId" value={solicitacaoId} />

            {proximosStatus.length > 1 ? (
              <Select
                label={
                  <>
                    Mudar para
                    <CampoAjuda texto="Cada opção é uma etapa do processo de compra. Aprovado libera a compra pra ser efetivada, Comprado indica que o pedido já foi feito ao fornecedor, Recebido confirma que o material chegou (e atualiza o estoque sozinho), e Conferido é a etapa final — depois de conferida, a solicitação fica travada e não pode mais ser alterada." />
                  </>
                }
                name="proximoStatus"
                value={proximoStatus}
                onChange={(e) => setProximoStatus(e.target.value as StatusSolicitacaoCompra)}
              >
                {proximosStatus.map((status) => (
                  <option key={status} value={status}>
                    {ROTULOS_STATUS_SOLICITACAO_COMPRA[status]}
                  </option>
                ))}
              </Select>
            ) : (
              <input type="hidden" name="proximoStatus" value={proximoStatus} />
            )}

            {campos?.fornecedor && (
              <Select label="Fornecedor (opcional)" name="fornecedorId" defaultValue={fornecedorAtualId ?? ""}>
                <option value="">Ainda não definido</option>
                {fornecedores.map((fornecedor) => (
                  <option key={fornecedor.id} value={fornecedor.id}>
                    {fornecedor.nome}
                  </option>
                ))}
              </Select>
            )}

            {vindoDeCotacao && (
              <p className="text-xs text-slate-500">
                O fornecedor e o valor serão preenchidos pela cotação marcada como vencedora acima — escolha uma
                antes de aprovar.
              </p>
            )}

            {campos?.valorFinal && (
              <Input
                label="Valor final pago (R$)"
                name="valorFinal"
                type="number"
                step="0.01"
                min="0"
                defaultValue={valorEstimado ?? undefined}
                required
              />
            )}

            {campos?.custoAquisicao && (
              <div className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Custo de aquisição real (opcional)
                  <CampoAjuda texto="Preencha só se a nota fiscal desta compra tiver frete, IPI, ICMS creditável ou desconto — eles entram no custo real por unidade em vez de só o valor final pago. Deixe em branco se a nota não tiver nenhum desses valores (o cálculo continua igual a antes)." />
                </p>
                <div className="flex flex-wrap gap-3">
                  <div className="w-36">
                    <Input label="Frete (R$)" name="valorFrete" type="number" step="0.01" min="0" />
                  </div>
                  <div className="w-36">
                    <Input label="IPI (R$)" name="valorIpi" type="number" step="0.01" min="0" />
                  </div>
                  <div className="w-40">
                    <Input label="ICMS creditável (R$)" name="valorIcmsCreditavel" type="number" step="0.01" min="0" />
                  </div>
                  <div className="w-36">
                    <Input label="Desconto (R$)" name="valorDesconto" type="number" step="0.01" min="0" />
                  </div>
                </div>
              </div>
            )}

            {campos?.documento && (
              <Input
                label="Nº da nota (opcional)"
                name="documento"
                type="text"
                maxLength={60}
                defaultValue={documentoAtual ?? ""}
              />
            )}

            {campos?.recebimento && (
              <div className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Recebimento
                  <CampoAjuda texto="Quanto chegou de verdade nesta confirmação — pré-preenchido com o restante esperado desta solicitação, mas editável. Se vier menos que o restante, a solicitação fica 'Recebido parcialmente' e você confirma o resto depois reabrindo esta mesma ação; se vier diferente do restante esperado (pra mais ou pra menos), é preciso explicar a divergência." />
                </p>
                <Input
                  label={`Quantidade recebida agora${unidade ? ` (${unidade})` : ""}`}
                  name="quantidadeRecebida"
                  type="number"
                  step="0.0001"
                  min="0"
                  defaultValue={quantidadeRestante}
                  required
                />
                <p className="text-xs text-slate-500">
                  Restam {formatoQuantidade.format(quantidadeRestante)} {unidade} desta solicitação de{" "}
                  {formatoQuantidade.format(quantidadeSolicitada)} {unidade}.
                  {geraMovimentacaoEstoque
                    ? " Confirmar aqui gera automaticamente uma entrada no estoque desta matéria-prima."
                    : " Esta compra não gera entrada de estoque (não é matéria-prima do catálogo)."}
                </p>
                <Input label="Valor da nota fiscal (opcional)" name="valorNotaFiscal" type="number" step="0.01" min="0" />
                <Input
                  label="Observação da divergência (obrigatório se a quantidade acima for diferente do restante esperado)"
                  name="divergenciaObservacao"
                  type="text"
                  maxLength={500}
                />
              </div>
            )}

            {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}

            <Button type="submit" loading={pending} className="self-start">
              {pending ? "Salvando..." : `Marcar como ${ROTULOS_STATUS_SOLICITACAO_COMPRA[proximoStatus]}`}
            </Button>
          </form>
        </div>
      )}

      {podeCancelar && (
        <form
          action={formActionCancelar}
          className="flex flex-col gap-2 border-t border-slate-100 pt-4 dark:border-slate-800"
          onSubmit={(e) => {
            if (!confirm("Cancelar esta solicitação de compra? Essa ação não pode ser desfeita.")) {
              e.preventDefault();
            }
          }}
        >
          <input type="hidden" name="solicitacaoId" value={solicitacaoId} />
          <input type="hidden" name="proximoStatus" value="CANCELADO" />
          {stateCancelar && !stateCancelar.ok && <Alert variant="error">{stateCancelar.mensagem}</Alert>}
          <Button
            type="submit"
            variant="outline"
            loading={pendingCancelar}
            className="self-start border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-300"
          >
            Cancelar solicitação
          </Button>
        </form>
      )}
    </Card>
  );
}
