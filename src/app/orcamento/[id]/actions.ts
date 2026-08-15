"use server";

import { z } from "zod";
import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { randomBytes } from "node:crypto";
import { put, del } from "@vercel/blob";
import { exigirTokenBlobPrivado } from "@/lib/blob-assinado";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { calcularItemOrcamento } from "@/lib/orcamento-precificacao";
import { resolverOrigemPublica } from "@/lib/url-publica";
import {
  validarArquivoArte,
  extensaoArte,
  assinaturaBateComTipo,
  BYTES_ASSINATURA,
} from "@/lib/upload-validacao";
import {
  TRANSICOES_VALIDAS,
  ROTULOS_STATUS_ORCAMENTO,
  type StatusOrcamento,
} from "@/lib/orcamento-status";
import { verificarProntidaoFiscal } from "@/lib/nota-fiscal";
import {
  emitirNfe,
  consultarNfe,
  ErroFocusNfe,
  type AmbienteFocusNfe,
  type RespostaFocusNfe,
} from "@/lib/focus-nfe";
import { registrarAuditoria } from "@/lib/auditoria";
import { formatoMoeda } from "@/lib/moeda";
import { dataInputParaUTC, dataHoraInputParaUTC } from "@/lib/data";
import {
  ETAPAS_ORCAMENTO,
  nomeCampoEtapaEm,
  nomeCampoEtapaResponsavel,
  type ChaveEtapaOrcamento,
} from "@/lib/orcamento-etapas";
import {
  validarContagemCor,
  normalizarRebobinamento,
  validarMaterialSubstratoOutro,
} from "@/lib/orcamento-etiqueta";
import { parseJsonArray } from "@/lib/form-json";
import { ehConflitoDeSerializacao } from "@/lib/prisma-conflito";
import { calcularValorBase, calcularComissao } from "@/lib/comissao";
import {
  removerArquivo,
  resolverContextoArmazenamento,
  reservarEspaco,
  confirmarArquivo,
  cancelarReserva,
} from "@/lib/billing/armazenamento";
import { calcularPrevisaoAprovacaoPedido, gravarPrevisaoAprovacaoPedido } from "@/lib/pedido-aprovacao";
import { UNIDADES_DIMENSAO, converterParaCm } from "@/lib/unidade-dimensao";
import { paraDecimal, type Dec } from "@/lib/pricing/decimal";

// Nunca confia na unidade que vem do formulário — validada contra as únicas
// 3 que existem (ver src/lib/unidade-dimensao.ts) antes de converter pra
// centímetro na fronteira (usada por adicionarItemOrcamento).
const unidadeDimensaoSchema = z.enum(UNIDADES_DIMENSAO);

// Sinaliza, de dentro de uma transação Serializable, que o orçamento já está
// no último item — usado só pra abortar a transação com uma mensagem amigável
// (ver removerItemOrcamento). Não é um erro de banco de verdade.
class ErroUltimoItemOrcamento extends Error {}

const MENSAGEM_CONFLITO_CONCORRENTE =
  "Outra pessoa alterou este orçamento ao mesmo tempo — tente de novo.";

// novoStatus é só informativo (preenchido nas respostas de sucesso) — deixa o
// client (OrcamentoAcoes.tsx) saber QUAL transição aconteceu sem precisar
// inferir do status anterior, pra decidir se mostra a micro-animação de
// aprovação. Não participa da lógica de compare-and-swap abaixo.
export type AtualizarStatusResult = {
  ok: boolean;
  mensagem: string;
  novoStatus?: StatusOrcamento;
};

export async function atualizarStatusOrcamento(
  _estadoAnterior: AtualizarStatusResult | null,
  formData: FormData
): Promise<AtualizarStatusResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar orçamentos." };
  }
  const orcamentoId = String(formData.get("orcamentoId"));
  const novoStatus = String(formData.get("novoStatus")) as StatusOrcamento;

  const orcamento = await prisma.orcamento.findFirst({
    where: { id: orcamentoId, graficaId: usuario.graficaId },
  });
  if (!orcamento) {
    return { ok: false, mensagem: "Orçamento não encontrado." };
  }

  const transicaoPermitida = TRANSICOES_VALIDAS[
    orcamento.status as StatusOrcamento
  ]?.includes(novoStatus);
  if (!transicaoPermitida) {
    return { ok: false, mensagem: "Transição de status inválida." };
  }

  if (novoStatus === "APROVADO") {
    // Opcional: string vazia (campo em branco) vira undefined, pedido nasce
    // sem prazo e nunca vai gerar alerta de atraso (ver src/lib/alerta-atraso.ts).
    const prazoEntregaBruto = formData.get("prazoEntrega");
    const prazoEntrega =
      typeof prazoEntregaBruto === "string" && prazoEntregaBruto
        ? dataInputParaUTC(prazoEntregaBruto)
        : undefined;

    // Leitura fora da transação de propósito (mesmo cuidado de avancarPedido
    // em src/app/producao/actions.ts): ficha de custo/comissão não muda por
    // causa de uma corrida de atualizarStatusOrcamento, então não precisa
    // fazer parte da transação — mantém ela curta. Mesmo cuidado vale pra
    // previsaoCusto (fase "custo real", §3.1): a leitura de breakdown/ficha
    // técnica também não muda por causa desta corrida.
    const [orcamentoComItens, usuarioVendedor, parametros, previsaoCusto] = await Promise.all([
      prisma.orcamentoItem.findMany({
        where: { orcamentoId },
        include: { itemGrafica: { select: { precoCompra: true } } },
      }),
      prisma.usuario.findUnique({
        where: { id: orcamento.usuarioId },
        select: { comissaoPercent: true },
      }),
      prisma.parametrosGrafica.findUnique({
        where: { graficaId: usuario.graficaId },
        select: { comissaoVendedorBase: true },
      }),
      calcularPrevisaoAprovacaoPedido(orcamentoId, usuario.graficaId),
    ]);

    const percentualVendedor = usuarioVendedor?.comissaoPercent
      ? Number(usuarioVendedor.comissaoPercent)
      : null;
    const dadosComissao =
      percentualVendedor && percentualVendedor > 0
        ? (() => {
            const baseCalculo = parametros?.comissaoVendedorBase ?? "VALOR";
            // Custo real só existe no motor avançado (breakdown.custoTotal, ver
            // src/lib/pricing/compor.ts) — item SIMPLES usa o preço de compra
            // ATUAL do produto como estimativa (não é snapshot do momento da
            // venda; pode ter mudado desde a criação do orçamento). Sem
            // precoCompra cadastrado, custo 0 pra esse item (conta como lucro
            // total em vez de travar o cálculo).
            const itensComCusto = orcamentoComItens.map((item) => {
              const breakdown = item.breakdown as { custoTotal?: string } | null;
              const custoTotal = breakdown?.custoTotal
                ? Number(breakdown.custoTotal)
                : item.itemGrafica.precoCompra
                  ? Number(item.itemGrafica.precoCompra) * item.quantidade
                  : 0;
              return { precoTotal: Number(item.precoTotal), custoTotal };
            });
            const valorBase = calcularValorBase(Number(orcamento.total), itensComCusto, baseCalculo);
            const valorComissao = calcularComissao(valorBase, percentualVendedor);
            return { baseCalculo, valorBase, valorComissao };
          })()
        : null;

    // Compare-and-swap: só transiciona (e cria pedido/comissão) se o status
    // AINDA for o que validamos — senão duas transições concorrentes (ex: link
    // público aprovando enquanto o painel rejeita) poderiam ambas passar e a
    // última venceria, deixando um Pedido órfão. upsert continua idempotente
    // contra duplo clique (orcamentoId único em Pedido e Comissao).
    const aprovado = await prisma.$transaction(async (tx) => {
      const cas = await tx.orcamento.updateMany({
        where: { id: orcamentoId, status: orcamento.status },
        data: { status: "APROVADO" },
      });
      if (cas.count === 0) return false;

      await tx.pedido.upsert({
        where: { orcamentoId },
        update: {},
        create: {
          graficaId: usuario.graficaId,
          orcamentoId,
          status: "FILA",
          prazoEntrega,
          producaoLinkToken: randomBytes(20).toString("base64url"),
          // Copia a URL como referência — o arquivo continua "pertencendo"
          // contabilmente ao orçamento (ArquivoArmazenado tipo
          // ARTE_ORCAMENTO), não cria uma linha nova de razão pro Pedido.
          // Se depois alguém remover a arte na Produção (removerArte),
          // removerArquivo({ tipo: "ARTE_PEDIDO" }) não vai achar nada e só
          // limpa pedido.arteUrl local, sem apagar o blob — comportamento
          // esperado.
          arteUrl: orcamento.arteUrl,
        },
      });

      // Congela aprovadoEm + os três snapshots + a previsão de custo por
      // categoria (PedidoCustoPrevisto) — ver fase-custo-real.md §2.3, §3.1
      // e src/lib/pedido-aprovacao.ts.
      await gravarPrevisaoAprovacaoPedido(tx, {
        graficaId: usuario.graficaId,
        orcamentoId,
        previsao: previsaoCusto,
      });

      if (dadosComissao) {
        await tx.comissao.upsert({
          where: { orcamentoId },
          update: {},
          create: {
            graficaId: usuario.graficaId,
            orcamentoId,
            usuarioId: orcamento.usuarioId,
            baseCalculo: dadosComissao.baseCalculo,
            percentualAplicado: percentualVendedor!,
            valorBase: dadosComissao.valorBase,
            valorComissao: dadosComissao.valorComissao,
          },
        });
      }
      return true;
    });

    if (!aprovado) {
      return { ok: false, mensagem: "Este orçamento já teve o status alterado. Atualize a página." };
    }
  } else {
    const cas = await prisma.orcamento.updateMany({
      where: { id: orcamentoId, status: orcamento.status },
      data: { status: novoStatus },
    });
    if (cas.count === 0) {
      return { ok: false, mensagem: "Este orçamento já teve o status alterado. Atualize a página." };
    }
  }

  revalidatePath(`/orcamento/${orcamentoId}`);
  revalidatePath("/orcamento");
  if (novoStatus === "APROVADO") {
    revalidatePath("/producao");
    revalidatePath("/financeiro/comissoes");
  }

  return {
    ok: true,
    mensagem: `Orçamento atualizado para ${ROTULOS_STATUS_ORCAMENTO[novoStatus]}.`,
    novoStatus,
  };
}

