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
import { garantirFeriadosNacionaisPadrao } from "@/lib/dias-uteis";
import { formatoData } from "@/lib/data";
import { UserNav } from "@/components/UserNav";
import { Card } from "@/components/ui/Card";
import { ArrowLeftIcon } from "@/components/icons";
import { NovoFeriadoForm } from "./NovoFeriadoForm";
import { RemoverFeriadoForm } from "./RemoverFeriadoForm";

export default async function FeriadosPage() {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  await exigirVerModulo(usuario, "CONFIGURACOES");
  const podeEditar = await podeEditarModulo(usuario, "CONFIGURACOES");

  // Idempotente: só semeia os 8 feriados nacionais fixos (Confraternização,
  // Tiradentes, Trabalho...) se a gráfica ainda não tem NENHUM feriado
  // cadastrado — assim toda gráfica já vê algo pronto na primeira visita a
  // esta tela (ver comentário em src/lib/dias-uteis.ts).
  await garantirFeriadosNacionaisPadrao(usuario.graficaId);

  const feriados = await prisma.feriadoGrafica.findMany({
    where: { graficaId: usuario.graficaId },
    orderBy: { data: "asc" },
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
          href="/configuracoes"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Voltar a Configurações
        </Link>

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Feriados</h1>
          <p className="mt-1 text-slate-500">
            Usados pra calcular o prazo de entrega em dias úteis (ver
            &quot;Prazo em dias úteis&quot; nas Configurações gerais) e pro alerta
            de prazo por e-mail pular datas em que sua gráfica não funciona.
            Vieram 8 feriados nacionais fixos prontos — adicione os
            municipais/estaduais da sua cidade e os móveis (Carnaval, Corpus
            Christi) ano a ano.
          </p>
        </div>

        <div className="mb-8 flex flex-col gap-2">
          {feriados.length === 0 && (
            <Card className="p-5">
              <p className="text-sm text-slate-500">Nenhum feriado cadastrado ainda.</p>
            </Card>
          )}
          {feriados.map((feriado) => (
            <Card key={feriado.id} className="flex items-center justify-between gap-4 p-5">
              <div>
                <p className="font-medium text-slate-900 dark:text-white">{feriado.descricao}</p>
                <p className="text-sm text-slate-500">
                  {formatoData.format(feriado.data)}
                  {feriado.recorrenteAnual && " · Recorrente todo ano"}
                </p>
              </div>
              {podeEditar && (
                <RemoverFeriadoForm feriadoId={feriado.id} descricao={feriado.descricao} />
              )}
            </Card>
          ))}
        </div>

        {podeEditar && (
          <Card className="p-6">
            <h2 className="mb-4 text-base font-semibold text-slate-900 dark:text-white">
              Novo feriado
            </h2>
            <NovoFeriadoForm />
          </Card>
        )}
      </main>
    </div>
  );
}
