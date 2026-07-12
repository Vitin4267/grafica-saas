"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { logout } from "@/app/logout/actions";
import { obterResumoAssinatura } from "@/app/configuracoes/assinatura/actions";
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
  const [diasRestantesTrial, setDiasRestantesTrial] = useState<number | null>(null);
  const [diasAteBloqueio, setDiasAteBloqueio] = useState<number | null>(null);

  // Busca só o resumo (status + dias de trial/limite) no mount — não é dado
  // que as ~40 páginas que renderizam <UserNav> precisam calcular e passar
  // na mão (mesmo cuidado documentado acima sobre mostrarMeuNegocio/
  // modulosVisiveis: não queremos um prop novo a mais pra lembrar em todo
  // lugar). Deixa claro em QUALQUER página, não só em
  // /configuracoes/assinatura, que a conta está em teste ou passou do
  // limite de uso do plano.
  useEffect(() => {
    obterResumoAssinatura().then((resumo) => {
      if (resumo?.status === "TRIALING") {
        setDiasRestantesTrial(resumo.diasRestantesTrial);
      }
      if (resumo?.limiteExcedidoDesde) {
        setDiasAteBloqueio(resumo.diasAteBloqueio);
      }
    });
  }, []);

  let links: { href: string; label: string; modulo: ModuloPermissao | null }[] = LINKS.filter(
    (l) => modulosVisiveis === null || modulosVisiveis.includes(l.modulo)
  );
  if (papel === "DONO") {
    links = [
      ...links,
      { href: "/usuarios", label: "Usuários", modulo: null },
      { href: "/configuracoes/assinatura", label: "Assinatura", modulo: null },
    ];
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

      {diasRestantesTrial !== null && (
        <div className="border-t border-amber-200 bg-amber-50 px-6 py-2 text-center text-xs font-medium text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300">
          {diasRestantesTrial > 0
            ? `Período de teste — ${diasRestantesTrial} dia${diasRestantesTrial === 1 ? "" : "s"} restante${diasRestantesTrial === 1 ? "" : "s"}.`
            : "Seu período de teste terminou."}{" "}
          {papel === "DONO" && (
            <Link href="/configuracoes/assinatura" className="underline hover:no-underline">
              Assinar agora
            </Link>
          )}
        </div>
      )}

      {diasAteBloqueio !== null && (
        <div className="border-t border-rose-200 bg-rose-50 px-6 py-2 text-center text-xs font-medium text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300">
          {diasAteBloqueio > 0
            ? `Você passou do limite do seu plano — ${diasAteBloqueio} dia${diasAteBloqueio === 1 ? "" : "s"} pra evitar o bloqueio.`
            : "Você passou do limite do seu plano — o acesso pode ser bloqueado a qualquer momento."}{" "}
          {papel === "DONO" && (
            <Link href="/configuracoes/assinatura" className="underline hover:no-underline">
              Fazer upgrade
            </Link>
          )}
        </div>
      )}

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
