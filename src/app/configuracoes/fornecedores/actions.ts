"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import type { CategoriaFornecedor, CondicaoPagamentoFornecedor } from "@/generated/prisma/enums";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { registrarAuditoria, criarDiffCampos } from "@/lib/auditoria";
import { camposDaViolacaoDeUnicidade } from "@/lib/prisma-conflito";
import {
  ORDEM_CATEGORIA_FORNECEDOR,
  ORDEM_CONDICAO_PAGAMENTO_FORNECEDOR,
  rotuloCategoriaFornecedor,
  rotuloCondicaoPagamentoFornecedor,
} from "@/lib/tipos-fornecedor";

export type SalvarFornecedorResult = { ok: boolean; mensagem: string };

const MENSAGEM_SEM_PERMISSAO = "Você não tem permissão pra editar configurações.";
const MENSAGEM_NOME_VAZIO = "Informe um nome para o fornecedor.";
const MENSAGEM_NOME_DUPLICADO = "Já existe um fornecedor com esse nome.";
const MENSAGEM_DOCUMENTO_DUPLICADO = "Já existe outro fornecedor desta gráfica com esse CNPJ/CPF.";

// Achado A5 da Parte 3 (Compras) da auditoria de abrangência — categoria e
// condição de pagamento são AMBAS opcionais (diferente de
// TipoPrestadorServico.tipo, que é obrigatório): "" = nenhuma escolhida,
// vira null. Só exige o companion "Outro" quando o enum escolhido é OUTRO.
function validarCategoria(
  formData: FormData
):
  | { ok: true; categoria: CategoriaFornecedor | null; categoriaOutro: string | null }
  | { ok: false; mensagem: string } {
  const valor = String(formData.get("categoria") ?? "");
  if (!valor) {
    return { ok: true, categoria: null, categoriaOutro: null };
  }
  if (!ORDEM_CATEGORIA_FORNECEDOR.includes(valor as CategoriaFornecedor)) {
    return { ok: false, mensagem: "Selecione uma categoria de fornecedor válida." };
  }
  if (valor === "OUTRO") {
    const categoriaOutro = String(formData.get("categoriaOutro") ?? "").trim();
    if (!categoriaOutro) {
      return { ok: false, mensagem: 'Descreva a categoria quando escolher "Outro".' };
    }
    return { ok: true, categoria: "OUTRO", categoriaOutro };
  }
  return { ok: true, categoria: valor as CategoriaFornecedor, categoriaOutro: null };
}

function validarCondicaoPagamento(
  formData: FormData
):
  | {
      ok: true;
      condicaoPagamentoPadrao: CondicaoPagamentoFornecedor | null;
      condicaoPagamentoPadraoOutro: string | null;
    }
  | { ok: false; mensagem: string } {
  const valor = String(formData.get("condicaoPagamentoPadrao") ?? "");
  if (!valor) {
    return { ok: true, condicaoPagamentoPadrao: null, condicaoPagamentoPadraoOutro: null };
  }
  if (!ORDEM_CONDICAO_PAGAMENTO_FORNECEDOR.includes(valor as CondicaoPagamentoFornecedor)) {
    return { ok: false, mensagem: "Selecione uma condição de pagamento válida." };
  }
  if (valor === "OUTRO") {
    const condicaoPagamentoPadraoOutro = String(formData.get("condicaoPagamentoPadraoOutro") ?? "").trim();
    if (!condicaoPagamentoPadraoOutro) {
      return { ok: false, mensagem: 'Descreva a condição de pagamento quando escolher "Outro".' };
    }
    return { ok: true, condicaoPagamentoPadrao: "OUTRO", condicaoPagamentoPadraoOutro };
  }
  return {
    ok: true,
    condicaoPagamentoPadrao: valor as CondicaoPagamentoFornecedor,
    condicaoPagamentoPadraoOutro: null,
  };
}

