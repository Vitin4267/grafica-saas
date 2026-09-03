import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import {
  podeVerMeuNegocio,
  podeVerModulo,
  podeEditarModulo,
  obterModulosVisiveis,
} from "@/lib/auth/permissoes";
import { verificarEDispararAlertasAtraso } from "@/lib/alerta-atraso";
import { dataEhPassado, limitesDiaBrasilia, dataParaInputValue } from "@/lib/data";
import { resolverOrigemPublica } from "@/lib/url-publica";
import { listarMaquinasSelecionaveis, sugerirMaquinaPedido } from "@/lib/apontamento-etapa";
import { resolverEtapasGrafica } from "@/lib/etapa-grafica";
import { UserNav } from "@/components/UserNav";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { PrinterIcon, LayersIcon } from "@/components/icons";
import type { TerceirizacaoResumo } from "./TerceirizacaoPedidoSecao";
import { PedidoLinha } from "./PedidoLinha";
import { ProducaoVisualizacao } from "./ProducaoVisualizacao";
import type { PedidoKanban } from "./KanbanBoard";
import type { StatusPedido } from "@/generated/prisma/enums";
import type { AvisoPreflight } from "@/lib/preflight";

const REGEX_DATA = /^\d{4}-\d{2}-\d{2}$/;

// Terminal — pedido já concluído (entregue ou cancelado) não precisa mais de
// ação de ninguém. Fica visualmente separado do resto da fila, não misturado
// entre os pedidos que ainda estão em andamento (era a fonte da confusão:
// ordenar tudo só por "mais antigo primeiro" colocava pedido antigo já
// entregue acima de pedido novo ainda na fila).
const STATUS_FINALIZADOS = new Set<StatusPedido>(["ENTREGUE", "CANCELADO"]);

function chipAtraso(prazoEntrega: Date | null, status: string) {
  if (
    !prazoEntrega ||
    status === "ENTREGUE" ||
    status === "CANCELADO" ||
    !dataEhPassado(prazoEntrega)
  ) {
    return null;
  }

  const hojeUTC = new Date();
  hojeUTC.setUTCHours(0, 0, 0, 0);
  const diasAtraso = Math.floor((hojeUTC.getTime() - prazoEntrega.getTime()) / 86_400_000);
  return (
    <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
      Atrasado ({diasAtraso}d)
    </span>
  );
}

// Achado E1 da auditoria de abrangência (Parte 2/Produção, 2026-09-01) —
// indicador "No terceiro — retorna dd/mm" (ou "sem previsão") quando existe
// uma EtapaTerceirizada ENVIADO pra este pedido, mesma ideia de chipAtraso
// acima, usado tanto na lista (PedidoLinha) quanto no Kanban.
function chipTerceirizacao(etapas: { situacao: string; previsaoRetorno: Date | null }[]) {
  const ativa = etapas.find((e) => e.situacao === "ENVIADO");
  if (!ativa) return null;

  return (
    <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
      No terceiro
      {ativa.previsaoRetorno
        ? ` — retorna ${ativa.previsaoRetorno.toLocaleDateString("pt-BR", { timeZone: "UTC", day: "2-digit", month: "2-digit" })}`
        : " — sem previsão"}
    </span>
  );
}

// Formato que TerceirizacaoPedidoSecao.tsx espera — resolve o nome de
// exibição (Fornecedor cadastrado > nome livre digitado > fallback) e
// converte Decimal/Date pro formato serializável que cruza a fronteira
// server→client. valorAcordado/valorFinal só viajam pro client quando
// podeVerCustos (mesma regra de custos/lucro já aplicada no resto desta
// tela) — nunca no payload da página pra quem só tem PRODUCAO sem CUSTOS.
function mapearTerceirizacoes(
  etapas: {
    id: string;
    situacao: string;
    fornecedorId: string | null;
    fornecedorNome: string | null;
    fornecedor: { nome: string } | null;
    enviadoEm: Date | null;
    previsaoRetorno: Date | null;
    retornadoEm: Date | null;
    valorAcordado: unknown;
    valorFinal: unknown;
    notaRemessa: string | null;
    notaRetorno: string | null;
    observacao: string | null;
  }[],
  podeVerCustos: boolean
): TerceirizacaoResumo[] {
  return etapas.map((etapa) => ({
    id: etapa.id,
    situacao: etapa.situacao as TerceirizacaoResumo["situacao"],
    fornecedorId: etapa.fornecedorId,
    fornecedorNome: etapa.fornecedor?.nome ?? etapa.fornecedorNome ?? "Fornecedor não informado",
    enviadoEm: etapa.enviadoEm ? etapa.enviadoEm.toISOString() : null,
    previsaoRetorno: etapa.previsaoRetorno ? dataParaInputValue(etapa.previsaoRetorno) : null,
    retornadoEm: etapa.retornadoEm ? etapa.retornadoEm.toISOString() : null,
    valorAcordado: podeVerCustos && etapa.valorAcordado !== null ? Number(etapa.valorAcordado) : null,
    valorFinal: podeVerCustos && etapa.valorFinal !== null ? Number(etapa.valorFinal) : null,
    notaRemessa: etapa.notaRemessa,
    notaRetorno: etapa.notaRetorno,
    observacao: etapa.observacao,
  }));
}

