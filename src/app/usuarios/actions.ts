"use server";

import { z } from "zod";
import { revalidatePath, updateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { exigirPapel, podeEditarModulo, MODULOS_PERMISSAO } from "@/lib/auth/permissoes";
import { senhaSchema } from "@/lib/auth/validation";
import { hashPassword } from "@/lib/auth/password";
import { resolverEtapasGrafica } from "@/lib/etapa-grafica";
import { AREAS_ADMINISTRATIVAS, ROTULO_AREA_ADMINISTRATIVA } from "@/lib/areas-administrativas";
import { ORDEM_TIPO_CHAVE_PIX } from "@/lib/tipos-grafica";
import { registrarAuditoria } from "@/lib/auditoria";
import type { AreaAdministrativa, TipoChavePix } from "@/generated/prisma/enums";

const ROTULO_PAPEL: Record<"ADMIN" | "OPERADOR", string> = {
  ADMIN: "Admin",
  OPERADOR: "Operador",
};

export type CriarUsuarioResult = { ok: boolean; mensagem: string };

const criarUsuarioSchema = z.object({
  nome: z.string().trim().min(2, "Nome muito curto").max(120),
  email: z.string().trim().toLowerCase().email("E-mail inválido"),
  senha: senhaSchema,
  papel: z.enum(["ADMIN", "OPERADOR"]),
});

export async function criarUsuario(
  _estadoAnterior: CriarUsuarioResult | null,
  formData: FormData
): Promise<CriarUsuarioResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  exigirPapel(usuario, ["DONO"]);

  const parsed = criarUsuarioSchema.safeParse({
    nome: formData.get("nome"),
    email: formData.get("email"),
    senha: formData.get("senha"),
    papel: formData.get("papel"),
  });

  if (!parsed.success) {
    return { ok: false, mensagem: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const { nome, email, senha, papel } = parsed.data;

  // Usuario.email é único globalmente no schema (não só por gráfica).
  const emailExistente = await prisma.usuario.findUnique({ where: { email } });
  if (emailExistente) {
    return { ok: false, mensagem: "Este e-mail já está cadastrado em alguma gráfica." };
  }

  const senhaHash = await hashPassword(senha);

  // Feature "multi-cargo" (2026-09-06) — cargos escolhidos na hora da
  // criação (checkbox múltiplo em UsuarioForm.tsx), pra não exigir um passo
  // separado depois em PerfilAcessoCell. Nunca confia nos ids crus do form —
  // revalida cada um contra a MESMA gráfica (mesmo cuidado de
  // condicaoPagamentoId/transportadoraId em actions/cabecalho.ts). Só tem
  // efeito de verdade pra papel OPERADOR (ver resolverPermissaoOperador) —
  // marcar um cargo pra ADMIN/DONO não quebra nada, só fica sem uso.
  const idsCargosBrutos = [...new Set(formData.getAll("perfilAcessoId").map((v) => String(v)))];
  const cargosValidos =
    idsCargosBrutos.length > 0
      ? await prisma.perfilAcesso.findMany({
          where: { id: { in: idsCargosBrutos }, graficaId: usuario.graficaId },
          select: { id: true },
        })
      : [];

  const novoUsuario = await prisma.$transaction(async (tx) => {
    const criado = await tx.usuario.create({
      data: {
        graficaId: usuario.graficaId,
        nome,
        email,
        senhaHash,
        papel,
        // Convite de colega por um DONO já verificado — confiança transitiva,
        // nunca fica pendente em /verificar-email (diferente do cadastro
        // self-service em /registro).
        emailVerificadoEm: new Date(),
      },
    });
    if (cargosValidos.length > 0) {
      await tx.perfilUsuario.createMany({
        data: cargosValidos.map((c) => ({ usuarioId: criado.id, perfilAcessoId: c.id })),
      });
    }
    return criado;
  });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "usuario.criar",
    entidade: "Usuario",
    entidadeId: novoUsuario.id,
    descricao: `Usuário "${nome}" (${email}) criado com papel ${ROTULO_PAPEL[papel]}`,
  });

  updateTag(`uso-${usuario.graficaId}`); // usuário novo muda a contagem de seats (ver src/lib/billing/uso.ts)
  revalidatePath("/usuarios");
  return { ok: true, mensagem: `Usuário "${nome}" criado com sucesso!` };
}

export type SalvarAcessoMeuNegocioResult = { ok: boolean; mensagem: string };

