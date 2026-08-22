"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { put, del } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo, podeVerModulo, podeConfirmarEstagio } from "@/lib/auth/permissoes";
import { Prisma } from "@/generated/prisma/client";
import { buscarAutomacaoGrafica, dispararEventoAutomacao } from "@/lib/webhook-automacao";
import { normalizarTelefone } from "@/lib/telefone";
import { ehConflitoDeSerializacao } from "@/lib/prisma-conflito";
import { registrarAuditoria } from "@/lib/auditoria";
import { formatoMoeda } from "@/lib/moeda";
import { D } from "@/lib/pricing/decimal";
import { montarChavePerda } from "@/lib/perda-fixa-producao";
import { analisarPreflight } from "@/lib/preflight";
import { avancarStatusPedido, buscarOrcamentoParaBaixa } from "./status-transicao";
import {
  validarArquivoArte,
  extensaoArte,
  assinaturaBateComTipo,
  BYTES_ASSINATURA,
} from "@/lib/upload-validacao";
import {
  resolverContextoArmazenamento,
  reservarEspaco,
  confirmarArquivo,
  cancelarReserva,
  removerArquivo,
} from "@/lib/billing/armazenamento";

export type AvancarPedidoResult = { ok: boolean; mensagem: string };

type ItemPrevisaoBaixa = {
  chave: string;
  materiaPrimaNome: string;
  varianteRotulo: string | null;
  quantidadeConsumida: number;
  perdaPadrao: number;
  // Prévia em R$ do custo automático que esta linha vai gerar (fase "custo
  // real" §3.2) — quantidadeConsumida × precoCompra vigente do material/
  // variante. null quando o material não tem preço de custo cadastrado: a
  // tela não mostra valor nesse caso, nunca inventa R$0,00. Não inclui a
  // perda fixa (editável nesta mesma tela) de propósito — o valor aqui é só
  // uma prévia informativa, não precisa recalcular a cada tecla digitada.
  custoEstimado: number | null;
};

export type PrevisaoBaixaEstoqueResult =
  | { ok: false; mensagem: string }
  | { ok: true; itens: ItemPrevisaoBaixa[] };

