"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { TRANSICOES_VALIDAS, orcamentoEstaExpirado, type StatusOrcamento } from "@/lib/orcamento-status";
import { calcularValorBase, calcularComissao } from "@/lib/comissao";
import { tentarRegistrarRespostaOrcamento } from "@/lib/auth/rate-limit";
import { obterIpRequisicao } from "@/lib/auth/ip";
import { ehConflitoDeSerializacao } from "@/lib/prisma-conflito";
import { resolverOrigemPublica } from "@/lib/url-publica";
import { formatoInstanteReal } from "@/lib/data";
import { dispararEventoEmail, type EventoEmail } from "@/lib/email/webhook-email";
import {
  templateOrcamentoAprovado,
  templateOrcamentoRecusado,
  templateResponsavelNotaFiscal,
  templateSolicitacaoAjusteOrcamento,
} from "@/lib/email/templates";
import { assinaturaEstaLiberada } from "@/lib/billing/status";
import { calcularPrevisaoAprovacaoPedido, gravarPrevisaoAprovacaoPedido } from "@/lib/pedido-aprovacao";
import { registrarCandidatosGangRun } from "@/lib/gang-run-servico";
import { prepararNotificacaoNotaFiscal } from "@/lib/nota-fiscal";
import { registrarAuditoria } from "@/lib/auditoria";

export type ResponderPublicoResult = { ok: boolean; mensagem: string };
export type SolicitarAjusteResult = { ok: boolean; mensagem: string };

const NOME_MAX = 200;
const MOTIVO_MAX = 2000;

// Destinatários da resposta pública (aprovação, recusa e pedido de ajuste):
// quem CRIOU o orçamento (Orcamento.usuarioId — é quem precisa agir e quem
// ganha comissão) + todos os DONO(s) da gráfica (garantia de que alguém vê,
// caso o vendedor esteja fora). Deduplicado por e-mail: se o vendedor FOR um
// dos donos, ele recebe um único e-mail, não dois. Busca feita FORA da
// transação principal (o CAS de status já commitou quando isto roda) —
// mesmo cuidado de não alongar a transação por algo que não precisa de
// atomicidade com ela.
async function notificarRespostaOrcamento(
  graficaId: string,
  usuarioIdVendedor: string,
  tipo: EventoEmail["tipo"],
  template: { assunto: string; html: string; texto: string }
) {
  const [vendedor, donos] = await Promise.all([
    prisma.usuario.findUnique({ where: { id: usuarioIdVendedor }, select: { email: true } }),
    prisma.usuario.findMany({ where: { graficaId, papel: "DONO" }, select: { email: true } }),
  ]);
  const destinatarios = new Set<string>();
  if (vendedor?.email) destinatarios.add(vendedor.email);
  for (const dono of donos) destinatarios.add(dono.email);
  for (const destinatario of destinatarios) {
    // after() em vez de void: em serverless (Vercel) a instância pode ser
    // congelada assim que a resposta é enviada, antes do fetch do `void`
    // terminar — after() garante que a instância continua viva até o
    // callback terminar. Mesmo padrão de src/app/a/[token]/actions.ts.
    after(() => dispararEventoEmail({ tipo, destinatario, ...template }));
  }
}

