"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { clienteSchema } from "@/lib/clientes";
import { ehViolacaoDeChaveEstrangeira } from "@/lib/prisma-conflito";
import { registrarAuditoria } from "@/lib/auditoria";
import { ORDEM_ORIGEM_CLIENTE, ORDEM_SEGMENTO_CLIENTE } from "@/lib/tipos-cliente";
import type { OrigemCliente, SegmentoCliente } from "@/generated/prisma/enums";

// Mesmo padrão do resto do schema (UnidadeMedida, CategoriaEquipamento etc.):
// origem vem de uma lista fechada com OUTRO de escape — origemOutro só é
// obrigatório nesse caso, nunca trava um cliente real fora da lista. Campo
// em si é opcional (formulário sem seleção -> undefined -> null no banco),
// mesmo padrão de validarCategoria em
// configuracoes/maquinas/equipamentos/actions.ts.
function validarOrigem(
  formData: FormData
): { ok: true; origem: OrigemCliente | null; origemOutro: string | null } | { ok: false; mensagem: string } {
  const origem = String(formData.get("origem") ?? "").trim();
  if (!origem) {
    return { ok: true, origem: null, origemOutro: null };
  }
  if (!ORDEM_ORIGEM_CLIENTE.includes(origem as OrigemCliente)) {
    return { ok: false, mensagem: "Origem do cliente inválida." };
  }
  if (origem === "OUTRO") {
    const origemOutro = String(formData.get("origemOutro") ?? "").trim();
    if (!origemOutro) {
      return { ok: false, mensagem: 'Descreva a origem quando escolher "Outro".' };
    }
    return { ok: true, origem: "OUTRO", origemOutro };
  }
  return { ok: true, origem: origem as OrigemCliente, origemOutro: null };
}

// Achado A7 da auditoria de abrangência — mesmo padrão de validarOrigem
// acima, lista fechada com OUTRO de escape, segmentoOutro só obrigatório
// nesse caso, campo em si opcional.
function validarSegmento(
  formData: FormData
): { ok: true; segmento: SegmentoCliente | null; segmentoOutro: string | null } | { ok: false; mensagem: string } {
  const segmento = String(formData.get("segmento") ?? "").trim();
  if (!segmento) {
    return { ok: true, segmento: null, segmentoOutro: null };
  }
  if (!ORDEM_SEGMENTO_CLIENTE.includes(segmento as SegmentoCliente)) {
    return { ok: false, mensagem: "Segmento de cliente inválido." };
  }
  if (segmento === "OUTRO") {
    const segmentoOutro = String(formData.get("segmentoOutro") ?? "").trim();
    if (!segmentoOutro) {
      return { ok: false, mensagem: 'Descreva o segmento quando escolher "Outro".' };
    }
    return { ok: true, segmento: "OUTRO", segmentoOutro };
  }
  return { ok: true, segmento: segmento as SegmentoCliente, segmentoOutro: null };
}

// Achado A7 — sobrescreve ParametrosGrafica.margemPadrao só pra este
// cliente. Mesmo formato de ParametrosGrafica.margemPadrao (fração 0-1,
// nunca 0-100) e mesma guarda de presença-antes-de-Number() de
// salvarParametros (src/app/configuracoes/actions.ts): campo em branco vira
// null (sem override, comportamento de hoje), mas um valor presente e
// inválido (negativo, não numérico) é rejeitado em vez de gravado como 0
// silenciosamente.
function validarMargemPadraoOverride(
  formData: FormData
): { ok: true; valor: number | null } | { ok: false; mensagem: string } {
  const bruto = formData.get("margemPadraoOverride");
  if (typeof bruto !== "string" || bruto.trim() === "") {
    return { ok: true, valor: null };
  }
  const valor = Number(bruto);
  if (!Number.isFinite(valor) || valor < 0) {
    return { ok: false, mensagem: "Margem diferenciada inválida." };
  }
  return { ok: true, valor };
}

export type CriarClienteResult = { ok: boolean; mensagem: string };