// Leitura pura pra alimentar a tela de confirmação de "Iniciar impressão"
// (IniciarImpressaoConfirm.tsx) — replica os mesmos gates de avancarPedido
// (permissão, pedido precisa estar em CLICHE_FACA — a etapa que baixa
// estoque ao avançar pra PRODUCAO) pra nunca abrir uma confirmação que seria
// rejeitada no submit de qualquer forma.
export async function previsaoBaixaEstoque(pedidoId: string): Promise<PrevisaoBaixaEstoqueResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "PRODUCAO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar a produção." };
  }

  const pedido = await prisma.pedido.findFirst({
    where: { id: pedidoId, graficaId: usuario.graficaId },
  });
  if (!pedido) {
    return { ok: false, mensagem: "Pedido não encontrado." };
  }
  if (pedido.status !== "CLICHE_FACA") {
    return { ok: false, mensagem: "Este pedido não está pronto pra iniciar a produção." };
  }

  const orcamentoComItens = await buscarOrcamentoParaBaixa(pedido.orcamentoId);

  // custoEstimado só viaja pro client quando o usuário tem CUSTOS.podeVer —
  // achado da revisão de segurança da fase "custo real": esta tela é
  // acessível com só PRODUCAO.podeEditar (ver gate acima), e um operador de
  // chão de fábrica com PRODUCAO mas sem CUSTOS.podeVer não pode ver o
  // valor de venda/custo em NENHUMA tela (mesmo critério já aplicado em
  // producao/page.tsx e CustosPedidoSecao.tsx) — sem isso, "Iniciar
  // impressão" vazava o custo estimado da baixa pra quem só lança
  // retrabalho.
  const podeVerCustos = await podeVerModulo(usuario, "CUSTOS");

  const itens: ItemPrevisaoBaixa[] = [];
  for (const item of orcamentoComItens?.itens ?? []) {
    for (const ficha of item.itemGrafica.fichaTecnica) {
      // Mesma regra de avancarPedido: sem estoqueAtual configurado, esse
      // material não tem controle de estoque e não entra na baixa nem na perda.
      const estoqueAtual = ficha.variante ? ficha.variante.estoqueAtual : ficha.materiaPrima.estoqueAtual;
      if (estoqueAtual === null) continue;

      const perdaPadrao = ficha.variante ? ficha.variante.perdaFixaPadrao : ficha.materiaPrima.perdaFixaPadrao;
      const quantidadeConsumida = Number(ficha.quantidadePorUnidade) * item.quantidade;
      // Mesmo preço que snapshotCustoFicha (status-transicao.ts) vai
      // congelar na baixa de verdade — variante sobrepõe o preço da
      // matéria-prima "pai" quando a ficha aponta uma variante específica.
      const precoCompra = ficha.varianteId ? (ficha.variante?.precoCompra ?? null) : ficha.materiaPrima.precoCompra;
      itens.push({
        chave: montarChavePerda(item.id, ficha.id),
        materiaPrimaNome: ficha.materiaPrima.itemCatalogo.nome,
        varianteRotulo: ficha.variante?.rotulo ?? null,
        quantidadeConsumida,
        perdaPadrao: perdaPadrao !== null ? Number(perdaPadrao) : 0,
        custoEstimado:
          podeVerCustos && precoCompra !== null
            ? new D(precoCompra.toString()).times(quantidadeConsumida).toNumber()
            : null,
      });
    }

    // Mesma prévia acima, agora pela ficha técnica dos SERVIÇOS anexados
    // como acabamento (ex: laminação consumindo BOPP) — precisa bater
    // EXATAMENTE com o loop equivalente em avancarStatusPedido
    // (status-transicao.ts), mesmo cuidado do comentário de
    // buscarOrcamentoParaBaixa: a tela de confirmação não pode mostrar algo
    // diferente do que de fato vai ser descontado. Multiplicador é
    // `acabamento.qtdBase`, não `item.quantidade`. Aditivo: acabamento sem
    // ficha técnica cadastrada não gera nenhuma linha aqui.
    for (const acabamento of item.acabamentos) {
      for (const ficha of acabamento.itemGrafica.fichaTecnica) {
        const estoqueAtual = ficha.variante ? ficha.variante.estoqueAtual : ficha.materiaPrima.estoqueAtual;
        if (estoqueAtual === null) continue;

        const perdaPadrao = ficha.variante ? ficha.variante.perdaFixaPadrao : ficha.materiaPrima.perdaFixaPadrao;
        const quantidadeConsumida = Number(ficha.quantidadePorUnidade) * Number(acabamento.qtdBase);
        const precoCompra = ficha.varianteId ? (ficha.variante?.precoCompra ?? null) : ficha.materiaPrima.precoCompra;
        itens.push({
          chave: montarChavePerda(acabamento.id, ficha.id),
          materiaPrimaNome: ficha.materiaPrima.itemCatalogo.nome,
          varianteRotulo: ficha.variante?.rotulo ?? null,
          quantidadeConsumida,
          perdaPadrao: perdaPadrao !== null ? Number(perdaPadrao) : 0,
          custoEstimado:
            podeVerCustos && precoCompra !== null
              ? new D(precoCompra.toString()).times(quantidadeConsumida).toNumber()
              : null,
        });
      }
    }
  }

  return { ok: true, itens };
}

