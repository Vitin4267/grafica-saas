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
import { formatoInstanteRealComHora } from "@/lib/data";
import { ROTULO_TIPO_MANUTENCAO, indexarManutencoesAtivasPorMaquina } from "@/lib/manutencao-maquina";
import { ManutencaoMaquinaCard } from "./ManutencaoMaquinaCard";

const LIMITE_HISTORICO = 50;

export default async function ManutencaoMaquinasPage() {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  await exigirVerModulo(usuario, "CONFIGURACOES");
  const podeEditar = await podeEditarModulo(usuario, "CONFIGURACOES");

  const [
    prensas,
    maquinasFlexografia,
    equipamentos,
    impressorasDigitais,
    maquinasSetupPorPeca,
    registrosAtivos,
    historico,
  ] = await Promise.all([
    prisma.prensa.findMany({
      where: { graficaId: usuario.graficaId },
      orderBy: { nome: "asc" },
    }),
    prisma.maquinaFlexografia.findMany({
      where: { graficaId: usuario.graficaId },
      orderBy: { nome: "asc" },
    }),
    prisma.equipamento.findMany({
      where: { graficaId: usuario.graficaId },
      orderBy: { nome: "asc" },
    }),
    prisma.impressoraDigital.findMany({
      where: { graficaId: usuario.graficaId },
      orderBy: { nome: "asc" },
    }),
    prisma.maquinaSetupPorPeca.findMany({
      where: { graficaId: usuario.graficaId },
      orderBy: { nome: "asc" },
    }),
    prisma.registroManutencao.findMany({
      where: { graficaId: usuario.graficaId, dataFim: null },
    }),
    prisma.registroManutencao.findMany({
      where: { graficaId: usuario.graficaId, dataFim: { not: null } },
      orderBy: { dataFim: "desc" },
      take: LIMITE_HISTORICO,
      include: {
        prensa: { select: { nome: true } },
        maquinaFlexografia: { select: { nome: true } },
        equipamento: { select: { nome: true } },
        impressoraDigital: { select: { nome: true } },
        maquinaSetupPorPeca: { select: { nome: true } },
      },
    }),
  ]);

  // Resolve registradoPorId -> nome em batch (mesmo padrão do histórico de
  // movimentação de estoque em /catalogo/[itemGraficaId]) — sem FK direta
  // pra Usuario no schema, então precisa de uma segunda query.
  const idsRegistradores = [
    ...new Set(
      [...registrosAtivos, ...historico]
        .map((r) => r.registradoPorId)
        .filter((id): id is string => id !== null)
    ),
  ];
  const registradores =
    idsRegistradores.length > 0
      ? await prisma.usuario.findMany({
          where: { id: { in: idsRegistradores }, graficaId: usuario.graficaId },
          select: { id: true, nome: true },
        })
      : [];
  const nomePorRegistradorId = new Map(registradores.map((r) => [r.id, r.nome]));
  const nomeRegistrador = (id: string | null) =>
    id ? (nomePorRegistradorId.get(id) ?? "Usuário removido") : "Sistema";

  const ativosPorMaquina = indexarManutencoesAtivasPorMaquina(registrosAtivos);

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
          href="/configuracoes/maquinas"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Voltar às máquinas
        </Link>

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Manutenção de máquinas
          </h1>
          <p className="mt-1 text-slate-500">
            Registre paradas (preventivas ou quebras) das prensas e máquinas de
            flexografia. Enquanto uma parada estiver em andamento, a máquina
            aparece com aviso no cadastro de produtos.
          </p>
        </div>

        {!podeEditar && (
          <p className="mb-6 text-sm text-slate-500">
            Você tem acesso só de leitura a esta tela.
          </p>
        )}

        <div className="mb-10">
          <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">Offset</h2>
          <div className="flex flex-col gap-3">
            {prensas.length === 0 && (
              <Card className="p-5">
                <p className="text-sm text-slate-500">Nenhuma prensa cadastrada ainda.</p>
              </Card>
            )}
            {prensas.map((prensa) => {
              const registro = ativosPorMaquina.get(prensa.id);
              return podeEditar ? (
                <ManutencaoMaquinaCard
                  key={prensa.id}
                  maquinaId={prensa.id}
                  maquinaNome={prensa.nome}
                  campoId="prensaId"
                  registroAtivo={
                    registro
                      ? {
                          id: registro.id,
                          tipo: registro.tipo,
                          motivo: registro.motivo,
                          dataInicioFormatada: formatoInstanteRealComHora.format(registro.dataInicio),
                          registradoPorNome: nomeRegistrador(registro.registradoPorId),
                        }
                      : null
                  }
                />
              ) : (
                <Card key={prensa.id} className="p-5">
                  <p className="font-medium text-slate-900 dark:text-white">{prensa.nome}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {registro ? `Parada desde ${formatoInstanteRealComHora.format(registro.dataInicio)}` : "Disponível pra produção"}
                  </p>
                </Card>
              );
            })}
          </div>
        </div>

        <div className="mb-10">
          <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">
            Flexografia
          </h2>
          <div className="flex flex-col gap-3">
            {maquinasFlexografia.length === 0 && (
              <Card className="p-5">
                <p className="text-sm text-slate-500">Nenhuma máquina cadastrada ainda.</p>
              </Card>
            )}
            {maquinasFlexografia.map((maquina) => {
              const registro = ativosPorMaquina.get(maquina.id);
              return podeEditar ? (
                <ManutencaoMaquinaCard
                  key={maquina.id}
                  maquinaId={maquina.id}
                  maquinaNome={maquina.nome}
                  campoId="maquinaFlexografiaId"
                  registroAtivo={
                    registro
                      ? {
                          id: registro.id,
                          tipo: registro.tipo,
                          motivo: registro.motivo,
                          dataInicioFormatada: formatoInstanteRealComHora.format(registro.dataInicio),
                          registradoPorNome: nomeRegistrador(registro.registradoPorId),
                        }
                      : null
                  }
                />
              ) : (
                <Card key={maquina.id} className="p-5">
                  <p className="font-medium text-slate-900 dark:text-white">{maquina.nome}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {registro ? `Parada desde ${formatoInstanteRealComHora.format(registro.dataInicio)}` : "Disponível pra produção"}
                  </p>
                </Card>
              );
            })}
          </div>
        </div>

        <div className="mb-10">
          <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">
            Outros equipamentos
          </h2>
          <div className="flex flex-col gap-3">
            {equipamentos.length === 0 && (
              <Card className="p-5">
                <p className="text-sm text-slate-500">Nenhum equipamento cadastrado ainda.</p>
              </Card>
            )}
            {equipamentos.map((equipamento) => {
              const registro = ativosPorMaquina.get(equipamento.id);
              return podeEditar ? (
                <ManutencaoMaquinaCard
                  key={equipamento.id}
                  maquinaId={equipamento.id}
                  maquinaNome={equipamento.nome}
                  campoId="equipamentoId"
                  registroAtivo={
                    registro
                      ? {
                          id: registro.id,
                          tipo: registro.tipo,
                          motivo: registro.motivo,
                          dataInicioFormatada: formatoInstanteRealComHora.format(registro.dataInicio),
                          registradoPorNome: nomeRegistrador(registro.registradoPorId),
                        }
                      : null
                  }
                />
              ) : (
                <Card key={equipamento.id} className="p-5">
                  <p className="font-medium text-slate-900 dark:text-white">{equipamento.nome}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {registro ? `Parada desde ${formatoInstanteRealComHora.format(registro.dataInicio)}` : "Disponível pra produção"}
                  </p>
                </Card>
              );
            })}
          </div>
        </div>

        <div className="mb-10">
          <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">
            Impressão Digital
          </h2>
          <div className="flex flex-col gap-3">
            {impressorasDigitais.length === 0 && (
              <Card className="p-5">
                <p className="text-sm text-slate-500">Nenhuma impressora cadastrada ainda.</p>
              </Card>
            )}
            {impressorasDigitais.map((impressora) => {
              const registro = ativosPorMaquina.get(impressora.id);
              return podeEditar ? (
                <ManutencaoMaquinaCard
                  key={impressora.id}
                  maquinaId={impressora.id}
                  maquinaNome={impressora.nome}
                  campoId="impressoraDigitalId"
                  registroAtivo={
                    registro
                      ? {
                          id: registro.id,
                          tipo: registro.tipo,
                          motivo: registro.motivo,
                          dataInicioFormatada: formatoInstanteRealComHora.format(registro.dataInicio),
                          registradoPorNome: nomeRegistrador(registro.registradoPorId),
                        }
                      : null
                  }
                />
              ) : (
                <Card key={impressora.id} className="p-5">
                  <p className="font-medium text-slate-900 dark:text-white">{impressora.nome}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {registro ? `Parada desde ${formatoInstanteRealComHora.format(registro.dataInicio)}` : "Disponível pra produção"}
                  </p>
                </Card>
              );
            })}
          </div>
        </div>

        <div className="mb-10">
          <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">
            Serigrafia / Sublimação / Estampagem a quente
          </h2>
          <div className="flex flex-col gap-3">
            {maquinasSetupPorPeca.length === 0 && (
              <Card className="p-5">
                <p className="text-sm text-slate-500">Nenhuma máquina cadastrada ainda.</p>
              </Card>
            )}
            {maquinasSetupPorPeca.map((maquina) => {
              const registro = ativosPorMaquina.get(maquina.id);
              return podeEditar ? (
                <ManutencaoMaquinaCard
                  key={maquina.id}
                  maquinaId={maquina.id}
                  maquinaNome={maquina.nome}
                  campoId="maquinaSetupPorPecaId"
                  registroAtivo={
                    registro
                      ? {
                          id: registro.id,
                          tipo: registro.tipo,
                          motivo: registro.motivo,
                          dataInicioFormatada: formatoInstanteRealComHora.format(registro.dataInicio),
                          registradoPorNome: nomeRegistrador(registro.registradoPorId),
                        }
                      : null
                  }
                />
              ) : (
                <Card key={maquina.id} className="p-5">
                  <p className="font-medium text-slate-900 dark:text-white">{maquina.nome}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {registro ? `Parada desde ${formatoInstanteRealComHora.format(registro.dataInicio)}` : "Disponível pra produção"}
                  </p>
                </Card>
              );
            })}
          </div>
        </div>

        <Card className="flex flex-col gap-1 p-6">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Histórico de paradas
          </h2>
          <p className="mb-3 text-sm text-slate-500">
            Últimas {LIMITE_HISTORICO} paradas já encerradas, mais recente primeiro.
          </p>
          {historico.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              Nenhuma parada encerrada ainda.
            </p>
          ) : (
            <div className="-mx-6 divide-y divide-slate-100 dark:divide-slate-800">
              {historico.map((registro) => (
                <div key={registro.id} className="flex items-start justify-between gap-4 px-6 py-4">
                  <div>
                    <p className="text-sm text-slate-900 dark:text-white">
                      {registro.prensa?.nome ??
                        registro.maquinaFlexografia?.nome ??
                        registro.equipamento?.nome ??
                        registro.impressoraDigital?.nome ??
                        registro.maquinaSetupPorPeca?.nome ??
                        "Máquina removida"}
                      {" · "}
                      {ROTULO_TIPO_MANUTENCAO[registro.tipo]}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">{registro.motivo}</p>
                  </div>
                  <div className="shrink-0 text-right text-xs text-slate-500">
                    <p>
                      {formatoInstanteRealComHora.format(registro.dataInicio)} até{" "}
                      {registro.dataFim ? formatoInstanteRealComHora.format(registro.dataFim) : "—"}
                    </p>
                    <p className="mt-1">{nomeRegistrador(registro.registradoPorId)}</p>
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