// Dois níveis salvos juntos: o switch geral da gráfica (Grafica.compartilharMeuNegocio)
// e a concessão individual por funcionário (Usuario.acessoMeuNegocio) — ver
// podeVerMeuNegocio em lib/auth/permissoes.ts para a regra de combinação dos dois.
// Igual a salvarCatalogo: checkbox ausente no FormData = desmarcado.
export async function salvarAcessoMeuNegocio(
  _estadoAnterior: SalvarAcessoMeuNegocioResult | null,
  formData: FormData
): Promise<SalvarAcessoMeuNegocioResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  exigirPapel(usuario, ["DONO"]);

  const compartilhar = formData.get("compartilhar") === "on";

  const graficaAntes = await prisma.grafica.findUnique({
    where: { id: usuario.graficaId },
    select: { compartilharMeuNegocio: true },
  });
  // desativadoEm: null — funcionário removido não entra no fetch nem no
  // formData enviado pelo form (não aparece mais na tela), então sem esse
  // filtro a linha dele nem seria incluída na transação abaixo mas TAMBÉM
  // não teria `acesso_${f.id}` no formData, o que zeraria o acesso dele
  // silenciosamente a cada salvamento — mantém o valor como estava.
  const funcionarios = await prisma.usuario.findMany({
    where: { graficaId: usuario.graficaId, papel: { not: "DONO" }, desativadoEm: null },
    select: { id: true, nome: true, acessoMeuNegocio: true },
  });
  const novoAcessoPorId = new Map(
    funcionarios.map((f) => [f.id, formData.get(`acesso_${f.id}`) === "on"])
  );

  await prisma.$transaction([
    prisma.grafica.update({
      where: { id: usuario.graficaId },
      data: { compartilharMeuNegocio: compartilhar },
    }),
    ...funcionarios.map((f) =>
      prisma.usuario.update({
        where: { id: f.id },
        data: { acessoMeuNegocio: novoAcessoPorId.get(f.id) ?? false },
      })
    ),
  ]);

  // Quem ganhou/perdeu acesso individual é o que importa pra investigar
  // depois "por que o Fulano conseguia ver o Meu Negócio" — reportar o
  // switch geral sozinho não respondia isso.
  const concedidoA = funcionarios
    .filter((f) => !f.acessoMeuNegocio && novoAcessoPorId.get(f.id))
    .map((f) => f.nome);
  const revogadoDe = funcionarios
    .filter((f) => f.acessoMeuNegocio && !novoAcessoPorId.get(f.id))
    .map((f) => f.nome);
  const switchMudou = (graficaAntes?.compartilharMeuNegocio ?? false) !== compartilhar;

  if (switchMudou || concedidoA.length > 0 || revogadoDe.length > 0) {
    const partes: string[] = [];
    if (concedidoA.length > 0) partes.push(`acesso concedido a ${concedidoA.join(", ")}`);
    if (revogadoDe.length > 0) partes.push(`acesso revogado de ${revogadoDe.join(", ")}`);

    await registrarAuditoria({
      graficaId: usuario.graficaId,
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "usuario.acesso_meu_negocio",
      entidade: "Grafica",
      entidadeId: usuario.graficaId,
      descricao:
        partes.length > 0
          ? `Acesso ao Meu Negócio atualizado — ${partes.join("; ")}`
          : "Acesso ao Meu Negócio atualizado",
      valorAnterior: switchMudou
        ? `compartilhar: ${graficaAntes?.compartilharMeuNegocio ? "sim" : "não"}`
        : undefined,
      valorNovo: switchMudou ? `compartilhar: ${compartilhar ? "sim" : "não"}` : undefined,
    });
  }

  revalidatePath("/usuarios");
  revalidatePath("/meu-negocio");

  return { ok: true, mensagem: "Acesso atualizado com sucesso!" };
}

export type SalvarPermissoesResult = { ok: boolean; mensagem: string };

