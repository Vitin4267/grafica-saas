import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeVerMeuNegocio, podeEditarModulo, obterModulosVisiveis } from "@/lib/auth/permissoes";
import { resolverLimiteImportacaoMes } from "@/lib/billing/limite-importacao";
import { obterPlanoPorPriceId } from "@/lib/billing/planos";
import { UserNav } from "@/components/UserNav";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { UsersIcon, BoxIcon, ReceiptIcon, SparklesIcon, ArrowRightIcon } from "@/components/icons";

// Início do mês corrente em UTC — mesmo helper duplicado em
// src/lib/rate-limit-importacao.ts e src/lib/billing/uso.ts (convenção do
// projeto: função pura pequena de data, copiada por arquivo em vez de
// forçar um import compartilhado).
function inicioDoMesUTC(): Date {
  const agora = new Date();
  return new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1));
}

const CARDS = [
  {
    tipo: "CLIENTES" as const,
    href: "/importar/clientes",
    titulo: "Clientes",
    descricao: "Importe sua base de clientes de uma planilha existente.",
    icone: UsersIcon,
  },
  {
    tipo: "CATALOGO" as const,
    href: "/importar/catalogo",
    titulo: "Catálogo",
    descricao: "Importe produtos, serviços e matéria-prima de uma planilha.",
    icone: BoxIcon,
  },
  {
    tipo: "PEDIDOS" as const,
    href: "/importar/pedidos",
    titulo: "Pedidos históricos",
    descricao: "Importe pedidos já vendidos, pra manter o histórico de faturamento.",
    icone: ReceiptIcon,
  },
];

export default async function ImportarPage() {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);

  const limiteMes = resolverLimiteImportacaoMes({
    status: usuario.grafica.assinatura?.status ?? null,
    cortesia: usuario.grafica.assinatura?.cortesia ?? false,
    planoId: obterPlanoPorPriceId(usuario.grafica.assinatura?.stripePriceId ?? null)?.id ?? null,
  });

  const usadoNoMes = await prisma.importacaoPlanilha.count({
    where: { graficaId: usuario.graficaId, createdAt: { gte: inicioDoMesUTC() } },
  });

  const [podeClientes, podeCatalogo, podePedidos] = await Promise.all([
    podeEditarModulo(usuario, "CLIENTES"),
    podeEditarModulo(usuario, "CATALOGO"),
    podeEditarModulo(usuario, "ORCAMENTO"),
  ]);
  const podeEditarPorTipo = { CLIENTES: podeClientes, CATALOGO: podeCatalogo, PEDIDOS: podePedidos };
  const cardsVisiveis = CARDS.filter((c) => podeEditarPorTipo[c.tipo]);

  return (
    <div className="flex flex-1 flex-col">
      <UserNav
        nome={usuario.nome}
        graficaNome={usuario.grafica.nome}
        papel={usuario.papel}
        paginaAtual="/importar"
        mostrarMeuNegocio={podeVerMeuNegocio(usuario)}
        modulosVisiveis={await obterModulosVisiveis(usuario)}
      />

      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Importador de planilha com IA
          </h1>
          <p className="mt-1 text-slate-500">
            Envie uma planilha e a IA sugere como cada coluna corresponde aos
            campos do sistema — você confirma antes de qualquer coisa ser gravada.
          </p>
        </div>

        {cardsVisiveis.length === 0 ? (
          <EmptyState
            icone={<SparklesIcon className="h-6 w-6" />}
            texto="Você não tem permissão pra importar dados em nenhum módulo. Fale com o dono ou administrador da gráfica."
          />
        ) : (
          <>
            <p className="mb-4 text-sm text-slate-500">
              {limiteMes === null
                ? "Importações este mês: ilimitado no seu plano."
                : `${usadoNoMes} de ${limiteMes} importações usadas este mês.`}
            </p>

            <div className="grid gap-4 sm:grid-cols-3">
              {cardsVisiveis.map((card) => {
                const Icone = card.icone;
                return (
                  <Link key={card.tipo} href={card.href}>
                    <Card className="flex h-full flex-col gap-3 p-6 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-50 text-teal-600 dark:bg-teal-950 dark:text-teal-400">
                        <Icone className="h-5 w-5" />
                      </span>
                      <div className="flex-1">
                        <h2 className="font-semibold text-slate-900 dark:text-white">{card.titulo}</h2>
                        <p className="mt-1 text-sm text-slate-500">{card.descricao}</p>
                      </div>
                      <span className="flex items-center gap-1 text-xs font-medium text-teal-700 dark:text-teal-400">
                        Importar <ArrowRightIcon className="h-3.5 w-3.5" />
                      </span>
                    </Card>
                  </Link>
                );
              })}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
