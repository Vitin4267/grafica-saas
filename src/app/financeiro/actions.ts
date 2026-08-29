"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { registrarAuditoria } from "@/lib/auditoria";
import { formatoMoeda } from "@/lib/moeda";
import { despesaSchema, marcarComoPagaSchema } from "./schema";
import { saldoDespesa } from "@/lib/baixa-financeira";
import { paraDecimal } from "@/lib/pricing/decimal";

export type DespesaResult = { ok: boolean; mensagem: string };

// Sinaliza, de dentro da transação, que a despesa já mudou de status entre a
// leitura inicial e a escrita — mesmo padrão de ErroContaJaRecebida em
// financeiro/contas-receber/actions.ts.
class ErroDespesaJaPaga extends Error {}

function revalidarFinanceiro(despesaId?: string) {
  revalidatePath("/financeiro");
  revalidatePath("/meu-negocio");
  if (despesaId) revalidatePath(`/financeiro/${despesaId}`);
}

// Decide os dois campos de categoria a partir do que veio do form: se um
// categoriaCustoId foi escolhido (select de CampoCategoriaDespesa.tsx),
// confere que ele pertence à gráfica e espelha o NOME da categoria em
// `categoria` — snapshot legível pra quem só lê o texto (lista, CSV) não
// precisar mudar. Sem categoriaCustoId, usa o texto livre digitado e limpa
// a relação (importante em editarDespesa: trocar de categoria da lista pra
// "Outra" precisa desligar o vínculo antigo, não só ignorá-lo).
async function resolverCategoriaDespesa(
  graficaId: string,
  dados: { categoria?: string; categoriaCustoId?: string }
): Promise<
  | { ok: true; categoria: string | undefined; categoriaCustoId: string | null }
  | { ok: false; mensagem: string }
> {
  if (!dados.categoriaCustoId) {
    return { ok: true, categoria: dados.categoria, categoriaCustoId: null };
  }
  const categoriaCusto = await prisma.categoriaCusto.findFirst({
    where: { id: dados.categoriaCustoId, graficaId },
  });
  if (!categoriaCusto) {
    return { ok: false, mensagem: "Categoria de custo inválida." };
  }
  return { ok: true, categoria: categoriaCusto.nome, categoriaCustoId: categoriaCusto.id };
}

export async function criarDespesa(
  _estadoAnterior: DespesaResult | null,
  formData: FormData
): Promise<DespesaResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "FINANCEIRO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar o financeiro." };
  }

  const parsed = despesaSchema.safeParse({
    descricao: formData.get("descricao"),
    categoria: formData.get("categoria") ?? undefined,
    categoriaCustoId: formData.get("categoriaCustoId") ?? undefined,
    valor: formData.get("valor"),
    vencimento: formData.get("vencimento"),
    periodicidade: formData.get("periodicidade") ?? undefined,
    recorrenciaAteEm: formData.get("recorrenciaAteEm") ?? undefined,
  });
  if (!parsed.success) {
    return { ok: false, mensagem: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const dadosCategoria = await resolverCategoriaDespesa(usuario.graficaId, parsed.data);
  if (!dadosCategoria.ok) {
    return { ok: false, mensagem: dadosCategoria.mensagem };
  }

  const recorrente = formData.get("recorrente") === "on";
  const valorVariavel = formData.get("valorVariavel") === "on";

  // A primeira ocorrência de uma série usa o próprio id como
  // serieRecorrenciaId — precisa de um segundo update porque o id só existe
  // depois do create. Os dois ficam na mesma transação pra nunca deixar uma
  // despesa "recorrente: true" mas sem serieRecorrenciaId visível pra quem
  // ler entre o create e o update (ex: gerarDespesasRecorrentesPendentes
  // rodando ao mesmo tempo).
  const despesa = await prisma.$transaction(async (tx) => {
    const criada = await tx.despesa.create({
      data: {
        graficaId: usuario.graficaId,
        descricao: parsed.data.descricao,
        categoria: dadosCategoria.categoria,
        categoriaCustoId: dadosCategoria.categoriaCustoId,
        valor: parsed.data.valor,
        vencimento: parsed.data.vencimento,
        recorrente,
        periodicidade: parsed.data.periodicidade,
        recorrenciaAteEm: parsed.data.recorrenciaAteEm ?? null,
        valorVariavel,
      },
    });
    if (!recorrente) return criada;
    return tx.despesa.update({
      where: { id: criada.id },
      data: { serieRecorrenciaId: criada.id },
    });
  });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "despesa.criar",
    entidade: "Despesa",
    entidadeId: despesa.id,
    descricao: `Despesa "${despesa.descricao}" cadastrada (${formatoMoeda.format(Number(despesa.valor))})`,
  });

  revalidarFinanceiro();
  return { ok: true, mensagem: "Despesa cadastrada com sucesso!" };
}