export type EditarOrcamentoResult = { ok: boolean; mensagem: string };

// Edita UM item específico do orçamento (não mais "o item", já que um orçamento
// pode ter vários — ver plano de multi-item). O total do orçamento é sempre
// recalculado como soma de TODOS os itens, não só do editado.
export async function editarOrcamento(
  _estadoAnterior: EditarOrcamentoResult | null,
  formData: FormData
): Promise<EditarOrcamentoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar orçamentos." };
  }
  const orcamentoId = String(formData.get("orcamentoId"));
  const orcamentoItemId = String(formData.get("orcamentoItemId"));
  const quantidade = Number(formData.get("quantidade"));
  const larguraCm = formData.get("larguraCm") ? Number(formData.get("larguraCm")) : null;
  const alturaCm = formData.get("alturaCm") ? Number(formData.get("alturaCm")) : null;
  // Limites iguais aos de itemEntradaSchema (orcamento/actions.ts), que
  // criarOrcamento já aplica — editarOrcamento/adicionarItemOrcamento não
  // usavam zod aqui e aceitavam string de qualquer tamanho. Com
  // serverActions.bodySizeLimit em 25mb (por causa do upload de arte), isso
  // permitia gravar dezenas de MB de texto numa única linha de orçamento.
  const cores = String(formData.get("cores") || "").slice(0, 60);
  const acabamento = String(formData.get("acabamento") || "").slice(0, 200);
  const corFrente = formData.get("corFrente") ? Number(formData.get("corFrente")) : null;
  const corVerso = formData.get("corVerso") ? Number(formData.get("corVerso")) : null;

  if (!quantidade || quantidade <= 0 || quantidade > 1_000_000) {
    return { ok: false, mensagem: "Informe uma quantidade válida (até 1.000.000 unidades)." };
  }

  const orcamento = await prisma.orcamento.findFirst({
    where: { id: orcamentoId, graficaId: usuario.graficaId },
    include: { itens: { include: { itemGrafica: true } } },
  });
  if (!orcamento) {
    return { ok: false, mensagem: "Orçamento não encontrado." };
  }
  // Só dá pra editar enquanto ainda é rascunho — preserva a integridade do
  // que já foi enviado/decidido pelo cliente.
  if (orcamento.status !== "RASCUNHO") {
    return { ok: false, mensagem: "Só é possível editar um orçamento em rascunho." };
  }

  const item = orcamento.itens.find((i) => i.id === orcamentoItemId);
  if (!item) {
    return { ok: false, mensagem: "Item do orçamento não encontrado." };
  }

  const resultado = await calcularItemOrcamento(item.itemGrafica, usuario.graficaId, {
    quantidade,
    larguraCm,
    alturaCm,
    corFrente,
    corVerso,
  });
  if (!resultado.ok) {
    return { ok: false, mensagem: resultado.mensagem };
  }

  // Produto não muda em editarOrcamento (só quantidade/medida/cores), então
  // modeloCalculo vem do item já existente, não de `resultado`.
  let etiqueta: EtiquetaParaGravar | null = null;
  if (item.modeloCalculo === "M2") {
    const etiquetaResult = lerEtiquetaDoFormData(formData);
    if (!etiquetaResult.ok) {
      return { ok: false, mensagem: etiquetaResult.mensagem };
    }
    etiqueta = etiquetaResult.etiqueta;
  }

  // Isolamento Serializable + total recalculado por agregado DENTRO da
  // transação (não somado em JS a partir da leitura de `orcamento.itens` feita
  // acima, que já pode estar desatualizada) — evita tanto a corrida de duas
  // edições concorrentes em itens diferentes do mesmo orçamento quanto a
  // imprecisão de somar Decimal via Number() (o SUM roda no Postgres).
  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.orcamentoItem.update({
          where: { id: orcamentoItemId },
          data: {
            quantidade,
            larguraCm,
            alturaCm,
            cores: cores || null,
            acabamento: acabamento || null,
            precoUnitario: resultado.precoUnitario,
            precoTotal: resultado.precoTotal,
            corFrente: resultado.corFrente,
            corVerso: resultado.corVerso,
            breakdown: resultado.breakdown ?? undefined,
          },
        });

        // upsert (não create) porque um item M2 criado antes desta feature
        // pode ainda não ter linha de etiqueta.
        if (item.modeloCalculo === "M2" && etiqueta) {
          const dadosEtiqueta = {
            materialSubstrato: etiqueta.materialSubstrato,
            materialSubstratoOutro: etiqueta.materialSubstratoOutro,
            tipoAdesivo: etiqueta.tipoAdesivo,
            superficieAplicacao: etiqueta.superficieAplicacao,
            formatoEtiqueta: etiqueta.formatoEtiqueta,
            coresRotulo: etiqueta.coresRotulo,
            coresContraRotulo: etiqueta.coresContraRotulo,
            embalagemQtdPorRolo: etiqueta.embalagemQtdPorRolo,
            tubeteMedida: etiqueta.tubeteMedida,
            rotulagem: etiqueta.rotulagem,
            serrilha: etiqueta.serrilha,
            vernizRotuloTotal: etiqueta.vernizRotuloTotal,
            vernizRotuloReserva: etiqueta.vernizRotuloReserva,
            vernizRotuloTipo: etiqueta.vernizRotuloTipo,
            vernizContraRotuloTotal: etiqueta.vernizContraRotuloTotal,
            vernizContraRotuloReserva: etiqueta.vernizContraRotuloReserva,
            vernizContraRotuloTipo: etiqueta.vernizContraRotuloTipo,
            laminacaoRotulo: etiqueta.laminacaoRotulo,
            laminacaoContraRotulo: etiqueta.laminacaoContraRotulo,
            rebobinamento: etiqueta.rebobinamento,
          };
          const etiquetaRow = await tx.orcamentoItemEtiqueta.upsert({
            where: { orcamentoItemId },
            create: { orcamentoItemId, ...dadosEtiqueta },
            update: dadosEtiqueta,
          });

          // Lista pequena, sem histórico a preservar (diferente de
          // VarianteMateriaPrima) — mais simples apagar tudo e recriar do
          // zero a partir do array enviado do que diffar item a item.
          await tx.orcamentoItemHotStamping.deleteMany({
            where: { orcamentoItemEtiquetaId: etiquetaRow.id },
          });
          if (etiqueta.hotStampings.length > 0) {
            await tx.orcamentoItemHotStamping.createMany({
              data: etiqueta.hotStampings.map((h) => ({
                orcamentoItemEtiquetaId: etiquetaRow.id,
                lado: h.lado,
                tipo: h.tipo,
                medida: h.medida,
                cor: h.cor,
              })),
            });
          }
        }

        const agregado = await tx.orcamentoItem.aggregate({
          where: { orcamentoId },
          _sum: { precoTotal: true },
        });
        await tx.orcamento.update({
          where: { id: orcamentoId },
          data: { total: agregado._sum.precoTotal ?? 0 },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (erro) {
    if (ehConflitoDeSerializacao(erro)) {
      return { ok: false, mensagem: MENSAGEM_CONFLITO_CONCORRENTE };
    }
    throw erro;
  }

  revalidatePath(`/orcamento/${orcamentoId}`);
  revalidatePath("/orcamento");

  return { ok: true, mensagem: "Item atualizado com sucesso!" };
}

export type AlterarClienteResult = { ok: boolean; mensagem: string };

export async function alterarClienteOrcamento(
  _estadoAnterior: AlterarClienteResult | null,
  formData: FormData
): Promise<AlterarClienteResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar orçamentos." };
  }
  const orcamentoId = String(formData.get("orcamentoId"));
  const clienteId = String(formData.get("clienteId"));

  const orcamento = await prisma.orcamento.findFirst({
    where: { id: orcamentoId, graficaId: usuario.graficaId },
  });
  if (!orcamento) {
    return { ok: false, mensagem: "Orçamento não encontrado." };
  }
  if (orcamento.status !== "RASCUNHO") {
    return { ok: false, mensagem: "Só é possível trocar o cliente de um orçamento em rascunho." };
  }

  const cliente = await prisma.cliente.findFirst({
    where: { id: clienteId, graficaId: usuario.graficaId },
  });
  if (!cliente) {
    return { ok: false, mensagem: "Cliente não encontrado." };
  }

  await prisma.orcamento.update({
    where: { id: orcamentoId },
    data: { clienteId: cliente.id },
  });

  revalidatePath(`/orcamento/${orcamentoId}`);
  revalidatePath("/orcamento");

  return { ok: true, mensagem: "Cliente atualizado." };
}

const tipoPedidoSchema = z.enum([
  "MODELO_NOVO",
  "REPETICAO_SEM_ALTERACAO",
  "REPETICAO_COM_ALTERACAO",
]);
const freteSchema = z.enum(["EMITENTE", "DESTINATARIO"]);