export default async function ProducaoPage({
  searchParams,
}: {
  searchParams: Promise<{ clienteId?: string; de?: string; ate?: string }>;
}) {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);

  const { clienteId, de, ate } = await searchParams;
  const clienteIdFiltro = clienteId || undefined;
  const inicio = de && REGEX_DATA.test(de) ? limitesDiaBrasilia(de).inicio : undefined;
  const fim = ate && REGEX_DATA.test(ate) ? limitesDiaBrasilia(ate).fim : undefined;
  const filtrosAtivos = Boolean(clienteIdFiltro || inicio || fim);

  // Responsabilidades por etapa (ver ResponsavelEstagio) dão acesso a
  // /producao mesmo sem PRODUCAO.podeVer completo — precisa ler isso ANTES
  // do gate pra decidir se redireciona. DONO/ADMIN sempre passam por
  // podeVerModulo, então nunca precisam do fallback.
  const responsabilidades =
    usuario.papel === "OPERADOR"
      ? await prisma.responsavelEstagio.findMany({
          where: { usuarioId: usuario.id },
          select: { status: true },
        })
      : [];
  const etapasResponsavel = new Set(responsabilidades.map((r) => r.status));

  const podeVer = await podeVerModulo(usuario, "PRODUCAO");
  if (!podeVer && etapasResponsavel.size === 0) {
    redirect("/comecar");
  }
  const podeEditar = await podeEditarModulo(usuario, "PRODUCAO");

  // Permissão separada da PRODUCAO acima (ver fase-custo-real.md §2.6 /
  // PR-1): lançar custo (retrabalho, frete) não implica poder ver valor de
  // venda, custo total nem margem — é o que separa o chão de fábrica do
  // dono/gerente. podeEditarCustos e podeVerCustos são repassados até
  // CustosPedidoSecao (via PedidoLinha) pra controlar exatamente isso.
  const podeEditarCustos = await podeEditarModulo(usuario, "CUSTOS");
  const podeVerCustos = await podeVerModulo(usuario, "CUSTOS");

  await verificarEDispararAlertasAtraso(usuario.graficaId, usuario.grafica.nome);
  const origem = await resolverOrigemPublica();

  const [todosPedidos, clientes, responsaveisEstagio, maquinasSelecionaveis, fornecedoresAtivos, etapas] = await Promise.all([
    prisma.pedido.findMany({
      where: {
        graficaId: usuario.graficaId,
        ...(clienteIdFiltro ? { orcamento: { clienteId: clienteIdFiltro } } : {}),
        ...(inicio || fim
          ? { createdAt: { ...(inicio ? { gte: inicio } : {}), ...(fim ? { lte: fim } : {}) } }
          : {}),
      },
      include: {
        orcamento: {
          include: {
            cliente: true,
            itens: { include: { itemGrafica: { include: { itemCatalogo: true } } } },
          },
        },
        custos: {
          include: { categoriaCusto: true },
          orderBy: { createdAt: "desc" },
        },
        entrega: true,
        // Achado E1 da auditoria de abrangência (Parte 2/Produção) — todas
        // as terceirizações deste pedido (não só a ativa, ver
        // TerceirizacaoPedidoSecao.tsx), mais recente primeiro.
        etapasTerceirizadas: {
          include: { fornecedor: { select: { nome: true } } },
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.cliente.findMany({
      // desativadoEm: null — mesmo filtro dos outros dropdowns de cliente
      // (ver achado A9/A13).
      where: { graficaId: usuario.graficaId, desativadoEm: null },
      select: { id: true, nome: true },
      orderBy: { nome: "asc" },
    }),
    // Quem é responsável por CADA etapa (não só a do usuário logado, ver
    // `responsabilidades` acima) — pra mostrar o nome na tela, tanto na
    // lista quanto no Kanban. Tabela pequena (1 linha por
    // funcionário×etapa atribuída), sem custo de N+1 em buscar tudo de uma
    // vez em vez de filtrar por pedido.
    prisma.responsavelEstagio.findMany({
      where: { usuario: { graficaId: usuario.graficaId } },
      select: { status: true, usuario: { select: { nome: true } } },
    }),
    // Achado B2 — buscada UMA VEZ (grafica-wide, não por pedido) pra
    // alimentar o seletor de máquina de cada linha (ver SeletorMaquina.tsx).
    listarMaquinasSelecionaveis(usuario.graficaId),
    // Achado E1 — mesmo espírito de listarMaquinasSelecionaveis acima:
    // buscada UMA VEZ pra alimentar o select de fornecedor de
    // TerceirizacaoPedidoSecao em toda linha, sem N+1.
    prisma.fornecedor.findMany({
      where: { graficaId: usuario.graficaId, ativo: true },
      select: { id: true, nome: true },
      orderBy: { nome: "asc" },
    }),
    // Achado A1 (Fase 1) — sequência/rótulos DESTA gráfica (liga/desliga e
    // renomeia etapa, ver EtapaGrafica) — resolvida uma única vez aqui,
    // repassada pra PedidoLinha (lista) e KanbanBoard (quadro), os dois
    // client components que hoje importavam SEQUENCIA_STATUS_PEDIDO/
    // ROTULOS_STATUS_PEDIDO diretamente.
    resolverEtapasGrafica(usuario.graficaId),
  ]);

  const responsaveisPorEtapa: Partial<Record<StatusPedido, string[]>> = {};
  for (const r of responsaveisEstagio) {
    (responsaveisPorEtapa[r.status] ??= []).push(r.usuario.nome);
  }

  // Buscada UMA VEZ fora do loop de pedidos (evita N+1) — só as ATIVAS, pra
  // popular o select de "lançar custo" de cada linha. Categorias inativas
  // continuam aparecendo nos custos já lançados (join via categoriaCusto
  // acima), só somem da lista de opções pra lançar um custo NOVO.
  const categoriasCustoAtivas = await prisma.categoriaCusto.findMany({
    where: { graficaId: usuario.graficaId, ativa: true },
    orderBy: { ordem: "asc" },
    select: { id: true, nome: true },
  });

  // Só a CONTAGEM aqui, pra decidir se mostra o banner de gang run — a fila
  // completa (agrupada por compatibilidade física) mora em
  // /producao/gang-run (ver listarFilaGangRunAgrupada em
  // src/lib/gang-run-servico.ts). Mesmo padrão do banner de "orçamentos
  // parados" em src/app/orcamento/page.tsx.
  const totalCandidatosGangRun = await prisma.filaGangRun.count({
    where: { graficaId: usuario.graficaId, status: "AGUARDANDO" },
  });

  // Quem só entrou aqui pela responsabilidade de etapa (sem PRODUCAO.podeVer
  // de verdade) não deveria ver a fila inteira — só os pedidos que estão
  // numa das etapas dele. Quem tem podeVer completo continua vendo tudo,
  // sem filtro (inclui DONO/ADMIN, que nunca dependem de etapasResponsavel).
  const pedidosVisiveis = podeVer
    ? todosPedidos
    : todosPedidos.filter((pedido) => etapasResponsavel.has(pedido.status));

  // Ativos (ainda precisam de ação) continuam do mais antigo pro mais novo —
  // é a ordem de prioridade real de uma fila de produção. Finalizados vão
  // pro fim da lista, ordenados pelo mais recente primeiro (o que a gráfica
  // mais provavelmente quer conferir é uma entrega recente, não a mais antiga).
  const pedidosAtivos = pedidosVisiveis.filter((p) => !STATUS_FINALIZADOS.has(p.status));
  const pedidosFinalizados = [...pedidosVisiveis]
    .filter((p) => STATUS_FINALIZADOS.has(p.status))
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  const pedidos = [...pedidosAtivos, ...pedidosFinalizados];

  // Mesma fórmula usada dentro do .map da lista abaixo (lucroDoPedido, ver
  // src/lib/custo-pedido.ts) — extraída pra função porque agora também
  // alimenta pedidosKanban, sem duplicar a conta duas vezes no arquivo.
  function lucroDoPedidoListado(pedido: (typeof pedidosAtivos)[number]) {
    const custosAtivos = pedido.custos.filter((custo) => custo.estornadoEm === null);
    const custoTotalPedido = custosAtivos.reduce((soma, custo) => soma + Number(custo.valor), 0);
    return custosAtivos.length > 0 ? Number(pedido.orcamento.total) - custoTotalPedido : null;
  }

  // Visão Kanban só tem coluna pras etapas ATIVAS (ver KanbanBoard.tsx) —
  // pedidosAtivos já é exatamente esse recorte (STATUS_FINALIZADOS excluído
  // acima), então nada de recalcular o filtro. valor/lucro seguem a mesma
  // regra de podeVerCustos da lista: nunca viajam pro client sem permissão,
  // nem escondidos por CSS.
  const pedidosKanban: PedidoKanban[] = pedidosAtivos.map((pedido) => ({
    id: pedido.id,
    orcamentoId: pedido.orcamentoId,
    clienteNome: pedido.orcamento.cliente.nome,
    itensResumo: pedido.orcamento.itens.map((i) => i.itemGrafica.itemCatalogo.nome).join(", "),
    status: pedido.status,
    chipAtraso: chipAtraso(pedido.prazoEntrega, pedido.status),
    chipTerceirizacao: chipTerceirizacao(pedido.etapasTerceirizadas),
    valorTotal: podeVerCustos ? Number(pedido.orcamento.total) : null,
    lucro: podeVerCustos ? lucroDoPedidoListado(pedido) : null,
    souResponsavelDesteStatus: etapasResponsavel.has(pedido.status),
  }));

  // Construído aqui (fora do JSX final) pra poder ser passado pronto —
  // já renderizado pelo servidor — como children de ProducaoVisualizacao
  // (client component): a lista continua 100% a mesma, só o lugar onde ela
  // é montada muda (alterna com o Kanban via CSS, não é recriada).
  const listaConteudo =
    pedidos.length === 0 ? (
      <EmptyState
        icone={<PrinterIcon className="h-6 w-6" />}
        texto={
          filtrosAtivos
            ? "Nenhum pedido encontrado com esse filtro."
            : "Nenhum pedido em produção ainda. Pedidos aparecem aqui automaticamente quando um orçamento é aprovado."
        }
        href="/orcamento"
        rotuloCta="Ir para Orçamento"
      />
    ) : (
      <Card className="divide-y divide-slate-100 dark:divide-slate-800">
        {pedidos.map((pedido, indice) => {
          // Divisor visual só na virada de ativos pra finalizados (nunca
          // no topo, mesmo se a lista inteira for só finalizados).
          const inicioFinalizados = indice === pedidosAtivos.length && pedidosAtivos.length > 0;

          // Achado B2 — sugestão pré-preenchida a partir da máquina que os
          // ITENS deste pedido usaram na precificação (ver
          // sugerirMaquinaPedido); "campo:id" codificado ou "" quando não há
          // sugestão (nenhum item com máquina configurada, ou ambígua entre
          // eles). Calculado aqui (não numa query própria) porque
          // pedido.orcamento.itens já veio com o itemGrafica inteiro (todos
          // os scalars, ver `include` acima) — nenhuma query extra por pedido.
          const sugestao = sugerirMaquinaPedido(pedido.orcamento.itens);
          const sugestaoMaquinaValor = sugestao ? `${sugestao.campo}:${sugestao.id}` : "";

          return (
            <div key={pedido.id}>
              {inicioFinalizados && (
                <p className="bg-slate-50 px-6 py-2 text-xs font-medium text-slate-500 dark:bg-slate-900/50">
                  Finalizados
                </p>
              )}
              <PedidoLinha
                pedidoId={pedido.id}
                orcamentoId={pedido.orcamentoId}
                clienteNome={pedido.orcamento.cliente.nome}
                itensResumo={pedido.orcamento.itens
                  .map((i) => i.itemGrafica.itemCatalogo.nome)
                  .join(", ")}
                status={pedido.status}
                podeEditar={podeEditar}
                podeEditarCustos={podeEditarCustos}
                podeVerCustos={podeVerCustos}
                souResponsavelDesteStatus={etapasResponsavel.has(pedido.status)}
                chipAtraso={chipAtraso(pedido.prazoEntrega, pedido.status)}
                chipTerceirizacao={chipTerceirizacao(pedido.etapasTerceirizadas)}
                arteUrl={pedido.arteUrl}
                arteAprovadaEm={pedido.arteAprovadaEm}
                arteRespondidaPor={pedido.arteRespondidaPor}
                arteComentarioCliente={pedido.arteComentarioCliente}
                linkArtePublico={pedido.arteLinkToken ? `${origem}/a/${pedido.arteLinkToken}` : null}
                preflightAvisos={(pedido.preflightAvisos as AvisoPreflight[] | null) ?? []}
                responsaveisEtapa={responsaveisPorEtapa[pedido.status] ?? []}
                categoriasCustoAtivas={categoriasCustoAtivas}
                // valor/lucro só viajam pro client quando podeVerCustos:
                // nunca deixar quem só tem CUSTOS.podeEditar (lança
                // retrabalho) receber o número no payload da página, nem
                // que escondido por CSS — ver critério de aceite do PR-1.
                custos={pedido.custos.map((custo) => ({
                  id: custo.id,
                  categoriaNome: custo.categoriaCusto.nome,
                  valor: podeVerCustos ? Number(custo.valor) : null,
                  observacao: custo.observacao,
                  createdAt: custo.createdAt.toISOString(),
                }))}
                lucro={podeVerCustos ? lucroDoPedidoListado(pedido) : null}
                maquinas={maquinasSelecionaveis}
                sugestaoMaquinaValor={sugestaoMaquinaValor}
                sequencia={etapas.sequencia}
                rotulos={etapas.rotulos}
                entrega={
                  pedido.entrega
                    ? {
                        id: pedido.entrega.id,
                        status: pedido.entrega.status,
                        motorista: pedido.entrega.motorista,
                        dataSaida: pedido.entrega.dataSaida ? pedido.entrega.dataSaida.toISOString() : null,
                        dataEntrega: pedido.entrega.dataEntrega ? pedido.entrega.dataEntrega.toISOString() : null,
                        observacoes: pedido.entrega.observacoes,
                      }
                    : null
                }
                terceirizacoes={mapearTerceirizacoes(pedido.etapasTerceirizadas, podeVerCustos)}
                fornecedores={fornecedoresAtivos}
              />
            </div>
          );
        })}
      </Card>
    );

  return (
    <div className="flex flex-1 flex-col">
      <UserNav
        nome={usuario.nome}
        graficaNome={usuario.grafica.nome}
        papel={usuario.papel}
        paginaAtual="/producao"
        mostrarMeuNegocio={podeVerMeuNegocio(usuario)}
        modulosVisiveis={await obterModulosVisiveis(usuario)}
      />

      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Fila de produção
          </h1>
          <p className="mt-1 text-slate-500">
            Pedidos em andamento primeiro (do mais antigo pro mais novo).
            Entregues e cancelados ficam no fim da lista.
          </p>
        </div>

        {totalCandidatosGangRun > 0 && (
          <Card className="mb-8 flex flex-col items-start justify-between gap-4 p-6 sm:flex-row sm:items-center">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400">
                <LayersIcon className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                  {totalCandidatosGangRun}{" "}
                  {totalCandidatosGangRun === 1
                    ? "item esperando gang run"
                    : "itens esperando gang run"}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Peças Offset pequenas demais pra encher uma chapa sozinhas — combine com
                  pedidos compatíveis pra dividir o custo.
                </p>
              </div>
            </div>
            <Link href="/producao/gang-run" className="shrink-0">
              <Button type="button" variant="outline">
                Ver fila de gang run
              </Button>
            </Link>
          </Card>
        )}

        <form className="mb-6 flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <Select label="Cliente" name="clienteId" defaultValue={clienteIdFiltro ?? ""}>
              <option value="">Todos os clientes</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-40">
            <Input label="De" type="date" name="de" defaultValue={de ?? ""} />
          </div>
          <div className="w-40">
            <Input label="Até" type="date" name="ate" defaultValue={ate ?? ""} />
          </div>
          <Button type="submit" variant="outline">
            Filtrar
          </Button>
          {filtrosAtivos && (
            <Link href="/producao" className="text-sm text-slate-500 underline decoration-dotted underline-offset-2 hover:text-slate-700 dark:hover:text-slate-300">
              Limpar filtros
            </Link>
          )}
        </form>

        <ProducaoVisualizacao
          lista={listaConteudo}
          pedidosKanban={pedidosKanban}
          podeEditar={podeEditar}
          podeVerCustos={podeVerCustos}
          responsaveisPorEtapa={responsaveisPorEtapa}
          sequencia={etapas.sequencia}
          rotulos={etapas.rotulos}
        />
      </main>
    </div>
  );
}
