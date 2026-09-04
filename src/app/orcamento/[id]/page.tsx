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
import { resolverOrigemPublica } from "@/lib/url-publica";
import { buscarCustoRealVsOrcado } from "@/lib/custo-producao";
import { resolverEtapasGrafica } from "@/lib/etapa-grafica";
import { verificarProntidaoFiscal, resolverDadosFiscais } from "@/lib/nota-fiscal";
import { formatoMoeda } from "@/lib/moeda";
import { calcularConversoesPreco } from "@/lib/unidade-contagem";
import {
  formatoInstanteRealComHora,
  dataInputParaUTC,
  dataParaInputValue,
  hojeBrasiliaInputValue,
  somarDiasInputValue,
} from "@/lib/data";
import { somarDiasUteis } from "@/lib/dias-uteis";
import { saldoCreditoCliente } from "@/lib/credito-cliente";
import { calcularPrazoEfetivoDias } from "@/lib/orcamento-prazo";
import { UserNav } from "@/components/UserNav";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/Badge";
import { MedidorMargem } from "@/components/ui/MedidorMargem";
import { ArrowLeftIcon } from "@/components/icons";
import {
  calcularMargemItemOrcamento,
  calcularMargemAgregadaOrcamento,
  lerAvisoGramaturaAproximada,
  LIMIAR_MARGEM_RUIM,
  LIMIAR_MARGEM_ATENCAO,
} from "@/lib/orcamento-margem";
import { Alert } from "@/components/ui/Alert";
import { OrcamentoAcoes } from "./OrcamentoAcoes";
import { OpcoesOrcamento } from "./OpcoesOrcamento";
import { MAX_OPCOES_ALTERNATIVAS } from "@/lib/orcamento-opcoes";
import { EditarOrcamentoForm } from "./EditarOrcamentoForm";
import { DescontoItemForm } from "./DescontoItemForm";
import { AdicionarItemForm } from "./AdicionarItemForm";
import { TrocarClienteForm } from "./TrocarClienteForm";
import { CompartilharOrcamento } from "./CompartilharOrcamento";
import { PagamentosCard } from "./PagamentosCard";
import { ContasReceberCard } from "./ContasReceberCard";
import { CustoProducaoCard } from "./CustoProducaoCard";
import { NotaFiscalCard } from "./NotaFiscalCard";
import { PrimeiroOrcamentoCelebracao } from "./PrimeiroOrcamentoCelebracao";
import { EditarDadosGeraisOrcamentoForm } from "./EditarDadosGeraisOrcamentoForm";
import { OrcamentoEnviarArteForm } from "./OrcamentoEnviarArteForm";
import { EtapasOrcamentoForm } from "./EtapasOrcamentoForm";
import { ETAPAS_ORCAMENTO, type ChaveEtapaOrcamento } from "@/lib/orcamento-etapas";
import { EtiquetaResumo } from "./EtiquetaResumo";
import { etiquetaParaCampos } from "../etiqueta-campos";
import { AnaliseTintaCard } from "./AnaliseTintaCard";
import { verificarRecursoPago } from "@/lib/auth/recurso-pago";
import { urlAssinadaLeitura } from "@/lib/blob-assinado";
import { converterDeCm, ROTULO_UNIDADE_DIMENSAO } from "@/lib/unidade-dimensao";
import type { AvisoPreflight } from "@/lib/preflight";
import { saldoContaReceber } from "@/lib/baixa-financeira";

// Server Action herda o maxDuration da página (Vercel) — analisarTintaItem
// espera até 40s do webhook n8n + upload da imagem + margem (ver
// AnaliseTinta.actions.ts), acima do default de 15s do plano Hobby/Pro.
export const maxDuration = 60;