export type EditarDadosGeraisResult = { ok: boolean; mensagem: string };

// Campos gerais do pedido (vendedor, tipo de pedido, contato específico
// deste orçamento, condições de pagamento, frete, transportadora, local de
// entrega, observações internas) — editáveis a QUALQUER status, diferente do
// resto do orçamento (que trava em RASCUNHO): nenhum desses campos mexe no
// total nem no preço que o cliente já viu, e frete/transportadora
// normalmente só são definidos depois que o cliente aprova.
export async function editarDadosGeraisOrcamento(
  _estadoAnterior: EditarDadosGeraisResult | null,
  formData: FormData
): Promise<EditarDadosGeraisResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar orçamentos." };
  }
  const orcamentoId = String(formData.get("orcamentoId"));

  const orcamento = await prisma.orcamento.findFirst({
    where: { id: orcamentoId, graficaId: usuario.graficaId },
  });
  if (!orcamento) {
    return { ok: false, mensagem: "Orçamento não encontrado." };
  }

  const tipoPedidoBruto = formData.get("tipoPedido");
  const tipoPedidoParsed = tipoPedidoBruto ? tipoPedidoSchema.safeParse(tipoPedidoBruto) : null;
  if (tipoPedidoParsed && !tipoPedidoParsed.success) {
    return { ok: false, mensagem: "Tipo de pedido inválido." };
  }

  const freteBruto = formData.get("frete");
  const freteParsed = freteBruto ? freteSchema.safeParse(freteBruto) : null;
  if (freteParsed && !freteParsed.success) {
    return { ok: false, mensagem: "Tipo de frete inválido." };
  }

  const campoTexto = (nome: string, max: number) =>
    String(formData.get(nome) || "").trim().slice(0, max) || null;

  await prisma.orcamento.update({
    where: { id: orcamentoId },
    data: {
      vendedor: campoTexto("vendedor", 120),
      tipoPedido: tipoPedidoParsed?.success ? tipoPedidoParsed.data : null,
      contatoNome: campoTexto("contatoNome", 120),
      contatoEmail: campoTexto("contatoEmail", 200),
      condicoesPagamento: campoTexto("condicoesPagamento", 200),
      frete: freteParsed?.success ? freteParsed.data : null,
      transportadora: campoTexto("transportadora", 120),
      localEntrega: campoTexto("localEntrega", 500),
      observacoes: campoTexto("observacoes", 2000),
    },
  });

  // Sem gate de status, esses campos podem ser reescritos a qualquer momento
  // por qualquer pessoa com acesso — o log é o único jeito de saber depois
  // quem mudou o quê (ver comentário de editarEtapasOrcamento, mesma lógica).
  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "orcamento.editar_dados_gerais",
    entidade: "Orcamento",
    entidadeId: orcamentoId,
    descricao: `Dados gerais atualizados no orçamento #${orcamentoId.slice(-6)}`,
  });

  revalidatePath(`/orcamento/${orcamentoId}`);
  revalidatePath("/orcamento");

  return { ok: true, mensagem: "Dados do pedido atualizados." };
}

export type EnviarArteOrcamentoResult = { ok: boolean; mensagem: string };

// Sobe a arte já na fase de orçamento, enquanto ainda é RASCUNHO — mesmo
// padrão de enviarArte (src/app/producao/actions.ts), mas mais simples:
// sem link/token de aprovação pública nem estado de "aguardando aprovação
// do cliente" (isso é exclusivo do fluxo de Pedido em produção; aqui é só
// pré-visualização pro cliente ver junto do orçamento, ver /o/[token]).
// access "public" pelo mesmo motivo de enviarArte: a arte é vista pelo
// cliente através do link com token de qualquer forma, sem segredo nenhum.
export async function enviarArteOrcamento(
  _estadoAnterior: EnviarArteOrcamentoResult | null,
  formData: FormData
): Promise<EnviarArteOrcamentoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar orçamentos." };
  }

  const orcamentoId = String(formData.get("orcamentoId"));
  const arquivo = formData.get("arquivo");
  if (!(arquivo instanceof File)) {
    return { ok: false, mensagem: "Selecione um arquivo." };
  }
  const validacao = validarArquivoArte(arquivo);
  if (!validacao.ok) {
    return { ok: false, mensagem: validacao.mensagem };
  }
  // Confere a assinatura real do arquivo, não só o Content-Type declarado
  // pelo cliente (forjável) — ver comentário em upload-validacao.ts.
  const cabecalho = new Uint8Array(await arquivo.slice(0, BYTES_ASSINATURA).arrayBuffer());
  if (!assinaturaBateComTipo(cabecalho, arquivo.type)) {
    return { ok: false, mensagem: "O conteúdo do arquivo não corresponde a um PDF, JPG ou PNG." };
  }

  const orcamento = await prisma.orcamento.findFirst({
    where: { id: orcamentoId, graficaId: usuario.graficaId },
  });
  if (!orcamento) {
    return { ok: false, mensagem: "Orçamento não encontrado." };
  }
  // Gate extra que enviarArte de Pedido não precisa ter: evita mexer num
  // arquivo que um Pedido já criado passou a referenciar (ver
  // atualizarStatusOrcamento/o/[token]/actions.ts, que copiam arteUrl pro
  // Pedido no momento da aprovação).
  if (orcamento.status !== "RASCUNHO") {
    return { ok: false, mensagem: "Só é possível anexar arte enquanto o orçamento está em rascunho." };
  }

  // Reserva o espaço ANTES do put() — nunca depois, senão um upload rejeitado
  // por cota já teria custado o armazenamento (ver src/lib/billing/armazenamento.ts).
  const contextoArmazenamento = resolverContextoArmazenamento(usuario);
  const reserva = await reservarEspaco({
    graficaId: usuario.graficaId,
    tipo: "ARTE_ORCAMENTO",
    referenciaId: orcamentoId,
    bytes: arquivo.size,
    contexto: contextoArmazenamento,
  });
  if (!reserva.ok) {
    return { ok: false, mensagem: reserva.mensagem };
  }

  const extensao = extensaoArte(arquivo.type);
  let blob;
  try {
    blob = await put(`orcamentos-arte/${usuario.graficaId}/${orcamentoId}-${Date.now()}.${extensao}`, arquivo, {
      access: "public",
      addRandomSuffix: true,
      contentType: arquivo.type,
    });
  } catch (erro) {
    await cancelarReserva(reserva.arquivoId);
    throw erro;
  }
  await confirmarArquivo(reserva.arquivoId, { url: blob.url, pathname: blob.pathname });

  await prisma.orcamento.update({
    where: { id: orcamentoId },
    data: { arteUrl: blob.url },
  });

  // Apaga a arte anterior DEPOIS que a nova já está gravada no banco (melhor
  // esforço) — mesmo cuidado de enviarArte (producao/actions.ts): sem isso,
  // cada reenvio deixava o arquivo antigo no Blob pra sempre, público e sem
  // nenhuma referência no banco.
  if (orcamento.arteUrl) {
    await del(orcamento.arteUrl).catch(() => {});
  }

  revalidatePath(`/orcamento/${orcamentoId}`);

  return { ok: true, mensagem: "Arte enviada." };
}

// Única forma de liberar o espaço ocupado por uma arte de orçamento sem
// precisar substituí-la por outra — mesmos gates de enviarArteOrcamento.
export async function removerArteOrcamento(
  _estadoAnterior: EnviarArteOrcamentoResult | null,
  formData: FormData
): Promise<EnviarArteOrcamentoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar orçamentos." };
  }

  const orcamentoId = String(formData.get("orcamentoId"));
  const orcamento = await prisma.orcamento.findFirst({
    where: { id: orcamentoId, graficaId: usuario.graficaId },
  });
  if (!orcamento) {
    return { ok: false, mensagem: "Orçamento não encontrado." };
  }
  if (orcamento.status !== "RASCUNHO") {
    return { ok: false, mensagem: "Só é possível anexar arte enquanto o orçamento está em rascunho." };
  }
  if (!orcamento.arteUrl) {
    return { ok: false, mensagem: "Este orçamento não tem arte enviada." };
  }

  await prisma.orcamento.update({
    where: { id: orcamentoId },
    data: { arteUrl: null },
  });

  const arquivoRemovido = await removerArquivo({
    graficaId: usuario.graficaId,
    tipo: "ARTE_ORCAMENTO",
    referenciaId: orcamentoId,
  });
  if (arquivoRemovido) {
    await del(arquivoRemovido.url).catch(() => {});
  }

  revalidatePath(`/orcamento/${orcamentoId}`);
  return { ok: true, mensagem: "Arte removida." };
}

export type EditarEtapasResult = { ok: boolean; mensagem: string };