// Sem autenticação: o próprio token é o "credencial" — dá acesso de leitura/decisão
// só sobre ESTE orçamento, nunca sobre a conta da gráfica.
export async function responderOrcamentoPublico(
  _estadoAnterior: ResponderPublicoResult | null,
  formData: FormData
): Promise<ResponderPublicoResult> {
  const token = String(formData.get("token"));
  const decisao = String(formData.get("decisao"));

  if (decisao !== "APROVADO" && decisao !== "REJEITADO") {
    return { ok: false, mensagem: "Ação inválida." };
  }

  // Nome DECLARADO por quem responde — não é verificado, quem tem o link
  // digita o que quiser (mesmo princípio de Pedido.arteRespondidaPor, ver
  // comentário no schema). Obrigatório nos dois caminhos: sem isso, um
  // orçamento podia ser aprovado/recusado sem nenhum registro de quem
  // decidiu. Motivo é só da recusa, e opcional — o campo em si (mesmo vazio)
  // já é sinal ("recusou sem dizer por quê").
  const nome = String(formData.get("nome") ?? "").trim();
  if (!nome) {
    return { ok: false, mensagem: "Informe seu nome pra confirmar." };
  }
  if (nome.length > NOME_MAX) {
    return { ok: false, mensagem: "Nome muito longo — use até 200 caracteres." };
  }
  const motivo = String(formData.get("motivo") ?? "").trim();
  if (motivo.length > MOTIVO_MAX) {
    return { ok: false, mensagem: "Motivo muito longo — resuma em até 2000 caracteres." };
  }

  const orcamento = await prisma.orcamento.findUnique({
    where: { linkPublicoToken: token },
    include: {
      cliente: { select: { nome: true } },
      grafica: { select: { nome: true, corPrimaria: true } },
    },
  });
  if (!orcamento) {
    return { ok: false, mensagem: "Orçamento não encontrado." };
  }

  // Furo de paywall (achado de revisão de código): o link público é evergreen
  // e nunca expira por design, então uma gráfica com assinatura cancelada
  // (bloqueada no app autenticado) continuava deixando o cliente final
  // aprovar orçamentos por aqui — criando Pedido e Comissao de graça. Mesmo
  // padrão de confirmarEstagioPublico (src/app/p/[token]/actions.ts): sem
  // sessão de usuário aqui, não dá pra reaproveitar exigirAssinaturaAtiva,
  // então busca a assinatura da gráfica DONA do orçamento pelo graficaId e
  // aplica assinaturaEstaLiberada direto, devolvendo erro amigável sem
  // detalhe de billing. Antes do rate limit e da transação de propósito:
  // falha rápido, sem gastar tentativa do rate limit nem abrir transação à
  // toa.
  const assinatura = await prisma.assinaturaGrafica.findUnique({
    where: { graficaId: orcamento.graficaId },
  });
  if (!assinaturaEstaLiberada(assinatura)) {
    return {
      ok: false,
      mensagem: "A assinatura desta gráfica não está ativa no momento — não é possível responder por aqui.",
    };
  }

  // Mesmo princípio da checagem de paywall acima: falha rápido, antes do
  // rate limit e de qualquer transação. validoAteEm é calculado só quando o
  // orçamento vira ENVIADO (ver atualizarStatusOrcamento em
  // orcamento/[id]/actions.ts) — orcamentoEstaExpirado já cobre o caso de
  // orçamento sem prazo (validoAteEm null nunca expira).
  if (orcamentoEstaExpirado(orcamento)) {
    return {
      ok: false,
      mensagem: `Este orçamento venceu em ${formatoInstanteReal.format(orcamento.validoAteEm!)} — entre em contato com a gráfica para um novo.`,
    };
  }

  // Rate limit: quem tem o link consegue chamar esta action indefinidamente —
  // sem trava, um script poderia martelar aprovação/rejeição sem limite.
  // Mesmo padrão de responderArtePublica (src/app/a/[token]/actions.ts) e
  // confirmarEstagioPublico (src/app/p/[token]/actions.ts), tabela própria
  // (TentativaRespostaOrcamento) pra não misturar o orçamento de tentativas
  // dos três fluxos públicos por token.
  const ip = await obterIpRequisicao();
  let bloqueado: boolean;
  try {
    bloqueado = await tentarRegistrarRespostaOrcamento(orcamento.id, ip);
  } catch (erro) {
    if (ehConflitoDeSerializacao(erro)) {
      bloqueado = true;
    } else {
      throw erro;
    }
  }
  if (bloqueado) {
    return { ok: false, mensagem: "Muitas tentativas — aguarde alguns minutos e tente de novo." };
  }

  // Mesma máquina de estados da action autenticada — o cliente só pode decidir
  // a partir de ENVIADO, nunca "enviar" o próprio orçamento.
  const permitido = TRANSICOES_VALIDAS[orcamento.status as StatusOrcamento]?.includes(
    decisao as StatusOrcamento
  );
  if (!permitido) {
    return { ok: false, mensagem: "Este orçamento não pode mais ser respondido." };
  }

  // Compare-and-swap: o updateMany só transiciona se o status AINDA for o que
  // acabamos de validar. Sem isso, o cliente aprovando pelo link público e um
  // funcionário rejeitando no painel ao mesmo tempo poderiam ambos passar na
  // checagem de transição e o último a gravar venceria — deixando, por
  // exemplo, um Pedido criado mas o orçamento marcado como REJEITADO (mesmo
  // padrão de guarda que producao/actions.ts já usa em avancarPedido).
  // Um único instante pros dois campos abaixo (e pros dois branches) — não
  // faz sentido respostaPublicaEm divergir por milissegundos de quando o
  // status realmente mudou no banco.
  const agora = new Date();

  if (decisao === "APROVADO") {
    // Leitura fora da transação de propósito (mesmo cuidado de
    // atualizarStatusOrcamento em src/app/orcamento/[id]/actions.ts): ficha de
    // custo/comissão não muda por causa de uma corrida de
    // responderOrcamentoPublico, então não precisa fazer parte da transação —
    // mantém ela curta. Sem usuário autenticado aqui (link público), o
    // vendedor vem de orcamento.usuarioId e os parâmetros da própria gráfica
    // do orçamento.
    const [orcamentoComItens, usuarioVendedor, parametros, previsaoCusto] = await Promise.all([
      prisma.orcamentoItem.findMany({
        where: { orcamentoId: orcamento.id },
        include: { itemGrafica: { select: { precoCompra: true } } },
      }),
      prisma.usuario.findUnique({
        where: { id: orcamento.usuarioId },
        select: { comissaoPercent: true },
      }),
      prisma.parametrosGrafica.findUnique({
        where: { graficaId: orcamento.graficaId },
        select: { comissaoVendedorBase: true },
      }),
      // Mesmo cuidado do bloco de comissão acima: leitura de breakdown/ficha
      // técnica fica FORA da transação (ver fase-custo-real.md §3.1 e
      // src/lib/pedido-aprovacao.ts). Reaproveita o mesmo `agora` desta
      // resposta pra aprovadoEm bater com respostaPublicaEm.
      calcularPrevisaoAprovacaoPedido(orcamento.id, orcamento.graficaId, agora),
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

    const resultado = await prisma.$transaction(async (tx) => {
      // Nome + instante gravados na MESMA operação que muda o status — nunca
      // num update solto depois, senão dá pra ter status mudado sem nome
      // (ex: o CAS abaixo falha por corrida, mas um update de nome solto já
      // teria gravado antes).
      const cas = await tx.orcamento.updateMany({
        where: { id: orcamento.id, status: orcamento.status },
        data: { status: "APROVADO", respostaPublicaNome: nome, respostaPublicaEm: agora },
      });
      if (cas.count === 0) return false;
      const pedido = await tx.pedido.upsert({
        where: { orcamentoId: orcamento.id },
        update: {},
        create: {
          graficaId: orcamento.graficaId,
          orcamentoId: orcamento.id,
          status: "FILA",
          producaoLinkToken: randomBytes(20).toString("base64url"),
          // Copia a URL como referência (mesmo comportamento do caminho
          // autenticado em src/app/orcamento/[id]/actions.ts) — o arquivo
          // continua "pertencendo" contabilmente ao orçamento, nunca cria
          // uma linha nova de razão pro Pedido.
          arteUrl: orcamento.arteUrl,
          // Mesmo arquivo copiado acima — copia os achados já calculados
          // junto, não recalcula (ver comentário de Pedido.preflightAvisos
          // no schema.prisma).
          preflightAvisos: orcamento.preflightAvisos ?? undefined,
        },
      });

      // Congela aprovadoEm + os três snapshots + a previsão de custo por
      // categoria (PedidoCustoPrevisto) — ver fase-custo-real.md §2.3, §3.1
      // e src/lib/pedido-aprovacao.ts. Mesmo comportamento do caminho
      // autenticado (src/app/orcamento/[id]/actions.ts), nunca duplicado.
      await gravarPrevisaoAprovacaoPedido(tx, {
        graficaId: orcamento.graficaId,
        orcamentoId: orcamento.id,
        previsao: previsaoCusto,
      });

      // Mesmo comportamento do caminho autenticado
      // (src/app/orcamento/[id]/actions.ts) — ver src/lib/gang-run-servico.ts.
      await registrarCandidatosGangRun(tx, {
        graficaId: orcamento.graficaId,
        orcamentoId: orcamento.id,
        pedidoId: pedido.id,
      });

      if (dadosComissao) {
        await tx.comissao.upsert({
          where: { orcamentoId: orcamento.id },
          update: {},
          create: {
            graficaId: orcamento.graficaId,
            orcamentoId: orcamento.id,
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
    if (!resultado) {
      return { ok: false, mensagem: "Este orçamento não pode mais ser respondido." };
    }

    const origem = await resolverOrigemPublica();
    const template = templateOrcamentoAprovado(
      orcamento.grafica.nome,
      orcamento.cliente.nome,
      nome,
      Number(orcamento.total),
      `${origem}/orcamento/${orcamento.id}`,
      orcamento.grafica.corPrimaria
    );
    await notificarRespostaOrcamento(orcamento.graficaId, orcamento.usuarioId, "orcamento_aprovado", template);

    // Mesmo princípio do caminho autenticado (atualizarStatusOrcamento em
    // src/app/orcamento/[id]/actions.ts): só dispara depois que a transação
    // de aprovação acima já teve sucesso (o `if (!resultado)` logo acima já
    // trata o conflito de concorrência). prepararNotificacaoNotaFiscal
    // retorna null quando ninguém está configurado como responsável pela
    // área NOTA_FISCAL em /usuarios, ou quando o orçamento ainda não está
    // pronto fiscalmente — o `if` abaixo cobre os dois casos. `origem` já
    // foi resolvida acima pra montar o link de templateOrcamentoAprovado,
    // reaproveitada aqui.
    const notificacaoNotaFiscal = await prepararNotificacaoNotaFiscal(orcamento.id, orcamento.graficaId);
    if (notificacaoNotaFiscal) {
      const templateNotaFiscal = templateResponsavelNotaFiscal(
        notificacaoNotaFiscal.graficaNome,
        notificacaoNotaFiscal.clienteNome,
        orcamento.id,
        notificacaoNotaFiscal.valorTotal,
        `${origem}/orcamento/${orcamento.id}`,
        notificacaoNotaFiscal.corPrimaria
      );
      for (const destinatario of notificacaoNotaFiscal.destinatarios) {
        after(() =>
          dispararEventoEmail({
            tipo: "responsavel_nota_fiscal",
            destinatario: destinatario.email,
            ...templateNotaFiscal,
          })
        );
      }
    }
  } else {
    // Motivo vai pro campo próprio (Orcamento.respostaPublicaMotivo — ver
    // comentário no schema), na MESMA operação que muda o status e grava o
    // nome, mesmo cuidado do bloco de aprovação acima: sem isso, o CAS podia
    // ter sucesso e um update de motivo solto depois falhar/nem rodar,
    // deixando status mudado sem motivo registrado. Vazio vira `null`
    // (nunca string vazia) pra distinguir de forma limpa "campo não
    // preenchido" no e-mail e em qualquer tela futura que leia este campo.
    const cas = await prisma.orcamento.updateMany({
      where: { id: orcamento.id, status: orcamento.status },
      data: {
        status: "REJEITADO",
        respostaPublicaNome: nome,
        respostaPublicaEm: agora,
        respostaPublicaMotivo: motivo || null,
      },
    });
    if (cas.count === 0) {
      return { ok: false, mensagem: "Este orçamento não pode mais ser respondido." };
    }

    const origem = await resolverOrigemPublica();
    const template = templateOrcamentoRecusado(
      orcamento.grafica.nome,
      orcamento.cliente.nome,
      nome,
      Number(orcamento.total),
      motivo,
      `${origem}/orcamento/${orcamento.id}`,
      orcamento.grafica.corPrimaria
    );
    await notificarRespostaOrcamento(orcamento.graficaId, orcamento.usuarioId, "orcamento_recusado", template);
  }

  revalidatePath(`/o/${token}`);
  revalidatePath(`/orcamento/${orcamento.id}`);
  revalidatePath("/orcamento");
  if (decisao === "APROVADO") {
    revalidatePath("/producao");
    revalidatePath("/financeiro/comissoes");
  }

  return {
    ok: true,
    mensagem: decisao === "APROVADO" ? "Orçamento aprovado!" : "Orçamento recusado.",
  };
}

// Caminho paralelo a responderOrcamentoPublico, pro cliente que não quer
// aprovar nem recusar — quer que a gráfica mude algo antes. Mesma cadeia de
// checagens (paywall → rate limit → expirado → transição → CAS), só que a
// transição é ENVIADO→RASCUNHO (ver comentário em TRANSICOES_VALIDAS) em vez
// de →APROVADO/REJEITADO, e sem nenhum efeito colateral de Pedido/Comissao —
// só reabre o orçamento pra edição normal do vendedor.
export async function solicitarAjusteOrcamento(
  _estadoAnterior: SolicitarAjusteResult | null,
  formData: FormData
): Promise<SolicitarAjusteResult> {
  const token = String(formData.get("token"));

  const nome = String(formData.get("nome") ?? "").trim();
  if (!nome) {
    return { ok: false, mensagem: "Informe seu nome pra confirmar." };
  }
  if (nome.length > NOME_MAX) {
    return { ok: false, mensagem: "Nome muito longo — use até 200 caracteres." };
  }
  // Diferente do motivo da recusa (opcional): sem mensagem aqui a gráfica
  // não sabe o que ajustar, então é obrigatória.
  const mensagem = String(formData.get("mensagem") ?? "").trim();
  if (!mensagem) {
    return { ok: false, mensagem: "Descreva o ajuste que você precisa." };
  }
  if (mensagem.length > MOTIVO_MAX) {
    return { ok: false, mensagem: "Mensagem muito longa — resuma em até 2000 caracteres." };
  }

  const orcamento = await prisma.orcamento.findUnique({
    where: { linkPublicoToken: token },
    include: {
      cliente: { select: { nome: true } },
      grafica: { select: { nome: true, corPrimaria: true } },
    },
  });
  if (!orcamento) {
    return { ok: false, mensagem: "Orçamento não encontrado." };
  }

  // Mesmo furo de paywall documentado em responderOrcamentoPublico — sem
  // esta checagem, uma gráfica com assinatura cancelada continuaria
  // recebendo pedidos de ajuste (e reabrindo orçamentos) por aqui de graça.
  const assinatura = await prisma.assinaturaGrafica.findUnique({
    where: { graficaId: orcamento.graficaId },
  });
  if (!assinaturaEstaLiberada(assinatura)) {
    return {
      ok: false,
      mensagem: "A assinatura desta gráfica não está ativa no momento — não é possível responder por aqui.",
    };
  }

  // Mesma tabela de tentativas de responderOrcamentoPublico — ela conta por
  // orçamento/IP, não por tipo de resposta, então serve igual aqui sem
  // precisar de nenhuma mudança em tentarRegistrarRespostaOrcamento.
  const ip = await obterIpRequisicao();
  let bloqueado: boolean;
  try {
    bloqueado = await tentarRegistrarRespostaOrcamento(orcamento.id, ip);
  } catch (erro) {
    if (ehConflitoDeSerializacao(erro)) {
      bloqueado = true;
    } else {
      throw erro;
    }
  }
  if (bloqueado) {
    return { ok: false, mensagem: "Muitas tentativas — aguarde alguns minutos e tente de novo." };
  }

  if (orcamentoEstaExpirado(orcamento)) {
    return {
      ok: false,
      mensagem: `Este orçamento venceu em ${formatoInstanteReal.format(orcamento.validoAteEm!)} — entre em contato com a gráfica para um novo.`,
    };
  }

  const permitido = TRANSICOES_VALIDAS[orcamento.status as StatusOrcamento]?.includes("RASCUNHO");
  if (!permitido) {
    return { ok: false, mensagem: "Este orçamento não pode mais ser respondido." };
  }

  // CAS: mesmo cuidado de responderOrcamentoPublico — só reabre se o status
  // AINDA for o que acabamos de validar. validoAteEm e enviadoEm voltam a
  // null na MESMA operação: um RASCUNHO não tem prazo de validade nem entra
  // na lista de "parados" (só recalculados do zero quando o vendedor
  // reenviar), então nenhum dos dois pode sobreviver zumbi no banco.
  const cas = await prisma.orcamento.updateMany({
    where: { id: orcamento.id, status: orcamento.status },
    data: { status: "RASCUNHO", validoAteEm: null, enviadoEm: null },
  });
  if (cas.count === 0) {
    return { ok: false, mensagem: "Este orçamento não pode mais ser respondido." };
  }

  // Primeiro registro de auditoria vindo do fluxo público: mesmo helper que
  // toda tela autenticada usa (src/lib/auditoria.ts), mas com usuarioId do
  // VENDEDOR do orçamento (não existe usuário logado aqui) e usuarioNome
  // deixando explícito, na própria tela de auditoria, que foi o cliente final
  // quem agiu através do link — não um funcionário.
  await registrarAuditoria({
    graficaId: orcamento.graficaId,
    usuarioId: orcamento.usuarioId,
    usuarioNome: `Cliente ${nome} (via link público)`,
    acao: "orcamento.solicitar_ajuste",
    entidade: "Orcamento",
    entidadeId: orcamento.id,
    descricao: `Cliente ${nome} pediu ajuste no orçamento: "${mensagem}"`,
    valorAnterior: "ENVIADO",
    valorNovo: "RASCUNHO",
  });

  const origem = await resolverOrigemPublica();
  const template = templateSolicitacaoAjusteOrcamento(
    orcamento.grafica.nome,
    orcamento.cliente.nome,
    nome,
    Number(orcamento.total),
    mensagem,
    `${origem}/orcamento/${orcamento.id}`,
    orcamento.grafica.corPrimaria
  );
  await notificarRespostaOrcamento(
    orcamento.graficaId,
    orcamento.usuarioId,
    "orcamento_solicitou_ajuste",
    template
  );

  revalidatePath(`/o/${token}`);
  revalidatePath(`/orcamento/${orcamento.id}`);
  revalidatePath("/orcamento");

  return {
    ok: true,
    mensagem: "Pedido de ajuste enviado — a gráfica vai revisar e te manda um novo link em breve.",
  };
}
