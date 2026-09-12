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
import { registrarAuditoria, criarDiffCampos } from "@/lib/auditoria";
import { formatoMoeda } from "@/lib/moeda";
import { D } from "@/lib/pricing/decimal";
import { montarChavePerda } from "@/lib/perda-fixa-producao";
import { analisarPreflight } from "@/lib/preflight";
import { cancelarCandidatosDoPedido } from "@/lib/gang-run-servico";
import { extrairEValidarSelecaoMaquina } from "@/lib/apontamento-etapa";
import { parseRefugoFormData } from "@/lib/refugo-producao";
import { ehNivelPrioridadeValido } from "@/lib/prioridade-pedido";
import { avancarStatusPedido, buscarOrcamentoParaBaixa } from "./status-transicao";
import { calcularQuantidadeConsumidaFichaProduto } from "@/lib/baixa-estoque-substrato";
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
  // Estoque de produto pré-produzido (2026-09-08) — id do OrcamentoItem
  // "dono" desta linha (o produto, quando a linha é da ficha técnica dele;
  // o produto PAI do acabamento, quando a linha vem de um acabamento
  // anexado). Permite ao painel de confirmação agrupar/esconder as linhas
  // de um item que acabou de ser marcado "atender do estoque pré-produzido"
  // — ver itensElegiveisEstoque abaixo.
  orcamentoItemId: string;
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

// Estoque de produto pré-produzido (2026-09-08) — item do orçamento cujo
// PRODUTO tem estoque pré-produzido suficiente pra atender a quantidade
// pedida (ItemGrafica.estoqueAtual >= item.quantidade). Só produtos
// elegíveis aparecem aqui — o painel de confirmação (PainelConfirmacaoImpressao)
// só oferece o checkbox "atender do estoque" pra estes.
type ItemElegivelEstoque = {
  orcamentoItemId: string;
  nomeProduto: string;
  quantidadePedida: number;
  estoqueDisponivel: number;
};

