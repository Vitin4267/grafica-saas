import Link from "next/link";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/Button";
import { SparklesIcon, ArrowRightIcon } from "@/components/icons";

export const metadata = {
  title: "Bem-vindo — GrafPro",
};

export default async function BemVindoPage() {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  const primeiroNome = usuario.nome.trim().split(" ")[0];

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-white dark:bg-slate-950">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-[32rem] w-[48rem] -translate-x-1/2 rounded-full bg-teal-200/40 blur-3xl dark:bg-teal-900/20"
      />

      <header className="relative px-6 py-6 sm:px-10">
        <Logo />
      </header>

      <main className="relative flex flex-1 items-center justify-center px-6 pb-24">
        <div className="flex max-w-lg flex-col items-center gap-6 text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-100 px-3 py-1 text-xs font-medium text-teal-700 dark:bg-teal-950 dark:text-teal-300">
            <SparklesIcon className="h-3.5 w-3.5" />
            Sua conta foi criada
          </span>

          <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl dark:text-white">
            Bem-vindo, {primeiroNome}!
          </h1>

          <p className="text-lg text-slate-600 dark:text-slate-400">
            A <span className="font-semibold text-slate-900 dark:text-white">{usuario.grafica.nome}</span> já
            tem um espaço só dela no GrafPro. Faltam só alguns minutos de configuração pra você montar
            o primeiro orçamento.
          </p>

          <Link href="/comecar?tour=1" className="mt-2">
            <Button variant="primary" className="px-8 py-3 text-base">
              Vamos começar
              <ArrowRightIcon className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </main>

      <Link
        href="/comecar"
        className="fixed bottom-6 right-6 rounded-xl px-4 py-2.5 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
      >
        Pular
      </Link>
    </div>
  );
}
