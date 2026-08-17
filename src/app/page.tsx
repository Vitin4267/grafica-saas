import Link from "next/link";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/Button";
import {
  ReceiptIcon,
  UsersIcon,
  BoxIcon,
  PrinterIcon,
  ArrowRightIcon,
  SparklesIcon,
} from "@/components/icons";

const RECURSOS = [
  {
    icon: ReceiptIcon,
    titulo: "Orçamento em segundos",
    descricao:
      "Escolha o produto, informe a quantidade e pronto: o preço sai calculado na hora, sem planilha e sem erro de conta.",
  },
  {
    icon: UsersIcon,
    titulo: "Clientes organizados",
    descricao:
      "Cadastre seus clientes uma vez só e reaproveite os dados em todos os orçamentos futuros.",
  },
  {
    icon: BoxIcon,
    titulo: "Estoque sob controle",
    descricao:
      "Saiba quanto papel, tinta e outros insumos você tem antes de fechar um pedido grande.",
  },
  {
    icon: PrinterIcon,
    titulo: "Feito para o dia a dia",
    descricao:
      "Interface simples pensada para quem trabalha no balcão da gráfica, sem termos técnicos complicados.",
  },
];

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Logo />
          <nav className="flex items-center gap-3">
            <Link
              href="/login"
              className="rounded-xl px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
            >
              Entrar
            </Link>
            <Link href="/registro">
              <Button variant="primary" className="text-sm">
                Cadastrar grátis
              </Button>
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className="relative overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-32 left-1/2 h-96 w-[48rem] -translate-x-1/2 rounded-full bg-teal-200/40 blur-3xl dark:bg-teal-900/20"
          />
          <div className="relative mx-auto grid max-w-6xl gap-12 px-6 py-20 md:grid-cols-2 md:items-center md:py-28">
            <div className="flex flex-col gap-6">
              <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-teal-100 px-3 py-1 text-xs font-medium text-teal-700 dark:bg-teal-950 dark:text-teal-300">
                <SparklesIcon className="h-3.5 w-3.5" />
                Feito para gráficas de qualquer tamanho
              </span>
              <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl dark:text-white">
                Orçamentos rápidos e sua gráfica sempre organizada
              </h1>
              <p className="max-w-md text-lg text-slate-600 dark:text-slate-400">
                Calcule preços, cadastre clientes e acompanhe o estoque em uma
                única tela, feita para ser simples desde o primeiro clique.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link href="/registro">
                  <Button variant="primary" className="px-6 py-3 text-base">
                    Cadastrar minha gráfica
                    <ArrowRightIcon className="h-4 w-4" />
                  </Button>
                </Link>
                <Link href="/login">
                  <Button variant="outline" className="px-6 py-3 text-base">
                    Já tenho conta
                  </Button>
                </Link>
              </div>
            </div>

            <div className="relative">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/5 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
                  <span className="text-sm font-medium text-slate-500">
                    Novo orçamento
                  </span>
                  <span className="rounded-full bg-teal-100 px-2.5 py-1 text-xs font-medium text-teal-700 dark:bg-teal-950 dark:text-teal-300">
                    Banner Lona
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 py-4 text-sm">
                  <div>
                    <p className="text-slate-400">Cliente</p>
                    <p className="font-medium text-slate-800 dark:text-slate-200">
                      Padaria Bom Pão
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-400">Quantidade</p>
                    <p className="font-medium text-slate-800 dark:text-slate-200">
                      2 unidades
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-400">Tamanho</p>
                    <p className="font-medium text-slate-800 dark:text-slate-200">
                      100 × 200 cm
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-400">Área total</p>
                    <p className="font-medium text-slate-800 dark:text-slate-200">
                      2,00 m²
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800">
                  <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
                    Total do orçamento
                  </span>
                  <span className="text-xl font-bold text-teal-700 dark:text-teal-400">
                    R$ 180,00
                  </span>
                </div>
              </div>
              <div
                aria-hidden
                className="absolute -bottom-4 -right-4 -z-10 h-full w-full rounded-2xl bg-teal-600/10"
              />
            </div>
          </div>
        </section>

        <section className="border-t border-slate-200 bg-slate-50/60 py-20 dark:border-slate-800 dark:bg-slate-950/40">
          <div className="mx-auto max-w-6xl px-6">
            <div className="mb-12 max-w-xl">
              <h2 className="text-3xl font-bold text-slate-900 dark:text-white">
                Tudo que sua gráfica precisa, sem complicação
              </h2>
              <p className="mt-3 text-slate-600 dark:text-slate-400">
                Pensado para quem quer resolver o orçamento do cliente rápido
                e voltar para a produção.
              </p>
            </div>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {RECURSOS.map(({ icon: Icon, titulo, descricao }) => (
                <div
                  key={titulo}
                  className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900"
                >
                  <span className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-teal-50 text-teal-600 dark:bg-teal-950 dark:text-teal-400">
                    <Icon className="h-5 w-5" />
                  </span>
                  <h3 className="font-semibold text-slate-900 dark:text-white">
                    {titulo}
                  </h3>
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                    {descricao}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-20">
          <div className="mx-auto flex max-w-4xl flex-col items-center gap-6 px-6 text-center">
            <h2 className="text-3xl font-bold text-slate-900 dark:text-white">
              Pronto para simplificar o dia a dia da sua gráfica?
            </h2>
            <p className="max-w-lg text-slate-600 dark:text-slate-400">
              Crie sua conta grátis agora e monte seu primeiro orçamento em
              poucos minutos.
            </p>
            <Link href="/registro">
              <Button variant="primary" className="px-6 py-3 text-base">
                Cadastrar minha gráfica
                <ArrowRightIcon className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 py-8 dark:border-slate-800">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 text-sm text-slate-500 sm:flex-row">
          <Logo />
          <p>© {new Date().getFullYear()} GrafPro. Todos os direitos reservados.</p>
          <div className="flex items-center gap-4">
            <Link href="/termos" className="hover:text-slate-700 dark:hover:text-slate-300">
              Termos de Uso
            </Link>
            <Link href="/privacidade" className="hover:text-slate-700 dark:hover:text-slate-300">
              Privacidade
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