// Só se aplica a usuário com papel OPERADOR — DONO e ADMIN têm acesso total
// automático (ver podeVerModulo/podeEditarModulo), essa tela nem é acessível
// pros dois. Upsert de uma linha por módulo: "podeVer" desmarcado também
// desmarca "podeEditar" (não faz sentido editar o que não pode nem ver).
export async function salvarPermissoes(
  _estadoAnterior: SalvarPermissoesResult | null,
  formData: FormData
): Promise<SalvarPermissoesResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  exigirPapel(usuario, ["DONO"]);

  const usuarioAlvoId = String(formData.get("usuarioId"));
  const alvo = await prisma.usuario.findFirst({
    where: { id: usuarioAlvoId, graficaId: usuario.graficaId, papel: "OPERADOR" },
  });
  if (!alvo) {
    return { ok: false, mensagem: "Usuário não encontrado (ou não é Operador)." };
  }

  const permissoesAntes = await prisma.permissaoUsuario.findMany({
    where: { usuarioId: usuarioAlvoId },
  });
  const antesPorModulo = new Map(permissoesAntes.map((p) => [p.modulo, p]));

  // O antes/depois é o que importa aqui — "quem ganhou o quê" (ver missão) —
  // por isso o diff é montado módulo a módulo ANTES da transação gravar, só
  // incluindo no log os módulos que realmente mudaram.
  const antesTextos: string[] = [];
  const depoisTextos: string[] = [];
  const operacoes = MODULOS_PERMISSAO.map(({ valor, rotulo }) => {
    const podeVer = formData.get(`ver_${valor}`) === "on";
    const podeEditar = podeVer && formData.get(`editar_${valor}`) === "on";
    const atual = antesPorModulo.get(valor);
    const verAntes = atual?.podeVer ?? false;
    const editarAntes = atual?.podeEditar ?? false;
    if (verAntes !== podeVer || editarAntes !== podeEditar) {
      antesTextos.push(`${rotulo} (ver: ${verAntes ? "sim" : "não"}, editar: ${editarAntes ? "sim" : "não"})`);
      depoisTextos.push(`${rotulo} (ver: ${podeVer ? "sim" : "não"}, editar: ${podeEditar ? "sim" : "não"})`);
    }
    return prisma.permissaoUsuario.upsert({
      where: { usuarioId_modulo: { usuarioId: usuarioAlvoId, modulo: valor } },
      create: { usuarioId: usuarioAlvoId, modulo: valor, podeVer, podeEditar },
      update: { podeVer, podeEditar },
    });
  });

  await prisma.$transaction(operacoes);

  if (antesTextos.length > 0) {
    await registrarAuditoria({
      graficaId: usuario.graficaId,
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "usuario.salvar_permissoes",
      entidade: "Usuario",
      entidadeId: usuarioAlvoId,
      descricao: `Permissões de "${alvo.nome}" atualizadas`,
      valorAnterior: antesTextos.join("; "),
      valorNovo: depoisTextos.join("; "),
    });
  }

  revalidatePath(`/usuarios/${usuarioAlvoId}/permissoes`);
  revalidatePath("/usuarios");

  return { ok: true, mensagem: `Permissões de "${alvo.nome}" atualizadas com sucesso!` };
}

export type SalvarPerfilUsuarioResult = { ok: boolean; mensagem: string };

// Achado A5 da auditoria de abrangência (Parte 6/Configurações,
// pesquisa-abrangencia-modulos.md, 2026-08-27) — atribui/troca os cargos
// (PerfilAcesso) de UM usuário por vez (ver PerfilAcessoCell, auto-salva no
// onChange de cada checkbox). Feature "multi-cargo" (2026-09-06): passou de
// "trocar 1 valor" pra "substituir o conjunto inteiro" — apaga os que
// saíram e insere os que entraram, numa transação (nunca um DELETE-then-
// INSERT visível como dois estados intermediários). Só se aplica a OPERADOR
// (mesma restrição de PermissaoUsuario em toda a resolução de permissão) —
// DONO/ADMIN não têm os checkboxes renderizados na tela, mas o servidor não
// confia nisso: rejeita explicitamente se o alvo não for OPERADOR, mesmo que
// o form seja adulterado.
export async function salvarPerfilUsuario(
  _estadoAnterior: SalvarPerfilUsuarioResult | null,
  formData: FormData
): Promise<SalvarPerfilUsuarioResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  exigirPapel(usuario, ["DONO"]);

  const usuarioAlvoId = String(formData.get("usuarioId") ?? "");
  const alvo = await prisma.usuario.findFirst({
    where: { id: usuarioAlvoId, graficaId: usuario.graficaId, papel: "OPERADOR" },
  });
  if (!alvo) {
    return { ok: false, mensagem: "Usuário não encontrado (ou não é Operador)." };
  }

  // Nunca confia nos ids crus do form — revalida cada um contra a MESMA
  // gráfica (mesmo cuidado de condicaoPagamentoId/transportadoraId em
  // actions/cabecalho.ts). Um id que não pertence a esta gráfica (só pode
  // vir de um POST forjado, o checkbox real só lista perfis desta gráfica)
  // é silenciosamente ignorado em vez de rejeitar a submissão inteira.
  const idsBrutos = [...new Set(formData.getAll("perfilAcessoId").map((v) => String(v)))];
  const perfisNovos =
    idsBrutos.length > 0
      ? await prisma.perfilAcesso.findMany({
          where: { id: { in: idsBrutos }, graficaId: usuario.graficaId },
          select: { id: true, nome: true },
        })
      : [];

  const perfisAntes = await prisma.perfilUsuario.findMany({
    where: { usuarioId: alvo.id },
    select: { perfilAcesso: { select: { nome: true } } },
  });
  const nomesAntes = perfisAntes.map((p) => p.perfilAcesso.nome).sort();
  const nomesDepois = perfisNovos.map((p) => p.nome).sort();

  await prisma.$transaction([
    prisma.perfilUsuario.deleteMany({ where: { usuarioId: alvo.id } }),
    ...(perfisNovos.length > 0
      ? [
          prisma.perfilUsuario.createMany({
            data: perfisNovos.map((p) => ({ usuarioId: alvo.id, perfilAcessoId: p.id })),
          }),
        ]
      : []),
  ]);

  const mudou = nomesAntes.join("||") !== nomesDepois.join("||");
  if (mudou) {
    await registrarAuditoria({
      graficaId: usuario.graficaId,
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "usuario.salvar_perfil_acesso",
      entidade: "Usuario",
      entidadeId: alvo.id,
      descricao: `Cargos de "${alvo.nome}" atualizados`,
      valorAnterior: nomesAntes.length > 0 ? nomesAntes.join(", ") : "Sem cargo",
      valorNovo: nomesDepois.length > 0 ? nomesDepois.join(", ") : "Sem cargo",
    });
  }

  revalidatePath("/usuarios");
  return { ok: true, mensagem: `Cargos de "${alvo.nome}" atualizados com sucesso!` };
}

