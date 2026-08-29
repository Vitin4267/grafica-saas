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
import { UserNav } from "@/components/UserNav";
import { ArrowLeftIcon } from "@/components/icons";
import { ClienteEditForm } from "./ClienteEditForm";
import { ContatosClienteCard } from "./ContatosClienteCard";

export default async function ClienteDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  await exigirVerModulo(usuario, "CLIENTES");
  const podeEditar = await podeEditarModulo(usuario, "CLIENTES");

  const [cliente, vendedores, contatos] = await Promise.all([
    prisma.cliente.findFirst({
      where: { id, graficaId: usuario.graficaId },
    }),
    // Achado A8 — mesma lista fechada de ClientesPage (usuários ativos da
    // gráfica, sem role "vendedor" explícita no sistema).
    prisma.usuario.findMany({
      where: { graficaId: usuario.graficaId, desativadoEm: null },
      orderBy: { nome: "asc" },
      select: { id: true, nome: true },
    }),
    // Achado A4 da Parte 5 — inclui inativos de propósito: esta é a tela de
    // GESTÃO dos contatos (precisa reativar), diferente do <select> do
    // orçamento (esse sim só ativos, ver EditarDadosGeraisOrcamentoForm.tsx).
    prisma.contatoCliente.findMany({
      where: { clienteId: id },
      orderBy: [{ ativo: "desc" }, { principal: "desc" }, { nome: "asc" }],
    }),
  ]);

  if (!cliente) {
    notFound();
  }

  return (
    <div className="flex flex-1 flex-col">
      <UserNav
        nome={usuario.nome}
        graficaNome={usuario.grafica.nome}
        papel={usuario.papel}
        paginaAtual="/clientes"
        mostrarMeuNegocio={podeVerMeuNegocio(usuario)}
        modulosVisiveis={await obterModulosVisiveis(usuario)}
      />

      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
        <Link
          href="/clientes"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Voltar aos clientes
        </Link>

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{cliente.nome}</h1>
          <p className="mt-1 text-slate-500">
            O endereço é usado pra emitir nota fiscal — preencha antes de
            aprovar um orçamento pra esse cliente se for emitir nota.
          </p>
        </div>

        <ClienteEditForm
          clienteId={cliente.id}
          podeEditar={podeEditar}
          vendedores={vendedores}
          valoresIniciais={{
            nome: cliente.nome,
            email: cliente.email ?? "",
            telefone: cliente.telefone ?? "",
            documento: cliente.documento ?? "",
            tipoPessoa: cliente.tipoPessoa ?? "",
            razaoSocial: cliente.razaoSocial ?? "",
            nomeFantasia: cliente.nomeFantasia ?? "",
            inscricaoEstadual: cliente.inscricaoEstadual ?? "",
            indicadorInscricaoEstadual: cliente.indicadorInscricaoEstadual ?? "",
            inscricaoMunicipal: cliente.inscricaoMunicipal ?? "",
            enderecoCep: cliente.enderecoCep ?? "",
            enderecoLogradouro: cliente.enderecoLogradouro ?? "",
            enderecoNumero: cliente.enderecoNumero ?? "",
            enderecoComplemento: cliente.enderecoComplemento ?? "",
            enderecoBairro: cliente.enderecoBairro ?? "",
            enderecoMunicipio: cliente.enderecoMunicipio ?? "",
            enderecoCodigoIbge: cliente.enderecoCodigoIbge ?? "",
            enderecoUf: cliente.enderecoUf ?? "",
            bloqueadoParaVenda: cliente.bloqueadoParaVenda,
            motivoBloqueio: cliente.motivoBloqueio ?? "",
            limiteCredito: cliente.limiteCredito !== null ? cliente.limiteCredito.toString() : "",
            prazoPagamentoPadraoDias:
              cliente.prazoPagamentoPadraoDias !== null ? cliente.prazoPagamentoPadraoDias.toString() : "",
            bloqueadoParaFaturamento: cliente.bloqueadoParaFaturamento,
            motivoBloqueioFaturamento: cliente.motivoBloqueioFaturamento ?? "",
            formaPagamentoPreferida: cliente.formaPagamentoPreferida ?? "",
            descontoPadraoPercent:
              cliente.descontoPadraoPercent !== null ? cliente.descontoPadraoPercent.toString() : "",
            observacaoFinanceira: cliente.observacaoFinanceira ?? "",
            observacoes: cliente.observacoes ?? "",
            preferenciasProducao: cliente.preferenciasProducao ?? "",
            origem: cliente.origem ?? "",
            origemOutro: cliente.origemOutro ?? "",
            segmento: cliente.segmento ?? "",
            segmentoOutro: cliente.segmentoOutro ?? "",
            margemPadraoOverride:
              cliente.margemPadraoOverride !== null ? cliente.margemPadraoOverride.toString() : "",
            vendedorId: cliente.vendedorId ?? "",
            desativadoEm: cliente.desativadoEm ? cliente.desativadoEm.toISOString() : null,
          }}
        />

        <div className="mt-6">
          <ContatosClienteCard
            clienteId={cliente.id}
            podeEditar={podeEditar}
            contatos={contatos.map((contato) => ({
              id: contato.id,
              nome: contato.nome,
              cargo: contato.cargo,
              departamento: contato.departamento,
              email: contato.email,
              telefone: contato.telefone,
              whatsapp: contato.whatsapp,
              funcao: contato.funcao,
              funcaoOutro: contato.funcaoOutro,
              principal: contato.principal,
              ativo: contato.ativo,
            }))}
          />
        </div>
      </main>
    </div>
  );
}
