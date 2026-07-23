"use client";

import { useSyncExternalStore } from "react";

const inscrever = () => () => {};

// Guard de hidratação (ex: ThemeToggle, Turnstile — decidir algo que só o
// cliente sabe, tipo tema resolvido ou se o widget pode montar, sem mostrar
// o valor errado por um instante no SSR). useSyncExternalStore entrega
// "false" no primeiro render do cliente (igual ao servidor, evita mismatch
// de hidratação) e "true" logo em seguida, sem precisar do padrão antigo
// useState+useEffect — que a partir do eslint-config-next mais novo passou
// a ser erro de lint (react-hooks/set-state-in-effect).
export function useMontado(): boolean {
  return useSyncExternalStore(
    inscrever,
    () => true,
    () => false
  );
}