// Autorização OR: PRODUCAO.podeEditar completo OU responsável atribuído
// pela etapa ATUAL do pedido (ver podeConfirmarEstagio) — por isso o pedido
// é buscado ANTES de decidir a permissão, ao contrário das outras actions
// deste arquivo. A transição em si (CAS, baixa de estoque condicional,
// webhooks, e-mail aos responsáveis da PRÓXIMA etapa) mora em
// avancarStatusPedido (./status-transicao.ts), compartilhada com a
// confirmação pública sem login em src/app/p/[token]/actions.ts.
export async function avancarPedido(
  _estadoAnterior: AvancarPedidoResult | null,
  formData: FormData
): Promise<AvancarPedidoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  const pedidoId = String(formData.get("pedidoId"));

  const pedido = await prisma.pedido.findFirst({
    where: { id: pedidoId, graficaId: usuario.graficaId },
    include: {
      orcamento: {
        include: {
          cliente: true,
          grafica: true,
          itens: { include: { itemGrafica: { include: { itemCatalogo: true } } } },
        },
      },
    },
  });
  if (!pedido) {
    return { ok: false, mensagem: "Pedido não encontrado." };
  }

  if (!(await podeEditarModulo(usuario, "PRODUCAO")) && !(await podeConfirmarEstagio(usuario, pedido.status))) {
    return { ok: false, mensagem: "Você não tem permissão pra confirmar esta etapa." };
  }

  return avancarStatusPedido(pedido, formData.get("perdasJson"));
}

export type CancelarPedidoResult = { ok: boolean; mensagem: string };

const MENSAGEM_CONFLITO_CANCELAMENTO =
  "Outra pessoa já alterou este pedido — recarregue a página e confira o status atual.";

// Reaproveita a mesma ideia de ErroPedidoJaAvancado (sinalizar de dentro da
// transação que o status já não é mais o esperado), só com nome próprio pra
// não confundir os dois catch acima/abaixo.
class ErroPedidoJaAlterado extends Error {}

