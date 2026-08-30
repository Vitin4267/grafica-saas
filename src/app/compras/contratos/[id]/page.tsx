import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeVerMeuNegocio, exigirVerModulo, obterModulosVisiveis } from "@/lib/auth/permissoes";
import { UserNav } from "@/components/UserNav";
import { ArrowLeftIcon } from "@/components/icons";
import { dataParaInputValue } from "@/lib/data";
import type { UnidadeCompra } from "@/lib/unidade-compra";
import { ContratoForm } from "./ContratoForm";

export default async function ContratoFornecimentoDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  await exigirVerModulo(usuario, "COMPRAS");

  const [contrato, fornecedores, materiais] = await Promise.all([
    prisma.contratoFornecimento.findFirst({
      where: { id, graficaId: usuario.graficaId },
      include: { fornecedor: { select: { nome: true } } },
    }),
    prisma.fornecedor.findMany({
      where: { graficaId: usuario.graficaId, ativo: true },
      orderBy: { nome: "asc" },
      select: { id: true, nome: true },
    }),
    prisma.itemGrafica.findMany({
      where: { graficaId: usuario.graficaId, ativo: true, itemCatalogo: { tipo: "MATERIA_PRIMA" } },
      include: { itemCatalogo: true, variantes: { where: { ativo: true }, orderBy: { rotulo: "asc" } } },
      orderBy: { itemCatalogo: { nome: "asc" } },
    }),
  ]);

  if (!contrato) {
    notFound();
  }

  return (
    <div className="flex flex-1 flex-col">
      <UserNav
        nome={usuario.nome}
        graficaNome={usuario.grafica.nome}
        papel={usuario.papel}
        paginaAtual="/compras"
        mostrarMeuNegocio={podeVerMeuNegocio(usuario)}
        modulosVisiveis={await obterModulosVisiveis(usuario)}
      />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <Link
          href="/compras/contratos"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Voltar aos contratos
        </Link>

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{contrato.fornecedor.nome}</h1>
          <p className="mt-1 text-slate-500">Edite o contrato de fornecimento ou desative-o.</p>
        </div>

        <ContratoForm
          contratoId={contrato.id}
          fornecedores={fornecedores}
          materiais={materiais.map((m) => ({
            id: m.id,
            nome: m.itemCatalogo.nome,
            variantes: m.variantes.map((v) => ({ id: v.id, rotulo: v.rotulo })),
          }))}
          fornecedorIdInicial={contrato.fornecedorId}
          itemGraficaIdInicial={contrato.itemGraficaId ?? ""}
          varianteIdInicial={contrato.varianteId ?? ""}
          precoUnitarioInicial={Number(contrato.precoUnitario)}
          unidadeCompraInicial={contrato.unidadeCompra as UnidadeCompra}
          unidadeCompraOutroInicial={contrato.unidadeCompraOutro ?? ""}
          vigenciaInicioInicial={dataParaInputValue(contrato.vigenciaInicio)}
          vigenciaFimInicial={dataParaInputValue(contrato.vigenciaFim)}
          quantidadeContratadaInicial={contrato.quantidadeContratada !== null ? String(Number(contrato.quantidadeContratada)) : ""}
          quantidadeConsumida={Number(contrato.quantidadeConsumida)}
          condicaoPagamentoInicial={contrato.condicaoPagamento ?? ""}
          observacaoInicial={contrato.observacao ?? ""}
          ativo={contrato.ativo}
        />
      </main>
    </div>
  );
}
