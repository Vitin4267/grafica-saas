"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

// Fica montado em toda página (ver layout.tsx) mas só é leve: nenhum
// import de cmdk acontece até o usuário apertar Ctrl+K/Cmd+K pela primeira
// vez (jaAbriu controla isso) — só a partir daí o chunk pesado é buscado.
const CommandPalette = dynamic(
  () => import("@/components/CommandPalette").then((m) => m.CommandPalette),
  { ssr: false }
);

export function CommandPaletteLauncher() {
  const [aberto, setAberto] = useState(false);
  const [jaAbriu, setJaAbriu] = useState(false);

  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      const teclaK = e.key === "k" || e.key === "K";
      if ((e.metaKey || e.ctrlKey) && teclaK) {
        e.preventDefault();
        setJaAbriu(true);
        setAberto((atual) => !atual);
      }
    }
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, []);

  if (!jaAbriu) return null;

  return <CommandPalette aberto={aberto} aoFechar={() => setAberto(false)} />;
}