// Cancela um pedido em qualquer estágio ANTES de ENTREGUE (produto já saiu,
// cancelar não desfaz uma entrega física — ver comentário no enum
// StatusPedido) e, se ele já tinha passado por CLICHE_FACA→PRODUCAO (baixa
// automática de estoque, ver avancarPedido acima), ESTORNA automaticamente
// a matéria-prima decrementada. Essa era a lacuna crítica documentada no
// comentário de avancarPedido: sem isso, cancelar um pedido em produção
// deixava o estoque permanentemente "faltando" material que na prática
// nunca foi usado.
export async function cancelarPedido(
  _estadoAnterior: CancelarPedidoResult | null,
  formData: FormData
): Promise<CancelarPedidoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "PRODUCAO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar a produção." };
  }
  const pedidoId = String(formData.get("pedidoId"));

  const pedido = await prisma.pedido.findFirst({
    where: { id: pedidoId, graficaId: usuario.graficaId },
    include: { orcamento: { include: { cliente: true } } },
  });
  if (!pedido) {
    return { ok: false, mensagem: "Pedido não encontrado." };
  }
  if (pedido.status === "ENTREGUE") {
    return { ok: false, mensagem: "Um pedido já entregue não pode ser cancelado." };
  }
  if (pedido.status === "CANCELADO") {
    return { ok: false, mensagem: "Este pedido já está cancelado." };
  }

  const statusAnterior = pedido.status;
  const automacao = await buscarAutomacaoGrafica(usuario.graficaId);
  let itensEstornados = 0;

  try {
    await prisma.$transaction(
      async (tx) => {
        // Mesmo guard otimista de avancarPedido: updateMany com o status
        // ANTERIOR no where, não update por id — se outra requisição já
        // mudou o status entre a leitura acima e aqui (duplo clique, duas
        // abas), count vem 0 e abortamos em vez de cancelar/estornar em
        // cima de um estado que já não é mais o que a gente leu.
        const resultado = await tx.pedido.updateMany({
          where: { id: pedidoId, status: statusAnterior },
          data: { status: "CANCELADO" },
        });
        if (resultado.count === 0) {
          throw new ErroPedidoJaAlterado();
        }

        // Estorna pelo HISTÓRICO real de saídas (MovimentacaoEstoque), não
        // recalculando pela ficha técnica de novo — a ficha pode ter mudado
        // desde a baixa original, e o histórico é sempre a fonte da verdade
        // do que de fato foi decrementado. Se o pedido nunca saiu de
        // CLICHE_FACA, não existe nenhuma SAIDA pra este pedidoId e o loop
        // não faz nada.
        const saidas = await tx.movimentacaoEstoque.findMany({
          where: { pedidoId, tipo: "SAIDA_PRODUCAO" },
        });
        itensEstornados = saidas.length;

        for (const saida of saidas) {
          if (saida.varianteId) {
            await tx.varianteMateriaPrima.update({
              where: { id: saida.varianteId },
              data: { estoqueAtual: { increment: saida.quantidade } },
            });
          } else {
            await tx.itemGrafica.update({
              where: { id: saida.itemGraficaId },
              data: { estoqueAtual: { increment: saida.quantidade } },
            });
          }
          await tx.movimentacaoEstoque.create({
            data: {
              itemGraficaId: saida.itemGraficaId,
              varianteId: saida.varianteId,
              pedidoId: pedido.id,
              tipo: "ESTORNO_CANCELAMENTO",
              quantidade: saida.quantidade,
              motivo: `Estorno por cancelamento do pedido ${pedido.id} (orçamento ${pedido.orcamentoId})`,
              // Copiado da SAIDA_PRODUCAO original sendo revertida, não
              // recalculado pelo preço atual do cadastro (mesmo princípio de
              // usar o histórico real, não a ficha técnica de agora, que já
              // rege o resto deste estorno). Fica null se a saída original
              // também não tinha custo — não inventa valor.
              custoUnitario: saida.custoUnitario,
              custoTotal: saida.custoTotal,
              precoReferenciaEm: saida.precoReferenciaEm,
            },
          });
        }

        // Marca (nunca apaga) o CustoPedido automático atrelado a cada saída
        // que acabou de ser estornada — fase "custo real" §3.3: histórico
        // preservado, só sai da soma de lucro/relatórios (ver
        // lucroDoPedido/custosPorCategoriaNoPeriodo, que filtram
        // estornadoEm: null). Custos MANUAIS não são tocados aqui de
        // propósito — frete pago é frete pago, ver comentário no schema.
        if (saidas.length > 0) {
          await tx.custoPedido.updateMany({
            where: { movimentacaoEstoqueId: { in: saidas.map((s) => s.id) }, estornadoEm: null },
            data: { estornadoEm: new Date() },
          });
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (erro) {
    if (erro instanceof ErroPedidoJaAlterado) {
      return { ok: false, mensagem: MENSAGEM_CONFLITO_CANCELAMENTO };
    }
    if (ehConflitoDeSerializacao(erro)) {
      return { ok: false, mensagem: MENSAGEM_CONFLITO_CANCELAMENTO };
    }
    throw erro;
  }

  if (automacao.webhookUrl && automacao.notificarStatusMudou) {
    // after() em vez de void: garante que a instância serverless continua
    // viva até o webhook terminar, mesmo depois da resposta já ter sido
    // enviada ao cliente.
    const webhookUrl = automacao.webhookUrl;
    after(() =>
      dispararEventoAutomacao(webhookUrl, {
        tipo: "pedido_status_mudou",
        graficaNome: usuario.grafica.nome,
        clienteNome: pedido.orcamento.cliente.nome,
        clienteTelefone: normalizarTelefone(pedido.orcamento.cliente.telefone),
        statusAnterior,
        statusNovo: "CANCELADO",
        orcamentoId: pedido.orcamentoId,
      })
    );
  }

  revalidatePath("/producao");
  revalidatePath(`/orcamento/${pedido.orcamentoId}`);
  revalidatePath("/catalogo");
  revalidatePath("/meu-negocio");

  let mensagem = itensEstornados > 0 ? "Pedido cancelado e estoque estornado." : "Pedido cancelado.";

  // Aviso "nice to have" do plano (§3.3): custo manual não é estornado
  // automaticamente, então avisa quando sobrou algum neste pedido cancelado
  // — sem isso, a diferença some dentro do texto genérico acima. Leitura
  // fora da transação (melhor esforço, não crítica ao cancelamento em si).
  const custosManuaisRestantes = await prisma.custoPedido.findMany({
    where: { pedidoId, origem: "MANUAL", estornadoEm: null },
    select: { valor: true },
  });
  if (custosManuaisRestantes.length > 0) {
    const totalManual = custosManuaisRestantes.reduce((soma, c) => soma + Number(c.valor), 0);
    mensagem += ` ${custosManuaisRestantes.length} custo${custosManuaisRestantes.length > 1 ? "s" : ""} manual${custosManuaisRestantes.length > 1 ? "is" : ""} de ${formatoMoeda.format(totalManual)} permanece${custosManuaisRestantes.length > 1 ? "m" : ""} neste pedido cancelado.`;
  }

  return { ok: true, mensagem };
}

export type CustoPedidoResult = { ok: boolean; mensagem: string };

// Lança um custo REAL (não estimado) num pedido — alimenta lucroDoPedido
// (src/lib/custo-pedido.ts) e o card de custos em PedidoLinha. Confere
// isolamento de tenant duas vezes: o pedido precisa pertencer à gráfica do
// usuário logado E a categoria também, senão um pedidoId/categoriaCustoId
// de outra gráfica vindo direto do form (sem passar pela UI) seria aceito.
//
// Gate é CUSTOS, não PRODUCAO (ver fase-custo-real.md §2.6 / PR-1): o
// operador de chão de fábrica precisa lançar retrabalho sem enxergar
// valor de venda, custo total nem margem — isso é responsabilidade de
// CUSTOS.podeVer, checado na leitura (producao/page.tsx), não aqui.
export async function lancarCustoPedido(
  _estadoAnterior: CustoPedidoResult | null,
  formData: FormData
): Promise<CustoPedidoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CUSTOS"))) {
    return { ok: false, mensagem: "Você não tem permissão pra lançar custo." };
  }

  const pedidoId = String(formData.get("pedidoId"));
  const categoriaCustoId = String(formData.get("categoriaCustoId"));
  const valor = Number(formData.get("valor"));
  const observacao = String(formData.get("observacao") || "").trim().slice(0, 500) || null;

  if (!Number.isFinite(valor) || valor <= 0) {
    return { ok: false, mensagem: "Informe um valor maior que zero." };
  }

  const pedido = await prisma.pedido.findFirst({
    where: { id: pedidoId, graficaId: usuario.graficaId },
  });
  if (!pedido) {
    return { ok: false, mensagem: "Pedido não encontrado." };
  }

  const categoria = await prisma.categoriaCusto.findFirst({
    where: { id: categoriaCustoId, graficaId: usuario.graficaId },
  });
  if (!categoria) {
    return { ok: false, mensagem: "Categoria de custo não encontrada." };
  }

  const custo = await prisma.custoPedido.create({
    data: {
      graficaId: usuario.graficaId,
      pedidoId,
      categoriaCustoId,
      valor,
      observacao,
      criadoPorId: usuario.id,
    },
  });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "custo_pedido.criar",
    entidade: "CustoPedido",
    entidadeId: custo.id,
    descricao: `Lançou custo de ${formatoMoeda.format(valor)} em ${categoria.nome} no pedido ${pedidoId}`,
  });

  revalidatePath("/producao");
  revalidatePath("/meu-negocio");
  return { ok: true, mensagem: "Custo lançado." };
}