export async function editarDespesa(
  _estadoAnterior: DespesaResult | null,
  formData: FormData
): Promise<DespesaResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "FINANCEIRO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar o financeiro." };
  }
  const despesaId = String(formData.get("despesaId"));

  const despesa = await prisma.despesa.findFirst({
    where: { id: despesaId, graficaId: usuario.graficaId },
    include: { comissao: { select: { id: true } } },
  });
  if (!despesa) {
    return { ok: false, mensagem: "Despesa não encontrada." };
  }
  if (despesa.comissao) {
    return {
      ok: false,
      mensagem: "Esta despesa foi gerada pelo pagamento de uma comissão — ajuste em Financeiro → Comissões.",
    };
  }

  const parsed = despesaSchema.safeParse({
    descricao: formData.get("descricao"),
    categoria: formData.get("categoria") ?? undefined,
    categoriaCustoId: formData.get("categoriaCustoId") ?? undefined,
    valor: formData.get("valor"),
    vencimento: formData.get("vencimento"),
    periodicidade: formData.get("periodicidade") ?? undefined,
    recorrenciaAteEm: formData.get("recorrenciaAteEm") ?? undefined,
  });
  if (!parsed.success) {
    return { ok: false, mensagem: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const dadosCategoria = await resolverCategoriaDespesa(usuario.graficaId, parsed.data);
  if (!dadosCategoria.ok) {
    return { ok: false, mensagem: dadosCategoria.mensagem };
  }

  const recorrente = formData.get("recorrente") === "on";
  const valorVariavel = formData.get("valorVariavel") === "on";

  await prisma.despesa.update({
    where: { id: despesaId },
    data: {
      descricao: parsed.data.descricao,
      categoria: dadosCategoria.categoria,
      categoriaCustoId: dadosCategoria.categoriaCustoId,
      valor: parsed.data.valor,
      vencimento: parsed.data.vencimento,
      recorrente,
      periodicidade: parsed.data.periodicidade,
      recorrenciaAteEm: parsed.data.recorrenciaAteEm ?? null,
      valorVariavel,
      // Liga recorrência numa despesa que ainda não tinha série: essa
      // ocorrência vira o início. Já tinha série (recorrente antes ou
      // desligando agora): mantém o serieRecorrenciaId como estava — ver
      // comentário no schema sobre só a ocorrência mais recente decidir.
      serieRecorrenciaId: recorrente && !despesa.serieRecorrenciaId ? despesaId : despesa.serieRecorrenciaId,
    },
  });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "despesa.editar",
    entidade: "Despesa",
    entidadeId: despesaId,
    descricao: `Despesa "${parsed.data.descricao}" editada (agora ${formatoMoeda.format(Number(parsed.data.valor))})`,
  });

  revalidarFinanceiro(despesaId);
  return { ok: true, mensagem: "Despesa atualizada com sucesso!" };
}