// As 5 etapas de produção (data/hora + responsável cada, ver
// src/lib/orcamento-etapas.ts) — editável a qualquer status (a maioria só
// faz sentido depois de RASCUNHO mesmo: Aprovação/Pedido/Entrega acontecem
// depois que o orçamento já avançou). Responsável é texto livre porque pode
// ser uma pessoa diferente de quem está logado (alguém registrando o
// trabalho de outra pessoa) — não é um log de eventos, é editável direto.
export async function editarEtapasOrcamento(
  _estadoAnterior: EditarEtapasResult | null,
  formData: FormData
): Promise<EditarEtapasResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar orçamentos." };
  }
  const orcamentoId = String(formData.get("orcamentoId"));

  const orcamento = await prisma.orcamento.findFirst({
    where: { id: orcamentoId, graficaId: usuario.graficaId },
  });
  if (!orcamento) {
    return { ok: false, mensagem: "Orçamento não encontrado." };
  }

  const valoresPorChave = Object.fromEntries(
    ETAPAS_ORCAMENTO.map(({ chave }) => {
      const emBruto = formData.get(nomeCampoEtapaEm(chave));
      const em = typeof emBruto === "string" && emBruto ? dataHoraInputParaUTC(emBruto) : null;
      const responsavel =
        String(formData.get(nomeCampoEtapaResponsavel(chave)) || "").trim().slice(0, 120) || null;
      return [chave, { em, responsavel }];
    })
  ) as Record<ChaveEtapaOrcamento, { em: Date | null; responsavel: string | null }>;

  await prisma.orcamento.update({
    where: { id: orcamentoId },
    data: {
      etapaOrcamentoDesenvolvimentoEm: valoresPorChave.orcamentoDesenvolvimento.em,
      etapaOrcamentoDesenvolvimentoResponsavel: valoresPorChave.orcamentoDesenvolvimento.responsavel,
      etapaLayoutEm: valoresPorChave.layout.em,
      etapaLayoutResponsavel: valoresPorChave.layout.responsavel,
      etapaAprovacaoEm: valoresPorChave.aprovacao.em,
      etapaAprovacaoResponsavel: valoresPorChave.aprovacao.responsavel,
      etapaConfirmacaoPedidoEm: valoresPorChave.confirmacaoPedido.em,
      etapaConfirmacaoPedidoResponsavel: valoresPorChave.confirmacaoPedido.responsavel,
      etapaEntregaEm: valoresPorChave.entrega.em,
      etapaEntregaResponsavel: valoresPorChave.entrega.responsavel,
    },
  });

  // As etapas não têm gate de status nem trava de campo parcial (ver comentário
  // acima da função) — data e responsável são texto/data livres, editáveis a
  // qualquer momento por qualquer pessoa com acesso ao módulo. Sem isso, uma
  // mudança de "quando entregamos e quem fez" não deixava nenhum rastro.
  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "orcamento.editar_etapas",
    entidade: "Orcamento",
    entidadeId: orcamentoId,
    descricao: `Etapas de produção atualizadas no orçamento #${orcamentoId.slice(-6)}`,
  });

  revalidatePath(`/orcamento/${orcamentoId}`);

  return { ok: true, mensagem: "Etapas atualizadas." };
}

// Valores dos enums de etiqueta, usados só pra validar campo solto vindo de
// FormData (adicionarItemOrcamento/editarOrcamento) — o schema zod completo
// (usado no carrinho JSON de criarOrcamento) vive em src/app/orcamento/actions.ts.
const MATERIAL_SUBSTRATO_VALORES = [
  "PAPEL_TERMICO",
  "COUCHE_C_ROT",
  "BOPP_METALIZADO_ROT",
  "BOPP_BCO_PEROLIZADO",
  "BOPP_BCO_FOSCO",
  "BOPP_TRANSPARENTE",
  "L2_SEM_ADESIVO",
  "POLIETILENO_BRANCO",
  "POLIETILENO_TRANSPARENTE",
  "POLIESTER_BRANCO",
  "POLIESTER_TRANSPARENTE",
  "POLIESTER_CROMO_FOSCO",
  "ELETROSTATICO_SEM_COLA",
  "OUTRO",
] as const;
const TIPO_ADESIVO_VALORES = [
  "ACRILICO_20G",
  "ACRILICO_30G",
  "BORRACHA_20G",
  "BORRACHA_25G",
  "BORRACHA_30G",
  "BORRACHA_50G",
] as const;
const SUPERFICIE_APLICACAO_VALORES = ["VIDRO", "PLASTICO", "METAL", "PAPEL", "PAPELAO", "OUTROS"] as const;
const TIPO_ROTULAGEM_VALORES = ["MANUAL", "AUTOMATICA"] as const;
const TIPO_SERRILHA_VALORES = ["SERRILHA", "MICRO_SERRILHA", "GAP"] as const;
const TIPO_LAMINACAO_VALORES = ["BRILHO", "FOSCO"] as const;
const TIPO_VERNIZ_VALORES = ["BRILHO", "FOSCO", "RIBBON"] as const;

const hotStampingFormSchema = z.object({
  lado: z.enum(["ROTULO", "CONTRA_ROTULO"]),
  tipo: z.enum(["HOT", "COLD"]),
  medida: z.string().max(60).nullable(),
  cor: z.string().max(60).nullable(),
});

type EtiquetaParaGravar = {
  materialSubstrato: (typeof MATERIAL_SUBSTRATO_VALORES)[number] | null;
  materialSubstratoOutro: string | null;
  tipoAdesivo: (typeof TIPO_ADESIVO_VALORES)[number] | null;
  superficieAplicacao: (typeof SUPERFICIE_APLICACAO_VALORES)[number] | null;
  formatoEtiqueta: string | null;
  coresRotulo: number | null;
  coresContraRotulo: number | null;
  embalagemQtdPorRolo: number | null;
  tubeteMedida: string | null;
  rotulagem: (typeof TIPO_ROTULAGEM_VALORES)[number] | null;
  serrilha: (typeof TIPO_SERRILHA_VALORES)[number] | null;
  vernizRotuloTotal: boolean;
  vernizRotuloReserva: boolean;
  vernizRotuloTipo: (typeof TIPO_VERNIZ_VALORES)[number] | null;
  vernizContraRotuloTotal: boolean;
  vernizContraRotuloReserva: boolean;
  vernizContraRotuloTipo: (typeof TIPO_VERNIZ_VALORES)[number] | null;
  laminacaoRotulo: (typeof TIPO_LAMINACAO_VALORES)[number] | null;
  laminacaoContraRotulo: (typeof TIPO_LAMINACAO_VALORES)[number] | null;
  rebobinamento: number | null;
  hotStampings: z.infer<typeof hotStampingFormSchema>[];
};

type ResultadoEtiquetaFormData = { ok: true; etiqueta: EtiquetaParaGravar } | { ok: false; mensagem: string };

// Lê e valida os ~18 campos de etiqueta soltos no FormData (não JSON — mesmo
// padrão do resto deste arquivo) + a lista de hot stampings (essa sim vem
// como JSON num hidden field, é a única parte de tamanho variável). Usado
// por adicionarItemOrcamento e editarOrcamento.
function lerEtiquetaDoFormData(formData: FormData): ResultadoEtiquetaFormData {
  const campoTexto = (nome: string, max: number) =>
    String(formData.get(nome) || "").trim().slice(0, max) || null;
  const campoEnum = <T extends string>(nome: string, valores: readonly T[]): T | null => {
    const bruto = formData.get(nome);
    return typeof bruto === "string" && (valores as readonly string[]).includes(bruto) ? (bruto as T) : null;
  };
  const campoBooleano = (nome: string) => formData.get(nome) === "on" || formData.get(nome) === "true";
  const campoString = (nome: string): string | null => {
    const bruto = formData.get(nome);
    return typeof bruto === "string" ? bruto : null;
  };

  const materialSubstrato = campoEnum("materialSubstrato", MATERIAL_SUBSTRATO_VALORES);
  const materialSubstratoOutro = campoTexto("materialSubstratoOutro", 120);
  const validacaoOutro = validarMaterialSubstratoOutro(materialSubstrato, materialSubstratoOutro);
  if (!validacaoOutro.ok) return { ok: false, mensagem: validacaoOutro.mensagem };

  const coresRotuloResult = validarContagemCor(campoString("coresRotulo"), "Cores rótulo");
  if (!coresRotuloResult.ok) return { ok: false, mensagem: coresRotuloResult.mensagem };
  const coresContraRotuloResult = validarContagemCor(campoString("coresContraRotulo"), "Cores contra-rótulo");
  if (!coresContraRotuloResult.ok) return { ok: false, mensagem: coresContraRotuloResult.mensagem };
  const embalagemQtdResult = validarContagemCor(campoString("embalagemQtdPorRolo"), "Quantidade por rolo");
  if (!embalagemQtdResult.ok) return { ok: false, mensagem: embalagemQtdResult.mensagem };
  const rebobinamentoResult = normalizarRebobinamento(campoString("rebobinamento"));
  if (!rebobinamentoResult.ok) return { ok: false, mensagem: rebobinamentoResult.mensagem };

  const hotStampingsParsed = parseJsonArray(formData.get("hotStampingsJson"), hotStampingFormSchema, {
    max: 20,
  });
  if (!hotStampingsParsed.ok) return { ok: false, mensagem: hotStampingsParsed.mensagem };

  return {
    ok: true,
    etiqueta: {
      materialSubstrato,
      materialSubstratoOutro,
      tipoAdesivo: campoEnum("tipoAdesivo", TIPO_ADESIVO_VALORES),
      superficieAplicacao: campoEnum("superficieAplicacao", SUPERFICIE_APLICACAO_VALORES),
      formatoEtiqueta: campoTexto("formatoEtiqueta", 120),
      coresRotulo: coresRotuloResult.valor,
      coresContraRotulo: coresContraRotuloResult.valor,
      embalagemQtdPorRolo: embalagemQtdResult.valor,
      tubeteMedida: campoTexto("tubeteMedida", 60),
      rotulagem: campoEnum("rotulagem", TIPO_ROTULAGEM_VALORES),
      serrilha: campoEnum("serrilha", TIPO_SERRILHA_VALORES),
      vernizRotuloTotal: campoBooleano("vernizRotuloTotal"),
      vernizRotuloReserva: campoBooleano("vernizRotuloReserva"),
      vernizRotuloTipo: campoEnum("vernizRotuloTipo", TIPO_VERNIZ_VALORES),
      vernizContraRotuloTotal: campoBooleano("vernizContraRotuloTotal"),
      vernizContraRotuloReserva: campoBooleano("vernizContraRotuloReserva"),
      vernizContraRotuloTipo: campoEnum("vernizContraRotuloTipo", TIPO_VERNIZ_VALORES),
      laminacaoRotulo: campoEnum("laminacaoRotulo", TIPO_LAMINACAO_VALORES),
      laminacaoContraRotulo: campoEnum("laminacaoContraRotulo", TIPO_LAMINACAO_VALORES),
      rebobinamento: rebobinamentoResult.valor,
      hotStampings: hotStampingsParsed.data,
    },
  };
}

