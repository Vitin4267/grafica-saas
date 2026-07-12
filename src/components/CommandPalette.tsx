"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { LINKS } from "@/components/UserNav";
import { obterComandosDisponiveis } from "./CommandPalette.actions";
import {
  ReceiptIcon,
  UsersIcon,
  PrinterIcon,
  BoxIcon,
  TrendingUpIcon,
  SlidersIcon,
} from "@/components/icons";
import type { ComandosDisponiveis } from "./CommandPalette.actions";

const ICONE_POR_ROTA: Record<string, typeof ReceiptIcon> = {
  "/orcamento": ReceiptIcon,
  "/clientes": UsersIcon,
  "/producao": PrinterIcon,
  "/catalogo": BoxIcon,
  "/financeiro": ReceiptIcon,
  "/configuracoes": SlidersIcon,
  "/configuracoes/assinatura": SlidersIcon,
  "/meu-negocio": TrendingUpIcon,
  "/usuarios": UsersIcon,
};

// Componente pesado (cmdk) — só é importado (ver dynamic() em
// CommandPaletteLauncher.tsx) depois do primeiro Ctrl+K/Cmd+K, então o
// chunk nunca entra no carregamento inicial de nenhuma página.
export function CommandPalette({ aberto, aoFechar }: { aberto: boolean; aoFechar: () => void }) {
  const router = useRouter();
  const [comandos, setComandos] = useState<ComandosDisponiveis | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const focoAnteriorRef = useRef<Element | null>(null);

  useEffect(() => {
    obterComandosDisponiveis().then(setComandos);
  }, []);

  // Depende também de `comandos`: o <input> só existe no DOM depois que
  // `comandos` carrega (o componente inteiro retorna null até lá, ver
  // abaixo) — um efeito preso só em [aberto] rodaria cedo demais, achando
  // inputRef.current ainda nulo, e o foco nunca pegaria de verdade.
  useEffect(() => {
    if (aberto && comandos) {
      focoAnteriorRef.current = document.activeElement;
      inputRef.current?.focus();
    } else if (!aberto) {
      (focoAnteriorRef.current as HTMLElement | null)?.focus?.();
    }
  }, [aberto, comandos]);

  useEffect(() => {
    if (!aberto) return;
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") aoFechar();
    }
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aberto, aoFechar]);

  if (!aberto || !comandos) return null;

  const links = LINKS.filter(
    (l) => comandos.modulosVisiveis === null || comandos.modulosVisiveis.includes(l.modulo)
  );
  const extras: { href: string; label: string }[] = [];
  if (comandos.mostrarMeuNegocio) {
    extras.push({ href: "/meu-negocio", label: "Meu Negócio" });
  }
  if (comandos.papel === "DONO") {
    extras.push(
      { href: "/usuarios", label: "Usuários" },
      { href: "/configuracoes/assinatura", label: "Assinatura" }
    );
  }
  const itens = [...extras, ...links];

  function irPara(href: string) {
    aoFechar();
    router.push(href);
  }

  return (
    <div className="fixed inset-0 z-50">
      <div
        aria-hidden
        onClick={aoFechar}
        className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm transition-opacity motion-reduce:transition-none starting:opacity-0"
      />

      <div className="fixed inset-x-0 top-24 mx-auto w-full max-w-lg px-4">
        <Command
          label="Paleta de comandos"
          className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl transition-all motion-reduce:transition-none starting:scale-95 starting:opacity-0 dark:border-slate-700 dark:bg-slate-900"
        >
          <Command.Input
            ref={inputRef}
            placeholder="Ir para..."
            className="w-full border-b border-slate-100 bg-transparent px-4 py-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none dark:border-slate-800 dark:text-slate-100"
          />
          <Command.List className="max-h-80 overflow-y-auto p-2">
            <Command.Empty className="px-3 py-6 text-center text-sm text-slate-500">
              Nada encontrado.
            </Command.Empty>
            {itens.map((item) => {
              const Icone = ICONE_POR_ROTA[item.href] ?? ReceiptIcon;
              return (
                <Command.Item
                  key={item.href}
                  value={item.label}
                  onSelect={() => irPara(item.href)}
                  className="flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-slate-700 data-[selected=true]:bg-teal-50 data-[selected=true]:text-teal-700 dark:text-slate-200 dark:data-[selected=true]:bg-teal-950 dark:data-[selected=true]:text-teal-300"
                >
                  <Icone className="h-4 w-4 shrink-0" />
                  {item.label}
                </Command.Item>
              );
            })}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
