import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatoMoeda } from "@/lib/moeda";
import { formatoInstanteRealComHora } from "@/lib/data";
import { orcamentoEstaExpirado } from "@/lib/orcamento-status";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/Badge";
import { Logo } from "@/components/Logo";
import { RespostaPublica } from "./RespostaPublica";
import { OpcoesPublicasTabs, type OpcaoPublica } from "./OpcoesPublicasTabs";
import { EtiquetaResumo, type EtiquetaResumoDados } from "@/app/orcamento/[id]/EtiquetaResumo";
import { converterDeCm, ROTULO_UNIDADE_DIMENSAO } from "@/lib/unidade-dimensao";
import { ROTULO_TIPO_CHAVE_PIX } from "@/lib/tipos-grafica";
import { calcularPrazoEfetivoDias } from "@/lib/orcamento-prazo";

const ROTULO_TIPO_PEDIDO: Record<string, string> = {
  MODELO_NOVO: "Modelo novo",
  REPETICAO_SEM_ALTERACAO: "Repetição sem alteração",
  REPETICAO_COM_ALTERACAO: "Repetição com alteração",
};
const ROTULO_FRETE: Record<string, string> = { EMITENTE: "Emitente", DESTINATARIO: "Destinatário" };

export default async function OrcamentoPublicoPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Busca só pelo token — rota pública, sem exigirUsuarioAutenticado().
  const orcamento = await prisma.orcamento.findUnique({
    where: { linkPublicoToken: token },
    include: {
      cliente: true,
      grafica: {
        include: { parametros: { select: { mostrarEspecificacoesTecnicas: true, prazoEmDiasUteis: true } } },
      },
      // opcaoId: null — só a opção-base ("Opção A"). Opções alternativas
      // (ver model OrcamentoOpcao) vêm à parte, no include `opcoes` abaixo.
      itens: {
        where: { opcaoId: null },
        include: {
          itemGrafica: { include: { itemCatalogo: true } },
          etiqueta: { include: { hotStampings: true } },
          faixasQuantidade: { orderBy: { quantidade: "asc" } }, // achado B5
        },
      },
      opcoes: {
        orderBy: { ordem: "asc" },
        include: {
          itens: {
            include: {
              itemGrafica: { include: { itemCatalogo: true } },
              etiqueta: { include: { hotStampings: true } },
              // Achado B5 — faixa é sempre criada num item da opção-base (ver
              // opcaoId: null nas actions de faixas.ts, mesma restrição de
              // editarOrcamento/adicionarItemOrcamento); incluído aqui só pra
              // manter o mesmo shape de `orcamento.itens` acima e o helper
              // mapearItensParaOpcaoPublica funcionar pros dois — na prática
              // sempre um array vazio pra item de opção alternativa.
              faixasQuantidade: { orderBy: { quantidade: "asc" } },
            },
          },
        },
      },
    },
  });

  if (!orcamento) {
    notFound();
  }

  const ehPdf = orcamento.arteUrl?.toLowerCase().endsWith(".pdf") ?? false;
  // Default true: mesmo comportamento de sempre mostrar, que já existia
  // antes deste toggle (ver comentário do campo no schema).
  const mostrarEspecificacoesTecnicas = orcamento.grafica.parametros?.mostrarEspecificacoesTecnicas ?? true;
  // Achado A2 da Parte 6 (auditoria de abrangência, 2026-08-27) — decide se
  // "Prazo estimado" (abaixo) fala em "dias úteis" ou "dias corridos".
  const prazoEmDiasUteis = orcamento.grafica.parametros?.prazoEmDiasUteis ?? true;
  // Achado B4 — prazo por item complementa o do cabeçalho: o cliente vê o
  // maior entre o valor do cabeçalho e o maior valor entre os itens
  // preenchidos, nunca menor que o que a gráfica já digitou manualmente.
  const prazoEfetivoDias = calcularPrazoEfetivoDias(orcamento.prazoEntregaEstimadoDias, orcamento.itens);
  // Achado F6 da Parte 7 (auditoria de abrangência, 2026-08-31) — "Como
  // pagar" só faz sentido depois que o orçamento foi APROVADO (antes disso
  // não existe cobrança ainda) e só quando a gráfica cadastrou pelo menos um
  // dos 4 campos em /configuracoes/identidade.
  const temDadosPagamento =
    !!orcamento.grafica.chavePix ||
    !!orcamento.grafica.favorecidoPix ||
    !!orcamento.grafica.dadosBancarios;

  // Mapeia um conjunto de OrcamentoItem (base ou de uma opção alternativa)
  // pro shape simples que OpcoesPublicasTabs consome — mesmos campos que a
  // renderização de sempre (abaixo, pro caso sem opções alternativas) usa.
  function mapearItensParaOpcaoPublica(
    itens: NonNullable<typeof orcamento>["itens"][number][]
  ): OpcaoPublica["itens"] {
    return itens.map((item) => ({
      id: item.id,
      // Achado B6 — descrição específica do pedido sobrepõe o nome genérico
      // do catálogo quando preenchida (mesmo fallback de mapear-dados.ts).
      nome: item.descricaoLivre?.trim() || item.itemGrafica.itemCatalogo.nome,
      quantidade: item.quantidade,
      precoUnitario: item.precoUnitario.toString(),
      precoTotal: item.precoTotal.toString(),
      larguraCm: item.larguraCm ? Number(item.larguraCm) : null,
      alturaCm: item.alturaCm ? Number(item.alturaCm) : null,
      // Achado F7 — mesma convenção de largura/altura acima.
      profundidadeCm: item.profundidadeCm ? Number(item.profundidadeCm) : null,
      espessuraMm: item.espessuraMm ? Number(item.espessuraMm) : null,
      unidadeDimensao: item.unidadeDimensao,
      cores: item.cores,
      acabamento: item.acabamento,
      etiqueta: item.etiqueta as EtiquetaResumoDados | null,
      // Achado B5 — tiragens alternativas deste item ("1.000/3.000/5.000
      // unidades"); na prática só a opção-base tem linhas aqui (ver
      // comentário do include em opcoes acima), mas o mapeamento é o mesmo
      // pros dois casos.
      faixasQuantidade: item.faixasQuantidade.map((faixa) => ({
        id: faixa.id,
        quantidade: faixa.quantidade,
        precoUnitario: faixa.precoUnitario.toString(),
        precoTotal: faixa.precoTotal.toString(),
      })),
    }));
  }

  // opcao-base sempre em [0] (id: null) — OpcoesPublicasTabs só é renderizado
  // quando opcoesPublicas.length > 1 é irrelevante pra abas; o gate real é
  // orcamento.opcoes.length > 0 mais abaixo.
  const opcoesPublicas: OpcaoPublica[] =
    orcamento.opcoes.length > 0
      ? [
          { id: null, nome: "Opção A", total: orcamento.total.toString(), itens: mapearItensParaOpcaoPublica(orcamento.itens) },
          ...orcamento.opcoes.map((opcao) => ({
            id: opcao.id,
            nome: opcao.nome,
            total: opcao.total.toString(),
            itens: mapearItensParaOpcaoPublica(opcao.itens),
          })),
        ]
      : [];

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-900">
        <Logo />
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-slate-500">Orçamento de {orcamento.grafica.nome}</p>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
              {orcamento.cliente.nome}
            </h1>
          </div>
          <StatusBadge status={orcamento.status} />
        </div>

        {(orcamento.vendedor ||
          orcamento.tipoPedido ||
          orcamento.condicoesPagamento ||
          orcamento.frete ||
          orcamento.transportadora ||
          orcamento.localEntrega ||
          prazoEfetivoDias) && (
          <Card className="mb-6 p-5">
            <p className="mb-3 text-sm font-medium text-slate-500">Dados do pedido</p>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              {orcamento.vendedor && (
                <div>
                  <dt className="text-slate-500">Vendedor</dt>
                  <dd className="font-medium text-slate-800 dark:text-slate-100">{orcamento.vendedor}</dd>
                </div>
              )}
              {orcamento.tipoPedido && (
                <div>
                  <dt className="text-slate-500">Tipo de pedido</dt>
                  <dd className="font-medium text-slate-800 dark:text-slate-100">
                    {ROTULO_TIPO_PEDIDO[orcamento.tipoPedido] ?? orcamento.tipoPedido}
                  </dd>
                </div>
              )}
              {orcamento.condicoesPagamento && (
                <div>
                  <dt className="text-slate-500">Condições de pagamento</dt>
                  <dd className="font-medium text-slate-800 dark:text-slate-100">
                    {orcamento.condicoesPagamento}
                  </dd>
                </div>
              )}
              {orcamento.frete && (
                <div>
                  <dt className="text-slate-500">Frete</dt>
                  <dd className="font-medium text-slate-800 dark:text-slate-100">
                    {ROTULO_FRETE[orcamento.frete] ?? orcamento.frete}
                  </dd>
                </div>
              )}
              {orcamento.transportadora && (
                <div>
                  <dt className="text-slate-500">Transportadora</dt>
                  <dd className="font-medium text-slate-800 dark:text-slate-100">
                    {orcamento.transportadora}
                  </dd>
                </div>
              )}
              {orcamento.localEntrega && (
                <div>
                  <dt className="text-slate-500">Local de entrega</dt>
                  <dd className="font-medium text-slate-800 dark:text-slate-100">{orcamento.localEntrega}</dd>
                </div>
              )}
              {prazoEfetivoDias && (
                <div>
                  <dt className="text-slate-500">Prazo estimado</dt>
                  <dd className="font-medium text-slate-800 dark:text-slate-100">
                    {prazoEfetivoDias} {prazoEmDiasUteis ? "dias úteis" : "dias corridos"} após
                    aprovação
                  </dd>
                </div>
              )}
            </dl>
          </Card>
        )}

        {/* Nunca renderiza item.breakdown aqui — custo de material, margens etc.
            são dado comercial sensível da gráfica, não algo que o cliente final vê. */}
        {opcoesPublicas.length === 0 ? (
          <Card className="mb-6 divide-y divide-slate-100 dark:divide-slate-800">
            {orcamento.itens.map((item) => (
              <div key={item.id} className="flex flex-col gap-2 p-5">
                <div className="flex items-center justify-between gap-4">
                  <p className="font-medium text-slate-900 dark:text-white">
                    {item.descricaoLivre?.trim() || item.itemGrafica.itemCatalogo.nome}
                  </p>
                  <p className="font-semibold text-slate-900 dark:text-white">
                    {formatoMoeda.format(Number(item.precoTotal))}
                  </p>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                  <span>Qtd: {item.quantidade}</span>
                  {item.larguraCm && item.alturaCm && (
                    <span>
                      {converterDeCm(Number(item.larguraCm), item.unidadeDimensao)} ×{" "}
                      {converterDeCm(Number(item.alturaCm), item.unidadeDimensao)}
                      {item.profundidadeCm
                        ? ` × ${converterDeCm(Number(item.profundidadeCm), item.unidadeDimensao)}`
                        : ""}{" "}
                      {ROTULO_UNIDADE_DIMENSAO[item.unidadeDimensao]}
                    </span>
                  )}
                  {item.espessuraMm && <span>Espessura: {Number(item.espessuraMm)}mm</span>}
                  {item.cores && <span>Cores: {item.cores}</span>}
                  {item.acabamento && <span>Acabamento: {item.acabamento}</span>}
                  <span>Unitário: {formatoMoeda.format(Number(item.precoUnitario))}</span>
                </div>
                {item.etiqueta && mostrarEspecificacoesTecnicas && (
                  <EtiquetaResumo etiqueta={item.etiqueta} />
                )}
                {item.faixasQuantidade.length > 0 && (
                  <div className="rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-900/50">
                    <p className="mb-1 font-medium text-slate-500">Outras quantidades</p>
                    <div className="flex flex-col gap-0.5">
                      {item.faixasQuantidade.map((faixa) => (
                        <div key={faixa.id} className="flex justify-between gap-4">
                          <span>{faixa.quantidade.toLocaleString("pt-BR")} un.</span>
                          <span>
                            {formatoMoeda.format(Number(faixa.precoUnitario))} / un. —{" "}
                            {formatoMoeda.format(Number(faixa.precoTotal))}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </Card>
        ) : (
          // Múltiplas opções — itens, total E o formulário de resposta ficam
          // todos dentro de OpcoesPublicasTabs (o opcaoId aprovado tem que
          // nascer sincronizado com a aba visível). Substitui tanto o Card de
          // itens quanto o Card de total logo abaixo E a RespostaPublica
          // solta mais adiante nesta página (ver os dois `length === 0` perto
          // do fim deste arquivo).
          <OpcoesPublicasTabs
            token={token}
            nomeSugerido={orcamento.contatoNome}
            opcoes={opcoesPublicas}
            mostrarResposta={orcamento.status === "ENVIADO" && !orcamentoEstaExpirado(orcamento)}
            mostrarEspecificacoesTecnicas={mostrarEspecificacoesTecnicas}
          />
        )}

        {orcamento.arteUrl && (
          <Card className="mb-6 flex flex-col items-center gap-4 p-5">
            <p className="self-start text-sm font-medium text-slate-500">Arte</p>
            {ehPdf ? (
              <a href={orcamento.arteUrl} target="_blank" rel="noopener noreferrer" className="w-full">
                <Button type="button" variant="outline" className="w-full">
                  Abrir arte (PDF)
                </Button>
              </a>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- arquivo vem de URL externa (Vercel Blob), fora do domínio otimizável pelo next/image
              <img
                src={orcamento.arteUrl}
                alt="Arte do orçamento"
                className="max-h-[70vh] w-full rounded-lg object-contain"
              />
            )}
          </Card>
        )}

        {opcoesPublicas.length === 0 && (
          <Card className="mb-6 flex items-center justify-between p-5">
            <p className="text-sm font-medium text-slate-500">Total</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">
              {formatoMoeda.format(Number(orcamento.total))}
            </p>
          </Card>
        )}

        <a href={`/o/${token}/pdf`} className="mb-6 block">
          <Button type="button" variant="outline" className="w-full">
            Baixar PDF
          </Button>
        </a>

        {orcamento.status === "ENVIADO" && orcamentoEstaExpirado(orcamento) && (
          <p className="text-sm text-amber-600 dark:text-amber-400">
            Este orçamento venceu em {formatoInstanteRealComHora.format(orcamento.validoAteEm!)} — entre em
            contato com a gráfica para receber um novo.
          </p>
        )}
        {/* Com opções alternativas, a RespostaPublica já foi renderizada
            dentro de OpcoesPublicasTabs acima (opcaoId precisa nascer
            sincronizado com a aba selecionada) — nunca duplicada aqui. */}
        {opcoesPublicas.length === 0 &&
          orcamento.status === "ENVIADO" &&
          !orcamentoEstaExpirado(orcamento) && (
            <RespostaPublica token={token} nomeSugerido={orcamento.contatoNome} />
          )}
        {orcamento.status === "APROVADO" && (
          <p className="text-sm text-emerald-600 dark:text-emerald-400">
            {orcamento.respostaPublicaNome
              ? `Aprovado por ${orcamento.respostaPublicaNome}${
                  orcamento.respostaPublicaEm
                    ? ` em ${formatoInstanteRealComHora.format(orcamento.respostaPublicaEm)}`
                    : ""
                }.`
              : "Este orçamento foi aprovado."}
          </p>
        )}
        {/* Achado F6 — só depois de APROVADO existe cobrança de verdade; antes
            disso mostrar dados de pagamento seria prematuro (ver comentário
            de temDadosPagamento acima). Nunca confirma pagamento automático:
            é só o mesmo texto que a gráfica cadastrou, pro cliente ler. */}
        {orcamento.status === "APROVADO" && temDadosPagamento && (
          <Card className="mt-6 flex flex-col gap-2 p-5">
            <p className="text-sm font-medium text-slate-500">Como pagar</p>
            {orcamento.grafica.chavePix && (
              <p className="text-sm text-slate-800 dark:text-slate-100">
                Chave PIX
                {orcamento.grafica.tipoChavePix
                  ? ` (${ROTULO_TIPO_CHAVE_PIX[orcamento.grafica.tipoChavePix]})`
                  : ""}
                : <span className="font-medium">{orcamento.grafica.chavePix}</span>
              </p>
            )}
            {orcamento.grafica.favorecidoPix && (
              <p className="text-sm text-slate-800 dark:text-slate-100">
                Favorecido: <span className="font-medium">{orcamento.grafica.favorecidoPix}</span>
              </p>
            )}
            {orcamento.grafica.dadosBancarios && (
              <p className="text-sm text-slate-800 dark:text-slate-100">
                Dados bancários:{" "}
                <span className="font-medium">{orcamento.grafica.dadosBancarios}</span>
              </p>
            )}
          </Card>
        )}
        {orcamento.status === "REJEITADO" && (
          <p className="text-sm text-rose-600 dark:text-rose-400">
            {orcamento.respostaPublicaNome
              ? `Recusado por ${orcamento.respostaPublicaNome}${
                  orcamento.respostaPublicaEm
                    ? ` em ${formatoInstanteRealComHora.format(orcamento.respostaPublicaEm)}`
                    : ""
                }.`
              : "Este orçamento foi recusado."}
          </p>
        )}
        {/* RASCUNHO: existem links legados gerados antes desta correção (ver
            gerarLinkPublico em orcamento/[id]/actions.ts, que agora
            transiciona RASCUNHO→ENVIADO ao gerar o link) — sem esta
            mensagem, quem abrisse um desses caía numa página sem nenhum
            botão e nenhuma explicação. */}
        {orcamento.status === "RASCUNHO" && (
          <p className="text-sm text-slate-500">
            Este orçamento ainda não foi finalizado pela gráfica — volte a este link em instantes.
          </p>
        )}
      </main>
    </div>
  );
}
