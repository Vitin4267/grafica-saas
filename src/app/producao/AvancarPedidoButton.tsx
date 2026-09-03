"use client";

import { useState } from "react";
import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { avancarPedido } from "./actions";
import { SeletorMaquina, type MaquinaOpcaoUI } from "./SeletorMaquina";

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
  rotuloProximo = null,
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
  // Achado A1 (Fase 1) — rótulo (já resolvido: customizado da gráfica ou
  // padrão, ver resolverEtapasGrafica em src/lib/etapa-grafica.ts) da
  // PRÓXIMA etapa deste pedido. Antes desta troca o texto do botão vinha de
  // um mapa fixo por status ("Enviar p/ clichê/faca" etc.) — incoerente
  // assim que uma gráfica renomeia a etapa de destino. null (ou omitido)
  // cai no rótulo genérico "Avançar", mesmo comportamento de qualquer
  // chamador que ainda não passe esta prop.
  rotuloProximo?: string | null;
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
        {rotuloProximo ? `Avançar para ${rotuloProximo}` : "Avançar"}
      </Button>
      {state && !state.ok && (
        <span className="text-xs text-rose-600">{state.mensagem}</span>
      )}
    </form>
  );
}