export type AdicionarItemResult = { ok: boolean; mensagem: string };

export async function adicionarItemOrcamento(
  _estadoAnterior: AdicionarItemResult | null,
  formData: FormData
): Promise<AdicionarItemResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar orçamentos." };
  }
  const orcamentoId = String(formData.get("orcamentoId"));
  const itemGraficaId = String(formData.get("itemGraficaId"));
  const quantidade = Number(formData.get("quantidade"));
  // Valor DIGITADO na unidade abaixo — NÃO necessariamente centímetro (ver
  // SeletorItemOrcamento.tsx). Validado e convertido pra cm mais abaixo,
  // antes de calcularItemOrcamento.
  const larguraBruta = formData.get("largura") ? Number(formData.get("largura")) : null;
  const alturaBruta = formData.get("altura") ? Number(formData.get("altura")) : null;
  // Limites iguais aos de itemEntradaSchema (orcamento/actions.ts), que
  // criarOrcamento já aplica — editarOrcamento/adicionarItemOrcamento não
  // usavam zod aqui e aceitavam string de qualquer tamanho. Com
  // serverActions.bodySizeLimit em 25mb (por causa do upload de arte), isso
  // permitia gravar dezenas de MB de texto numa única linha de orçamento.
  const cores = String(formData.get("cores") || "").slice(0, 60);
  const acabamento = String(formData.get("acabamento") || "").slice(0, 200);
  const corFrente = formData.get("corFrente") ? Number(formData.get("corFrente")) : null;
  const corVerso = formData.get("corVerso") ? Number(formData.get("corVerso")) : null;

  if (!itemGraficaId || !quantidade || quantidade <= 0 || quantidade > 1_000_000) {
    return { ok: false, mensagem: "Escolha um produto e uma quantidade válida (até 1.000.000 unidades)." };
  }

  // Nunca confia na unidade vinda do formulário — precisa ser uma das 3 que
  // existem antes de converter pra cm.
  const unidadeParsed = unidadeDimensaoSchema.safeParse(formData.get("unidadeDimensao"));
  if (!unidadeParsed.success) {
    return { ok: false, mensagem: "Unidade de medida inválida." };
  }
  const unidadeDimensao = unidadeParsed.data;
  const larguraCm = larguraBruta !== null ? converterParaCm(larguraBruta, unidadeDimensao) : null;
  const alturaCm = alturaBruta !== null ? converterParaCm(alturaBruta, unidadeDimensao) : null;

  const orcamento = await prisma.orcamento.findFirst({
    where: { id: orcamentoId, graficaId: usuario.graficaId },
  });
  if (!orcamento) {
    return { ok: false, mensagem: "Orçamento não encontrado." };
  }
  if (orcamento.status !== "RASCUNHO") {
    return { ok: false, mensagem: "Só é possível adicionar itens a um orçamento em rascunho." };
  }

  const itemGrafica = await prisma.itemGrafica.findFirst({
    where: {
      id: itemGraficaId,
      graficaId: usuario.graficaId,
      ativo: true,
      precoVenda: { not: null },
    },
  });
  if (!itemGrafica || !itemGrafica.precoVenda) {
    return { ok: false, mensagem: "Produto ou serviço não encontrado." };
  }

  const resultado = await calcularItemOrcamento(itemGrafica, usuario.graficaId, {
    quantidade,
    larguraCm,
    alturaCm,
    corFrente,
    corVerso,
  });
  if (!resultado.ok) {
    return { ok: false, mensagem: resultado.mensagem };
  }

  // Etiqueta não entra na conta de preço (ver src/lib/pricing/m2.ts) — só
  // relevante/gravada quando o item é M2 (flexografia).
  let etiqueta: EtiquetaParaGravar | null = null;
  if (resultado.modeloCalculo === "M2") {
    const etiquetaResult = lerEtiquetaDoFormData(formData);
    if (!etiquetaResult.ok) {
      return { ok: false, mensagem: etiquetaResult.mensagem };
    }
    etiqueta = etiquetaResult.etiqueta;
  }

  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.orcamentoItem.create({
          data: {
            orcamentoId,
            itemGraficaId: itemGrafica.id,
            quantidade,
            larguraCm,
            alturaCm,
            unidadeDimensao,
            cores: cores || null,
            acabamento: acabamento || null,
            precoUnitario: resultado.precoUnitario,
            precoTotal: resultado.precoTotal,
            // Preço sugerido pelo motor no momento da criação — nunca editado
            // depois de gravado (ver fase-custo-real.md §2.4). Igual a
            // precoUnitario nesta primeira gravação; só diverge quando um
            // desconto é aplicado depois via aplicarDescontoItemOrcamento.
            precoSugeridoUnitario: resultado.precoUnitario,
            modeloCalculo: resultado.modeloCalculo,
            corFrente: resultado.corFrente,
            corVerso: resultado.corVerso,
            breakdown: resultado.breakdown ?? undefined,
            etiqueta:
              resultado.modeloCalculo === "M2"
                ? {
                    create: {
                      materialSubstrato: etiqueta?.materialSubstrato ?? null,
                      materialSubstratoOutro: etiqueta?.materialSubstratoOutro ?? null,
                      tipoAdesivo: etiqueta?.tipoAdesivo ?? null,
                      superficieAplicacao: etiqueta?.superficieAplicacao ?? null,
                      formatoEtiqueta: etiqueta?.formatoEtiqueta ?? null,
                      coresRotulo: etiqueta?.coresRotulo ?? null,
                      coresContraRotulo: etiqueta?.coresContraRotulo ?? null,
                      embalagemQtdPorRolo: etiqueta?.embalagemQtdPorRolo ?? null,
                      tubeteMedida: etiqueta?.tubeteMedida ?? null,
                      rotulagem: etiqueta?.rotulagem ?? null,
                      serrilha: etiqueta?.serrilha ?? null,
                      vernizRotuloTotal: etiqueta?.vernizRotuloTotal ?? false,
                      vernizRotuloReserva: etiqueta?.vernizRotuloReserva ?? false,
                      vernizRotuloTipo: etiqueta?.vernizRotuloTipo ?? null,
                      vernizContraRotuloTotal: etiqueta?.vernizContraRotuloTotal ?? false,
                      vernizContraRotuloReserva: etiqueta?.vernizContraRotuloReserva ?? false,
                      vernizContraRotuloTipo: etiqueta?.vernizContraRotuloTipo ?? null,
                      laminacaoRotulo: etiqueta?.laminacaoRotulo ?? null,
                      laminacaoContraRotulo: etiqueta?.laminacaoContraRotulo ?? null,
                      rebobinamento: etiqueta?.rebobinamento ?? null,
                      hotStampings: {
                        create: (etiqueta?.hotStampings ?? []).map((h) => ({
                          lado: h.lado,
                          tipo: h.tipo,
                          medida: h.medida,
                          cor: h.cor,
                        })),
                      },
                    },
                  }
                : undefined,
          },
        });
        const agregado = await tx.orcamentoItem.aggregate({
          where: { orcamentoId },
          _sum: { precoTotal: true },
        });
        await tx.orcamento.update({
          where: { id: orcamentoId },
          data: { total: agregado._sum.precoTotal ?? 0 },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (erro) {
    if (ehConflitoDeSerializacao(erro)) {
      return { ok: false, mensagem: MENSAGEM_CONFLITO_CONCORRENTE };
    }
    throw erro;
  }

  revalidatePath(`/orcamento/${orcamentoId}`);
  revalidatePath("/orcamento");

  return { ok: true, mensagem: "Item adicionado com sucesso!" };
}

export type RemoverItemResult = { ok: boolean; mensagem: string };

export async function removerItemOrcamento(
  _estadoAnterior: RemoverItemResult | null,
  formData: FormData
): Promise<RemoverItemResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar orçamentos." };
  }
  const orcamentoItemId = String(formData.get("orcamentoItemId"));

  const item = await prisma.orcamentoItem.findFirst({
    where: { id: orcamentoItemId, orcamento: { graficaId: usuario.graficaId } },
    include: { orcamento: true },
  });
  if (!item) {
    return { ok: false, mensagem: "Item não encontrado." };
  }
  if (item.orcamento.status !== "RASCUNHO") {
    return { ok: false, mensagem: "Só é possível remover itens de um orçamento em rascunho." };
  }

  try {
    await prisma.$transaction(
      async (tx) => {
        // Contagem refeita AQUI DENTRO (não a partir de uma leitura solta) —
        // sob Serializable, duas remoções concorrentes no mesmo orçamento não
        // conseguem as duas passar por essa checagem: uma é abortada com
        // conflito de serialização (ver catch abaixo).
        const quantidadeItens = await tx.orcamentoItem.count({
          where: { orcamentoId: item.orcamentoId },
        });
        if (quantidadeItens <= 1) {
          throw new ErroUltimoItemOrcamento();
        }

        await tx.orcamentoItem.delete({ where: { id: orcamentoItemId } });

        const agregado = await tx.orcamentoItem.aggregate({
          where: { orcamentoId: item.orcamentoId },
          _sum: { precoTotal: true },
        });
        await tx.orcamento.update({
          where: { id: item.orcamentoId },
          data: { total: agregado._sum.precoTotal ?? 0 },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (erro) {
    if (erro instanceof ErroUltimoItemOrcamento) {
      return {
        ok: false,
        mensagem:
          "O orçamento precisa ter pelo menos um item — cancele o orçamento se quiser removê-lo por completo.",
      };
    }
    if (ehConflitoDeSerializacao(erro)) {
      return { ok: false, mensagem: MENSAGEM_CONFLITO_CONCORRENTE };
    }
    throw erro;
  }

  // A linha de OrcamentoItemTinta já foi cascade-apagada junto do item, mas
  // o razão de armazenamento (ArquivoArmazenado) e o arquivo de verdade no
  // Blob NÃO — só têm relação com Grafica, não com OrcamentoItem. Melhor
  // esforço, depois que a remoção do item já foi confirmada.
  const arquivoTintaRemovido = await removerArquivo({
    graficaId: usuario.graficaId,
    tipo: "ANALISE_TINTA",
    referenciaId: orcamentoItemId,
  });
  if (arquivoTintaRemovido) {
    await del(arquivoTintaRemovido.url, { token: exigirTokenBlobPrivado() }).catch(() => {});
  }

  revalidatePath(`/orcamento/${item.orcamentoId}`);
  revalidatePath("/orcamento");

  return { ok: true, mensagem: "Item removido." };
}

const tipoDescontoFormSchema = z.enum(["PERCENTUAL", "VALOR_ABSOLUTO", "PRECO_FINAL"]);

export type AplicarDescontoResult = { ok: boolean; mensagem: string };

// Aplica (tipo+valor+motivo) ou remove (remover=true) um desconto negociado
// sobre o preço sugerido pelo motor num item já adicionado ao orçamento (ver
// fase-custo-real.md §2.4, §4.2). precoUnitario/precoTotal continuam sendo
// o VALOR VENDIDO de sempre — esta action só os recalcula a partir de
// precoSugeridoUnitario (gravado uma única vez em adicionarItemOrcamento,
// nunca mexido depois) + o desconto pedido aqui. Duas travas inegociáveis:
// preço negociado nunca fica abaixo do custo direto do item (mesma
// checagem/mensagem da trava que o motor já usa pro preço SUGERIDO, ver
// ErroPrecificacao "PRECO_ABAIXO_DO_CUSTO" em src/lib/pricing/compor.ts), e
// desconto acima de ParametrosGrafica.descontoMaxSemAprovacao só um
// DONO/ADMIN aplica (grava aprovadoPorId).
export async function aplicarDescontoItemOrcamento(
  _estadoAnterior: AplicarDescontoResult | null,
  formData: FormData
): Promise<AplicarDescontoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar orçamentos." };
  }

  const orcamentoItemId = String(formData.get("orcamentoItemId"));
  const remover = formData.get("remover") === "true";
  const motivo = String(formData.get("motivo") || "").trim().slice(0, 300);

  const item = await prisma.orcamentoItem.findFirst({
    where: { id: orcamentoItemId, orcamento: { graficaId: usuario.graficaId } },
    include: {
      orcamento: { select: { status: true } },
      itemGrafica: { select: { precoCompra: true } },
    },
  });
  if (!item) {
    return { ok: false, mensagem: "Item não encontrado." };
  }
  if (item.orcamento.status !== "RASCUNHO") {
    return {
      ok: false,
      mensagem: "Só é possível alterar o preço negociado de um item em um orçamento em rascunho.",
    };
  }
  // Item criado antes desta funcionalidade (precoSugeridoUnitario nasceu
  // nulo pra tudo que já existia) — sem uma baseline sugerida não dá pra
  // calcular desconto algum. Renderiza normalmente (ver EditarOrcamentoForm),
  // só não deixa aplicar aqui.
  if (item.precoSugeridoUnitario === null) {
    return {
      ok: false,
      mensagem:
        "Este item não tem preço sugerido registrado (foi criado antes desta funcionalidade) — remova e adicione o item novamente para negociar o preço.",
    };
  }

  const precoSugerido = paraDecimal(item.precoSugeridoUnitario.toString());
  const quantidade = item.quantidade;
  const precoUnitarioAnterior = item.precoUnitario.toString();

  let novoPrecoUnitario: Dec;
  let descontoTipoGravar: z.infer<typeof tipoDescontoFormSchema> | null = null;
  let descontoValorGravar: Dec | null = null;

  if (remover) {
    novoPrecoUnitario = precoSugerido.toDecimalPlaces(2);
  } else {
    const tipoParsed = tipoDescontoFormSchema.safeParse(formData.get("tipo"));
    if (!tipoParsed.success) {
      return { ok: false, mensagem: "Tipo de desconto inválido." };
    }
    if (!motivo) {
      return { ok: false, mensagem: "Informe o motivo do desconto." };
    }
    const valorNumero = Number(formData.get("valor"));
    if (!Number.isFinite(valorNumero)) {
      return { ok: false, mensagem: "Informe um valor de desconto válido." };
    }

    if (tipoParsed.data === "PERCENTUAL") {
      if (valorNumero < 0 || valorNumero >= 100) {
        return { ok: false, mensagem: "Informe um percentual de desconto entre 0 e 100." };
      }
      novoPrecoUnitario = precoSugerido
        .times(paraDecimal(1).minus(paraDecimal(valorNumero).div(100)))
        .toDecimalPlaces(2);
      descontoValorGravar = paraDecimal(valorNumero);
    } else if (tipoParsed.data === "VALOR_ABSOLUTO") {
      if (valorNumero < 0) {
        return { ok: false, mensagem: "Informe um valor de desconto maior ou igual a zero." };
      }
      novoPrecoUnitario = precoSugerido.minus(paraDecimal(valorNumero)).toDecimalPlaces(2);
      descontoValorGravar = paraDecimal(valorNumero);
    } else {
      if (valorNumero < 0) {
        return { ok: false, mensagem: "Informe um preço final válido." };
      }
      novoPrecoUnitario = paraDecimal(valorNumero).toDecimalPlaces(2);
      descontoValorGravar = precoSugerido.minus(novoPrecoUnitario);
    }
    descontoTipoGravar = tipoParsed.data;

    if (novoPrecoUnitario.lte(0)) {
      return { ok: false, mensagem: "O preço negociado precisa ser maior que zero." };
    }
  }

  const novoPrecoTotal = novoPrecoUnitario.times(quantidade);

  // Trava de preço mínimo — mesma checagem/mensagem que o motor já usa pra
  // travar o preço SUGERIDO, aplicada agora ao preço NEGOCIADO. Custo direto
  // calculado do mesmo jeito que o bloco de comissão logo acima neste mesmo
  // arquivo (breakdown.custoTotal pra M2/OFFSET, precoCompra × quantidade
  // pra SIMPLES) — nunca inventa um número novo pra "custo". Remover
  // desconto sempre volta pro preço que o motor já validou na criação, então
  // não precisa passar por esta checagem de novo.
  if (!remover) {
    const breakdown = item.breakdown as { custoTotal?: string } | null;
    const custoDiretoNumero = breakdown?.custoTotal
      ? Number(breakdown.custoTotal)
      : item.itemGrafica.precoCompra
        ? Number(item.itemGrafica.precoCompra) * quantidade
        : 0;
    const custoDireto = paraDecimal(custoDiretoNumero);

    if (novoPrecoTotal.lt(custoDireto)) {
      return {
        ok: false,
        mensagem:
          "O preço final calculado ficou abaixo do custo direto — configuração de margem/encargos provavelmente incorreta. Orçamento abortado por segurança.",
      };
    }
  }

  // Trava de aprovação — desconto efetivo sobre o preço SUGERIDO (baseline
  // fixa, não sobre o preço vendido anterior, que já poderia ter outro
  // desconto embutido). Só entra em jogo aplicando desconto: remover volta
  // ao sugerido = 0% de desconto, sem checagem.
  let aprovadoPorId: string | null = null;
  let descontoPercentualEfetivo: Dec | null = null;
  if (!remover) {
    descontoPercentualEfetivo = precoSugerido.gt(0)
      ? paraDecimal(1).minus(novoPrecoUnitario.div(precoSugerido)).times(100)
      : paraDecimal(0);

    const parametros = await prisma.parametrosGrafica.findUnique({
      where: { graficaId: usuario.graficaId },
      select: { descontoMaxSemAprovacao: true },
    });
    const limite = parametros
      ? paraDecimal(parametros.descontoMaxSemAprovacao.toString())
      : paraDecimal(100);

    if (descontoPercentualEfetivo.gt(limite)) {
      const podeAprovar = usuario.papel === "DONO" || usuario.papel === "ADMIN";
      if (!podeAprovar) {
        return {
          ok: false,
          mensagem: `Desconto acima de ${limite.toFixed(1)}% precisa ser aplicado por um dono ou administrador.`,
        };
      }
      aprovadoPorId = usuario.id;
    }
  }

  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.orcamentoItem.update({
          where: { id: orcamentoItemId },
          data: {
            precoUnitario: novoPrecoUnitario.toFixed(2),
            precoTotal: novoPrecoTotal.toFixed(2),
            descontoTipo: descontoTipoGravar,
            descontoValor: descontoValorGravar ? descontoValorGravar.toFixed(4) : null,
            motivoDesconto: remover ? null : motivo,
            aprovadoPorId,
          },
        });
        const agregado = await tx.orcamentoItem.aggregate({
          where: { orcamentoId: item.orcamentoId },
          _sum: { precoTotal: true },
        });
        await tx.orcamento.update({
          where: { id: item.orcamentoId },
          data: { total: agregado._sum.precoTotal ?? 0 },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (erro) {
    if (ehConflitoDeSerializacao(erro)) {
      return { ok: false, mensagem: MENSAGEM_CONFLITO_CONCORRENTE };
    }
    throw erro;
  }

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: remover ? "orcamento_item.remover_desconto" : "orcamento_item.aplicar_desconto",
    entidade: "OrcamentoItem",
    entidadeId: orcamentoItemId,
    descricao: remover
      ? `Removeu o desconto do item #${orcamentoItemId.slice(-6)} — preço restaurado para ${formatoMoeda.format(novoPrecoUnitario.toNumber())}/un.`
      : `Aplicou desconto de ${descontoPercentualEfetivo!.toFixed(1)}% no item #${orcamentoItemId.slice(-6)}, de ${formatoMoeda.format(Number(precoUnitarioAnterior))} para ${formatoMoeda.format(novoPrecoUnitario.toNumber())}/un — motivo: ${motivo}`,
  });

  revalidatePath(`/orcamento/${item.orcamentoId}`);
  revalidatePath("/orcamento");

  return { ok: true, mensagem: remover ? "Desconto removido." : "Desconto aplicado." };
}

export type CancelarOrcamentoResult = { ok: boolean; mensagem: string };

export async function cancelarOrcamento(
  _estadoAnterior: CancelarOrcamentoResult | null,
  formData: FormData
): Promise<CancelarOrcamentoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar orçamentos." };
  }
  const orcamentoId = String(formData.get("orcamentoId"));

  const orcamento = await prisma.orcamento.findFirst({
    where: { id: orcamentoId, graficaId: usuario.graficaId },
    include: { itens: { select: { id: true } } },
  });
  if (!orcamento) {
    return { ok: false, mensagem: "Orçamento não encontrado." };
  }
  if (orcamento.status !== "RASCUNHO") {
    return { ok: false, mensagem: "Só é possível cancelar um orçamento em rascunho." };
  }

  // Hard delete: nada foi comunicado ao cliente ainda (rascunho), então não há
  // necessidade de manter um registro "cancelado" — cascade cuida do OrcamentoItem.
  await prisma.orcamento.delete({ where: { id: orcamentoId } });

  // Mesmo cuidado de removerItemOrcamento: o cascade do Prisma apaga
  // OrcamentoItemTinta junto do item, mas não o razão de armazenamento nem o
  // arquivo de verdade no Blob (ArquivoArmazenado só tem relação com
  // Grafica). Melhor esforço, depois do delete confirmado.
  for (const item of orcamento.itens) {
    const arquivoTintaRemovido = await removerArquivo({
      graficaId: usuario.graficaId,
      tipo: "ANALISE_TINTA",
      referenciaId: item.id,
    });
    if (arquivoTintaRemovido) {
      await del(arquivoTintaRemovido.url, { token: exigirTokenBlobPrivado() }).catch(() => {});
    }
  }

  updateTag(`uso-${usuario.graficaId}`); // orçamento removido muda a contagem do mês (ver src/lib/billing/uso.ts)
  revalidatePath("/orcamento");
  redirect("/orcamento");
}