export default async function OrcamentoDetalhePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;
  // `?primeiro=1` só aparece no redirect logo após criarOrcamento quando a
  // contagem de orçamentos da gráfica acabou de virar 1 (ver
  // src/app/orcamento/actions.ts) — dispara a comemoração uma única vez,
  // nesse load. Um refresh da mesma URL continua mostrando (a query string
  // persiste), mas isso é aceitável: não é um estado sensível, só um convite
  // a mais pra copiar o link.
  const { primeiro } = await searchParams;
  const ehPrimeiroOrcamento = primeiro === "1";
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  await exigirVerModulo(usuario, "ORCAMENTO");
  const origem = await resolverOrigemPublica();
  const podeEditarFinanceiro = await podeEditarModulo(usuario, "FINANCEIRO");

  const [orcamento, clientes, itensVendaveis, parametrosGrafica, acabamentosDisponiveisRaw, papeisDisponiveisRaw] = await Promise.all([
    prisma.orcamento.findFirst({
      where: { id, graficaId: usuario.graficaId },
      include: {
        cliente: true,
        pedido: true,
        notaFiscal: true,
        // opcaoId: null — só a opção-base ("Opção A"). Opções alternativas
        // (ver model OrcamentoOpcao) vêm à parte, no include `opcoes`
        // abaixo, com um shape bem mais simples (não precisam de tinta,
        // preflight etc — são só pra exibir lado a lado com um total).
        itens: {
          where: { opcaoId: null },
          include: {
            itemGrafica: {
              include: { itemCatalogo: true, configuracaoClicheEtiqueta: { select: { id: true } } },
            },
            etiqueta: { include: { hotStampings: true } },
            tinta: true,
            acabamentos: { include: { itemGrafica: { include: { itemCatalogo: true } } } },
            precificacaoEtiqueta: true,
            precificacaoDigital: true, // achado N4
          },
        },
        opcoes: {
          orderBy: { ordem: "asc" },
          include: {
            itens: { include: { itemGrafica: { include: { itemCatalogo: true } } } },
          },
        },
        pagamentos: { orderBy: { createdAt: "desc" } },
        contasReceber: { orderBy: { vencimento: "asc" } },
      },
    }),
    prisma.cliente.findMany({
      // desativadoEm: null — mesmo filtro do dropdown de novo orçamento (ver
      // achado A9/A13). Edge case aceito: se o cliente já vinculado a este
      // orçamento for desativado depois, ele deixa de aparecer nesta lista
      // de troca — mas orcamento.cliente (include acima) continua mostrando
      // o cliente certo, e trocarClienteOrcamento só é permitido em RASCUNHO.
      where: { graficaId: usuario.graficaId, desativadoEm: null },
      orderBy: { nome: "asc" },
    }),
    prisma.itemGrafica.findMany({
      where: { graficaId: usuario.graficaId, ativo: true, precoVenda: { not: null } },
      include: { itemCatalogo: true, configuracaoClicheEtiqueta: { select: { id: true } } },
      orderBy: { itemCatalogo: { nome: "asc" } },
    }),
    prisma.parametrosGrafica.findUnique({
      where: { graficaId: usuario.graficaId },
      select: { custoTintaPorMl: true },
    }),
    prisma.itemGrafica.findMany({
      where: {
        graficaId: usuario.graficaId,
        ativo: true,
        itemCatalogo: { tipo: "SERVICO" },
        configuracaoAcabamento: { isNot: null },
      },
      include: { itemCatalogo: true, configuracaoAcabamento: { select: { baseCobranca: true } } },
      orderBy: { itemCatalogo: { nome: "asc" } },
    }),
    // Matéria-prima candidata a "papel" no motor de clichê de etiqueta —
    // mesmo padrão da query equivalente em orcamento/page.tsx.
    prisma.itemGrafica.findMany({
      where: {
        graficaId: usuario.graficaId,
        ativo: true,
        itemCatalogo: { tipo: "MATERIA_PRIMA" },
      },
      include: { itemCatalogo: true },
      orderBy: { itemCatalogo: { nome: "asc" } },
    }),
  ]);
  const custoTintaPorMl = parametrosGrafica?.custoTintaPorMl ? Number(parametrosGrafica.custoTintaPorMl) : null;
  const acabamentosDisponiveis = acabamentosDisponiveisRaw.map((ig) => ({
    id: ig.id,
    nome: ig.itemCatalogo.nome,
    baseCobranca: ig.configuracaoAcabamento!.baseCobranca,
  }));
  const papeisDisponiveis = papeisDisponiveisRaw.map((ig) => ({
    id: ig.id,
    nome: ig.itemCatalogo.nome,
    precoCompra: ig.precoCompra?.toString() ?? null,
  }));

  if (!orcamento) {
    notFound();
  }

  // Saldo em aberto de cada ContaReceber PARCIAL — sempre calculado (achado
  // A8 da Parte 4), nunca armazenado. PENDENTE tem saldo igual ao valor
  // total (nenhuma baixa ainda), por isso só busca pras PARCIAL.
  const saldosContaReceberPorConta = new Map<string, string>();
  await Promise.all(
    orcamento.contasReceber
      .filter((c) => c.status === "PARCIAL")
      .map(async (c) => {
        const saldo = await saldoContaReceber(prisma, c);
        saldosContaReceberPorConta.set(c.id, saldo.toFixed(2));
      })
  );

  // Achado A4 da Parte 5 da auditoria de abrangência — contatos cadastrados
  // do cliente deste orçamento, pra popular o <select> opcional em
  // EditarDadosGeraisOrcamentoForm.tsx. Só ativos (diferente da tela de
  // gestão em /clientes/[id], que também lista os desativados pra permitir
  // reativar). Cliente sem nenhum contato cadastrado -> lista vazia -> select
  // não aparece, digitação livre continua idêntica a hoje.
  const contatosCliente = await prisma.contatoCliente.findMany({
    where: { clienteId: orcamento.clienteId, ativo: true },
    orderBy: [{ principal: "desc" }, { nome: "asc" }],
    select: { id: true, nome: true, email: true, funcao: true, funcaoOutro: true },
  });

  // Achado A13 da auditoria de abrangência — saldo de CreditoCliente do
  // cliente deste orçamento, só pra oferecer o campo "usar crédito" em
  // OrcamentoAcoes quando ainda faz sentido (orçamento pra ser aprovado e
  // saldo > 0). null/0 pra todo cliente que nunca recebeu depósito
  // adiantado (o caso de sempre, hoje) — o campo simplesmente não aparece.
  let creditoClienteDisponivel: string | null = null;
  if (orcamento.status === "ENVIADO") {
    const creditoCliente = await prisma.creditoCliente.findUnique({
      where: { clienteId: orcamento.clienteId },
    });
    if (creditoCliente) {
      const saldo = await saldoCreditoCliente(prisma, creditoCliente.id);
      if (saldo.gt(0)) {
        creditoClienteDisponivel = saldo.toFixed(2);
      }
    }
  }

  // Achado B4 — prazo por item complementa o do cabeçalho: o prazo EFETIVO
  // (usado pra sugestão abaixo e exibido ao cliente) é o maior entre o valor
  // do cabeçalho e o maior valor entre os itens preenchidos, nunca menor que
  // o que já foi digitado manualmente (evita sub-prometer).
  const prazoEfetivoDias = calcularPrazoEfetivoDias(
    orcamento.prazoEntregaEstimadoDias,
    orcamento.itens
  );

  // Sugestão de prazo de entrega (achado A2 da Parte 6 — auditoria de
  // abrangência, 2026-08-27): calcula a partir de hoje + o número de dias
  // que o cliente já viu no PDF/link público (Orcamento.prazoEntregaEstimadoDias,
  // ou o efetivo por item — achado B4), respeitando dias úteis/feriados da
  // gráfica — só PRÉ-PREENCHE o campo em OrcamentoAcoes, o vendedor continua
  // livre pra editar (ver atualizarStatusOrcamento em ./actions.ts, que grava
  // exatamente o que vier do form, sem recalcular nada). Só compensa
  // calcular quando o orçamento ainda está pra ser aprovado.
  const prazoEntregaSugerido =
    orcamento.status === "ENVIADO" && prazoEfetivoDias
      ? dataParaInputValue(
          await somarDiasUteis(
            dataInputParaUTC(hojeBrasiliaInputValue()),
            prazoEfetivoDias,
            usuario.graficaId
          )
        )
      : null;

  // Opções alternativas (ver model OrcamentoOpcao no schema.prisma) — cada
  // uma com seu próprio conjunto de itens/total, exibidas lado a lado com a
  // opção-base. podeAdicionarOpcao segue o mesmo gate de RASCUNHO que o
  // resto da edição de itens, mais o teto do MVP.
  const opcoesFormatadas = orcamento.opcoes.map((opcao) => ({
    id: opcao.id,
    nome: opcao.nome,
    total: opcao.total.toString(),
    itens: opcao.itens.map((item) => ({
      id: item.id,
      nome: item.itemGrafica.itemCatalogo.nome,
      quantidade: item.quantidade,
      precoTotal: item.precoTotal.toString(),
    })),
  }));
  const podeAdicionarOpcao =
    orcamento.status === "RASCUNHO" && orcamento.opcoes.length < MAX_OPCOES_ALTERNATIVAS;
  // "Opção B" na primeira alternativa, "Opção C" na segunda (código 66="B").
  const proximaSugestaoNomeOpcao = `Opção ${String.fromCharCode(66 + orcamento.opcoes.length)}`;

  // Gate de plano do Cálculo de tinta com IA — avaliado uma vez aqui
  // (síncrono) e passado como prop; a Server Action (AnaliseTinta.actions.ts)
  // é quem de fato garante o bloqueio, isto é só pra UI mostrar/desabilitar
  // o botão sem round-trip nenhum.
  const acessoTinta = verificarRecursoPago(usuario, "calculo_tinta_ia");

  const itensComTinta = orcamento.itens.filter((item) => item.tinta !== null);
  const [autoresTinta, urlsAssinadasTinta] = await Promise.all([
    itensComTinta.length > 0
      ? prisma.usuario.findMany({
          where: { id: { in: [...new Set(itensComTinta.map((item) => item.tinta!.criadoPorUsuarioId))] } },
          select: { id: true, nome: true },
        })
      : Promise.resolve([]),
    Promise.all(
      itensComTinta.map(async (item) => [item.id, await urlAssinadaLeitura(item.tinta!.imagemPathname, 60 * 60 * 1000)] as const)
    ),
  ]);
  const nomePorAutorId = new Map(autoresTinta.map((u) => [u.id, u.nome]));
  const urlAssinadaPorItemId = new Map(urlsAssinadasTinta);

  const custoComparado = orcamento.pedido
    ? await buscarCustoRealVsOrcado(orcamento.pedido.id, usuario.graficaId)
    : null;

  // Achado A1 (Fase 1) — rótulo do StatusBadge do pedido abaixo (liga/
  // desliga e renomeia etapa, ver EtapaGrafica) — só resolvido quando há
  // pedido, mesmo critério condicional de custoComparado acima.
  const rotuloStatusPedido = orcamento.pedido
    ? (await resolverEtapasGrafica(usuario.graficaId)).rotulos[orcamento.pedido.status]
    : null;

  let checagemFiscal: { pronto: boolean; pendencias: string[] } | null = null;
  if (orcamento.status === "APROVADO" && !orcamento.notaFiscal) {
    const dadosFiscais = await resolverDadosFiscais(orcamento.filialId, usuario.graficaId);
    checagemFiscal = verificarProntidaoFiscal({
      dadosFiscais,
      cliente: orcamento.cliente,
      itens: orcamento.itens.map((item) => ({
        nome: item.itemGrafica.itemCatalogo.nome,
        ncm: item.itemGrafica.itemCatalogo.ncm,
      })),
    });
  }

  const valoresEtapas = Object.fromEntries(
    ETAPAS_ORCAMENTO.map(({ chave }) => {
      const chaveCapitalizada = chave.charAt(0).toUpperCase() + chave.slice(1);
      const em = orcamento[`etapa${chaveCapitalizada}Em` as keyof typeof orcamento] as Date | null;
      const responsavel = orcamento[
        `etapa${chaveCapitalizada}Responsavel` as keyof typeof orcamento
      ] as string | null;
      return [chave, { em, responsavel }];
    })
  ) as Record<ChaveEtapaOrcamento, { em: Date | null; responsavel: string | null }>;

  // Alerta de margem negativa (só faz sentido ANTES de aprovar — o vendedor
  // ainda pode ajustar preço/desconto do rascunho). Custo estimado por item
  // reaproveita a mesma regra de atualizarStatusOrcamento/
  // aplicarDescontoItemOrcamento (src/app/orcamento/[id]/actions.ts), lida
  // em src/lib/orcamento-margem.ts — nenhum cálculo de preço/custo novo.
  const margensPorItemId =
    orcamento.status === "RASCUNHO"
      ? new Map(
          orcamento.itens.map((item) => [
            item.id,
            calcularMargemItemOrcamento({
              precoTotal: item.precoTotal,
              quantidade: item.quantidade,
              breakdown: item.breakdown,
              precoCompra: item.itemGrafica.precoCompra,
              larguraCm: item.larguraCm,
              alturaCm: item.alturaCm,
              simplesCobraPorArea: item.itemGrafica.simplesCobraPorArea,
            }),
          ])
        )
      : null;
  const margemAgregada =
    orcamento.status === "RASCUNHO"
      ? calcularMargemAgregadaOrcamento(
          orcamento.itens.map((item) => ({
            precoTotal: item.precoTotal,
            quantidade: item.quantidade,
            breakdown: item.breakdown,
            precoCompra: item.itemGrafica.precoCompra,
            larguraCm: item.larguraCm,
            alturaCm: item.alturaCm,
            simplesCobraPorArea: item.itemGrafica.simplesCobraPorArea,
          }))
        )
      : null;

  // Achado N12 — aviso de gramatura aproximada (item OFFSET cujo R$/kg veio
  // da gramatura mais próxima cadastrada, não da gramatura real do papel).
  // Diferente de margensPorItemId acima, não é model-gated por status — vale
  // a pena avisar tanto no RASCUNHO (antes de aprovar) quanto depois, já que
  // é sobre o custo do papel usado no cálculo, não sobre desconto/margem.
  const avisosGramaturaPorItemId = new Map(
    orcamento.itens
      .map((item) => [item.id, lerAvisoGramaturaAproximada(item.breakdown)] as const)
      .filter((par): par is [string, { gramaturaBasePapel: number }] => par[1] !== null)
  );

  function mapearTinta(item: NonNullable<typeof orcamento>["itens"][number]) {
    if (!item.tinta) return null;
    return {
      imagemUrlAssinada: urlAssinadaPorItemId.get(item.id) ?? "",
      coberturaPercentual: Number(item.tinta.coberturaPercentual),
      coberturaCiano: item.tinta.coberturaCiano ? Number(item.tinta.coberturaCiano) : null,
      coberturaMagenta: item.tinta.coberturaMagenta ? Number(item.tinta.coberturaMagenta) : null,
      coberturaAmarelo: item.tinta.coberturaAmarelo ? Number(item.tinta.coberturaAmarelo) : null,
      coberturaPreto: item.tinta.coberturaPreto ? Number(item.tinta.coberturaPreto) : null,
      consumoMlPorPeca: Number(item.tinta.consumoMlPorPeca),
      consumoMlTotal: Number(item.tinta.consumoMlTotal),
      confianca: item.tinta.confianca,
      observacao: item.tinta.observacao,
      quantidadeSnapshot: item.tinta.quantidadeSnapshot,
      larguraCmSnapshot: item.tinta.larguraCmSnapshot ? Number(item.tinta.larguraCmSnapshot) : null,
      alturaCmSnapshot: item.tinta.alturaCmSnapshot ? Number(item.tinta.alturaCmSnapshot) : null,
      criadoPorNome: nomePorAutorId.get(item.tinta.criadoPorUsuarioId) ?? null,
      createdAtIso: item.tinta.createdAt.toISOString(),
    };
  }

  return (
    <div className="flex flex-1 flex-col">
      <UserNav
        nome={usuario.nome}
        graficaNome={usuario.grafica.nome}
        papel={usuario.papel}
        paginaAtual="/orcamento"
        mostrarMeuNegocio={podeVerMeuNegocio(usuario)}
        modulosVisiveis={await obterModulosVisiveis(usuario)}
      />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <Link
          href="/orcamento"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Voltar aos orçamentos
        </Link>

        {ehPrimeiroOrcamento && (
          <PrimeiroOrcamentoCelebracao
            orcamentoId={orcamento.id}
            linkExistente={
              orcamento.linkPublicoToken ? `${origem}/o/${orcamento.linkPublicoToken}` : null
            }
          />
        )}

        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
              {orcamento.cliente.nome}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Criado em {orcamento.createdAt.toLocaleDateString("pt-BR")}
            </p>
            {orcamento.status === "RASCUNHO" && (
              <div className="mt-2">
                <TrocarClienteForm
                  orcamentoId={orcamento.id}
                  clienteAtualId={orcamento.clienteId}
                  // Remapeado pra {id,nome} — sem isso, CPF/CNPJ e endereço
                  // de todo cliente iam pro payload da página só pra
                  // alimentar este <select> (ver mesmo achado em
                  // orcamento/page.tsx).
                  clientes={clientes.map((c) => ({ id: c.id, nome: c.nome }))}
                />
              </div>
            )}
            {/* Nome é DECLARADO por quem respondeu pelo link público, nunca
                verificado (ver comentário de Orcamento.respostaPublicaNome
                no schema) — por isso "aprovado/recusado por", nunca
                "confirmado por". */}
            {(orcamento.status === "APROVADO" || orcamento.status === "REJEITADO") &&
              orcamento.respostaPublicaNome && (
                <p className="mt-1 text-xs text-slate-500">
                  {orcamento.status === "APROVADO" ? "Aprovado" : "Recusado"} por{" "}
                  {orcamento.respostaPublicaNome}
                  {orcamento.respostaPublicaEm &&
                    ` em ${formatoInstanteRealComHora.format(orcamento.respostaPublicaEm)}`}
                </p>
              )}
          </div>
          <StatusBadge status={orcamento.status} />
        </div>

        <Card className="mb-6 p-5">
          <p className="mb-3 text-sm font-medium text-slate-500">Dados do pedido</p>
          <EditarDadosGeraisOrcamentoForm
            orcamentoId={orcamento.id}
            dados={{
              vendedor: orcamento.vendedor,
              tipoPedido: orcamento.tipoPedido,
              contatoNome: orcamento.contatoNome,
              contatoEmail: orcamento.contatoEmail,
              contatoClienteId: orcamento.contatoClienteId,
              condicoesPagamento: orcamento.condicoesPagamento,
              frete: orcamento.frete,
              transportadora: orcamento.transportadora,
              localEntrega: orcamento.localEntrega,
              notaEmpenho: orcamento.notaEmpenho,
              processoLicitatorio: orcamento.processoLicitatorio,
              observacoes: orcamento.observacoes,
            }}
            contatosCliente={contatosCliente}
          />
        </Card>

        {orcamento.status === "RASCUNHO" && (
          <Card className="mb-6 p-5">
            <p className="mb-3 text-sm font-medium text-slate-500">Arte do orçamento</p>
            <OrcamentoEnviarArteForm
              orcamentoId={orcamento.id}
              arteUrl={orcamento.arteUrl}
              preflightAvisos={(orcamento.preflightAvisos as AvisoPreflight[] | null) ?? []}
            />
          </Card>
        )}

        {orcamento.status === "RASCUNHO" ? (
          <div className="mb-6 flex flex-col gap-4">
            {orcamento.itens.map((item) => (
              <div key={item.id} className="flex flex-col gap-3">
                <EditarOrcamentoForm
                  orcamentoId={orcamento.id}
                  orcamentoItemId={item.id}
                  itemNome={item.itemGrafica.itemCatalogo.nome}
                  modeloCalculo={item.modeloCalculo}
                  usaClicheEtiqueta={item.itemGrafica.configuracaoClicheEtiqueta !== null}
                  simplesCobraPorArea={item.itemGrafica.simplesCobraPorArea}
                  unidadeDimensao={item.unidadeDimensao}
                  podeRemover={orcamento.itens.length > 1}
                  acabamentosDisponiveis={acabamentosDisponiveis}
                  papeisDisponiveis={papeisDisponiveis}
                  valoresIniciais={{
                    quantidade: item.quantidade,
                    larguraCm: item.larguraCm?.toString() ?? "",
                    alturaCm: item.alturaCm?.toString() ?? "",
                    profundidadeCm: item.profundidadeCm?.toString() ?? "",
                    espessuraMm: item.espessuraMm?.toString() ?? "",
                    cores: item.cores ?? "",
                    acabamento: item.acabamento ?? "",
                    descricaoLivre: item.descricaoLivre ?? "",
                    acabamentoIds: item.acabamentos.map((a) => a.itemGraficaId),
                    corFrente: item.corFrente?.toString() ?? "",
                    corVerso: item.corVerso?.toString() ?? "",
                    numeroCoresFlexo: item.numeroCoresFlexo?.toString() ?? "",
                    numeroCliques: item.numeroCliques?.toString() ?? "",
                    numeroSetups: item.numeroSetups?.toString() ?? "",
                    prazoEstimadoDias: item.prazoEstimadoDias?.toString() ?? "",
                    numeroPontos: item.numeroPontos?.toString() ?? "",
                    tempoEstimadoMin: item.tempoEstimadoMin?.toString() ?? "",
                    metrosCorte: item.metrosCorte?.toString() ?? "",
                    horasEstimadas: item.horasEstimadas?.toString() ?? "",
                    custoAquisicaoUnitario: item.custoAquisicaoUnitario?.toString() ?? "",
                    materialFornecidoPeloCliente: item.materialFornecidoPeloCliente,
                    etiqueta: etiquetaParaCampos(item.etiqueta),
                    papelId: item.precificacaoEtiqueta?.papelId ?? item.precificacaoDigital?.papelId ?? "",
                    quantidadeCores: item.precificacaoEtiqueta?.quantidadeCores.toString() ?? "",
                    // Achado N10 — precificacaoEtiqueta.custoFaca é a fonte de
                    // verdade pra M2 com clichê (comportamento de sempre);
                    // item.custoFaca (coluna direta, hoje só OFFSET) é o
                    // fallback pra todo o resto.
                    custoFaca:
                      item.precificacaoEtiqueta?.custoFaca?.toString() ??
                      item.custoFaca?.toString() ??
                      "",
                    custoFrete: item.precificacaoEtiqueta?.custoFrete?.toString() ?? "",
                  }}
                />
                <DescontoItemForm
                  orcamentoItemId={item.id}
                  precoSugeridoUnitario={item.precoSugeridoUnitario?.toString() ?? null}
                  precoUnitarioAtual={item.precoUnitario.toString()}
                  descontoTipo={item.descontoTipo}
                  descontoValor={item.descontoValor?.toString() ?? null}
                  motivoDesconto={item.motivoDesconto}
                  aprovadoPorId={item.aprovadoPorId}
                  // Achado A6 da Parte 5 — Cliente.descontoPadraoPercent é
                  // fração 0-1, o campo "Valor (%)" do form é 0-100.
                  descontoPadraoPercentSugerido={
                    orcamento.cliente.descontoPadraoPercent !== null
                      ? Number(orcamento.cliente.descontoPadraoPercent) * 100
                      : null
                  }
                />
                {margensPorItemId?.get(item.id) && (
                  <Card className="mb-4 -mt-2 p-5">
                    <p className="mb-2 text-sm font-medium text-slate-500">
                      Margem estimada deste item
                    </p>
                    <MedidorMargem
                      margem={margensPorItemId.get(item.id)!.margemPercent}
                      limiarRuim={LIMIAR_MARGEM_RUIM}
                      limiarBom={LIMIAR_MARGEM_ATENCAO}
                    />
                  </Card>
                )}
                {avisosGramaturaPorItemId.get(item.id) && (
                  <div className="mb-4 -mt-2">
                    <Alert variant="warning">
                      Preço estimado a partir da gramatura mais próxima cadastrada (
                      {avisosGramaturaPorItemId.get(item.id)!.gramaturaBasePapel}g/m²) — o papel
                      escolhido neste item não tem preço cadastrado na gramatura exata.
                    </Alert>
                  </div>
                )}
                <AnaliseTintaCard
                  orcamentoItemId={item.id}
                  podeUsar={acessoTinta.liberado}
                  mensagemBloqueio={acessoTinta.liberado ? null : acessoTinta.mensagem}
                  itemAtual={{
                    quantidade: item.quantidade,
                    larguraCm: item.larguraCm ? Number(item.larguraCm) : null,
                    alturaCm: item.alturaCm ? Number(item.alturaCm) : null,
                  }}
                  tinta={mapearTinta(item)}
                  custoPorMl={custoTintaPorMl}
                />
              </div>
            ))}
            <AdicionarItemForm
              orcamentoId={orcamento.id}
              itens={itensVendaveis.map((ig) => ({
                id: ig.id,
                nome: ig.itemCatalogo.nome,
                categoria: ig.itemCatalogo.categoria,
                precoVenda: ig.precoVenda!.toString(),
                modeloCalculo: ig.modeloCalculo,
                usaClicheEtiqueta: ig.configuracaoClicheEtiqueta !== null,
                simplesCobraPorArea: ig.simplesCobraPorArea,
              }))}
              unidadePadrao={usuario.grafica.unidadePadraoDimensao}
              acabamentosDisponiveis={acabamentosDisponiveis}
              papeisDisponiveis={papeisDisponiveis}
            />
          </div>
        ) : (
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
                  {item.corFrente !== null && (
                    <span>
                      Frente/verso: {item.corFrente}x{item.corVerso ?? 0}
                    </span>
                  )}
                  {item.numeroCoresFlexo !== null && <span>Cores: {item.numeroCoresFlexo}</span>}
                  {item.acabamento && <span>Acabamento: {item.acabamento}</span>}
                  {item.acabamentos.length > 0 && (
                    <span>
                      Acabamentos: {item.acabamentos.map((a) => a.itemGrafica.itemCatalogo.nome).join(", ")}
                    </span>
                  )}
                  <span>Unitário: {formatoMoeda.format(Number(item.precoUnitario))}</span>
                  {calcularConversoesPreco({
                    precoUnitario: Number(item.precoUnitario),
                    unidadeContagem: item.itemGrafica.unidadeContagem,
                    fatorConversao: item.itemGrafica.fatorConversao
                      ? Number(item.itemGrafica.fatorConversao)
                      : null,
                    embalagemQtdPorRolo: item.etiqueta?.embalagemQtdPorRolo ?? null,
                  }).map((c) => (
                    <span key={c.rotulo}>
                      {c.valorFormatado} / {c.rotulo}
                    </span>
                  ))}
                </div>
                {avisosGramaturaPorItemId.get(item.id) && (
                  <Alert variant="warning">
                    Preço estimado a partir da gramatura mais próxima cadastrada (
                    {avisosGramaturaPorItemId.get(item.id)!.gramaturaBasePapel}g/m²) — o papel
                    escolhido neste item não tem preço cadastrado na gramatura exata.
                  </Alert>
                )}
                {item.etiqueta && <EtiquetaResumo etiqueta={item.etiqueta} />}
                {orcamento.status !== "REJEITADO" && (
                  <AnaliseTintaCard
                    orcamentoItemId={item.id}
                    podeUsar={acessoTinta.liberado}
                    mensagemBloqueio={acessoTinta.liberado ? null : acessoTinta.mensagem}
                    itemAtual={{
                      quantidade: item.quantidade,
                      larguraCm: item.larguraCm ? Number(item.larguraCm) : null,
                      alturaCm: item.alturaCm ? Number(item.alturaCm) : null,
                    }}
                    tinta={mapearTinta(item)}
                    custoPorMl={custoTintaPorMl}
                  />
                )}
              </div>
            ))}
          </Card>
        )}

        <Card className="mb-6 flex items-center justify-between p-5">
          <p className="text-sm font-medium text-slate-500">
            {opcoesFormatadas.length > 0 ? "Total — Opção A" : "Total do orçamento"}
          </p>
          <p className="text-2xl font-bold text-slate-900 dark:text-white">
            {formatoMoeda.format(Number(orcamento.total))}
          </p>
        </Card>

        {margemAgregada && (
          <Card className="mb-6 p-5">
            <p className="mb-3 text-sm font-medium text-slate-500">Margem estimada do orçamento</p>
            {margemAgregada.ok ? (
              <MedidorMargem
                margem={margemAgregada.margemPercent}
                limiarRuim={LIMIAR_MARGEM_RUIM}
                limiarBom={LIMIAR_MARGEM_ATENCAO}
              />
            ) : (
              <p className="text-sm text-slate-500">
                {margemAgregada.itensSemCusto > 0
                  ? `Não é possível estimar a margem total — ${margemAgregada.itensSemCusto} ${
                      margemAgregada.itensSemCusto === 1
                        ? "item não tem custo cadastrado (preço de compra)"
                        : "itens não têm custo cadastrado (preço de compra)"
                    } pra calcular.`
                  : "Sem itens suficientes pra estimar a margem."}
              </p>
            )}
          </Card>
        )}

        {/* Fora de RASCUNHO, opcoesFormatadas fica sempre vazio na prática
            (resolverOpcoesNaAprovacao/descartarOpcoesAlternativas garantem
            que nenhum orçamento em status terminal tem OrcamentoOpcao — ver
            src/lib/orcamento-opcoes.ts) EXCETO em ENVIADO, onde as opções
            ainda existem aguardando a decisão do cliente — mostradas aqui em
            modo só-leitura (podeAdicionar sempre false fora de RASCUNHO). */}
        {(orcamento.status === "RASCUNHO" || opcoesFormatadas.length > 0) && (
          <OpcoesOrcamento
            orcamentoId={orcamento.id}
            opcoes={opcoesFormatadas}
            podeAdicionar={podeAdicionarOpcao}
            proximaSugestaoNome={proximaSugestaoNomeOpcao}
            itensVendaveis={itensVendaveis.map((ig) => ({
              id: ig.id,
              nome: ig.itemCatalogo.nome,
              categoria: ig.itemCatalogo.categoria,
              precoVenda: ig.precoVenda!.toString(),
              modeloCalculo: ig.modeloCalculo,
              usaClicheEtiqueta: ig.configuracaoClicheEtiqueta !== null,
              simplesCobraPorArea: ig.simplesCobraPorArea,
            }))}
            acabamentosDisponiveis={acabamentosDisponiveis}
            papeisDisponiveis={papeisDisponiveis}
            unidadePadrao={usuario.grafica.unidadePadraoDimensao}
          />
        )}

        <Card className="mb-6 p-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium text-slate-500">
              Compartilhar com o cliente
            </p>
            <a
              href={`/orcamento/${orcamento.id}/pdf`}
              className="text-xs font-medium text-teal-700 hover:underline dark:text-teal-400"
            >
              Baixar PDF
            </a>
          </div>
          <CompartilharOrcamento
            orcamentoId={orcamento.id}
            linkExistente={
              orcamento.linkPublicoToken ? `${origem}/o/${orcamento.linkPublicoToken}` : null
            }
            clienteNome={orcamento.cliente.nome}
            clienteTelefone={orcamento.cliente.telefone}
            graficaNome={usuario.grafica.nome}
          />
        </Card>

        <PagamentosCard
          orcamentoId={orcamento.id}
          total={Number(orcamento.total)}
          pagamentos={orcamento.pagamentos.map((p) => ({
            id: p.id,
            valor: p.valor.toString(),
            forma: p.forma,
            formaDetalhe: p.formaDetalhe,
            observacao: p.observacao,
            createdAt: p.createdAt.toISOString(),
          }))}
          podeRegistrar={orcamento.status === "APROVADO"}
        />

        {orcamento.status === "APROVADO" && (
          <ContasReceberCard
            orcamentoId={orcamento.id}
            podeEditar={podeEditarFinanceiro}
            // Achado A6 da Parte 5 — pré-calcula o vencimento sugerido a
            // partir de Cliente.prazoPagamentoPadraoDias (hoje + N dias).
            // null = cliente sem prazo cadastrado, campo nasce em branco
            // (comportamento de hoje, sem regressão).
            vencimentoSugerido={
              orcamento.cliente.prazoPagamentoPadraoDias !== null
                ? somarDiasInputValue(hojeBrasiliaInputValue(), orcamento.cliente.prazoPagamentoPadraoDias)
                : null
            }
            contas={orcamento.contasReceber.map((c) => ({
              id: c.id,
              descricao: c.descricao,
              valor: c.valor.toString(),
              saldo: saldosContaReceberPorConta.get(c.id) ?? c.valor.toString(),
              vencimento: c.vencimento.toISOString(),
              status: c.status,
              recebidoEm: c.recebidoEm ? c.recebidoEm.toISOString() : null,
            }))}
          />
        )}

        {orcamento.pedido && (
          <Link href="/producao" className="mb-6 block">
            <Card className="flex items-center justify-between p-5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50">
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Pedido de produção gerado — ver acompanhamento
              </p>
              <StatusBadge status={orcamento.pedido.status} tipo="pedido" rotulo={rotuloStatusPedido ?? undefined} />
            </Card>
          </Link>
        )}

        <Card className="mb-6 p-5">
          <p className="mb-3 text-sm font-medium text-slate-500">Etapas de produção</p>
          <EtapasOrcamentoForm orcamentoId={orcamento.id} valores={valoresEtapas} />
        </Card>

        {custoComparado && custoComparado.itens.length > 0 && (
          <CustoProducaoCard comparacao={custoComparado} />
        )}

        {orcamento.status === "APROVADO" && (
          <NotaFiscalCard
            orcamentoId={orcamento.id}
            notaFiscal={orcamento.notaFiscal}
            pendencias={checagemFiscal?.pendencias ?? []}
          />
        )}

        <OrcamentoAcoes
          orcamentoId={orcamento.id}
          status={orcamento.status}
          opcoes={opcoesFormatadas.map((o) => ({ id: o.id, nome: o.nome, total: o.total }))}
          totalOpcaoBase={orcamento.total.toString()}
          prazoEntregaSugerido={prazoEntregaSugerido}
          creditoClienteDisponivel={creditoClienteDisponivel}
        />
      </main>
    </div>
  );
}
