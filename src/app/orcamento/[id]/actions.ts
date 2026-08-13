"use server";

import { z } from "zod";
import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { randomBytes } from "node:crypto";
import { del } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { calcularItemOrcamento } from "@/lib/orcamento-precificacao";
import { resolverOrigemPublica } from "@/lib/url-publica";
import {
  TRANSICOES_VALIDAS,
  ROTULOS_STATUS_ORCAMENTO,
  type StatusOrcamento,
} from "@/lib/orcamento-status";
import { verificarProntidaoFiscal } from "@/lib/nota-fiscal";
import { emitirNfe, consultarNfe, ErroFocusNfe, type AmbienteFocusNfe } from "@/lib/focus-nfe";
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
import { removerArquivo } from "@/lib/billing/armazenamento";

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
    // fazer parte da transação — mantém ela curta.
    const [orcamentoComItens, usuarioVendedor, parametros] = await Promise.all([
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
        create: { graficaId: usuario.graficaId, orcamentoId, status: "FILA", prazoEntrega },
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

  if (!quantidade || quantidade <= 0) {
    return { ok: false, mensagem: "Informe uma quantidade válida." };
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

  if (!itemGraficaId || !quantidade || quantidade <= 0) {
    return { ok: false, mensagem: "Escolha um produto e uma quantidade válida." };
  }

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
            cores: cores || null,
            acabamento: acabamento || null,
            precoUnitario: resultado.precoUnitario,
            precoTotal: resultado.precoTotal,
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
    await del(arquivoTintaRemovido.url).catch(() => {});
  }

  revalidatePath(`/orcamento/${item.orcamentoId}`);
  revalidatePath("/orcamento");

  return { ok: true, mensagem: "Item removido." };
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
      await del(arquivoTintaRemovido.url).catch(() => {});
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
  if (orcamento.notaFiscal) {
    return { ok: false, mensagem: "Este orçamento já tem uma nota fiscal emitida." };
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
        mensagemErro: resposta.mensagemErro ?? resposta.mensagemSefaz,
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
        mensagemErro: resposta.mensagemErro ?? resposta.mensagemSefaz,
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