export type GerarLinkResult = { ok: boolean; mensagem: string; url?: string };

export async function gerarLinkPublico(
  _estadoAnterior: GerarLinkResult | null,
  formData: FormData
): Promise<GerarLinkResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar orçamentos." };
  }
  const orcamentoId = String(formData.get("orcamentoId"));

  const orcamento = await prisma.orcamento.findFirst({
    where: { id: orcamentoId, graficaId: usuario.graficaId },
  });
  if (!orcamento) {
    return { ok: false, mensagem: "Orçamento não encontrado." };
  }

  let token = orcamento.linkPublicoToken;
  if (!token) {
    token = randomBytes(20).toString("base64url");
    await prisma.orcamento.update({
      where: { id: orcamentoId },
      data: { linkPublicoToken: token },
    });
  }

  // Gerar (ou já ter gerado) o link é o próprio ato de "mandar pro cliente"
  // nesta tela — o botão que chama esta action fica dentro do card
  // "Compartilhar com o cliente", seguido de copiar/WhatsApp, nunca de um
  // fluxo de pré-visualização separado. Sem isto, dava pra gerar o link,
  // mandar de verdade pro cliente, e ele abrir um orçamento ainda em
  // RASCUNHO — onde TRANSICOES_VALIDAS só libera responder a partir de
  // ENVIADO, e a página pública não tinha nenhum botão nem explicação (ver
  // o/[token]/page.tsx). Só transiciona a partir de RASCUNHO — se já estiver
  // ENVIADO/APROVADO/REJEITADO, devolve o link sem mexer no status. CAS
  // (mesmo padrão do resto do arquivo) pra não pisar numa transição
  // concorrente, ex: vendedor gerando o link enquanto outra aba já avançou
  // o status por outro caminho.
  if (TRANSICOES_VALIDAS[orcamento.status as StatusOrcamento]?.includes("ENVIADO")) {
    await prisma.orcamento.updateMany({
      where: { id: orcamentoId, status: orcamento.status },
      data: { status: "ENVIADO" },
    });
    revalidatePath("/orcamento");
  }

  const url = `${await resolverOrigemPublica()}/o/${token}`;

  revalidatePath(`/orcamento/${orcamentoId}`);
  return { ok: true, mensagem: "Link gerado!", url };
}

