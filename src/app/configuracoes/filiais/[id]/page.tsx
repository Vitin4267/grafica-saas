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
import { ArrowLeftIcon } from "@/components/icons";
import { FilialForm } from "./FilialForm";
import { DadosFiscaisFilialForm } from "./DadosFiscaisFilialForm";

export default async function FilialDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  await exigirVerModulo(usuario, "CONFIGURACOES");

  const filial = await prisma.filial.findFirst({
    where: { id, graficaId: usuario.graficaId },
  });

  if (!filial) {
    notFound();
  }

  // Não faz upsert (diferente de /configuracoes/fiscal) — o cadastro fiscal
  // da filial é opcional por natureza, não cria linha só de visitar a
  // página. Ausência de linha == "esta filial usa os dados da gráfica".
  const dadosFiscaisFilial = await prisma.dadosFiscaisFilial.findUnique({
    where: { filialId: filial.id },
  });
  const tokenMascaradoFilial = dadosFiscaisFilial?.focusNfeToken
    ? `•••• ${dadosFiscaisFilial.focusNfeToken.slice(-4)}`
    : null;

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
          href="/configuracoes/filiais"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Voltar às filiais
        </Link>

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            {filial.nome}
          </h1>
        </div>

        <FilialForm
          filialId={filial.id}
          valoresIniciais={{
            nome: filial.nome,
            endereco: filial.endereco ?? "",
            ativa: filial.ativa,
          }}
        />

        <div className="mt-10">
          <h2 className="mb-1 text-lg font-bold text-slate-900 dark:text-white">
            Dados fiscais próprios
          </h2>
          <p className="mb-6 text-sm text-slate-500">
            Usados pra emitir nota fiscal (NF-e) desta filial via Focus NFe,
            no lugar dos dados fiscais da gráfica.
          </p>
          <DadosFiscaisFilialForm
            filialId={filial.id}
            valoresIniciais={{
              ambiente: (dadosFiscaisFilial?.ambiente ?? "homologacao") as "homologacao" | "producao",
              cnpj: dadosFiscaisFilial?.cnpj ?? "",
              razaoSocial: dadosFiscaisFilial?.razaoSocial ?? "",
              nomeFantasia: dadosFiscaisFilial?.nomeFantasia ?? "",
              inscricaoEstadual: dadosFiscaisFilial?.inscricaoEstadual ?? "",
              regimeTributario: dadosFiscaisFilial?.regimeTributario ?? "SIMPLES_NACIONAL",
              enderecoCep: dadosFiscaisFilial?.enderecoCep ?? "",
              enderecoLogradouro: dadosFiscaisFilial?.enderecoLogradouro ?? "",
              enderecoNumero: dadosFiscaisFilial?.enderecoNumero ?? "",
              enderecoBairro: dadosFiscaisFilial?.enderecoBairro ?? "",
              enderecoMunicipio: dadosFiscaisFilial?.enderecoMunicipio ?? "",
              enderecoUf: dadosFiscaisFilial?.enderecoUf ?? "",
              naturezaOperacaoPadrao: dadosFiscaisFilial?.naturezaOperacaoPadrao ?? "Venda de mercadoria",
              cfopPadrao: dadosFiscaisFilial?.cfopPadrao ?? "5102",
              csosnPadrao: dadosFiscaisFilial?.csosnPadrao ?? "102",
              cstIcmsPadrao: dadosFiscaisFilial?.cstIcmsPadrao ?? "",
              icmsAliquotaPadrao: dadosFiscaisFilial?.icmsAliquotaPadrao?.toString() ?? "",
              icmsModalidadeBaseCalculoPadrao: dadosFiscaisFilial?.icmsModalidadeBaseCalculoPadrao ?? "",
              pisCofinsSituacaoTributariaPadrao: dadosFiscaisFilial?.pisCofinsSituacaoTributariaPadrao ?? "",
            }}
            tokenMascarado={tokenMascaradoFilial}
          />
        </div>
      </main>
    </div>
  );
}