export type SalvarComissaoResult = { ok: boolean; mensagem: string };

// Mesmo padrão de salvarAcessoMeuNegocio: um form só com todos os usuários,
// um campo `percentual_${id}` cada, salva tudo de uma vez. Taxa individual,
// independente de papel — DONO/ADMIN/OPERADOR podem todos vender. Campo
// vazio = null = não é vendedor, nunca gera Comissao (ver
// atualizarStatusOrcamento em src/app/orcamento/[id]/actions.ts).
export async function salvarComissaoUsuarios(
  _estadoAnterior: SalvarComissaoResult | null,
  formData: FormData
): Promise<SalvarComissaoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  exigirPapel(usuario, ["DONO"]);

  // desativadoEm: null — mesmo motivo de salvarAcessoMeuNegocio: sem o filtro,
  // um funcionário removido (que não aparece mais no form) teria a comissão
  // zerada a cada salvamento por falta do campo `percentual_${id}` no formData.
  const usuarios = await prisma.usuario.findMany({
    where: { graficaId: usuario.graficaId, desativadoEm: null },
    select: { id: true, nome: true, comissaoPercent: true },
  });

  const atualizacoes: { id: string; comissaoPercent: number | null }[] = [];
  for (const u of usuarios) {
    const bruto = formData.get(`percentual_${u.id}`);
    const texto = typeof bruto === "string" ? bruto.trim() : "";
    if (!texto) {
      atualizacoes.push({ id: u.id, comissaoPercent: null });
      continue;
    }
    const valor = Number(texto);
    if (!Number.isFinite(valor) || valor < 0 || valor > 1) {
      return { ok: false, mensagem: "Percentual de comissão inválido — use um valor entre 0 e 1 (ex: 0.05 = 5%)." };
    }
    atualizacoes.push({ id: u.id, comissaoPercent: valor });
  }

  await prisma.$transaction(
    atualizacoes.map((a) =>
      prisma.usuario.update({ where: { id: a.id }, data: { comissaoPercent: a.comissaoPercent } })
    )
  );

  // Muda quanto cada vendedor recebe em toda venda futura — só entra no log
  // quem de fato mudou, não a lista inteira de funcionários.
  const nomePorId = new Map(usuarios.map((u) => [u.id, u.nome]));
  const mudancas = atualizacoes
    .filter((a) => {
      const antes = usuarios.find((u) => u.id === a.id)?.comissaoPercent;
      const antesNum = antes ? Number(antes) : null;
      return antesNum !== a.comissaoPercent;
    })
    .map((a) => {
      const antes = usuarios.find((u) => u.id === a.id)?.comissaoPercent;
      const antesNum = antes ? Number(antes) : null;
      return `${nomePorId.get(a.id)}: ${antesNum === null ? "—" : `${(antesNum * 100).toFixed(1)}%`} → ${a.comissaoPercent === null ? "—" : `${(a.comissaoPercent * 100).toFixed(1)}%`}`;
    });

  if (mudancas.length > 0) {
    await registrarAuditoria({
      graficaId: usuario.graficaId,
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "usuario.salvar_comissao",
      entidade: "Grafica",
      entidadeId: usuario.graficaId,
      descricao: `Comissão por vendedor atualizada — ${mudancas.join(", ")}`,
    });
  }

  revalidatePath("/usuarios");

  return { ok: true, mensagem: "Comissão por vendedor atualizada com sucesso!" };
}