// O link público não expira nem some sozinho — desde a feature de orçamento
// completo ele passou a expor a ficha técnica inteira da etiqueta, não só
// preço/itens. Gera um token novo em vez de reaproveitar (revogado de
// verdade, não só "escondido"); se a gráfica quiser compartilhar de novo,
// gerarLinkPublico cria outro token do zero.
export async function revogarLinkPublico(
  _estadoAnterior: GerarLinkResult | null,
  formData: FormData
): Promise<GerarLinkResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar orçamentos." };
  }
  const orcamentoId = String(formData.get("orcamentoId"));

  const orcamento = await prisma.orcamento.findFirst({
    where: { id: orcamentoId, graficaId: usuario.graficaId },
  });
  if (!orcamento) {
    return { ok: false, mensagem: "Orçamento não encontrado." };
  }

  await prisma.orcamento.update({
    where: { id: orcamentoId },
    data: { linkPublicoToken: null },
  });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "orcamento.revogar_link",
    entidade: "Orcamento",
    entidadeId: orcamentoId,
    descricao: `Link público revogado do orçamento #${orcamentoId.slice(-6)}`,
  });

  revalidatePath(`/orcamento/${orcamentoId}`);
  return { ok: true, mensagem: "Link revogado — quem tinha o link anterior não acessa mais." };
}

const formaPagamentoSchema = z.enum([
  "DINHEIRO",
  "PIX",
  "CARTAO",
  "BOLETO",
  "TRANSFERENCIA",
  "OUTRO",
]);

export type RegistrarPagamentoResult = { ok: boolean; mensagem: string };

// Só permite registrar pagamento com o orçamento APROVADO — não faz sentido cobrar por
// algo que o cliente ainda não aceitou, e REJEITADO é estado terminal permanente
// (nunca é deletado, diferente de RASCUNHO). Sem bloqueio de valor: saldo devedor pode
// ficar negativo (cliente pagou a mais), é só informativo.
export async function registrarPagamento(
  _estadoAnterior: RegistrarPagamentoResult | null,
  formData: FormData
): Promise<RegistrarPagamentoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar orçamentos." };
  }
  const orcamentoId = String(formData.get("orcamentoId"));
  const valor = Number(formData.get("valor"));
  const formaParsed = formaPagamentoSchema.safeParse(formData.get("forma"));
  const observacao = String(formData.get("observacao") || "").trim().slice(0, 500) || null;

  if (!Number.isFinite(valor) || valor <= 0) {
    return { ok: false, mensagem: "Informe um valor maior que zero." };
  }
  if (!formaParsed.success) {
    return { ok: false, mensagem: "Forma de pagamento inválida." };
  }

  const orcamento = await prisma.orcamento.findFirst({
    where: { id: orcamentoId, graficaId: usuario.graficaId },
  });
  if (!orcamento) {
    return { ok: false, mensagem: "Orçamento não encontrado." };
  }
  if (orcamento.status !== "APROVADO") {
    return {
      ok: false,
      mensagem: "Só é possível registrar pagamento em um orçamento aprovado.",
    };
  }

  const pagamento = await prisma.pagamento.create({
    data: { orcamentoId, valor, forma: formaParsed.data, observacao },
  });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "pagamento.registrar",
    entidade: "Pagamento",
    entidadeId: pagamento.id,
    descricao: `Pagamento de ${formatoMoeda.format(valor)} (${formaParsed.data}) registrado no orçamento #${orcamentoId.slice(-6)}`,
  });

  revalidatePath(`/orcamento/${orcamentoId}`);
  revalidatePath("/meu-negocio");

  return { ok: true, mensagem: "Pagamento registrado com sucesso!" };
}

const UNIDADE_FISCAL: Record<string, string> = {
  FOLHA: "FL",
  METRO_QUADRADO: "M2",
  METRO_LINEAR: "M",
  UNIDADE: "UN",
  LITRO: "LT",
  KG: "KG",
  ROLO: "RL",
  PACOTE: "PCT",
  CENTO: "CT",
  HORA: "HR",
};

export type EmitirNotaFiscalResult = { ok: boolean; mensagem: string };

