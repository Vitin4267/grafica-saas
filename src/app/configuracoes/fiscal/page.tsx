import Link from "next/link";
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
import { DadosFiscaisForm } from "./DadosFiscaisForm";

export default async function ConfiguracoesFiscaisPage() {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  await exigirVerModulo(usuario, "CONFIGURACOES");

  // Self-healing, mesmo padrão de carregarParametrosTenant: cria a linha com
  // os defaults do schema na primeira visita, sem forçar o usuário a nada.
  const dadosFiscais = await prisma.dadosFiscaisGrafica.upsert({
    where: { graficaId: usuario.graficaId },
    update: {},
    create: { graficaId: usuario.graficaId },
  });

  const tokenMascarado = dadosFiscais.focusNfeToken
    ? `•••• ${dadosFiscais.focusNfeToken.slice(-4)}`
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
          href="/configuracoes"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Voltar a Configurações
        </Link>

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Dados fiscais</h1>
          <p className="mt-1 text-slate-500">
            Usados pra emitir nota fiscal (NF-e) pros seus clientes via Focus
            NFe. A conta na Focus NFe é sua — o GrafPro nunca guarda
            certificado digital, só o token de acesso da sua própria conta.
          </p>
        </div>

        <DadosFiscaisForm
          valoresIniciais={{
            ambiente: dadosFiscais.ambiente as "homologacao" | "producao",
            cnpj: dadosFiscais.cnpj ?? "",
            razaoSocial: dadosFiscais.razaoSocial ?? "",
            nomeFantasia: dadosFiscais.nomeFantasia ?? "",
            inscricaoEstadual: dadosFiscais.inscricaoEstadual ?? "",
            regimeTributario: dadosFiscais.regimeTributario ?? "",
            enderecoCep: dadosFiscais.enderecoCep ?? "",
            enderecoLogradouro: dadosFiscais.enderecoLogradouro ?? "",
            enderecoNumero: dadosFiscais.enderecoNumero ?? "",
            enderecoBairro: dadosFiscais.enderecoBairro ?? "",
            enderecoMunicipio: dadosFiscais.enderecoMunicipio ?? "",
            enderecoUf: dadosFiscais.enderecoUf ?? "",
            naturezaOperacaoPadrao: dadosFiscais.naturezaOperacaoPadrao,
            cfopPadrao: dadosFiscais.cfopPadrao,
            csosnPadrao: dadosFiscais.csosnPadrao,
          }}
          tokenMascarado={tokenMascarado}
        />
      </main>
    </div>
  );
}
