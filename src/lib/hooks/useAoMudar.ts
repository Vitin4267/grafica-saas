"use client";

import { useState } from "react";

// Roda `efeito` de forma síncrona DURANTE a renderização quando `valor` muda
// (comparação por referência) — padrão oficial do React pra "ajustar estado
// quando uma prop/valor muda" sem usar useEffect (que dispara depois do
// commit e causa um render em cascata extra, motivo do eslint-config-next
// mais novo marcar isso como erro — react-hooks/set-state-in-effect). Ver
// https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
//
// Uso típico neste projeto: resetar um "confirmando exclusão?" pra false
// quando o resultado de uma Server Action (useActionState) muda.
export function useAoMudar<T>(valor: T, efeito: (valor: T) => void) {
  const [anterior, setAnterior] = useState(valor);
  if (valor !== anterior) {
    setAnterior(valor);
    efeito(valor);
  }
}
