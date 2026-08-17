import Link from "next/link";
import { Logo } from "@/components/Logo";
import { CheckCircleIcon } from "@/components/icons";
import { ThemeToggle } from "@/components/ThemeToggle";

const DESTAQUES = [
  "Orçamentos calculados automaticamente",
  "Clientes e produtos sempre à mão",
  "Estoque de insumos sob controle",
];

export function AuthLayout({
  titulo,
  subtitulo,
  children,
}: {
  titulo: string;
  subtitulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid flex-1 md:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-teal-700 p-10 text-white md:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-teal-500/40 blur-3xl"
        />
        <Link href="/">
          <Logo className="[&_span]:text-white" />
        </Link>
        <div className="relative flex flex-col gap-6">
          <h2 className="text-3xl font-bold leading-snug">
            A gestão da sua gráfica em um só lugar
          </h2>
          <ul className="flex flex-col gap-3">
            {DESTAQUES.map((item) => (
              <li key={item} className="flex items-center gap-2.5 text-teal-50">
                <CheckCircleIcon className="h-5 w-5 shrink-0 text-teal-200" />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm text-teal-100">
          © {new Date().getFullYear()} GrafPro
        </p>
      </div>

      <div className="relative flex flex-col justify-center px-6 py-12 sm:px-12 lg:px-20">
        <div className="absolute top-6 right-6">
          <ThemeToggle />
        </div>
        <div className="mx-auto w-full max-w-sm">
          <Link href="/" className="mb-8 inline-block md:hidden">
            <Logo />
          </Link>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            {titulo}
          </h1>
          <p className="mt-1 mb-8 text-sm text-slate-500 dark:text-slate-400">
            {subtitulo}
          </p>
          {children}
        </div>
      </div>
    </div>
  );
}