// Número inteiro opcional (prazo de entrega em dias) — "" vira null,
// qualquer outro valor não-inteiro/negativo é rejeitado.
function validarPrazoEntregaMedioDias(
  formData: FormData
): { ok: true; valor: number | null } | { ok: false; mensagem: string } {
  const bruto = String(formData.get("prazoEntregaMedioDias") ?? "").trim();
  if (!bruto) return { ok: true, valor: null };
  const numero = Number(bruto);
  if (!Number.isInteger(numero) || numero < 0) {
    return { ok: false, mensagem: "Prazo de entrega médio precisa ser um número inteiro de dias." };
  }
  return { ok: true, valor: numero };
}

// Decimal opcional (pedido mínimo em R$) — "" vira null, negativo é
// rejeitado. Mesmo tratamento textual (sem paraDecimal) que o resto deste
// cadastro simples usa pros outros campos numéricos.
function validarPedidoMinimoValor(
  formData: FormData
): { ok: true; valor: string | null } | { ok: false; mensagem: string } {
  const bruto = String(formData.get("pedidoMinimoValor") ?? "").trim();
  if (!bruto) return { ok: true, valor: null };
  const numero = Number(bruto);
  if (!Number.isFinite(numero) || numero < 0) {
    return { ok: false, mensagem: "Pedido mínimo precisa ser um valor válido." };
  }
  return { ok: true, valor: numero.toFixed(2) };
}

// Cria um novo fornecedor pra gráfica — cadastro deliberadamente pequeno
// (só "quem vendeu este material"), sem workflow de cotação/aprovação de
// compra (ver comentário do model Fornecedor no schema).
export async function criarFornecedor(
  _estadoAnterior: SalvarFornecedorResult | null,
  formData: FormData
): Promise<SalvarFornecedorResult> {
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
  const contato = String(formData.get("contato") ?? "").trim();

  const validacaoCategoria = validarCategoria(formData);
  if (!validacaoCategoria.ok) {
    return validacaoCategoria;
  }
  const validacaoCondicao = validarCondicaoPagamento(formData);
  if (!validacaoCondicao.ok) {
    return validacaoCondicao;
  }
  const validacaoPrazo = validarPrazoEntregaMedioDias(formData);
  if (!validacaoPrazo.ok) {
    return validacaoPrazo;
  }
  const validacaoPedidoMinimo = validarPedidoMinimoValor(formData);
  if (!validacaoPedidoMinimo.ok) {
    return validacaoPedidoMinimo;
  }
  const email = campoTextoOuNull(formData, "email");
  const telefone = campoTextoOuNull(formData, "telefone");

  let novoFornecedor: { id: string };
  try {
    novoFornecedor = await prisma.fornecedor.create({
      data: {
        graficaId: usuario.graficaId,
        nome,
        contato: contato || null,
        email,
        telefone,
        categoria: validacaoCategoria.categoria,
        categoriaOutro: validacaoCategoria.categoriaOutro,
        condicaoPagamentoPadrao: validacaoCondicao.condicaoPagamentoPadrao,
        condicaoPagamentoPadraoOutro: validacaoCondicao.condicaoPagamentoPadraoOutro,
        prazoEntregaMedioDias: validacaoPrazo.valor,
        pedidoMinimoValor: validacaoPedidoMinimo.valor,
      },
    });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      // Achado A5 — agora existem 2 constraints únicas (graficaId+nome,
      // graficaId+documento): distingue pelos campos da constraint violada
      // (camposDaViolacaoDeUnicidade, src/lib/prisma-conflito.ts — NUNCA
      // `erro.meta?.target` puro, esse campo não existe com
      // @prisma/adapter-pg, ver comentário lá).
      if (camposDaViolacaoDeUnicidade(erro).includes("documento")) {
        return { ok: false, mensagem: MENSAGEM_DOCUMENTO_DUPLICADO };
      }
      return { ok: false, mensagem: MENSAGEM_NOME_DUPLICADO };
    }
    throw erro;
  }

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "configuracoes.criar_fornecedor",
    entidade: "Fornecedor",
    entidadeId: novoFornecedor.id,
    descricao: `Fornecedor "${nome}" criado`,
  });

  revalidatePath("/configuracoes/fornecedores");
  redirect(`/configuracoes/fornecedores/${novoFornecedor.id}`);
}