// Exclui um lançamento de custo real — mesma checagem de isolamento de
// tenant de lancarCustoPedido, agora sobre o próprio CustoPedido (que já
// guarda graficaId direto, ver comentário no schema). Gate CUSTOS, mesmo
// motivo do comentário acima.
export async function excluirCustoPedido(
  _estadoAnterior: CustoPedidoResult | null,
  formData: FormData
): Promise<CustoPedidoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CUSTOS"))) {
    return { ok: false, mensagem: "Você não tem permissão pra lançar custo." };
  }

  const custoId = String(formData.get("custoId"));
  const custo = await prisma.custoPedido.findFirst({
    where: { id: custoId, graficaId: usuario.graficaId },
    include: { categoriaCusto: true },
  });
  if (!custo) {
    return { ok: false, mensagem: "Custo não encontrado." };
  }

  await prisma.custoPedido.delete({ where: { id: custoId } });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "custo_pedido.excluir",
    entidade: "CustoPedido",
    entidadeId: custo.id,
    descricao: `Removeu custo de ${formatoMoeda.format(Number(custo.valor))} em ${custo.categoriaCusto.nome} do pedido ${custo.pedidoId}`,
  });

  revalidatePath("/producao");
  revalidatePath("/meu-negocio");
  return { ok: true, mensagem: "Custo removido." };
}

