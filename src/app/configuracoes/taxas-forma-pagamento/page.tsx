import Link from "next/link";
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
import { Card } from "@/components/ui/Card";
import { ArrowLeftIcon } from "@/components/icons";
import { NovaTaxaFormaPagamentoForm } from "./NovaTaxaFormaPagamentoForm";
import { ROTULO_FORMA_PAGAMENTO } from "./tipos";

export default async function TaxasFormaPagamentoPage() {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  await exigirVerModulo(usuario, "CONFIGURACOES");
  const podeEditar = await podeEditarModulo(usuario, "CONFIGURACOES");

  const taxas = await prisma.taxaFormaPagamento.findMany({
    where: { graficaId: usuario.graficaId },
    orderBy: { forma: "asc" },
  });
  const formasJaCadastradas = new Set(taxas.map((t) => t.forma));

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
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Taxas de forma de pagamento
          </h1>
          <p className="mt-1 text-slate-500">
            Quanto a maquininha/banco cobra de cada forma de pagamento (ex:
            3,5% no cartão de crédito) e em quantos dias o dinheiro
            compensa. Cadastre aqui pra o valor da taxa vir pré-preenchido
            (sempre editável) na hora de registrar um pagamento novo — nunca
            muda nenhum pagamento já registrado.
          </p>
        </div>

        <div className="mb-8 flex flex-col gap-2">
          {taxas.length === 0 && (
            <Card className="p-5">
              <p className="text-sm text-slate-500">
                Nenhuma taxa cadastrada ainda — cadastre a primeira abaixo.
              </p>
            </Card>
          )}
          {taxas.map((taxa) => (
            <Link key={taxa.id} href={`/configuracoes/taxas-forma-pagamento/${taxa.id}`}>
              <Card className="flex items-center justify-between p-5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <div>
                  <p className="font-medium text-slate-900 dark:text-white">
                    {ROTULO_FORMA_PAGAMENTO[taxa.forma] ?? taxa.forma}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {taxa.percentual.toString()}% · compensa em {taxa.diasCompensacao}{" "}
                    {taxa.diasCompensacao === 1 ? "dia" : "dias"}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                    taxa.ativa
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                      : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                  }`}
                >
                  {taxa.ativa ? "Ativa" : "Inativa"}
                </span>
              </Card>
            </Link>
          ))}
        </div>

        {podeEditar && (
          <Card className="p-6">
            <h2 className="mb-4 text-base font-semibold text-slate-900 dark:text-white">
              Nova taxa
            </h2>
            <NovaTaxaFormaPagamentoForm formasJaCadastradas={Array.from(formasJaCadastradas)} />
          </Card>
        )}
      </main>
    </div>
  );
}