export async function criarCliente(
  _estadoAnterior: CriarClienteResult | null,
  formData: FormData
): Promise<CriarClienteResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CLIENTES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar clientes." };
  }

  const parsed = clienteSchema.safeParse({
    nome: formData.get("nome"),
    email: formData.get("email"),
    telefone: formData.get("telefone"),
    documento: formData.get("documento"),
    enderecoCep: formData.get("enderecoCep"),
    enderecoLogradouro: formData.get("enderecoLogradouro"),
    enderecoNumero: formData.get("enderecoNumero"),
    enderecoComplemento: formData.get("enderecoComplemento"),
    enderecoBairro: formData.get("enderecoBairro"),
    enderecoMunicipio: formData.get("enderecoMunicipio"),
    enderecoCodigoIbge: formData.get("enderecoCodigoIbge"),
    enderecoUf: formData.get("enderecoUf"),
    observacoes: formData.get("observacoes"),
    preferenciasProducao: formData.get("preferenciasProducao"),
  });

  if (!parsed.success) {
    return { ok: false, mensagem: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const validacaoOrigem = validarOrigem(formData);
  if (!validacaoOrigem.ok) {
    return validacaoOrigem;
  }
  const validacaoSegmento = validarSegmento(formData);
  if (!validacaoSegmento.ok) {
    return validacaoSegmento;
  }
  const validacaoMargem = validarMargemPadraoOverride(formData);
  if (!validacaoMargem.ok) {
    return validacaoMargem;
  }

  const {
    nome,
    email,
    telefone,
    documento,
    enderecoCep,
    enderecoLogradouro,
    enderecoNumero,
    enderecoComplemento,
    enderecoBairro,
    enderecoMunicipio,
    enderecoCodigoIbge,
    enderecoUf,
    observacoes,
    preferenciasProducao,
  } = parsed.data;

  try {
    await prisma.cliente.create({
      data: {
        graficaId: usuario.graficaId,
        nome,
        email: email || null,
        telefone: telefone || null,
        documento: documento || null,
        enderecoCep: enderecoCep || null,
        enderecoLogradouro: enderecoLogradouro || null,
        enderecoNumero: enderecoNumero || null,
        enderecoComplemento: enderecoComplemento || null,
        enderecoBairro: enderecoBairro || null,
        enderecoMunicipio: enderecoMunicipio || null,
        enderecoCodigoIbge: enderecoCodigoIbge || null,
        enderecoUf: enderecoUf || null,
        observacoes: observacoes || null,
        preferenciasProducao: preferenciasProducao || null,
        origem: validacaoOrigem.origem,
        origemOutro: validacaoOrigem.origemOutro,
        segmento: validacaoSegmento.segmento,
        segmentoOutro: validacaoSegmento.segmentoOutro,
        margemPadraoOverride: validacaoMargem.valor,
      },
    });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      return { ok: false, mensagem: "Já existe um cliente cadastrado com esse CPF/CNPJ." };
    }
    throw erro;
  }

  revalidatePath("/clientes");
  revalidatePath("/orcamento");
  revalidatePath("/comecar");

  return { ok: true, mensagem: `Cliente "${nome}" cadastrado com sucesso!` };
}

export type AtualizarClienteResult = { ok: boolean; mensagem: string };