export type EnviarArteResult = { ok: boolean; mensagem: string };

// Sobe o arquivo de arte de um pedido pro Blob (access "public" — a arte é
// vista pelo cliente final através do link com token de qualquer forma, e
// não carrega segredo nenhum, ao contrário do dump de backup em
// src/app/api/cron/backup/route.ts). Reenvio (pedido já tinha uma arte)
// zera arteAprovadaEm/arteComentarioCliente — a aprovação/comentário
// anterior era sobre o arquivo antigo, não faz sentido continuar valendo
// pro novo. arteLinkToken é reaproveitado entre reenvios: o link que a
// gráfica já mandou pro cliente continua o mesmo.
export async function enviarArte(
  _estadoAnterior: EnviarArteResult | null,
  formData: FormData
): Promise<EnviarArteResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "PRODUCAO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar a produção." };
  }

  const pedidoId = String(formData.get("pedidoId"));
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

  const pedido = await prisma.pedido.findFirst({
    where: { id: pedidoId, graficaId: usuario.graficaId },
    // itens (largura/altura) só servem pro preflight abaixo — decidir contra
    // qual tamanho checar o DPI efetivo da arte.
    include: { orcamento: { select: { itens: { select: { larguraCm: true, alturaCm: true } } } } },
  });
  if (!pedido) {
    return { ok: false, mensagem: "Pedido não encontrado." };
  }
  // A tela só mostra este formulário com status === "ARTE", mas isso não é
  // proteção real — um POST direto pra esta action com o id de um pedido já
  // ENTREGUE/CANCELADO subiria arte, geraria link de aprovação novo e
  // zeraria arteAprovadaEm pra um pedido que já acabou (ver comentário sobre
  // defesa em profundidade em src/lib/auth/permissoes.ts).
  if (pedido.status !== "ARTE") {
    return { ok: false, mensagem: "Só é possível enviar/remover arte enquanto o pedido está em Arte." };
  }

  // Reserva o espaço ANTES do put() — nunca depois, senão um upload rejeitado
  // por cota já teria custado o armazenamento (ver src/lib/billing/armazenamento.ts).
  const contextoArmazenamento = resolverContextoArmazenamento(usuario);
  const reserva = await reservarEspaco({
    graficaId: usuario.graficaId,
    tipo: "ARTE_PEDIDO",
    referenciaId: pedidoId,
    bytes: arquivo.size,
    contexto: contextoArmazenamento,
  });
  if (!reserva.ok) {
    return { ok: false, mensagem: reserva.mensagem };
  }

  const extensao = extensaoArte(arquivo.type);
  let blob;
  try {
    blob = await put(`pedidos-arte/${usuario.graficaId}/${pedidoId}-${Date.now()}.${extensao}`, arquivo, {
      access: "public",
      addRandomSuffix: true,
      contentType: arquivo.type,
    });
  } catch (erro) {
    await cancelarReserva(reserva.arquivoId);
    // console.error sempre roda, mesmo sem SENTRY_DSN configurado (ver
    // src/lib/auditoria.ts) — sem isso, uma falha aqui (ex: token do store
    // público do Blob ausente/errado em produção, ver .env.example) só
    // aparecia pro usuário como a tela genérica de erro do Next, sem
    // NENHUM rastro de qual foi o erro real, nem pra quem olhasse os logs
    // da Vercel depois.
    console.error("[enviarArte] falha ao subir arquivo no Vercel Blob", { graficaId: usuario.graficaId, pedidoId }, erro);
    return {
      ok: false,
      mensagem: "Não foi possível enviar o arquivo agora. Tente de novo em instantes.",
    };
  }
  await confirmarArquivo(reserva.arquivoId, { url: blob.url, pathname: blob.pathname });

  const arteLinkToken = pedido.arteLinkToken ?? randomBytes(20).toString("base64url");

  // Preflight é melhor esforço (nunca lança, ver analisarPreflight) — roda
  // ANTES do update pra gravar os achados no mesmo write que já grava
  // arteUrl, nunca deixando uma janela com arte nova e preflightAvisos
  // desatualizado (do arquivo anterior).
  const bufferArquivo = Buffer.from(await arquivo.arrayBuffer());
  const preflightAvisos = await analisarPreflight(
    bufferArquivo,
    arquivo.type,
    pedido.orcamento.itens.map((item) => ({
      larguraCm: item.larguraCm == null ? null : Number(item.larguraCm),
      alturaCm: item.alturaCm == null ? null : Number(item.alturaCm),
    }))
  );

  await prisma.pedido.update({
    where: { id: pedidoId },
    data: {
      arteUrl: blob.url,
      arteLinkToken,
      arteAprovadaEm: null,
      arteComentarioCliente: null,
      preflightAvisos,
    },
  });

  // Apaga a arte anterior DEPOIS que a nova já está gravada no banco (melhor
  // esforço, igual salvarLogo em configuracoes/identidade/actions.ts). Sem
  // isso, cada reenvio deixava o arquivo antigo no Blob pra sempre, público e
  // sem nenhuma referência no banco — ou seja, sem nenhuma forma de achar ou
  // apagar depois. Além do custo de storage acumulado, é privacidade: arte de
  // cliente continuaria acessível por URL mesmo depois de substituída.
  if (pedido.arteUrl) {
    await del(pedido.arteUrl).catch(() => {});
  }

  revalidatePath("/producao");

  return { ok: true, mensagem: "Arte enviada! Copie o link abaixo e envie pro cliente aprovar." };
}

