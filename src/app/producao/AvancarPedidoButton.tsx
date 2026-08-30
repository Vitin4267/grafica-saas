"use client";

import { useState } from "react";
import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { avancarPedido } from "./actions";
import { SeletorMaquina, type MaquinaOpcaoUI } from "./SeletorMaquina";

// CLICHE_FACA fica de fora deste mapa de propósito: essa transição baixa
// estoque automaticamente (ver avancarStatusPedido), então PedidoLinha.tsx
// mostra IniciarImpressaoBotao (fluxo de confirmação editável) em vez deste
// botão de um clique só quando o status é CLICHE_FACA.
const PROXIMO_ROTULO: Record<string, string> = {
  ARTE: "Enviar p/ clichê/faca",
  PRODUCAO: "Enviar p/ acabamento",
  ACABAMENTO: "Enviar p/ conferência",
  CONFERENCIA: "Enviar p/ embalagem",
  EMBALAGEM: "Enviar p/ expedição",
  EXPEDICAO: "Marcar como entregue",
};

// Etapas de DESTINO com "motor" (ver comentário de ApontamentoEtapa no
// schema): só ARTE→CLICHE_FACA e PRODUCAO→ACABAMENTO, entre as transições
// que este botão cobre, entram numa etapa que pode ter máquina associada.
// As outras (CONFERENCIA/EMBALAGEM/EXPEDICAO/ENTREGUE) nunca mostram o
// seletor — não têm "motor" nenhum (achado B2, item 5 do enunciado: decisão
// de escopo documentada aqui).
const STATUS_COM_SELETOR_MAQUINA = new Set(["ARTE", "PRODUCAO"]);

export function AvancarPedidoButton({
  pedidoId,
  status,
  maquinas = [],
  sugestaoValor = "",
}: {
  pedidoId: string;
  status: string;
  // Lista de máquinas ATIVAS da gráfica (achado B2) — [] quando a tela
  // ainda não passa essa prop (compatibilidade retroativa, ver relatório).
  maquinas?: MaquinaOpcaoUI[];
  // "campo:id" pré-calculado a partir da máquina que os itens do pedido
  // usaram na precificação (ver sugerirMaquinaPedido) — "" quando não há
  // sugestão (nenhuma máquina configurada nos itens, ou ambígua entre eles).
  sugestaoValor?: string;
}) {
  const [state, formAction, isPending] = useActionState(avancarPedido, null);
  const [maquinaEscolhida, setMaquinaEscolhida] = useState(sugestaoValor);

  if (status === "ENTREGUE" || status === "CANCELADO") {
    return null;
  }

  const mostrarSeletor = STATUS_COM_SELETOR_MAQUINA.has(status) && maquinas.length > 0;

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="pedidoId" value={pedidoId} />
      {mostrarSeletor && (
        <SeletorMaquina maquinas={maquinas} valor={maquinaEscolhida} onChange={setMaquinaEscolhida} />
      )}
      <Button type="submit" variant="outline" loading={isPending}>
        {PROXIMO_ROTULO[status] ?? "Avançar"}
      </Button>
      {state && !state.ok && (
        <span className="text-xs text-rose-600">{state.mensagem}</span>
      )}
    </form>
  );
}
