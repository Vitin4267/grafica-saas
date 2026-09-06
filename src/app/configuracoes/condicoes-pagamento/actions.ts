"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { registrarAuditoria } from "@/lib/auditoria";
import { parseJsonArray } from "@/lib/form-json";

export type SalvarCondicaoPagamentoResult = { ok: boolean; mensagem: string };

const MENSAGEM_SEM_PERMISSAO = "Você não tem permissão pra editar configurações.";
const MENSAGEM_NOME_VAZIO = "Informe um nome para a condição de pagamento.";
const MENSAGEM_NOME_DUPLICADO = "Já existe uma condição de pagamento com esse nome.";

// Valores válidos do enum AncoraVencimento (schema 09-orcamento.prisma),
// replicados aqui pra validar o valor bruto vindo do <select> sem precisar
// importar o client gerado só pra isso — mesmo princípio de
// NATUREZAS_VALIDAS em configuracoes/categorias-custo/actions.ts.
const ANCORAS_VALIDAS = new Set(["APROVACAO", "EMISSAO_NOTA", "ENTREGA", "OUTRO"]);

const parcelaSchema = z.object({
  percentual: z.coerce
    .number()
    .positive("Percentual da parcela deve ser maior que zero.")
    .max(100, "Percentual da parcela não pode passar de 100%."),
  diasAposAncora: z.coerce
    .number()
    .int("Dias após a âncora deve ser um número inteiro.")
    .min(0, "Dias após a âncora não pode ser negativo."),
});

type ParcelasValidadas =
  | { parcelas: { percentual: number; diasAposAncora: number }[] }
  | { erro: string };

// Lê e valida o campo hidden `parcelasJson` (JSON.stringify de um array
// editável no client, ver ParcelasCampos.tsx — mesmo padrão de
// TabelaGramaturaForm.tsx em src/app/catalogo/[itemGraficaId]/): pelo menos
// 1 parcela, e a soma dos percentuais precisa fechar 100% — regra que o
// próprio schema documenta no comentário de
// CondicaoPagamentoParcela.percentual ("validado no server ao salvar, não
// no banco").
function lerParcelas(formData: FormData): ParcelasValidadas {
  const parsed = parseJsonArray(formData.get("parcelasJson"), parcelaSchema, { max: 24 });
  if (!parsed.ok) {
    return { erro: parsed.mensagem };
  }
  if (parsed.data.length === 0) {
    return { erro: "Adicione ao menos uma parcela." };
  }
  const somaPercentual = parsed.data.reduce((soma, parcela) => soma + parcela.percentual, 0);
  // Tolerância de 0.01 pra casos tipo 33.34+33.33+33.33 (arredondamento de
  // 1/3) — mesma tolerância exibida no client em ParcelasCampos.tsx.
  if (Math.abs(somaPercentual - 100) > 0.01) {
    return {
      erro: `A soma dos percentuais das parcelas precisa fechar 100% — está em ${somaPercentual.toFixed(2)}%.`,
    };
  }
  return { parcelas: parsed.data };
}

function lerAcrescimoPercent(formData: FormData): { valor: number | null } | { erro: string } {
  const bruto = String(formData.get("acrescimoPercent") ?? "").trim();
  if (!bruto) return { valor: null };
  const valor = Number(bruto);
  if (!Number.isFinite(valor) || valor < 0 || valor > 100) {
    return { erro: "Acréscimo inválido — informe um percentual entre 0 e 100." };
  }
  return { valor };
}

// Cria uma nova condição de pagamento pra gráfica (achado A7 da Parte 4 da
// auditoria de abrangência — o model já existia com bootstrap lazy de 4
// condições comuns, ver garantirCondicoesPagamentoPadrao em
// src/lib/condicao-pagamento.ts; esta tela é o único jeito de criar uma
// condição NOVA, antes só era possível via Prisma direto).
export async function criarCondicaoPagamento(
  _estadoAnterior: SalvarCondicaoPagamentoResult | null,
  formData: FormData
): Promise<SalvarCondicaoPagamentoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const nome = String(formData.get("nome") ?? "").trim();
  if (!nome) {
    return { ok: false, mensagem: MENSAGEM_NOME_VAZIO };
  }
  const ancoraBruta = String(formData.get("ancora") ?? "");
  if (!ANCORAS_VALIDAS.has(ancoraBruta)) {
    return { ok: false, mensagem: "Selecione uma âncora de vencimento válida." };
  }
  const ancora = ancoraBruta as "APROVACAO" | "EMISSAO_NOTA" | "ENTREGA" | "OUTRO";

  const acrescimo = lerAcrescimoPercent(formData);
  if ("erro" in acrescimo) {
    return { ok: false, mensagem: acrescimo.erro };
  }

  const parcelasLidas = lerParcelas(formData);
  if ("erro" in parcelasLidas) {
    return { ok: false, mensagem: parcelasLidas.erro };
  }

  let novaCondicao: { id: string };
  try {
    novaCondicao = await prisma.condicaoPagamento.create({
      data: {
        graficaId: usuario.graficaId,
        nome,
        ancora,
        acrescimoPercent: acrescimo.valor,
        parcelas: {
          create: parcelasLidas.parcelas.map((parcela, indice) => ({
            ordem: indice + 1,
            percentual: parcela.percentual,
            diasAposAncora: parcela.diasAposAncora,
          })),
        },
      },
    });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      return { ok: false, mensagem: MENSAGEM_NOME_DUPLICADO };
    }
    throw erro;
  }

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "configuracoes.criar_condicao_pagamento",
    entidade: "CondicaoPagamento",
    entidadeId: novaCondicao.id,
    descricao: `Condição de pagamento "${nome}" criada`,
  });

  revalidatePath("/configuracoes/condicoes-pagamento");
  redirect(`/configuracoes/condicoes-pagamento/${novaCondicao.id}`);
}

