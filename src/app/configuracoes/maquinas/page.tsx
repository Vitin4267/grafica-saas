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
import { NovaPrensaForm } from "../prensas/NovaPrensaForm";
import { NovaMaquinaFlexografiaForm } from "./flexografia/NovaMaquinaFlexografiaForm";
import { indexarManutencoesAtivasPorMaquina } from "@/lib/manutencao-maquina";

export default async function MaquinasPage() {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  await exigirVerModulo(usuario, "CONFIGURACOES");
  const podeEditar = await podeEditarModulo(usuario, "CONFIGURACOES");

  const [prensas, maquinasFlexografia, registrosAtivos] = await Promise.all([
    prisma.prensa.findMany({
      where: { graficaId: usuario.graficaId },
      orderBy: { nome: "asc" },
    }),
    prisma.maquinaFlexografia.findMany({
      where: { graficaId: usuario.graficaId },
      orderBy: { nome: "asc" },
    }),
    prisma.registroManutencao.findMany({
      where: { graficaId: usuario.graficaId, dataFim: null },
      select: { prensaId: true, maquinaFlexografiaId: true },
    }),
  ]);
  // Só pra saber QUAIS máquinas estão paradas agora (badge de aviso) — o
  // registro completo (motivo, tipo, desde quando) fica na tela dedicada de
  // manutenção, pra não sobrecarregar esta lista.
  const ativasPorMaquina = indexarManutencoesAtivasPorMaquina(registrosAtivos);

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

        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Máquinas</h1>
            <p className="mt-1 text-slate-500">
              Cada máquina tem seu próprio custo e rodagem. Produtos do catálogo
              escolhem uma máquina específica conforme o modelo de cálculo.
            </p>
          </div>
          <Link
            href="/configuracoes/maquinas/manutencao"
            className="shrink-0 whitespace-nowrap rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Manutenção
          </Link>
        </div>

        <div className="mb-10">
          <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">
            Offset
          </h2>
          <div className="mb-6 flex flex-col gap-3">
            {prensas.length === 0 && (
              <Card className="p-5">
                <p className="text-sm text-slate-500">
                  Nenhuma prensa cadastrada ainda — crie a primeira abaixo.
                </p>
              </Card>
            )}
            {prensas.map((prensa) => (
              <Link key={prensa.id} href={`/configuracoes/prensas/${prensa.id}`}>
                <Card className="flex items-center justify-between p-5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <div>
                    <p className="font-medium text-slate-900 dark:text-white">
                      {prensa.nome}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {prensa.torres} torres · R$ {Number(prensa.custoHoraMaq).toFixed(2)}/h
                      de máquina
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {ativasPorMaquina.has(prensa.id) && (
                      <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                        Em manutenção
                      </span>
                    )}
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        prensa.ativa
                          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                          : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                      }`}
                    >
                      {prensa.ativa ? "Ativa" : "Inativa"}
                    </span>
                  </div>
                </Card>
              </Link>
            ))}
          </div>

          {podeEditar && (
            <Card className="p-6">
              <h3 className="mb-4 text-base font-semibold text-slate-900 dark:text-white">
                Nova prensa
              </h3>
              <NovaPrensaForm />
            </Card>
          )}
        </div>

        <div className="mb-8">
          <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">
            Flexografia
          </h2>
          <div className="mb-6 flex flex-col gap-3">
            {maquinasFlexografia.length === 0 && (
              <Card className="p-5">
                <p className="text-sm text-slate-500">
                  Nenhuma máquina de flexografia cadastrada ainda — crie a
                  primeira abaixo.
                </p>
              </Card>
            )}
            {maquinasFlexografia.map((maquina) => (
              <Link
                key={maquina.id}
                href={`/configuracoes/maquinas/flexografia/${maquina.id}`}
              >
                <Card className="flex items-center justify-between p-5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <div>
                    <p className="font-medium text-slate-900 dark:text-white">
                      {maquina.nome}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {Number(maquina.larguraMaquinaM).toFixed(2)} m de largura · R${" "}
                      {Number(maquina.custoHoraMaq).toFixed(2)}/h de máquina
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {ativasPorMaquina.has(maquina.id) && (
                      <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                        Em manutenção
                      </span>
                    )}
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        maquina.ativa
                          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                          : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                      }`}
                    >
                      {maquina.ativa ? "Ativa" : "Inativa"}
                    </span>
                  </div>
                </Card>
              </Link>
            ))}
          </div>

          {podeEditar && (
            <Card className="p-6">
              <h3 className="mb-4 text-base font-semibold text-slate-900 dark:text-white">
                Nova máquina de flexografia
              </h3>
              <NovaMaquinaFlexografiaForm />
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