export type SalvarDadosPagamentoUsuariosResult = { ok: boolean; mensagem: string };

// Achado D3 da auditoria de abrangência (Parte 7/Pessoas,
// pesquisa-abrangencia-modulos.md, 2026-09-09) — pra onde a gráfica paga
// cada usuário (comissão de vendedor, freelancer). Mesmo padrão de
// formulário único de salvarComissaoUsuarios: um campo por usuário, tudo
// salvo de uma vez. SÓ EXIBIÇÃO: cpf/chavePix nunca são validados (mesmo
// raciocínio do comentário de Grafica.chavePix no schema) — texto livre,
// sem checar dígito verificador nem formato. Gated por FINANCEIRO (além do
// exigirPapel DONO que já protege toda a página /usuarios) — hoje é
// redundante na prática (DONO sempre passa em podeEditarModulo), mas é o
// mecanismo pedido pra este dado sensível, e protege se a página um dia
// abrir pra outros papéis.
export async function salvarDadosPagamentoUsuarios(
  _estadoAnterior: SalvarDadosPagamentoUsuariosResult | null,
  formData: FormData
): Promise<SalvarDadosPagamentoUsuariosResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  exigirPapel(usuario, ["DONO"]);
  if (!(await podeEditarModulo(usuario, "FINANCEIRO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar dados financeiros." };
  }

  // desativadoEm: null — mesmo motivo de salvarComissaoUsuarios: sem o
  // filtro, um funcionário removido (que não aparece mais no form) teria os
  // dados de pagamento apagados a cada salvamento por falta dos campos
  // `*_${id}` no formData.
  const usuarios = await prisma.usuario.findMany({
    where: { graficaId: usuario.graficaId, desativadoEm: null },
    select: { id: true, nome: true, cpf: true, chavePix: true, tipoChavePix: true, especialidade: true },
  });

  const atualizacoes: {
    id: string;
    cpf: string | null;
    chavePix: string | null;
    tipoChavePix: TipoChavePix | null;
    especialidade: string | null;
  }[] = [];

  for (const u of usuarios) {
    const cpf = String(formData.get(`cpf_${u.id}`) ?? "").trim() || null;
    const chavePix = String(formData.get(`chavePix_${u.id}`) ?? "").trim() || null;
    const tipoChavePixBruto = String(formData.get(`tipoChavePix_${u.id}`) ?? "").trim();
    const especialidade = String(formData.get(`especialidade_${u.id}`) ?? "").trim() || null;

    let tipoChavePix: TipoChavePix | null = null;
    if (tipoChavePixBruto) {
      if (!ORDEM_TIPO_CHAVE_PIX.includes(tipoChavePixBruto as TipoChavePix)) {
        return { ok: false, mensagem: `Tipo de chave PIX inválido para "${u.nome}".` };
      }
      tipoChavePix = tipoChavePixBruto as TipoChavePix;
    }

    atualizacoes.push({ id: u.id, cpf, chavePix, tipoChavePix, especialidade });
  }

  await prisma.$transaction(
    atualizacoes.map((a) =>
      prisma.usuario.update({
        where: { id: a.id },
        data: {
          cpf: a.cpf,
          chavePix: a.chavePix,
          tipoChavePix: a.tipoChavePix,
          especialidade: a.especialidade,
        },
      })
    )
  );

  // NUNCA loga o VALOR de CPF/PIX (dado sensível) — só QUAIS campos mudaram,
  // por pessoa. Diferente do resto do repo (que costuma logar antes/depois
  // com criarDiffCampos): aqui é deliberado não usar esse helper porque ele
  // sempre inclui o valor no texto.
  const usuarioAntesPorId = new Map(usuarios.map((u) => [u.id, u]));
  const mudancasPorPessoa = atualizacoes
    .map((a) => {
      const antes = usuarioAntesPorId.get(a.id)!;
      const camposMudados: string[] = [];
      if ((antes.cpf ?? null) !== a.cpf) camposMudados.push("CPF");
      if ((antes.chavePix ?? null) !== a.chavePix) camposMudados.push("Chave PIX");
      if ((antes.tipoChavePix ?? null) !== a.tipoChavePix) camposMudados.push("Tipo de chave PIX");
      if ((antes.especialidade ?? null) !== a.especialidade) camposMudados.push("Especialidade");
      return camposMudados.length > 0 ? `${antes.nome}: ${camposMudados.join(", ")}` : null;
    })
    .filter((texto): texto is string => texto !== null);

  if (mudancasPorPessoa.length > 0) {
    await registrarAuditoria({
      graficaId: usuario.graficaId,
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "usuario.salvar_dados_pagamento",
      entidade: "Grafica",
      entidadeId: usuario.graficaId,
      descricao: `Dados de pagamento atualizados — ${mudancasPorPessoa.join("; ")}`,
    });
  }

  revalidatePath("/usuarios");

  return { ok: true, mensagem: "Dados de pagamento atualizados com sucesso!" };
}

