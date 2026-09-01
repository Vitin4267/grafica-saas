"use client";

import { useEffect, useId, useRef, useState } from "react";
import { HelpCircleIcon } from "@/components/icons";

// Botão "?" pequeno e circular pra ajuda contextual num campo de formulário
// confuso pra um vendedor/operador novo. CLICÁVEL (toggle), não só hover —
// hover sozinho não funciona em touch/mobile, que é como muito vendedor de
// gráfica acessa o sistema. Uso pretendido:
//   <label>Campo X <CampoAjuda texto="Explicação curta..." /></label>
// Pequeno o suficiente pra ficar inline ao lado de um rótulo sem quebrar o
// layout do formulário.
export function CampoAjuda({ texto }: { texto: string }) {
  const [aberto, setAberto] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();

  // Fecha ao clicar/tocar fora ou apertar Esc — mesmo padrão de listener
  // global usado em CommandPalette.tsx, só ativo enquanto o popover está
  // aberto (evita listener pendurado em toda página por causa de um "?").
  useEffect(() => {
    if (!aberto) return;

    function aoClicarFora(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setAberto(false);
      }
    }
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") setAberto(false);
    }

    document.addEventListener("mousedown", aoClicarFora);
    document.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("mousedown", aoClicarFora);
      document.removeEventListener("keydown", aoTeclar);
    };
  }, [aberto]);

  // Reposiciona o popover se ele estourar a lateral da tela — comum em
  // mobile, onde o campo pode estar perto da borda. Desloca só o necessário
  // pra caber, sem precisar de nenhuma lib de posicionamento.
  useEffect(() => {
    if (!aberto || !popoverRef.current) return;
    const el = popoverRef.current;
    el.style.transform = "translateX(-50%)";
    const rect = el.getBoundingClientRect();
    const margem = 8;
    if (rect.left < margem) {
      el.style.transform = `translateX(calc(-50% + ${margem - rect.left}px))`;
    } else if (rect.right > window.innerWidth - margem) {
      el.style.transform = `translateX(calc(-50% - ${rect.right - (window.innerWidth - margem)}px))`;
    }
  }, [aberto]);

  return (
    <span ref={containerRef} className="relative inline-flex align-middle">
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-label="Ajuda"
        aria-expanded={aberto}
        aria-controls={aberto ? popoverId : undefined}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-teal-500/40 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300"
      >
        <HelpCircleIcon className="h-3.5 w-3.5" />
      </button>

      {aberto && (
        <div
          ref={popoverRef}
          id={popoverId}
          role="tooltip"
          className="absolute left-1/2 top-full z-50 mt-2 w-64 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-xl border border-slate-200 bg-white p-3 text-xs font-normal leading-relaxed text-slate-600 shadow-lg dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
        >
          {texto}
        </div>
      )}
    </span>
  );
}
