import Link from "next/link";
import dynamic from "next/dynamic";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeVerMeuNegocio, obterModulosVisiveis } from "@/lib/auth/permissoes";
import { obterStatusOnboarding } from "@/lib/onboarding";
import { existemDadosExemplo } from "@/lib/dados-exemplo";
import { UserNav } from "@/components/UserNav";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import {
  UsersIcon,
  BoxIcon,
  SlidersIcon,
  ReceiptIcon,
  CheckCircleIcon,
  ArrowRightIcon,
} from "@/components/icons";
import { ClienteForm } from "@/app/clientes/ClienteForm";
import { DadosExemploPanel } from "./DadosExemploPanel";

// Lazy: já é client-only por dentro (mede DOM em useEffect), então isolar
// o chunk não muda o comportamento — só evita carregar o JS do tour pra
// quem não veio com ?tour=1 (a maioria das visitas a /comecar).
const TourAbas = dynamic(() => import("@/components/TourAbas").then((m) => m.TourAbas));

export default async function ComecarPage({
  searchParams,
}: {
  searchParams: Promise<{ tour?: string }>;
}) {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  // Independentes entre si — mesma lógica de "não faça em cascata" adotada no
  // resto da navegação (ver commit "Reduz cascata de queries na navegação").
  const [status, dadosExemploCarregados] = await Promise.all([
    obterStatusOnboarding(usuario.graficaId),
    existemDadosExemplo(usuario.graficaId),
  ]);
  const { tour } = await searchParams;

  const passosConcluidos = [status.temCliente, status.temCatalogo, status.temOrcamento].filter(
    Boolean
  ).length;
  const totalPassos = 3;
  const percentualProgresso = Math.round((passosConcluidos / totalPassos) * 100);

  return (
    <div className="flex flex-1 flex-col">
      <UserNav
        nome={usuario.nome}
        graficaNome={usuario.grafica.nome}
        papel={usuario.papel}
        mostrarMeuNegocio={podeVerMeuNegocio(usuario)}
        modulosVisiveis={await obterModulosVisiveis(usuario)}
      />
      <TourAbas ativo={tour === "1"} />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Configuração inicial
          </h1>
          <p className="mt-1 text-slate-500">
            Só mais alguns dados e sua gráfica já pode montar orçamentos.
          </p>

          <div className="mt-4 flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                className="h-full rounded-full bg-teal-500 transition-all"
                style={{ width: `${percentualProgresso}%` }}
              />
            </div>
            <span className="shrink-0 text-xs font-medium text-slate-500">
              {passosConcluidos} de {totalPassos} passos concluídos
            </span>
          </div>
        </div>

        <div className="mb-6">
          <DadosExemploPanel dadosExemploCarregados={dadosExemploCarregados} />
        </div>

        <div className="flex flex-col gap-6">
          <Card className="p-6">
            <div className="mb-4 flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-600 dark:bg-teal-950 dark:text-teal-400">
                <UsersIcon className="h-5 w-5" />
              </span>
              <div>
                <h2 className="font-semibold text-slate-900 dark:text-white">
                  1. Cadastre um cliente
                </h2>
                {status.temCliente && (
                  <p className="flex items-center gap-1 text-sm text-emerald-600 dark:text-emerald-400">
                    <CheckCircleIcon className="h-3.5 w-3.5" />
                    Você já tem {status.totalClientes} cliente
                    {status.totalClientes > 1 ? "s" : ""} cadastrado
                    {status.totalClientes > 1 ? "s" : ""}
                  </p>
                )}
              </div>
            </div>
            <ClienteForm />
          </Card>

          <Card className="flex items-center justify-between gap-4 p-6">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-600 dark:bg-teal-950 dark:text-teal-400">
                <BoxIcon className="h-5 w-5" />
              </span>
              <div>
                <h2 className="font-semibold text-slate-900 dark:text-white">
                  2. Escolha o que sua gráfica vende
                </h2>
                <p className="text-sm text-slate-500">
                  Marque os produtos e serviços do catálogo e defina os preços.
                </p>
              </div>
            </div>
            {status.temCatalogo ? (
              <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                <CheckCircleIcon className="h-3.5 w-3.5" />
                Feito
              </span>
            ) : (
              <Link href="/catalogo" className="shrink-0">
                <Button variant="primary">Ir para o catálogo</Button>
              </Link>
            )}
          </Card>

          <Card className="flex items-center justify-between gap-4 p-6">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                <SlidersIcon className="h-5 w-5" />
              </span>
              <div>
                <h2 className="font-semibold text-slate-900 dark:text-white">
                  3. Parâmetros de precificação{" "}
                  <span className="font-normal text-slate-400">(opcional)</span>
                </h2>
                <p className="text-sm text-slate-500">
                  Já vem com valores padrão prontos pra usar — revise só se quiser
                  ajustar margens e custos de máquina.
                </p>
              </div>
            </div>
            <Link href="/configuracoes" className="shrink-0">
              <Button variant="outline">Revisar</Button>
            </Link>
          </Card>

          <Card className="flex items-center justify-between gap-4 p-6">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-600 dark:bg-teal-950 dark:text-teal-400">
                <ReceiptIcon className="h-5 w-5" />
              </span>
              <div>
                <h2 className="font-semibold text-slate-900 dark:text-white">
                  4. Gere seu primeiro orçamento
                </h2>
                {status.temOrcamento ? (
                  <p className="flex items-center gap-1 text-sm text-emerald-600 dark:text-emerald-400">
                    <CheckCircleIcon className="h-3.5 w-3.5" />
                    Você já tem {status.totalOrcamentos} orçamento
                    {status.totalOrcamentos > 1 ? "s" : ""} criado
                    {status.totalOrcamentos > 1 ? "s" : ""}
                  </p>
                ) : (
                  <p className="text-sm text-slate-500">
                    Escolha o cliente e o produto — o preço sai calculado na hora.
                  </p>
                )}
              </div>
            </div>
            {status.temOrcamento ? (
              <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                <CheckCircleIcon className="h-3.5 w-3.5" />
                Feito
              </span>
            ) : (
              <Link href="/orcamento" className="shrink-0">
                <Button variant={status.completo ? "primary" : "outline"}>Ir para orçamentos</Button>
              </Link>
            )}
          </Card>
        </div>

        <div className="mt-8 flex justify-center">
          <Link href="/orcamento">
            <Button variant={status.completo ? "primary" : "outline"} className="px-6 py-3">
              Ir para o painel de orçamentos
              <ArrowRightIcon className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </main>
    </div>
  );
}
