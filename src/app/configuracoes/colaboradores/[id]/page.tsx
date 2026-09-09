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
  podeVerModulo,
  podeEditarModulo,
} from "@/lib/auth/permissoes";
import { UserNav } from "@/components/UserNav";
import { ArrowLeftIcon } from "@/components/icons";
import { ColaboradorForm } from "./ColaboradorForm";

export default async function ColaboradorDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  await exigirVerModulo(usuario, "CONFIGURACOES");

  const colaborador = await prisma.colaborador.findFirst({
    where: { id, graficaId: usuario.graficaId },
  });

  if (!colaborador) {
    notFound();
  }

  // Achado D3 da auditoria de abrangência — CPF/chave PIX/especialidade são
  // dados sensíveis, um segundo gate MAIS RESTRITO que o resto desta tela
  // (que já exige CONFIGURACOES): só aparecem/editam pra quem também tem
  // FINANCEIRO. Um operador com CONFIGURACOES mas sem FINANCEIRO edita
  // nome/tipo/telefone normalmente, só não vê os 4 campos novos.
  const [podeVerFinanceiro, podeEditarFinanceiro] = await Promise.all([
    podeVerModulo(usuario, "FINANCEIRO"),
    podeEditarModulo(usuario, "FINANCEIRO"),
  ]);

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
          href="/configuracoes/colaboradores"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Voltar aos colaboradores
        </Link>

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{colaborador.nome}</h1>
          <p className="mt-1 text-slate-500">Edite os dados ou desative este colaborador.</p>
        </div>

        <ColaboradorForm
          colaboradorId={colaborador.id}
          valoresIniciais={{
            nome: colaborador.nome,
            tipo: colaborador.tipo,
            tipoOutro: colaborador.tipoOutro,
            telefone: colaborador.telefone,
            ativo: colaborador.ativo,
            cpf: colaborador.cpf,
            chavePix: colaborador.chavePix,
            tipoChavePix: colaborador.tipoChavePix,
            especialidade: colaborador.especialidade,
          }}
          podeVerFinanceiro={podeVerFinanceiro}
          podeEditarFinanceiro={podeEditarFinanceiro}
        />
      </main>
    </div>
  );
}