// Achado R3 da auditoria de abrangência (rodada 20, 2026-09-03) — campos
// opcionais de documento/endereço, necessários pra usar este fornecedor
// como destinatário de uma NF-e de remessa de terceirização (ver
// fornecedorProntoParaNfe em src/lib/nota-fiscal.ts). Lidos aqui com o
// mesmo helper "presente e vazio = limpar" que o resto do formulário usa
// implicitamente (string vazia -> null), nunca "ausente = não mexer" (este
// formulário sempre reenvia todos os campos, diferente de uma transição
// parcial).
function campoTextoOuNull(formData: FormData, nome: string): string | null {
  const valor = String(formData.get(nome) ?? "").trim();
  return valor || null;
}

// Edita nome/contato/dados fiscais de um fornecedor já existente — nunca
// mexe em `ativo`, ver alternarAtivoFornecedor pra isso.
export async function editarFornecedor(
  _estadoAnterior: SalvarFornecedorResult | null,
  formData: FormData
): Promise<SalvarFornecedorResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const fornecedorId = String(formData.get("fornecedorId"));
  const fornecedor = await prisma.fornecedor.findFirst({
    where: { id: fornecedorId, graficaId: usuario.graficaId },
  });
  if (!fornecedor) {
    return { ok: false, mensagem: "Fornecedor não encontrado." };
  }

  const nome = String(formData.get("nome") ?? "").trim();
  if (!nome) {
    return { ok: false, mensagem: MENSAGEM_NOME_VAZIO };
  }
  const contato = String(formData.get("contato") ?? "").trim();
  const documento = campoTextoOuNull(formData, "documento");
  const enderecoLogradouro = campoTextoOuNull(formData, "enderecoLogradouro");
  const enderecoNumero = campoTextoOuNull(formData, "enderecoNumero");
  const enderecoBairro = campoTextoOuNull(formData, "enderecoBairro");
  const enderecoMunicipio = campoTextoOuNull(formData, "enderecoMunicipio");
  const enderecoUf = campoTextoOuNull(formData, "enderecoUf")?.toUpperCase().slice(0, 2) ?? null;
  const enderecoCep = campoTextoOuNull(formData, "enderecoCep");

  const validacaoCategoria = validarCategoria(formData);
  if (!validacaoCategoria.ok) {
    return validacaoCategoria;
  }
  const validacaoCondicao = validarCondicaoPagamento(formData);
  if (!validacaoCondicao.ok) {
    return validacaoCondicao;
  }
  const validacaoPrazo = validarPrazoEntregaMedioDias(formData);
  if (!validacaoPrazo.ok) {
    return validacaoPrazo;
  }
  const validacaoPedidoMinimo = validarPedidoMinimoValor(formData);
  if (!validacaoPedidoMinimo.ok) {
    return validacaoPedidoMinimo;
  }
  const email = campoTextoOuNull(formData, "email");
  const telefone = campoTextoOuNull(formData, "telefone");

  try {
    await prisma.fornecedor.update({
      where: { id: fornecedorId },
      data: {
        nome,
        contato: contato || null,
        documento,
        enderecoLogradouro,
        enderecoNumero,
        enderecoBairro,
        enderecoMunicipio,
        enderecoUf,
        enderecoCep,
        email,
        telefone,
        categoria: validacaoCategoria.categoria,
        categoriaOutro: validacaoCategoria.categoriaOutro,
        condicaoPagamentoPadrao: validacaoCondicao.condicaoPagamentoPadrao,
        condicaoPagamentoPadraoOutro: validacaoCondicao.condicaoPagamentoPadraoOutro,
        prazoEntregaMedioDias: validacaoPrazo.valor,
        pedidoMinimoValor: validacaoPedidoMinimo.valor,
      },
    });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      // Achado A5 — agora existem 2 constraints únicas (graficaId+nome,
      // graficaId+documento): distingue pelos campos da constraint violada
      // (camposDaViolacaoDeUnicidade, src/lib/prisma-conflito.ts — NUNCA
      // `erro.meta?.target` puro, esse campo não existe com
      // @prisma/adapter-pg, ver comentário lá).
      if (camposDaViolacaoDeUnicidade(erro).includes("documento")) {
        return { ok: false, mensagem: MENSAGEM_DOCUMENTO_DUPLICADO };
      }
      return { ok: false, mensagem: MENSAGEM_NOME_DUPLICADO };
    }
    throw erro;
  }

  const diff = criarDiffCampos();
  diff.campo("Nome", fornecedor.nome, nome);
  diff.campo("Contato", fornecedor.contato, contato || null);
  diff.campo("E-mail", fornecedor.email, email);
  diff.campo("Telefone", fornecedor.telefone, telefone);
  diff.campo(
    "Categoria",
    rotuloCategoriaFornecedor(fornecedor.categoria, fornecedor.categoriaOutro),
    rotuloCategoriaFornecedor(validacaoCategoria.categoria, validacaoCategoria.categoriaOutro)
  );
  diff.campo(
    "Condição de pagamento",
    rotuloCondicaoPagamentoFornecedor(
      fornecedor.condicaoPagamentoPadrao,
      fornecedor.condicaoPagamentoPadraoOutro
    ),
    rotuloCondicaoPagamentoFornecedor(
      validacaoCondicao.condicaoPagamentoPadrao,
      validacaoCondicao.condicaoPagamentoPadraoOutro
    )
  );
  diff.campo(
    "Prazo de entrega médio (dias)",
    fornecedor.prazoEntregaMedioDias,
    validacaoPrazo.valor
  );
  diff.campo(
    "Pedido mínimo (R$)",
    fornecedor.pedidoMinimoValor?.toString() ?? null,
    validacaoPedidoMinimo.valor
  );
  if (diff.temMudanca) {
    await registrarAuditoria({
      graficaId: usuario.graficaId,
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "configuracoes.editar_fornecedor",
      entidade: "Fornecedor",
      entidadeId: fornecedorId,
      descricao: `Fornecedor "${fornecedor.nome}" atualizado`,
      valorAnterior: diff.antesTextos.join("; "),
      valorNovo: diff.depoisTextos.join("; "),
    });
  }

  revalidatePath(`/configuracoes/fornecedores/${fornecedorId}`);
  revalidatePath("/configuracoes/fornecedores");
  return { ok: true, mensagem: "Fornecedor atualizado com sucesso!" };
}