export async function atualizarCliente(
  _estadoAnterior: AtualizarClienteResult | null,
  formData: FormData
): Promise<AtualizarClienteResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CLIENTES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar clientes." };
  }
  const clienteId = String(formData.get("clienteId"));

  const cliente = await prisma.cliente.findFirst({
    where: { id: clienteId, graficaId: usuario.graficaId },
  });
  if (!cliente) {
    return { ok: false, mensagem: "Cliente não encontrado." };
  }

  const parsed = clienteSchema.safeParse({
    nome: formData.get("nome"),
    email: formData.get("email"),
    telefone: formData.get("telefone"),
    documento: formData.get("documento"),
    enderecoCep: formData.get("enderecoCep"),
    enderecoLogradouro: formData.get("enderecoLogradouro"),
    enderecoNumero: formData.get("enderecoNumero"),
    enderecoComplemento: formData.get("enderecoComplemento"),
    enderecoBairro: formData.get("enderecoBairro"),
    enderecoMunicipio: formData.get("enderecoMunicipio"),
    enderecoCodigoIbge: formData.get("enderecoCodigoIbge"),
    enderecoUf: formData.get("enderecoUf"),
    observacoes: formData.get("observacoes"),
    preferenciasProducao: formData.get("preferenciasProducao"),
  });

  if (!parsed.success) {
    return { ok: false, mensagem: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const validacaoOrigem = validarOrigem(formData);
  if (!validacaoOrigem.ok) {
    return validacaoOrigem;
  }
  const validacaoSegmento = validarSegmento(formData);
  if (!validacaoSegmento.ok) {
    return validacaoSegmento;
  }
  const validacaoMargem = validarMargemPadraoOverride(formData);
  if (!validacaoMargem.ok) {
    return validacaoMargem;
  }

  const {
    nome,
    email,
    telefone,
    documento,
    enderecoCep,
    enderecoLogradouro,
    enderecoNumero,
    enderecoComplemento,
    enderecoBairro,
    enderecoMunicipio,
    enderecoCodigoIbge,
    enderecoUf,
    observacoes,
    preferenciasProducao,
  } = parsed.data;

  // bloqueadoParaVenda/motivoBloqueio ficam fora do clienteSchema (zod)
  // de propósito: esse schema é reusado byte-a-byte pela importação de
  // planilha (src/lib/importacao/campos.ts), e esses dois campos são
  // conceito novo (bloqueio comercial), não dado de cadastro — não faz
  // sentido nem é seguro estender o schema compartilhado aqui.
  const bloqueadoParaVenda = formData.get("bloqueadoParaVenda") === "on";
  const motivoBloqueioRaw = String(formData.get("motivoBloqueio") ?? "").trim();
  const motivoBloqueio = bloqueadoParaVenda && motivoBloqueioRaw ? motivoBloqueioRaw.slice(0, 300) : null;

  try {
    await prisma.cliente.update({
      where: { id: clienteId },
      data: {
        nome,
        email: email || null,
        telefone: telefone || null,
        documento: documento || null,
        enderecoCep: enderecoCep || null,
        enderecoLogradouro: enderecoLogradouro || null,
        enderecoNumero: enderecoNumero || null,
        enderecoComplemento: enderecoComplemento || null,
        enderecoBairro: enderecoBairro || null,
        enderecoMunicipio: enderecoMunicipio || null,
        enderecoCodigoIbge: enderecoCodigoIbge || null,
        enderecoUf: enderecoUf || null,
        observacoes: observacoes || null,
        preferenciasProducao: preferenciasProducao || null,
        origem: validacaoOrigem.origem,
        origemOutro: validacaoOrigem.origemOutro,
        segmento: validacaoSegmento.segmento,
        segmentoOutro: validacaoSegmento.segmentoOutro,
        margemPadraoOverride: validacaoMargem.valor,
        bloqueadoParaVenda,
        motivoBloqueio,
      },
    });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      return { ok: false, mensagem: "Já existe um cliente cadastrado com esse CPF/CNPJ." };
    }
    throw erro;
  }

  revalidatePath("/clientes");
  revalidatePath(`/clientes/${clienteId}`);
  revalidatePath("/orcamento");

  return { ok: true, mensagem: "Cliente atualizado com sucesso!" };
}

export type ExcluirClienteResult = { ok: boolean; mensagem: string };

export async function excluirCliente(
  _estadoAnterior: ExcluirClienteResult | null,
  formData: FormData
): Promise<ExcluirClienteResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CLIENTES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar clientes." };
  }
  const clienteId = String(formData.get("clienteId"));

  const cliente = await prisma.cliente.findFirst({
    where: { id: clienteId, graficaId: usuario.graficaId },
  });
  if (!cliente) {
    return { ok: false, mensagem: "Cliente não encontrado." };
  }

  try {
    await prisma.cliente.delete({ where: { id: clienteId } });
  } catch (erro) {
    if (ehViolacaoDeChaveEstrangeira(erro)) {
      return {
        ok: false,
        mensagem:
          'Este cliente tem orçamentos vinculados e não pode ser excluído. Use "Desativar" pra tirá-lo das listas mantendo o histórico intacto, ou "Anonimizar dados" se for um pedido de exclusão de dado pessoal (LGPD).',
      };
    }
    throw erro;
  }

  revalidatePath("/clientes");
  redirect("/clientes");
}

export type DesativarClienteResult = { ok: boolean; mensagem: string };

// Alternativa a excluirCliente pro caso mais comum: cliente com orçamento
// vinculado (é justamente quem já comprou que mais importa manter no
// histórico). Soft delete — marca desativadoEm em vez de apagar. Cliente
// some das listas e dos dropdowns de seleção (orçamento, produção,
// relatórios — ver filtro desativadoEm: null nessas queries), mas
// Orcamento/NotaFiscal continuam intactos e consultáveis. Reversível via
// reativarCliente. Mesmo precedente de desativarUsuario (src/app/usuarios/actions.ts).
export async function desativarCliente(
  _estadoAnterior: DesativarClienteResult | null,
  formData: FormData
): Promise<DesativarClienteResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CLIENTES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar clientes." };
  }
  const clienteId = String(formData.get("clienteId"));

  const cliente = await prisma.cliente.findFirst({
    where: { id: clienteId, graficaId: usuario.graficaId },
  });
  if (!cliente) {
    return { ok: false, mensagem: "Cliente não encontrado." };
  }
  if (cliente.desativadoEm) {
    return { ok: false, mensagem: "Este cliente já está desativado." };
  }

  await prisma.cliente.update({
    where: { id: clienteId },
    data: { desativadoEm: new Date() },
  });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "cliente.desativar",
    entidade: "Cliente",
    entidadeId: cliente.id,
    descricao: `Cliente "${cliente.nome}" desativado`,
  });

  revalidatePath("/clientes");
  revalidatePath(`/clientes/${clienteId}`);
  return { ok: true, mensagem: `Cliente "${cliente.nome}" desativado com sucesso.` };
}