export async function excluirDespesa(
  _estadoAnterior: DespesaResult | null,
  formData: FormData
): Promise<DespesaResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "FINANCEIRO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar o financeiro." };
  }
  const despesaId = String(formData.get("despesaId"));

  const despesa = await prisma.despesa.findFirst({
    where: { id: despesaId, graficaId: usuario.graficaId },
    include: { comissao: { select: { id: true } } },
  });
  if (!despesa) {
    return { ok: false, mensagem: "Despesa não encontrada." };
  }
  if (despesa.comissao) {
    return {
      ok: false,
      mensagem: "Esta despesa foi gerada pelo pagamento de uma comissão — ajuste em Financeiro → Comissões.",
    };
  }

  // Registrado ANTES do delete: entidadeId não é FK de propósito (ver
  // comentário em LogAuditoria no schema), então o log sobrevive ao registro
  // que ele descreve — mas os dados (descrição/valor) só existem até aqui.
  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "despesa.excluir",
    entidade: "Despesa",
    entidadeId: despesaId,
    descricao: `Despesa "${despesa.descricao}" excluída (${formatoMoeda.format(Number(despesa.valor))})`,
  });

  // Hard delete direto: Comissao.despesaId é a única FK pra Despesa (onDelete:
  // SetNull), e já foi barrada acima — diferente de Prensa, que bloqueia por
  // causa de ItemGrafica.prensaId.
  await prisma.despesa.delete({ where: { id: despesaId } });

  revalidarFinanceiro();
  redirect("/financeiro");
}

// status/pagoEm nunca são campos de formulário genérico — só essa action
// (e marcarComoPendente, o desfazer) mexem neles, garantindo que nunca
// existe uma despesa "paga" sem data de pagamento ou vice-versa.
//
// Achado A8 da Parte 4 (2026-08-29) — pagamento PARCIAL: TODO pagamento
// registrado por aqui (mesmo o primeiro, em valor cheio) passa a virar uma
// linha em PagamentoDespesa — ver model no schema.prisma. Quando o valor
// enviado bate exato com o saldo em aberto (o comportamento de sempre, sem
// mexer no campo "valor" do form), o resultado observável é IDÊNTICO a
// antes: status PAGA, pagoEm/formaPagamento setados. Só quando o valor é
// MENOR que o saldo é que vira PARCIAL. Valor MAIOR que o saldo é
// rejeitado — nunca aplicado "com sobra" em silêncio (mesma trava de
// registrarBaixaContaReceber em financeiro/contas-receber/actions.ts).
export async function marcarComoPaga(
  _estadoAnterior: DespesaResult | null,
  formData: FormData
): Promise<DespesaResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "FINANCEIRO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar o financeiro." };
  }

  const parsed = marcarComoPagaSchema.safeParse({
    despesaId: formData.get("despesaId"),
    formaPagamento: formData.get("formaPagamento"),
    formaPagamentoDetalhe: formData.get("formaPagamentoDetalhe") ?? undefined,
    valor: formData.get("valor") ?? undefined,
  });
  if (!parsed.success) {
    return { ok: false, mensagem: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const { despesaId, formaPagamento, formaPagamentoDetalhe } = parsed.data;

  const despesa = await prisma.despesa.findFirst({
    where: { id: despesaId, graficaId: usuario.graficaId },
  });
  if (!despesa) {
    return { ok: false, mensagem: "Despesa não encontrada." };
  }
  if (despesa.status !== "PENDENTE" && despesa.status !== "PARCIAL") {
    return { ok: false, mensagem: "Essa despesa já está paga." };
  }

  const saldoAtual = await saldoDespesa(prisma, despesa);
  const valorNovo = paraDecimal(parsed.data.valor ?? saldoAtual.toFixed(2));
  if (valorNovo.gt(saldoAtual)) {
    return {
      ok: false,
      mensagem: `Valor informado (${formatoMoeda.format(valorNovo.toNumber())}) é maior que o saldo em aberto desta despesa (${formatoMoeda.format(saldoAtual.toNumber())}). Ajuste o valor.`,
    };
  }

  const statusLido = despesa.status;
  const fecha = valorNovo.eq(saldoAtual);
  const agora = new Date();
  // Só guarda o detalhe quando a forma é OUTRO — nunca deixa texto
  // órfão de uma forma antiga sobrar se o usuário escolher outra forma.
  const formaDetalheFinal = formaPagamento === "OUTRO" ? (formaPagamentoDetalhe ?? null) : null;

  try {
    await prisma.$transaction(async (tx) => {
      const cas = await tx.despesa.updateMany({
        where: { id: despesaId, status: statusLido },
        data: fecha
          ? { status: "PAGA", pagoEm: agora, formaPagamento, formaPagamentoDetalhe: formaDetalheFinal }
          : { status: "PARCIAL", formaPagamento, formaPagamentoDetalhe: formaDetalheFinal },
      });
      if (cas.count === 0) throw new ErroDespesaJaPaga();

      await tx.pagamentoDespesa.create({
        data: {
          despesaId,
          valor: valorNovo.toFixed(2),
          forma: formaPagamento,
          formaDetalhe: formaDetalheFinal,
          observacao: fecha ? null : "Baixa parcial",
        },
      });
    });
  } catch (erro) {
    if (erro instanceof ErroDespesaJaPaga) {
      return { ok: false, mensagem: "Essa despesa já mudou de status por outra requisição." };
    }
    throw erro;
  }

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: fecha ? "despesa.marcar_paga" : "despesa.baixa_parcial",
    entidade: "Despesa",
    entidadeId: despesaId,
    descricao: fecha
      ? `Despesa "${despesa.descricao}" marcada como paga (${formatoMoeda.format(valorNovo.toNumber())})`
      : `Baixa parcial de ${formatoMoeda.format(valorNovo.toNumber())} registrada na despesa "${despesa.descricao}" (saldo restante: ${formatoMoeda.format(saldoAtual.minus(valorNovo).toNumber())})`,
  });

  revalidarFinanceiro(despesaId);
  return { ok: true, mensagem: fecha ? "Despesa marcada como paga." : "Baixa parcial registrada." };
}