// Edita nome/âncora/acréscimo/parcelas de uma condição já existente — nunca
// mexe em `ativa`, ver alternarAtivaCondicaoPagamento pra isso. Orçamentos
// já vinculados a esta condição (Orcamento.condicaoPagamentoId) e contas a
// receber já geradas a partir dela não são afetados: a geração é SNAPSHOT no
// momento do evento-gatilho (ver comentário em gerarContasReceberPorAncora,
// src/lib/condicao-pagamento.ts), nunca relê CondicaoPagamentoParcela depois
// de criada.
export async function editarCondicaoPagamento(
  _estadoAnterior: SalvarCondicaoPagamentoResult | null,
  formData: FormData
): Promise<SalvarCondicaoPagamentoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const condicaoId = String(formData.get("condicaoId"));
  const condicao = await prisma.condicaoPagamento.findFirst({
    where: { id: condicaoId, graficaId: usuario.graficaId },
    include: { parcelas: true },
  });
  if (!condicao) {
    return { ok: false, mensagem: "Condição de pagamento não encontrada." };
  }

  const nome = String(formData.get("nome") ?? "").trim();
  if (!nome) {
    return { ok: false, mensagem: MENSAGEM_NOME_VAZIO };
  }
  const ancoraBruta = String(formData.get("ancora") ?? "");
  if (!ANCORAS_VALIDAS.has(ancoraBruta)) {
    return { ok: false, mensagem: "Selecione uma âncora de vencimento válida." };
  }
  const ancora = ancoraBruta as "APROVACAO" | "EMISSAO_NOTA" | "ENTREGA" | "OUTRO";

  const acrescimo = lerAcrescimoPercent(formData);
  if ("erro" in acrescimo) {
    return { ok: false, mensagem: acrescimo.erro };
  }

  const parcelasLidas = lerParcelas(formData);
  if ("erro" in parcelasLidas) {
    return { ok: false, mensagem: parcelasLidas.erro };
  }

  try {
    await prisma.$transaction([
      prisma.condicaoPagamento.update({
        where: { id: condicaoId },
        data: { nome, ancora, acrescimoPercent: acrescimo.valor },
      }),
      // Parcelas são substituídas inteiras a cada save (delete + recreate)
      // — mesmo padrão de salvarTabelaGramatura em
      // src/app/catalogo/[itemGraficaId]/actions.ts.
      prisma.condicaoPagamentoParcela.deleteMany({ where: { condicaoPagamentoId: condicaoId } }),
      prisma.condicaoPagamentoParcela.createMany({
        data: parcelasLidas.parcelas.map((parcela, indice) => ({
          condicaoPagamentoId: condicaoId,
          ordem: indice + 1,
          percentual: parcela.percentual,
          diasAposAncora: parcela.diasAposAncora,
        })),
      }),
    ]);
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      return { ok: false, mensagem: MENSAGEM_NOME_DUPLICADO };
    }
    throw erro;
  }

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "configuracoes.editar_condicao_pagamento",
    entidade: "CondicaoPagamento",
    entidadeId: condicaoId,
    descricao: `Condição de pagamento "${condicao.nome}" atualizada`,
    valorAnterior: `Nome: ${condicao.nome}, Âncora: ${condicao.ancora}, ${condicao.parcelas.length} parcela(s)`,
    valorNovo: `Nome: ${nome}, Âncora: ${ancora}, ${parcelasLidas.parcelas.length} parcela(s)`,
  });

  revalidatePath(`/configuracoes/condicoes-pagamento/${condicaoId}`);
  revalidatePath("/configuracoes/condicoes-pagamento");
  return { ok: true, mensagem: "Condição de pagamento atualizada com sucesso!" };
}

// Alterna ativa/inativa — é o equivalente de "remover" desta tela. NUNCA um
// delete físico: Orcamento.condicaoPagamentoId é onDelete SetNull no schema
// (ver comentário no model Orcamento), e orçamentos já aprovados com
// ContaReceber gerada a partir desta condição continuam com o histórico
// intacto mesmo depois de desativada — só some da seleção pra vínculo novo.
export async function alternarAtivaCondicaoPagamento(
  _estadoAnterior: SalvarCondicaoPagamentoResult | null,
  formData: FormData
): Promise<SalvarCondicaoPagamentoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const condicaoId = String(formData.get("condicaoId"));
  const condicao = await prisma.condicaoPagamento.findFirst({
    where: { id: condicaoId, graficaId: usuario.graficaId },
  });
  if (!condicao) {
    return { ok: false, mensagem: "Condição de pagamento não encontrada." };
  }

  await prisma.condicaoPagamento.update({
    where: { id: condicaoId },
    data: { ativa: !condicao.ativa },
  });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: condicao.ativa
      ? "configuracoes.desativar_condicao_pagamento"
      : "configuracoes.ativar_condicao_pagamento",
    entidade: "CondicaoPagamento",
    entidadeId: condicaoId,
    descricao: `Condição de pagamento "${condicao.nome}" ${condicao.ativa ? "desativada" : "ativada"}`,
  });

  revalidatePath(`/configuracoes/condicoes-pagamento/${condicaoId}`);
  revalidatePath("/configuracoes/condicoes-pagamento");
  return {
    ok: true,
    mensagem: condicao.ativa ? "Condição desativada." : "Condição ativada.",
  };
}
