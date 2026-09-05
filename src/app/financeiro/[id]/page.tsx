import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import {
  podeVerMeuNegocio,
  exigirVerModulo,
  podeEditarModulo,
  obterModulosVisiveis,
} from "@/lib/auth/permissoes";
import { dataParaInputValue } from "@/lib/data";
import { UserNav } from "@/components/UserNav";
import { ArrowLeftIcon } from "@/components/icons";
import { DespesaForm } from "./DespesaForm";
import { saldoDespesa } from "@/lib/baixa-financeira";

export default async function DespesaDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  await exigirVerModulo(usuario, "FINANCEIRO");
  const podeEditar = await podeEditarModulo(usuario, "FINANCEIRO");

  const despesa = await prisma.despesa.findFirst({
    where: { id, graficaId: usuario.graficaId },
    include: {
      filial: { select: { nome: true } },
      contaFinanceira: { select: { nome: true } },
    },
  });

  if (!despesa) {
    notFound();
  }

  // Saldo em aberto — sempre calculado (achado A8 da Parte 4), nunca
  // armazenado. Igual ao valor cheio pra despesa PENDENTE (nenhum pagamento
  // registrado ainda).
  const saldo = (await saldoDespesa(prisma, despesa)).toFixed(2);

  // Inclui a categoria já vinculada mesmo se ela tiver sido desativada
  // depois — senão o <select> perderia a opção selecionada e trocaria a
  // categoria da despesa sem o usuário pedir (ver comentário parecido em
  // CustosPedidoSecao.tsx, que só lida com lançamento novo).
  const categoriasCusto = await prisma.categoriaCusto.findMany({
    where: {
      graficaId: usuario.graficaId,
      OR: [{ ativa: true }, ...(despesa.categoriaCustoId ? [{ id: despesa.categoriaCustoId }] : [])],
    },
    orderBy: { ordem: "asc" },
    select: { id: true, nome: true },
  });

  // Achado A15 da Parte 4 da auditoria de abrangência (2026-09-04) — mesmo
  // cuidado de categoriasCusto acima: inclui a filial/conta já vinculada
  // mesmo se tiver sido desativada depois, senão o <select> perderia a
  // opção selecionada e trocaria o vínculo sem o usuário pedir.
  const filiais = await prisma.filial.findMany({
    where: {
      graficaId: usuario.graficaId,
      OR: [{ ativa: true }, ...(despesa.filialId ? [{ id: despesa.filialId }] : [])],
    },
    orderBy: { nome: "asc" },
    select: { id: true, nome: true },
  });
  const contasFinanceiras = await prisma.contaFinanceira.findMany({
    where: {
      graficaId: usuario.graficaId,
      OR: [{ ativa: true }, ...(despesa.contaFinanceiraId ? [{ id: despesa.contaFinanceiraId }] : [])],
    },
    orderBy: { nome: "asc" },
    select: { id: true, nome: true },
  });

  return (
    <div className="flex flex-1 flex-col">
      <UserNav
        nome={usuario.nome}
        graficaNome={usuario.grafica.nome}
        papel={usuario.papel}
        paginaAtual="/financeiro"
        mostrarMeuNegocio={podeVerMeuNegocio(usuario)}
        modulosVisiveis={await obterModulosVisiveis(usuario)}
      />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <Link
          href="/financeiro"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Voltar ao financeiro
        </Link>

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            {despesa.descricao}
          </h1>
        </div>

        <DespesaForm
          despesaId={despesa.id}
          valoresIniciais={{
            descricao: despesa.descricao,
            categoria: despesa.categoria ?? "",
            categoriaCustoId: despesa.categoriaCustoId,
            valor: despesa.valor.toString(),
            vencimento: dataParaInputValue(despesa.vencimento),
            periodicidade: despesa.periodicidade,
            recorrenciaAteEm: despesa.recorrenciaAteEm ? dataParaInputValue(despesa.recorrenciaAteEm) : null,
            valorVariavel: despesa.valorVariavel,
            filialId: despesa.filialId,
          }}
          categoriasCusto={categoriasCusto}
          filiais={filiais}
          contasFinanceiras={contasFinanceiras}
          contaFinanceiraNome={despesa.contaFinanceira?.nome ?? null}
          filialNome={despesa.filial?.nome ?? null}
          status={despesa.status}
          saldo={saldo}
          pagoEm={despesa.pagoEm ? dataParaInputValue(despesa.pagoEm) : null}
          formaPagamento={despesa.formaPagamento}
          formaPagamentoDetalhe={despesa.formaPagamentoDetalhe}
          recorrente={despesa.recorrente}
          podeEditar={podeEditar}
        />
      </main>
    </div>
  );
}