export async function marcarComoPendente(
  _estadoAnterior: DespesaResult | null,
  formData: FormData
): Promise<DespesaResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "FINANCEIRO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar o financeiro." };
  }
  const despesaId = String(formData.get("despesaId"));

  const despesa = await prisma.despesa.findFirst({
    where: { id: despesaId, graficaId: usuario.graficaId },
    include: { comissao: { select: { id: true } } },
  });
  if (!despesa) {
    return { ok: false, mensagem: "Despesa não encontrada." };
  }
  if (despesa.comissao) {
    return {
      ok: false,
      mensagem: "Esta despesa foi gerada pelo pagamento de uma comissão — ajuste em Financeiro → Comissões.",
    };
  }

  // Desfazer volta a despesa pro estado "nenhum pagamento registrado" —
  // achado A8 da Parte 4 (2026-08-29): inclui apagar as linhas de
  // PagamentoDespesa (total ou parciais) acumuladas, senão o saldo calculado
  // ficaria inconsistente com status PENDENTE (que pressupõe saldo == valor
  // cheio). Mesmo espírito "desfazer é desfazer tudo" que já existia aqui
  // pros campos flat.
  await prisma.$transaction([
    prisma.pagamentoDespesa.deleteMany({ where: { despesaId } }),
    prisma.despesa.update({
      where: { id: despesaId },
      data: { status: "PENDENTE", pagoEm: null, formaPagamento: null, formaPagamentoDetalhe: null },
    }),
  ]);

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "despesa.marcar_pendente",
    entidade: "Despesa",
    entidadeId: despesaId,
    descricao: `Despesa "${despesa.descricao}" marcada como pendente novamente`,
  });

  revalidarFinanceiro(despesaId);
  return { ok: true, mensagem: "Despesa marcada como pendente novamente." };
}
