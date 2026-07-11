import Link from "next/link";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-20 text-center">
      <Logo />
      <div>
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white">
          Página não encontrada
        </h1>
        <p className="mt-2 text-slate-500">
          O endereço que você tentou acessar não existe ou foi movido.
        </p>
      </div>
      <Link href="/orcamento">
        <Button variant="primary">Voltar ao painel</Button>
      </Link>
    </div>
  );
}