export type SalvarResponsaveisEstagioResult = { ok: boolean; mensagem: string };

// Mesmo padrão de formulário único de salvarAcessoMeuNegocio/salvarComissaoUsuarios
// (todos os funcionários numa tabela só, campo `resp_${usuarioId}_${status}` por
// célula) — mas ResponsavelEstagio não tem flag boolean pra fazer upsert em
// cima (diferente de PermissaoUsuario): a PRESENÇA da linha é o "marcado".
// Por isso apaga tudo do tenant e recria só o que veio marcado, em vez de
// upsert por célula — é uma lista pequena (funcionários × 5 etapas), sem
// histórico a preservar.
export async function salvarResponsaveisEstagio(
  _estadoAnterior: SalvarResponsaveisEstagioResult | null,
  formData: FormData
): Promise<SalvarResponsaveisEstagioResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  exigirPapel(usuario, ["DONO"]);

  // desativadoEm: null — um funcionário removido não aparece mais no form,
  // então funcionarioIds precisa excluí-lo: senão o deleteMany abaixo apaga o
  // ResponsavelEstagio dele (vínculo já existente que deve ser preservado —
  // só não pode ser reatribuído a ele de novo enquanto estiver desativado).
  const funcionarios = await prisma.usuario.findMany({
    where: { graficaId: usuario.graficaId, desativadoEm: null },
    select: { id: true, nome: true },
  });
  const funcionarioIds = funcionarios.map((f) => f.id);
  const nomePorId = new Map(funcionarios.map((f) => [f.id, f.nome]));

  // Achado A1 (Fase 1) — etapas atribuíveis DESTA gráfica (liga/desliga e
  // renomeia etapa, ver EtapaGrafica), não mais a lista fixa de 5.
  const etapas = await resolverEtapasGrafica(usuario.graficaId);

  const responsaveisAntes = await prisma.responsavelEstagio.findMany({
    where: { usuarioId: { in: funcionarioIds } },
  });
  const chaveAntes = new Set(responsaveisAntes.map((r) => `${r.usuarioId}::${r.status}`));

  const paresNovos = funcionarioIds.flatMap((usuarioId) =>
    etapas.estagiosAtribuiveis
      .filter(({ valor }) => formData.get(`resp_${usuarioId}_${valor}`) === "on")
      .map(({ valor }) => ({ usuarioId, status: valor }))
  );
  const chaveDepois = new Set(paresNovos.map((p) => `${p.usuarioId}::${p.status}`));

  await prisma.$transaction([
    prisma.responsavelEstagio.deleteMany({ where: { usuarioId: { in: funcionarioIds } } }),
    prisma.responsavelEstagio.createMany({ data: paresNovos }),
  ]);

  const rotuloEstagio = Object.fromEntries(etapas.estagiosAtribuiveis.map((e) => [e.valor, e.rotulo]));
  const descreverChave = (chave: string) => {
    const [usuarioId, status] = chave.split("::");
    return `${nomePorId.get(usuarioId) ?? usuarioId} → ${rotuloEstagio[status] ?? status}`;
  };
  const ganhos = [...chaveDepois].filter((c) => !chaveAntes.has(c)).map(descreverChave);
  const perdas = [...chaveAntes].filter((c) => !chaveDepois.has(c)).map(descreverChave);

  if (ganhos.length > 0 || perdas.length > 0) {
    await registrarAuditoria({
      graficaId: usuario.graficaId,
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "usuario.salvar_responsaveis_estagio",
      entidade: "Grafica",
      entidadeId: usuario.graficaId,
      descricao: "Responsáveis por etapa de produção atualizados",
      valorAnterior: perdas.length > 0 ? perdas.join(", ") : undefined,
      valorNovo: ganhos.length > 0 ? ganhos.join(", ") : undefined,
    });
  }

  revalidatePath("/usuarios");

  return { ok: true, mensagem: "Responsáveis por etapa atualizados com sucesso!" };
}