export type PrevisaoBaixaEstoqueResult =
  | { ok: false; mensagem: string }
  | { ok: true; itens: ItemPrevisaoBaixa[]; itensElegiveisEstoque: ItemElegivelEstoque[] };

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
      // Achado N5 da auditoria de código (2026-09-04) — mesma função
      // compartilhada de status-transicao.ts (ver
      // src/lib/baixa-estoque-substrato.ts): quando o item tem breakdown de
      // motor avançado e esta linha é o substrato identificado, a PRÉVIA já
      // mostra o consumo FÍSICO real (folhas/área/metragem), não o linear —
      // nunca pode divergir do que avancarStatusPedido de fato desconta.
      const quantidadeConsumida = calcularQuantidadeConsumidaFichaProduto(item, ficha);
      // Mesmo preço que snapshotCustoFicha (status-transicao.ts) vai
      // congelar na baixa de verdade — variante sobrepõe o preço da
      // matéria-prima "pai" quando a ficha aponta uma variante específica.
      const precoCompra = ficha.varianteId ? (ficha.variante?.precoCompra ?? null) : ficha.materiaPrima.precoCompra;
      itens.push({
        chave: montarChavePerda(item.id, ficha.id),
        orcamentoItemId: item.id,
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
          orcamentoItemId: item.id,
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

  // Estoque de produto pré-produzido (2026-09-08) — elegível quando o
  // PRODUTO deste item tem estoque pronto suficiente pra cobrir a
  // quantidade pedida (mesma leitura de estoqueAtual já trazida por
  // buscarOrcamentoParaBaixa, sem query extra). Item sem elegibilidade
  // nenhuma (produto nunca pré-produzido, ou pré-produzido mas insuficiente)
  // simplesmente não aparece aqui — o painel de confirmação só oferece o
  // checkbox pra quem está nesta lista.
  const itensElegiveisEstoque: ItemElegivelEstoque[] = (orcamentoComItens?.itens ?? [])
    .filter(
      (item) => item.itemGrafica.estoqueAtual !== null && Number(item.itemGrafica.estoqueAtual) >= item.quantidade
    )
    .map((item) => ({
      orcamentoItemId: item.id,
      nomeProduto: item.itemGrafica.itemCatalogo.nome,
      quantidadePedida: item.quantidade,
      estoqueDisponivel: Number(item.itemGrafica.estoqueAtual),
    }));

  return { ok: true, itens, itensElegiveisEstoque };
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

  // Achado B2 — máquina opcional (0 ou 1, nunca mais de uma) que produziu a
  // etapa que o pedido está ENTRANDO. Só o canal APP (este) coleta isso —
  // ver relatório da tarefa sobre por que LINK_PUBLICO/QR_ETIQUETA ficam de
  // fora. Validado ANTES de chamar avancarStatusPedido: um id de máquina de
  // outra gráfica vindo direto do form (sem passar pela UI) é rejeitado
  // aqui, nunca gravado.
  const selecaoMaquina = await extrairEValidarSelecaoMaquina(formData, usuario.graficaId);
  if (!selecaoMaquina.ok) {
    return { ok: false, mensagem: selecaoMaquina.mensagem };
  }

  // Achado B3 — refugo reportado (opcional) sobre a etapa que este pedido
  // está SAINDO. Validado ANTES de chamar avancarStatusPedido, mesmo
  // cuidado de selecaoMaquina acima: nunca confia em nada vindo direto do
  // form sem validar no servidor.
  const resolucaoRefugo = parseRefugoFormData(formData);
  if (!resolucaoRefugo.ok) {
    return { ok: false, mensagem: resolucaoRefugo.mensagem };
  }

  // Estoque de produto pré-produzido (2026-09-08) — checkboxes multi-valor
  // nativas (name="atenderEstoque", um <input> por item elegível, ver
  // PainelConfirmacaoImpressao.tsx), não JSON — mais simples que perdasJson
  // porque é só um opt-in booleano por item, sem quantidade a digitar.
  // Revalidado contra os itens REAIS do pedido dentro de avancarStatusPedido
  // (nunca confia num id vindo direto do form sem checar).
  const atenderEstoqueOrcamentoItemIds = formData.getAll("atenderEstoque").map(String);

  return avancarStatusPedido(
    pedido,
    formData.get("perdasJson"),
    {
      origemConfirmacao: "APP",
      operadorId: usuario.id,
      selecaoMaquina: selecaoMaquina.selecao,
    },
    resolucaoRefugo.refugo,
    atenderEstoqueOrcamentoItemIds
  );
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
  // Preenchido dentro da transação com os CustoPedido automáticos que
  // acabaram de ser marcados estornadoEm — logado DEPOIS que a transação
  // commitar (mesmo motivo do comentário em registrarAuditoria: nunca
  // auditoria dentro da própria transação de negócio).
  let custosEstornados: { id: string; valor: Prisma.Decimal; categoriaNome: string }[] = [];
  // Achado N2 da auditoria de abrangência — as duas outras consequências
  // financeiras da aprovação que cancelar um pedido também precisa desfazer
  // (junto com o estorno de estoque/custo acima): a(s) ContaReceber ainda
  // PENDENTE deste orçamento (senão fica pra sempre pendente, entrando no
  // aging e no limite de crédito de um pedido que não existe) e a Comissao
  // do vendedor, se ainda PENDENTE (senão ele recebe comissão de uma venda
  // cancelada). Preenchidos dentro da transação, logados DEPOIS que ela
  // commitar — mesmo motivo do comentário em custosEstornados acima.
  let contasReceberCanceladas: { id: string; descricao: string; valor: Prisma.Decimal }[] = [];
  // Array (não objeto nullable) apesar de Comissao ser @unique por orçamento
  // (no máximo 1 linha) — mesmo formato de contasReceberCanceladas acima, e
  // evita uma pegadinha do TypeScript: narrowing de `let x: T | null = null`
  // não atravessa direito o closure assíncrono de $transaction, colapsando o
  // tipo pra `never` num `if (x)` depois da transação.
  let comissoesCanceladas: { id: string; valorComissao: Prisma.Decimal }[] = [];

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

        // Tira este pedido da fila de gang run (só quem ainda estiver
        // AGUARDANDO — um candidato já COMBINADO não é desfeito aqui, ver
        // comentário em cancelarCandidatosDoPedido).
        await cancelarCandidatosDoPedido(tx, pedidoId, "Pedido cancelado");

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
              // Achado F4 da auditoria de abrangência (Parte 7, 2026-09-05)
              // — mesmo princípio do custo acima: copiado do snapshot da
              // SAIDA_PRODUCAO original sendo revertida, nunca recalculado
              // (a matéria-prima pode até ter mudado de controlaLote desde
              // então). null quando a saída original também não tinha
              // (item sem controlaLote, ou movimentação anterior a este
              // campo).
              lote: saida.lote,
              validade: saida.validade,
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
          const custosParaEstornar = await tx.custoPedido.findMany({
            where: { movimentacaoEstoqueId: { in: saidas.map((s) => s.id) }, estornadoEm: null },
            include: { categoriaCusto: true },
          });
          if (custosParaEstornar.length > 0) {
            await tx.custoPedido.updateMany({
              where: { id: { in: custosParaEstornar.map((c) => c.id) } },
              data: { estornadoEm: new Date() },
            });
            custosEstornados = custosParaEstornar.map((c) => ({
              id: c.id,
              valor: c.valor,
              categoriaNome: c.categoriaCusto.nome,
            }));
          }
        }

        // ContaReceber gerada na aprovação (automática ou manual) — só
        // cancela quem ainda estiver PENDENTE. Uma conta PARCIAL já tem
        // dinheiro real recebido via BaixaContaReceber: cancelar sozinho
        // faria esse saldo já recebido desaparecer sem contrapartida, então
        // fica como está e a gráfica decide à parte (mesmo critério que
        // cancelarContaReceber, em financeiro/contas-receber/actions.ts, já
        // aplica pro cancelamento manual — também só aceita PENDENTE).
        // RECEBIDO/CANCELADO nunca são tocados (já não representam dívida em
        // aberto, e um já cancelado não precisa ser cancelado de novo).
        const contasParaCancelar = await tx.contaReceber.findMany({
          where: { orcamentoId: pedido.orcamentoId, status: "PENDENTE" },
        });
        if (contasParaCancelar.length > 0) {
          await tx.contaReceber.updateMany({
            where: { id: { in: contasParaCancelar.map((c) => c.id) } },
            data: { status: "CANCELADO" },
          });
          contasReceberCanceladas = contasParaCancelar.map((c) => ({
            id: c.id,
            descricao: c.descricao,
            valor: c.valor,
          }));
        }

        // Comissao é @unique por orçamento (no máximo uma linha) — só mexe
        // se ainda estiver PENDENTE. Uma comissão já PAGA não é revertida
        // automaticamente (mesmo critério de custo manual acima: dinheiro que
        // já saiu da gráfica não é estornado sozinho).
        const comissaoParaCancelar = await tx.comissao.findFirst({
          where: { orcamentoId: pedido.orcamentoId, status: "PENDENTE" },
        });
        if (comissaoParaCancelar) {
          // estornadoEm: achado A12 da Parte 4 (2026-09-09) — mesmo padrão de
          // CustoPedido.estornadoEm, carimbado JUNTO com o status pra quem
          // precisar do "quando" sem depender de LogAuditoria.
          await tx.comissao.update({
            where: { id: comissaoParaCancelar.id },
            data: { status: "CANCELADA", estornadoEm: new Date() },
          });
          comissoesCanceladas = [
            { id: comissaoParaCancelar.id, valorComissao: comissaoParaCancelar.valorComissao },
          ];

          // Achado N22 da Parte 9 da auditoria de código (2026-09-12) —
          // espelho origem=COMISSAO em CustoPedido (criarCustoAutomaticoComissao
          // em src/lib/custo-pedido.ts) nunca era tocado aqui: a Comissao em
          // si já era cancelada acima, mas o custo mirror continuava ativo
          // pra sempre, inflando custosVariaveis da DRE sem receita
          // correspondente. Mesma regra "só reverte o que ainda não foi
          // incorrido" já aplicada à Comissao acima (só PENDENTE) — o
          // mirror só existe pra uma Comissao que acabou de ser cancelada
          // NESTE bloco (ainda não paga), então sempre pode ser estornado
          // junto.
          const custoComissao = await tx.custoPedido.findFirst({
            where: { pedidoId, origem: "COMISSAO", estornadoEm: null },
            include: { categoriaCusto: true },
          });
          if (custoComissao) {
            await tx.custoPedido.update({
              where: { id: custoComissao.id },
              data: { estornadoEm: new Date() },
            });
            custosEstornados.push({
              id: custoComissao.id,
              valor: custoComissao.valor,
              categoriaNome: custoComissao.categoriaCusto.nome,
            });
          }
        }

        // Achado N22 da Parte 9 — espelho origem=DESPESA (Fin-A1,
        // criarCustoAutomaticoDespesa) também nunca era tocado. Diferente de
        // TERCEIRIZACAO/COMPRA (que só nascem DEPOIS que o serviço já foi
        // prestado/o material já chegou — sempre já incorridos por
        // construção, nunca estornados aqui de propósito) e de COMISSAO
        // acima (decidido pelo status da própria Comissao), uma Despesa tem
        // seu próprio ciclo de pagamento: só estorna o mirror de uma Despesa
        // que ainda está PENDENTE (nada pago ainda) — PARCIAL/PAGA
        // continuam intactos, mesmo critério "não reverte o que já saiu do
        // caixa" de todo o resto desta função.
        const custosDespesaPendente = await tx.custoPedido.findMany({
          where: {
            pedidoId,
            origem: "DESPESA",
            estornadoEm: null,
            despesa: { status: "PENDENTE" },
          },
          include: { categoriaCusto: true },
        });
        if (custosDespesaPendente.length > 0) {
          await tx.custoPedido.updateMany({
            where: { id: { in: custosDespesaPendente.map((c) => c.id) } },
            data: { estornadoEm: new Date() },
          });
          for (const custo of custosDespesaPendente) {
            custosEstornados.push({
              id: custo.id,
              valor: custo.valor,
              categoriaNome: custo.categoriaCusto.nome,
            });
          }
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

  // Um log por CustoPedido estornado (mesma granularidade de
  // lancarCustoPedido/excluirCustoPedido acima). O cancelamento do pedido em
  // si não tem log de auditoria próprio hoje — isto aqui cobre especificamente
  // o custo saindo do cálculo de lucro, que é o que o achado A17 pede.
  for (const custo of custosEstornados) {
    const diff = criarDiffCampos();
    diff.campo("Conta no lucro do pedido", "sim", "não (estornado)");
    await registrarAuditoria({
      graficaId: usuario.graficaId,
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "custo_pedido.estornar",
      entidade: "CustoPedido",
      entidadeId: custo.id,
      descricao: `Estornou custo de ${formatoMoeda.format(Number(custo.valor))} em ${custo.categoriaNome} do pedido ${pedidoId} (cancelamento do pedido)`,
      valorAnterior: diff.antesTextos.join(", "),
      valorNovo: diff.depoisTextos.join(", "),
    });
  }

  // Mesma granularidade acima, agora pras duas consequências financeiras da
  // aprovação que o achado N2 pede pra desfazer no cancelamento.
  for (const conta of contasReceberCanceladas) {
    const diff = criarDiffCampos();
    diff.campo("Status", "PENDENTE", "CANCELADO (pedido cancelado)");
    await registrarAuditoria({
      graficaId: usuario.graficaId,
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "conta_receber.cancelar",
      entidade: "ContaReceber",
      entidadeId: conta.id,
      descricao: `Conta a receber "${conta.descricao}" (${formatoMoeda.format(Number(conta.valor))}) cancelada automaticamente pelo cancelamento do pedido ${pedidoId}`,
      valorAnterior: diff.antesTextos.join(", "),
      valorNovo: diff.depoisTextos.join(", "),
    });
  }
  for (const comissao of comissoesCanceladas) {
    const diff = criarDiffCampos();
    diff.campo("Status", "PENDENTE", "CANCELADA (pedido cancelado)");
    await registrarAuditoria({
      graficaId: usuario.graficaId,
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "comissao.cancelar",
      entidade: "Comissao",
      entidadeId: comissao.id,
      descricao: `Comissão de ${formatoMoeda.format(Number(comissao.valorComissao))} cancelada automaticamente pelo cancelamento do pedido ${pedidoId}`,
      valorAnterior: diff.antesTextos.join(", "),
      valorNovo: diff.depoisTextos.join(", "),
    });
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
  revalidatePath("/financeiro/contas-receber");
  revalidatePath("/financeiro/comissoes");

  let mensagem = itensEstornados > 0 ? "Pedido cancelado e estoque estornado." : "Pedido cancelado.";
  if (contasReceberCanceladas.length > 0) {
    const totalContas = contasReceberCanceladas.reduce((soma, c) => soma + Number(c.valor), 0);
    mensagem += ` ${contasReceberCanceladas.length} conta${contasReceberCanceladas.length > 1 ? "s" : ""} a receber de ${formatoMoeda.format(totalContas)} cancelada${contasReceberCanceladas.length > 1 ? "s" : ""}.`;
  }
  if (comissoesCanceladas.length > 0) {
    mensagem += ` Comissão de ${formatoMoeda.format(Number(comissoesCanceladas[0].valorComissao))} cancelada.`;
  }

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

export type AlterarPrioridadeResult = { ok: boolean; mensagem: string };

// Achado C1 da Parte 2 (Produção) da auditoria de abrangência (2026-09-07)
// — muda Pedido.prioridade, o campo que passou a ordenar o Kanban (ver
// compararPrioridadePedido em src/lib/prioridade-pedido.ts). Gate
// PRODUCAO.podeEditar puro (diferente de avancarPedido): decidir "o que
// roda primeiro" na fila inteira é responsabilidade de quem administra a
// produção, não do responsável por uma etapa específica (podeConfirmarEstagio
// nunca entra aqui). Só aceita um dos 4 valores fixos da UI (Baixa/Normal/
// Alta/Urgente) — nunca um número livre vindo direto de um POST sem passar
// pelo <select>.
export async function alterarPrioridadePedido(
  _estadoAnterior: AlterarPrioridadeResult | null,
  formData: FormData
): Promise<AlterarPrioridadeResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "PRODUCAO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar a produção." };
  }

  const pedidoId = String(formData.get("pedidoId"));
  const prioridade = Number(formData.get("prioridade"));
  if (!Number.isFinite(prioridade) || !ehNivelPrioridadeValido(prioridade)) {
    return { ok: false, mensagem: "Prioridade inválida." };
  }

  const pedido = await prisma.pedido.findFirst({
    where: { id: pedidoId, graficaId: usuario.graficaId },
    select: { id: true },
  });
  if (!pedido) {
    return { ok: false, mensagem: "Pedido não encontrado." };
  }

  await prisma.pedido.update({ where: { id: pedidoId }, data: { prioridade } });

  revalidatePath("/producao");
  return { ok: true, mensagem: "Prioridade atualizada." };
}
