"use client";

import { useState } from "react";
import Link from "next/link";
import { logout } from "@/app/logout/actions";
import { Logo } from "@/components/Logo";
import { LogOutIcon, MenuIcon, XIcon } from "@/components/icons";
import { ChatAssistente } from "@/components/ChatAssistente";
import type { PapelUsuario, ModuloPermissao } from "@/generated/prisma/enums";

// Exportado pra ChatAssistente reaproveitar os mesmos rótulos em pt-BR na
// hora de identificar em qual página o usuário está. `modulo` liga cada link
// ao controle granular de permissão (ver src/lib/auth/permissoes.ts) — link
// só aparece se `modulosVisiveis` incluir esse módulo (ou for null = DONO/ADMIN).
export const LINKS = [
  { href: "/orcamento", label: "Orçamento", modulo: "ORCAMENTO" as const },
  { href: "/clientes", label: "Clientes", modulo: "CLIENTES" as const },
  { href: "/producao", label: "Produção", modulo: "PRODUCAO" as const },
  { href: "/catalogo", label: "Catálogo", modulo: "CATALOGO" as const },
  { href: "/financeiro", label: "Financeiro", modulo: "FINANCEIRO" as const },
  { href: "/configuracoes", label: "Configurações", modulo: "CONFIGURACOES" as const },
];

// mostrarMeuNegocio e modulosVisiveis dependem de cada página que renderiza
// <UserNav> calcular e passar na mão — já aconteceu de 3 páginas esquecerem
// mostrarMeuNegocio (o link "Meu Negócio" sumia do menu nelas até alguém
// perceber). Continua assim de propósito (matching o padrão já estabelecido),
// mas vale vigilância: qualquer página nova protegida por módulo precisa
// lembrar de passar modulosVisiveis, senão o link aparece mesmo sem acesso
// (a PÁGINA de destino ainda bloqueia — é só o link que ficaria "errado").
//
// Client component (precisa de estado pro menu mobile) — nenhum dado é
// buscado aqui dentro, tudo já chega pronto via props, então não muda nada
// pras páginas que já chamam isto.
export function UserNav({
  nome,
  graficaNome,
  papel,
  paginaAtual,
  mostrarMeuNegocio = false,
  modulosVisiveis = null,
}: {
  nome: string;
  graficaNome: string;
  papel?: PapelUsuario;
  paginaAtual?: string;
  mostrarMeuNegocio?: boolean;
  modulosVisiveis?: ModuloPermissao[] | null;
}) {
  const [menuAberto, setMenuAberto] = useState(false);

  let links: { href: string; label: string; modulo: ModuloPermissao | null }[] = LINKS.filter(
    (l) => modulosVisiveis === null || modulosVisiveis.includes(l.modulo)
  );
  if (papel === "DONO") {
    links = [...links, { href: "/usuarios", label: "Usuários", modulo: null }];
  }
  if (mostrarMeuNegocio) {
    links = [{ href: "/meu-negocio", label: "Meu Negócio", modulo: null }, ...links];
  }

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-8">
          <Link href="/orcamento">
            <Logo />
          </Link>
          <nav className="hidden items-center gap-1 sm:flex">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                data-tour={link.href}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  paginaAtual === link.href
                    ? "bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300"
                    : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
          <div className="hidden text-right sm:block">
            <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
              {nome}
            </p>
            <p className="text-xs text-slate-500">{graficaNome}</p>
          </div>
          <form action={logout} className="hidden sm:block">
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <LogOutIcon className="h-4 w-4" />
              <span>Sair</span>
            </button>
          </form>
          <button
            type="button"
            onClick={() => setMenuAberto((aberto) => !aberto)}
            aria-label={menuAberto ? "Fechar menu" : "Abrir menu"}
            aria-expanded={menuAberto}
            className="rounded-xl border border-slate-200 p-2 text-slate-600 transition-colors hover:bg-slate-50 sm:hidden dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {menuAberto ? <XIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {menuAberto && (
        <nav className="border-t border-slate-200 px-4 pb-4 sm:hidden dark:border-slate-800">
          <div className="flex flex-col gap-1 pt-2">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMenuAberto(false)}
                className={`rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  paginaAtual === link.href
                    ? "bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300"
                    : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-3 dark:border-slate-800">
            <div>
              <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{nome}</p>
              <p className="text-xs text-slate-500">{graficaNome}</p>
            </div>
            <form action={logout}>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <LogOutIcon className="h-4 w-4" />
                Sair
              </button>
            </form>
          </div>
        </nav>
      )}

      <ChatAssistente />
    </header>
  );
}