export type ReativarClienteResult = { ok: boolean; mensagem: string };

// Reverso de desativarCliente: volta desativadoEm pra null. O cliente volta
// a aparecer nas listas e dropdowns.
export async function reativarCliente(
  _estadoAnterior: ReativarClienteResult | null,
  formData: FormData
): Promise<ReativarClienteResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CLIENTES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar clientes." };
  }
  const clienteId = String(formData.get("clienteId"));

  const cliente = await prisma.cliente.findFirst({
    where: { id: clienteId, graficaId: usuario.graficaId },
  });
  if (!cliente) {
    return { ok: false, mensagem: "Cliente não encontrado." };
  }
  if (!cliente.desativadoEm) {
    return { ok: false, mensagem: "Este cliente já está ativo." };
  }

  await prisma.cliente.update({
    where: { id: clienteId },
    data: { desativadoEm: null },
  });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "cliente.reativar",
    entidade: "Cliente",
    entidadeId: cliente.id,
    descricao: `Cliente "${cliente.nome}" reativado`,
  });

  revalidatePath("/clientes");
  revalidatePath(`/clientes/${clienteId}`);
  return { ok: true, mensagem: `Cliente "${cliente.nome}" reativado com sucesso.` };
}

export type AnonimizarClienteResult = { ok: boolean; mensagem: string };

// Caminho LGPD no lugar de "fale com o suporte": atende o direito de
// eliminação do titular sem violar a obrigação fiscal de retenção —
// Orcamento e NotaFiscal NUNCA são apagados ou desvinculados, só os dados
// de identificação/contato do Cliente em si são sobrescritos por
// marcadores. Também marca desativadoEm (some das listas). Ao contrário de
// desativarCliente, esta ação NÃO é reversível — o dado pessoal em si é
// destruído, não só escondido. Registrado em LogAuditoria (quem pediu, quem
// executou, quando), que é exatamente o rastro que esse tipo de ação exige.
export async function anonimizarCliente(
  _estadoAnterior: AnonimizarClienteResult | null,
  formData: FormData
): Promise<AnonimizarClienteResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CLIENTES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar clientes." };
  }
  const clienteId = String(formData.get("clienteId"));

  const cliente = await prisma.cliente.findFirst({
    where: { id: clienteId, graficaId: usuario.graficaId },
  });
  if (!cliente) {
    return { ok: false, mensagem: "Cliente não encontrado." };
  }

  const nomeOriginal = cliente.nome;

  await prisma.cliente.update({
    where: { id: clienteId },
    data: {
      nome: "Cliente removido",
      email: null,
      telefone: null,
      // documento fica null — NULL não colide com NULL no unique index
      // [graficaId, documento] (ver comentário no schema), então vários
      // clientes anonimizados da mesma gráfica convivem sem problema.
      documento: null,
      enderecoCep: null,
      enderecoLogradouro: null,
      enderecoNumero: null,
      enderecoComplemento: null,
      enderecoBairro: null,
      enderecoMunicipio: null,
      enderecoCodigoIbge: null,
      enderecoUf: null,
      desativadoEm: cliente.desativadoEm ?? new Date(),
    },
  });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "cliente.anonimizar",
    entidade: "Cliente",
    entidadeId: cliente.id,
    descricao: `Dados pessoais de "${nomeOriginal}" anonimizados a pedido do titular (LGPD). Orçamentos e notas fiscais vinculados foram preservados (obrigação de retenção fiscal).`,
  });

  revalidatePath("/clientes");
  revalidatePath(`/clientes/${clienteId}`);
  return {
    ok: true,
    mensagem: "Dados pessoais anonimizados com sucesso. Orçamentos e notas fiscais foram preservados.",
  };
}