// StatusNotaFiscal (schema.prisma) não tem um valor DENEGADO separado — tanto
// erro_autorizacao (Focus NFe rejeitou os dados, HTTP 422) quanto denegado
// (a SEFAZ negou a operação, ex.: destinatário com CNPJ irregular) caem em
// REJEITADA no banco. São problemas diferentes: erro_autorizacao costuma ser
// corrigível ajustando o cadastro; denegado é um bloqueio fiscal do
// destinatário que pode exigir regularização fora do sistema antes de
// reemitir. Prefixamos a mensagem guardada pra que o NotaFiscalCard consiga
// mostrar esse aviso extra sem precisar de uma coluna nova.
const PREFIXO_DENEGADO = "SEFAZ denegou:";

function formatarMensagemErroNfe(resposta: RespostaFocusNfe): string | undefined {
  const mensagem = resposta.mensagemErro ?? resposta.mensagemSefaz;
  if (resposta.status === "denegado") {
    return `${PREFIXO_DENEGADO} ${mensagem ?? "motivo não informado pela SEFAZ."}`;
  }
  return mensagem;
}

// Emite a nota fiscal (NF-e) do orçamento via Focus NFe — cada gráfica usa a
// PRÓPRIA conta/token (ver Configurações → Dados fiscais), nunca uma conta
// nossa. Só chega até aqui depois do usuário clicar "Emitir nota fiscal" no
// NotaFiscalCard — nada disso é pedido proativamente em /comecar ou /login.
export async function emitirNotaFiscal(
  _estadoAnterior: EmitirNotaFiscalResult | null,
  formData: FormData
): Promise<EmitirNotaFiscalResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar orçamentos." };
  }
  const orcamentoId = String(formData.get("orcamentoId"));

  const orcamento = await prisma.orcamento.findFirst({
    where: { id: orcamentoId, graficaId: usuario.graficaId },
    include: {
      cliente: true,
      notaFiscal: true,
      itens: { include: { itemGrafica: { include: { itemCatalogo: true } } } },
    },
  });
  if (!orcamento) {
    return { ok: false, mensagem: "Orçamento não encontrado." };
  }
  if (orcamento.status !== "APROVADO") {
    return { ok: false, mensagem: "Só é possível emitir nota fiscal de um orçamento aprovado." };
  }
  if (orcamento.notaFiscal && orcamento.notaFiscal.status !== "REJEITADA") {
    return { ok: false, mensagem: "Este orçamento já tem uma nota fiscal emitida." };
  }
  if (orcamento.notaFiscal) {
    // Nota anterior foi rejeitada (dados inválidos) ou denegada (bloqueio
    // fiscal do destinatário na SEFAZ) — nos dois casos a Focus NFe nunca
    // autorizou a nota, então não sobrou nada fiscal pra preservar aqui.
    // `referencia` é UNIQUE e sempre igual a orcamentoId (ver criação
    // abaixo), então a nota antiga precisa sair antes de tentarmos de novo.
    await prisma.notaFiscal.delete({ where: { id: orcamento.notaFiscal.id } });
  }

  const dadosFiscais = await prisma.dadosFiscaisGrafica.findUnique({
    where: { graficaId: usuario.graficaId },
  });

  const checagem = verificarProntidaoFiscal({
    dadosFiscais,
    cliente: orcamento.cliente,
    itens: orcamento.itens.map((item) => ({
      nome: item.itemGrafica.itemCatalogo.nome,
      ncm: item.itemGrafica.itemCatalogo.ncm,
    })),
  });
  if (!checagem.pronto || !dadosFiscais) {
    return { ok: false, mensagem: checagem.pendencias.join(" ") };
  }

  try {
    const resposta = await emitirNfe(
      { token: dadosFiscais.focusNfeToken!, ambiente: dadosFiscais.ambiente as AmbienteFocusNfe },
      {
        referencia: orcamentoId,
        naturezaOperacao: dadosFiscais.naturezaOperacaoPadrao,
        emitente: {
          cnpj: dadosFiscais.cnpj!,
          nome: dadosFiscais.razaoSocial!,
          nomeFantasia: dadosFiscais.nomeFantasia || dadosFiscais.razaoSocial!,
          inscricaoEstadual: dadosFiscais.inscricaoEstadual ?? "",
          logradouro: dadosFiscais.enderecoLogradouro!,
          numero: dadosFiscais.enderecoNumero!,
          bairro: dadosFiscais.enderecoBairro!,
          municipio: dadosFiscais.enderecoMunicipio!,
          uf: dadosFiscais.enderecoUf!,
          cep: dadosFiscais.enderecoCep!,
        },
        destinatario: {
          documento: orcamento.cliente.documento!,
          nome: orcamento.cliente.nome,
          logradouro: orcamento.cliente.enderecoLogradouro!,
          numero: orcamento.cliente.enderecoNumero!,
          bairro: orcamento.cliente.enderecoBairro!,
          municipio: orcamento.cliente.enderecoMunicipio!,
          uf: orcamento.cliente.enderecoUf!,
          cep: orcamento.cliente.enderecoCep!,
        },
        itens: orcamento.itens.map((item, indice) => ({
          numeroItem: indice + 1,
          codigoProduto: item.itemGraficaId,
          descricao: item.itemGrafica.itemCatalogo.nome,
          ncm: item.itemGrafica.itemCatalogo.ncm!,
          cfop: dadosFiscais.cfopPadrao,
          unidade: UNIDADE_FISCAL[item.itemGrafica.itemCatalogo.unidade ?? "UNIDADE"] ?? "UN",
          quantidade: item.quantidade,
          valorUnitario: Number(item.precoUnitario),
          valorBruto: Number(item.precoTotal),
          icmsSituacaoTributaria: dadosFiscais.csosnPadrao,
        })),
        valorTotal: Number(orcamento.total),
      }
    );

    await prisma.notaFiscal.create({
      data: {
        graficaId: usuario.graficaId,
        orcamentoId,
        referencia: orcamentoId,
        status:
          resposta.status === "autorizado"
            ? "AUTORIZADA"
            : resposta.status === "erro_autorizacao" || resposta.status === "denegado"
              ? "REJEITADA"
              : "PROCESSANDO",
        numero: resposta.numero,
        serie: resposta.serie,
        chaveAcesso: resposta.chaveNfe,
        xmlUrl: resposta.caminhoXml,
        danfeUrl: resposta.caminhoDanfe,
        mensagemErro: formatarMensagemErroNfe(resposta),
      },
    });
  } catch (erro) {
    if (erro instanceof ErroFocusNfe) {
      return { ok: false, mensagem: erro.message };
    }
    throw erro;
  }

  revalidatePath(`/orcamento/${orcamentoId}`);
  return { ok: true, mensagem: "Nota fiscal enviada pra processamento!" };
}

export async function atualizarStatusNotaFiscal(
  _estadoAnterior: EmitirNotaFiscalResult | null,
  formData: FormData
): Promise<EmitirNotaFiscalResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar orçamentos." };
  }
  const orcamentoId = String(formData.get("orcamentoId"));

  const notaFiscal = await prisma.notaFiscal.findFirst({
    where: { orcamentoId, graficaId: usuario.graficaId },
  });
  if (!notaFiscal) {
    return { ok: false, mensagem: "Nota fiscal não encontrada." };
  }

  const dadosFiscais = await prisma.dadosFiscaisGrafica.findUnique({
    where: { graficaId: usuario.graficaId },
  });
  if (!dadosFiscais?.focusNfeToken) {
    return { ok: false, mensagem: "Token da Focus NFe não configurado." };
  }

  try {
    const resposta = await consultarNfe(
      { token: dadosFiscais.focusNfeToken, ambiente: dadosFiscais.ambiente as AmbienteFocusNfe },
      notaFiscal.referencia
    );

    await prisma.notaFiscal.update({
      where: { id: notaFiscal.id },
      data: {
        status:
          resposta.status === "autorizado"
            ? "AUTORIZADA"
            : resposta.status === "cancelado"
              ? "CANCELADA"
              : resposta.status === "erro_autorizacao" || resposta.status === "denegado"
                ? "REJEITADA"
                : "PROCESSANDO",
        numero: resposta.numero,
        serie: resposta.serie,
        chaveAcesso: resposta.chaveNfe,
        xmlUrl: resposta.caminhoXml,
        danfeUrl: resposta.caminhoDanfe,
        mensagemErro: formatarMensagemErroNfe(resposta),
      },
    });
  } catch (erro) {
    if (erro instanceof ErroFocusNfe) {
      return { ok: false, mensagem: erro.message };
    }
    throw erro;
  }

  revalidatePath(`/orcamento/${orcamentoId}`);
  return { ok: true, mensagem: "Status atualizado." };
}

export async function excluirPagamento(
  _estadoAnterior: RegistrarPagamentoResult | null,
  formData: FormData
): Promise<RegistrarPagamentoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar orçamentos." };
  }
  const pagamentoId = String(formData.get("pagamentoId"));

  const pagamento = await prisma.pagamento.findFirst({
    where: { id: pagamentoId, orcamento: { graficaId: usuario.graficaId } },
  });
  if (!pagamento) {
    return { ok: false, mensagem: "Pagamento não encontrado." };
  }

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "pagamento.excluir",
    entidade: "Pagamento",
    entidadeId: pagamento.id,
    descricao: `Pagamento de ${formatoMoeda.format(Number(pagamento.valor))} removido do orçamento #${pagamento.orcamentoId.slice(-6)}`,
  });

  await prisma.pagamento.delete({ where: { id: pagamento.id } });

  revalidatePath(`/orcamento/${pagamento.orcamentoId}`);
  revalidatePath("/meu-negocio");

  return { ok: true, mensagem: "Pagamento removido." };
}
