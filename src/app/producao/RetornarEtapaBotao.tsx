"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Alert } from "@/components/ui/Alert";
import type { MotivoRetorno, StatusPedido } from "@/generated/prisma/enums";
import { ORDEM_MOTIVO_RETORNO, ROTULOS_MOTIVO_RETORNO } from "@/lib/motivo-retorno";
import { retornarEtapa } from "./retorno-etapa-actions";

// Achado Prod-D2 da Parte 2 (Produção) da auditoria de abrangência
// (pesquisa-abrangencia-modulos.md, "Não existe retorno de etapa") —
// distinto de propósito de AvancarPedidoButton.tsx (avanço de um clique
// só): retornar etapa muda o pedido pra TRÁS na FSM, então nunca é um botão
// direto — sempre abre um formulário pedindo etapa de destino + motivo
// obrigatório antes de submeter, mesmo espírito do desvio lateral
// "Reportar problema" em EntregaPedidoSecao.tsx (um formulário próprio, não
// escondido dentro do fluxo normal).
//
// Só renderizado pelo pai (PedidoLinha.tsx) quando `podeEditar` é
// PRODUCAO.podeEditar COMPLETO — nunca liberado por ResponsavelEstagio
// (diferente do avanço normal): retornar etapa é decisão de quem administra
// a produção, não do operador atribuído a rodar uma etapa específica.
export function RetornarEtapaBotao({
  pedidoId,
  etapasAnteriores,
}: {
  pedidoId: string;
  // Etapas ATIVAS da sequência resolvida desta gráfica, estritamente
  // ANTERIORES à etapa atual do pedido (calculado pelo pai a partir de
  // `sequencia`/`rotulos`, que PedidoLinha.tsx já recebe) — [] quando o
  // pedido está na primeira etapa (nada anterior pra voltar), caso em que
  // este componente não renderiza nada.
  etapasAnteriores: { valor: StatusPedido; rotulo: string }[];
}) {
  const [aberto, setAberto] = useState(false);
  const [state, formAction, isPending] = useActionState(retornarEtapa, null);
  const [motivo, setMotivo] = useState<MotivoRetorno>("REPROVADO_QUALIDADE");

  if (etapasAnteriores.length === 0) {
    return null;
  }

  if (!aberto) {
    return (
      <Button
        type="button"
        variant="ghost"
        onClick={() => setAberto(true)}
        className="!text-orange-700 hover:!bg-orange-50 dark:!text-orange-400 dark:hover:!bg-orange-950/50"
      >
        Retornar etapa
      </Button>
    );
  }

  return (
    <form
      action={formAction}
      className="flex w-full flex-col gap-3 rounded-xl border border-orange-200 bg-orange-50/60 p-4 dark:border-orange-900 dark:bg-orange-950/20"
    >
      <input type="hidden" name="pedidoId" value={pedidoId} />
      <p className="text-sm font-medium text-orange-800 dark:text-orange-300">
        Retornar pedido para uma etapa anterior (retrabalho)
      </p>
      <p className="text-xs text-orange-700/80 dark:text-orange-400/80">
        O estoque já baixado NÃO é estornado — o material já foi consumido. Se o
        retrabalho gastar material extra, registre o refugo ao avançar de novo.
      </p>

      <Select label="Etapa de destino" name="etapaDestino" defaultValue={etapasAnteriores[etapasAnteriores.length - 1].valor}>
        {etapasAnteriores.map((etapa) => (
          <option key={etapa.valor} value={etapa.valor}>
            {etapa.rotulo}
          </option>
        ))}
      </Select>

      <Select
        label="Motivo do retorno"
        name="motivo"
        value={motivo}
        onChange={(e) => setMotivo(e.target.value as MotivoRetorno)}
      >
        {ORDEM_MOTIVO_RETORNO.map((m) => (
          <option key={m} value={m}>
            {ROTULOS_MOTIVO_RETORNO[m]}
          </option>
        ))}
      </Select>

      {motivo === "OUTRO" && (
        <Input label="Descreva o motivo" name="motivoOutro" maxLength={200} required />
      )}

      {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}

      <div className="flex gap-2">
        <Button type="submit" variant="outline" loading={isPending}>
          Confirmar retorno
        </Button>
        <Button type="button" variant="ghost" onClick={() => setAberto(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