export type SalvarResponsaveisAdministrativoResult = { ok: boolean; mensagem: string };

// As áreas administrativas que podem ter responsável atribuído em /usuarios
// (ver enum AreaAdministrativa no schema) — numa lista (não um valor solto)
// pra esta action, e a UI (ResponsaveisAdministrativoForm, que importa os
// dois exports abaixo pra desenhar a tabela funcionário × área), servirem
// qualquer área nova sem precisar mudar a lógica, só adicionar o valor aqui
// e o rótulo abaixo. Movido pra src/lib/areas-administrativas.ts em
// 2026-09-02 (bug real de produção: este arquivo tem "use server" no topo,
// e exportar uma constante — não função async — daqui quebrava em produção
// quando importado por um client component, "X.map is not a function" na
// SSR; funcionava em `next dev` por isso não foi detectado antes). Import
// mantido aqui só pro uso interno de salvarResponsaveisAdministrativo abaixo.
// Mesmo padrão de salvarResponsaveisEstagio logo acima: ResponsavelAdministrativo
// não tem flag boolean pra fazer upsert em cima — a PRESENÇA da linha é o
// "marcado" — então apaga tudo do tenant e recria só o que veio marcado
// (lista pequena, sem histórico a preservar). Campo `resp_${usuarioId}_${area}`,
// mesmo nome de padrão da action de etapas, generalizado pra usar `area` no
// lugar de `status`.
export async function salvarResponsaveisAdministrativo(
  _estadoAnterior: SalvarResponsaveisAdministrativoResult | null,
  formData: FormData
): Promise<SalvarResponsaveisAdministrativoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  exigirPapel(usuario, ["DONO"]);

  // desativadoEm: null — mesmo motivo de salvarResponsaveisEstagio: um
  // funcionário removido não aparece mais no form, então funcionarioIds
  // precisa excluí-lo pra não apagar (ou impedir de reatribuir) o vínculo
  // dele por engano.
  const funcionarios = await prisma.usuario.findMany({
    where: { graficaId: usuario.graficaId, desativadoEm: null },
    select: { id: true, nome: true },
  });
  const funcionarioIds = funcionarios.map((f) => f.id);
  const nomePorId = new Map(funcionarios.map((f) => [f.id, f.nome]));

  const responsaveisAntes = await prisma.responsavelAdministrativo.findMany({
    where: { usuarioId: { in: funcionarioIds } },
  });
  const chaveAntes = new Set(responsaveisAntes.map((r) => `${r.usuarioId}::${r.area}`));

  const paresNovos = funcionarioIds.flatMap((usuarioId) =>
    AREAS_ADMINISTRATIVAS.filter((area) => formData.get(`resp_${usuarioId}_${area}`) === "on").map((area) => ({
      usuarioId,
      area,
    }))
  );
  const chaveDepois = new Set(paresNovos.map((p) => `${p.usuarioId}::${p.area}`));

  await prisma.$transaction([
    prisma.responsavelAdministrativo.deleteMany({ where: { usuarioId: { in: funcionarioIds } } }),
    prisma.responsavelAdministrativo.createMany({ data: paresNovos }),
  ]);

  const descreverChave = (chave: string) => {
    const [usuarioId, area] = chave.split("::");
    return `${nomePorId.get(usuarioId) ?? usuarioId} → ${ROTULO_AREA_ADMINISTRATIVA[area as AreaAdministrativa] ?? area}`;
  };
  const ganhos = [...chaveDepois].filter((c) => !chaveAntes.has(c)).map(descreverChave);
  const perdas = [...chaveAntes].filter((c) => !chaveDepois.has(c)).map(descreverChave);

  if (ganhos.length > 0 || perdas.length > 0) {
    await registrarAuditoria({
      graficaId: usuario.graficaId,
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "usuario.salvar_responsaveis_administrativo",
      entidade: "Grafica",
      entidadeId: usuario.graficaId,
      descricao: "Responsáveis administrativos atualizados",
      valorAnterior: perdas.length > 0 ? perdas.join(", ") : undefined,
      valorNovo: ganhos.length > 0 ? ganhos.join(", ") : undefined,
    });
  }

  revalidatePath("/usuarios");

  return { ok: true, mensagem: "Responsáveis administrativos atualizados com sucesso!" };
}