// Única forma de liberar o espaço ocupado por uma arte sem precisar
// substituí-la por outra — mesmos gates de enviarArte. Com arteUrl nulo, o
// gate de aprovação em avancarPedido volta a ficar inativo pra este pedido
// (é opt-in por pedido, não um bypass: se a gráfica quiser exigir aprovação
// de novo, basta enviar outra arte).
export async function removerArte(
  _estadoAnterior: EnviarArteResult | null,
  formData: FormData
): Promise<EnviarArteResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "PRODUCAO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar a produção." };
  }

  const pedidoId = String(formData.get("pedidoId"));
  const pedido = await prisma.pedido.findFirst({
    where: { id: pedidoId, graficaId: usuario.graficaId },
  });
  if (!pedido) {
    return { ok: false, mensagem: "Pedido não encontrado." };
  }
  // Mesmo gate de enviarArte acima: a tela só mostra o botão com
  // status === "ARTE", mas isso não é proteção real por si só.
  if (pedido.status !== "ARTE") {
    return { ok: false, mensagem: "Só é possível enviar/remover arte enquanto o pedido está em Arte." };
  }
  if (!pedido.arteUrl) {
    return { ok: false, mensagem: "Este pedido não tem arte enviada." };
  }

  await prisma.pedido.update({
    where: { id: pedidoId },
    data: {
      arteUrl: null,
      arteAprovadaEm: null,
      arteComentarioCliente: null,
      preflightAvisos: Prisma.JsonNull,
    },
  });

  const arquivoRemovido = await removerArquivo({
    graficaId: usuario.graficaId,
    tipo: "ARTE_PEDIDO",
    referenciaId: pedidoId,
  });
  if (arquivoRemovido) {
    await del(arquivoRemovido.url).catch(() => {});
  }

  revalidatePath("/producao");
  return { ok: true, mensagem: "Arte removida." };
}
