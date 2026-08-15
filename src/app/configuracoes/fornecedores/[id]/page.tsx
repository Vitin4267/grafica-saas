import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import {
  podeVerMeuNegocio,
  exigirVerModulo,
  obterModulosVisiveis,
} from "@/lib/auth/permissoes";
import { UserNav } from "@/components/UserNav";
import { Card } from "@/components/ui/Card";
import { ArrowLeftIcon } from "@/components/icons";
import { formatoMoeda } from "@/lib/moeda";
import { formatoInstanteRealComHora } from "@/lib/data";
import { FornecedorForm } from "./FornecedorForm";

const LIMITE_COMPRAS_RECENTES = 10;

export default async function FornecedorDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  await exigirVerModulo(usuario, "CONFIGURACOES");

  const fornecedor = await prisma.fornecedor.findFirst({
    where: { id, graficaId: usuario.graficaId },
  });

  if (!fornecedor) {
    notFound();
  }

  // Últimas compras deste fornecedor — filtra por graficaId indiretamente
  // via fornecedorId (que já pertence a esta gráfica, checado acima) mas
  // reforça graficaId no where do item pra nunca vazar movimentação de
  // outro tenant caso o dado esteja inconsistente.
  const compras = await prisma.movimentacaoEstoque.findMany({
    where: { fornecedorId: fornecedor.id, itemGrafica: { graficaId: usuario.graficaId } },
    orderBy: { createdAt: "desc" },
    take: LIMITE_COMPRAS_RECENTES,
    include: {
      itemGrafica: { include: { itemCatalogo: { select: { nome: true } } } },
      variante: { select: { rotulo: true } },
    },
  });

  return (
    <div className="flex flex-1 flex-col">
      <UserNav
        nome={usuario.nome}
        graficaNome={usuario.grafica.nome}
        papel={usuario.papel}
        paginaAtual="/configuracoes"
        mostrarMeuNegocio={podeVerMeuNegocio(usuario)}
        modulosVisiveis={await obterModulosVisiveis(usuario)}
      />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <Link
          href="/configuracoes/fornecedores"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Voltar aos fornecedores
        </Link>

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            {fornecedor.nome}
          </h1>
          <p className="mt-1 text-slate-500">
            Edite o nome/contato ou desative este fornecedor.
          </p>
        </div>

        <FornecedorForm
          fornecedorId={fornecedor.id}
          nome={fornecedor.nome}
          contato={fornecedor.contato ?? ""}
          ativo={fornecedor.ativo}
        />

        <Card className="mt-6 flex flex-col gap-1 p-6">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Compras recentes
          </h2>
          <p className="mb-3 text-sm text-slate-500">
            Últimas {LIMITE_COMPRAS_RECENTES} entradas de compra registradas com este
            fornecedor, mais recente primeiro.
          </p>
          {compras.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              Nenhuma compra registrada com este fornecedor ainda.
            </p>
          ) : (
            <div className="-mx-6 divide-y divide-slate-100 dark:divide-slate-800">
              {compras.map((compra) => (
                <div key={compra.id} className="flex items-start justify-between gap-4 px-6 py-4">
                  <div>
                    <p className="text-sm text-slate-900 dark:text-white">
                      {compra.itemGrafica.itemCatalogo.nome}
                      {compra.variante ? ` · ${compra.variante.rotulo}` : ""}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {formatoInstanteRealComHora.format(compra.createdAt)}
                      {compra.documento ? ` · NF ${compra.documento}` : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-medium text-slate-900 dark:text-white">
                      {compra.custoUnitario ? formatoMoeda.format(Number(compra.custoUnitario)) : "—"}
                    </p>
                    <p className="text-xs text-slate-500">
                      {Number(compra.quantidade).toLocaleString("pt-BR")}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </main>
    </div>
  );
}
