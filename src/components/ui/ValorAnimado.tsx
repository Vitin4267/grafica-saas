"use client";

import { useContagemAnimada } from "@/lib/hooks/useContagemAnimada";
import { formatoMoeda } from "@/lib/moeda";

// Folha de cliente cirúrgica pra um valor dentro de um StatTile — o resto
// da página (meu-negocio/page.tsx) continua um server component puro.
// formatoMoeda é importado direto aqui (não recebido via prop) porque uma
// função não é serializável através da fronteira Server->Client — só
// formatoMoeda.format em si (não o resultado formatado) cruzaria a
// fronteira quebrado, então a formatação tem que acontecer deste lado.
export function ValorAnimado({ valor }: { valor: number }) {
  const valorAnimado = useContagemAnimada(valor);
  return <>{formatoMoeda.format(valorAnimado)}</>;
}
