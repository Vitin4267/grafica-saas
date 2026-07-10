import Link from "next/link";
import { logout } from "@/app/logout/actions";
import { Logo } from "@/components/Logo";
import { LogOutIcon } from "@/components/icons";
import type { PapelUsuario } from "@/generated/prisma/enums";

const LINKS = [
  { href: "/orcamento", label: "Orçamento" },
  { href: "/clientes", label: "Clientes" },
  { href: "/producao", label: "Produção" },
  { href: "/catalogo", label: "Catálogo" },
  { href: "/configuracoes", label: "Configurações" },
];

// TODO(review): mostrarMeuNegocio depende de CADA página que renderiza <UserNav>
// calcular e passar `podeVerMeuNegocio(usuario)` manualmente — não há nada que
// force isso. Confirmado quebrado em 3 lugares (default false, then o link some):
// src/app/orcamento/[id]/page.tsx, src/app/catalogo/[itemGraficaId]/page.tsx e
// src/app/comecar/page.tsx (marcados com TODO(review) também). Uma página nova
// esquecer a prop é o caso comum, não a exceção — vale considerar calcular isso
// dentro do próprio UserNav (recebendo o usuário/sessão) em vez de repassado.
export function UserNav({
  nome,
  graficaNome,
  papel,
  paginaAtual,
  mostrarMeuNegocio = false,
}: {
  nome: string;
  graficaNome: string;
  papel?: PapelUsuario;
  paginaAtual?: string;
  mostrarMeuNegocio?: boolean;
}) {
  let links = papel === "DONO" ? [...LINKS, { href: "/usuarios", label: "Usuários" }] : LINKS;
  if (mostrarMeuNegocio) {
    links = [{ href: "/meu-negocio", label: "Meu Negócio" }, ...links];
  }

  return (
    <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
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
        <div className="flex items-center gap-4">
          <div className="hidden text-right sm:block">
            <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
              {nome}
            </p>
            <p className="text-xs text-slate-500">{graficaNome}</p>
          </div>
          <form action={logout}>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <LogOutIcon className="h-4 w-4" />
              <span className="hidden sm:inline">Sair</span>
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