// Alterna ativo/inativo — é o equivalente de "remover" desta tela. NUNCA um
// delete físico: MovimentacaoEstoque.fornecedorId é onDelete SetNull no
// schema, então mesmo apagando de verdade o histórico de compra continuaria
// íntegro (só perderia o nome do fornecedor) — mas o princípio aqui é o
// mesmo de CategoriaCusto.ativa: um fornecedor referenciado em histórico de
// compra não some, só sai da lista de seleção pra novas compras.
export async function alternarAtivoFornecedor(
  _estadoAnterior: SalvarFornecedorResult | null,
  formData: FormData
): Promise<SalvarFornecedorResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const fornecedorId = String(formData.get("fornecedorId"));
  const fornecedor = await prisma.fornecedor.findFirst({
    where: { id: fornecedorId, graficaId: usuario.graficaId },
  });
  if (!fornecedor) {
    return { ok: false, mensagem: "Fornecedor não encontrado." };
  }

  await prisma.fornecedor.update({
    where: { id: fornecedorId },
    data: { ativo: !fornecedor.ativo },
  });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: fornecedor.ativo ? "configuracoes.desativar_fornecedor" : "configuracoes.ativar_fornecedor",
    entidade: "Fornecedor",
    entidadeId: fornecedorId,
    descricao: `Fornecedor "${fornecedor.nome}" ${fornecedor.ativo ? "desativado" : "ativado"}`,
  });

  revalidatePath(`/configuracoes/fornecedores/${fornecedorId}`);
  revalidatePath("/configuracoes/fornecedores");
  return {
    ok: true,
    mensagem: fornecedor.ativo ? "Fornecedor desativado." : "Fornecedor ativado.",
  };
}
