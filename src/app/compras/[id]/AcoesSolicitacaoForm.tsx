"use client";

import { useActionState, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { avancarSolicitacaoCompra } from "../actions";
import { ROTULOS_STATUS_SOLICITACAO_COMPRA, type StatusSolicitacaoCompra } from "@/lib/compras-status";

// Campos contextuais: só aparecem quando fazem sentido pro próximo status
// escolhido (ver DadosTransicaoCompra em ../status-transicao.ts) — um
// campo que não aparece no DOM não entra na FormData, e a action trata
// isso como "não mexer" nesse campo.
function camposContextuais(status: StatusSolicitacaoCompra) {
  return {
    fornecedor: status === "APROVADO",
    valorFinal: status === "COMPRADO",
    documento: status === "COMPRADO" || status === "RECEBIDO",
  };
}

export function AcoesSolicitacaoForm({
  solicitacaoId,
  proximosStatus,
  podeCancelar,
  fornecedorAtualId,
  valorEstimado,
  documentoAtual,
  fornecedores,
}: {
  solicitacaoId: string;
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
}) {
  const [state, formAction, pending] = useActionState(avancarSolicitacaoCompra, null);
  const [stateCancelar, formActionCancelar, pendingCancelar] = useActionState(avancarSolicitacaoCompra, null);
  const [proximoStatus, setProximoStatus] = useState<StatusSolicitacaoCompra | null>(proximosStatus[0] ?? null);

  const campos = proximoStatus ? camposContextuais(proximoStatus) : null;

  return (
    <Card className="flex flex-col gap-6 p-6">
      {proximoStatus && (
        <div className="flex flex-col gap-4">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">Avançar status</h2>
          <form action={formAction} className="flex flex-col gap-4">
            <input type="hidden" name="solicitacaoId" value={solicitacaoId} />

            {proximosStatus.length > 1 ? (
              <Select
                label="Mudar para"
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

            {campos?.documento && (
              <Input
                label="Nº da nota (opcional)"
                name="documento"
                type="text"
                maxLength={60}
                defaultValue={documentoAtual ?? ""}
              />
            )}

            {proximoStatus === "RECEBIDO" && (
              <p className="text-xs text-slate-500">
                Confirmar aqui gera automaticamente uma entrada no estoque desta matéria-prima.
              </p>
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