export type DesativarUsuarioResult = { ok: boolean; mensagem: string };

// "Remover" um funcionário = desativar, nunca apagar (ver comentário de
// Usuario.desativadoEm no schema): Orcamento.usuarioId, Comissao.usuarioId e
// LogAuditoria.usuarioId apontam pra cá, e apagar deixaria esse histórico
// órfão ou faria a exclusão falhar. A transação faz as duas coisas que juntas
// garantem "perde acesso NA HORA": marca desativadoEm E apaga as sessões —
// só marcar desativadoEm não bastaria, a sessão continuaria válida até
// expirar sozinha (até 7 dias, ver SESSION_DURATION_MS em session.ts).
export async function desativarUsuario(
  _estadoAnterior: DesativarUsuarioResult | null,
  formData: FormData
): Promise<DesativarUsuarioResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  exigirPapel(usuario, ["DONO"]);

  const usuarioAlvoId = String(formData.get("usuarioId"));

  // Bloqueio explícito de autodesativação, antes até de buscar o alvo no
  // banco: sem isso a gráfica pode ficar sem ninguém com acesso, já que só
  // DONO pode chamar esta action.
  if (usuarioAlvoId === usuario.id) {
    return { ok: false, mensagem: "Você não pode remover a si mesmo." };
  }

  const alvo = await prisma.usuario.findFirst({
    where: { id: usuarioAlvoId, graficaId: usuario.graficaId },
  });
  if (!alvo) {
    return { ok: false, mensagem: "Usuário não encontrado." };
  }
  // Não existe UI pra criar um segundo DONO na gráfica, então isto não deve
  // acontecer na prática — mas é a mesma proteção da autodesativação, só que
  // sem depender de "usuarioAlvoId === usuario.id".
  if (alvo.papel === "DONO") {
    return { ok: false, mensagem: "Não é possível remover o dono da gráfica." };
  }
  if (alvo.desativadoEm) {
    return { ok: false, mensagem: "Este usuário já está removido." };
  }

  await prisma.$transaction([
    prisma.usuario.update({
      where: { id: alvo.id },
      data: { desativadoEm: new Date() },
    }),
    prisma.sessao.deleteMany({ where: { usuarioId: alvo.id } }),
  ]);

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "usuario.desativar",
    entidade: "Usuario",
    entidadeId: alvo.id,
    descricao: `Usuário "${alvo.nome}" (${alvo.email}) removido`,
  });

  updateTag(`uso-${usuario.graficaId}`); // um funcionário a menos muda a contagem de seats (ver src/lib/billing/uso.ts)
  revalidatePath("/usuarios");
  return { ok: true, mensagem: `Usuário "${alvo.nome}" removido com sucesso.` };
}

export type ReativarUsuarioResult = { ok: boolean; mensagem: string };

// Reverso de desativarUsuario: volta desativadoEm pra null. Não precisa mexer
// em Sessao — quem está desativado não tem sessão nenhuma (foram todas
// apagadas na remoção), então não há nada a restaurar; a pessoa loga de novo
// com a mesma senha de antes.
export async function reativarUsuario(
  _estadoAnterior: ReativarUsuarioResult | null,
  formData: FormData
): Promise<ReativarUsuarioResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  exigirPapel(usuario, ["DONO"]);

  const usuarioAlvoId = String(formData.get("usuarioId"));

  const alvo = await prisma.usuario.findFirst({
    where: { id: usuarioAlvoId, graficaId: usuario.graficaId },
  });
  if (!alvo) {
    return { ok: false, mensagem: "Usuário não encontrado." };
  }
  if (!alvo.desativadoEm) {
    return { ok: false, mensagem: "Este usuário já está ativo." };
  }

  await prisma.usuario.update({
    where: { id: alvo.id },
    data: { desativadoEm: null },
  });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "usuario.reativar",
    entidade: "Usuario",
    entidadeId: alvo.id,
    descricao: `Usuário "${alvo.nome}" (${alvo.email}) reativado`,
  });

  updateTag(`uso-${usuario.graficaId}`);
  revalidatePath("/usuarios");
  return { ok: true, mensagem: `Usuário "${alvo.nome}" reativado com sucesso.` };
}
