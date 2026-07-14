"use server";

import { z } from "zod";
import { revalidatePath, updateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { exigirPapel, MODULOS_PERMISSAO } from "@/lib/auth/permissoes";
import { senhaSchema } from "@/lib/auth/validation";
import { hashPassword } from "@/lib/auth/password";

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

  await prisma.usuario.create({
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

  const funcionarios = await prisma.usuario.findMany({
    where: { graficaId: usuario.graficaId, papel: { not: "DONO" } },
    select: { id: true },
  });

  await prisma.$transaction([
    prisma.grafica.update({
      where: { id: usuario.graficaId },
      data: { compartilharMeuNegocio: compartilhar },
    }),
    ...funcionarios.map((f) =>
      prisma.usuario.update({
        where: { id: f.id },
        data: { acessoMeuNegocio: formData.get(`acesso_${f.id}`) === "on" },
      })
    ),
  ]);

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

  await prisma.$transaction(
    MODULOS_PERMISSAO.map(({ valor }) => {
      const podeVer = formData.get(`ver_${valor}`) === "on";
      const podeEditar = podeVer && formData.get(`editar_${valor}`) === "on";
      return prisma.permissaoUsuario.upsert({
        where: { usuarioId_modulo: { usuarioId: usuarioAlvoId, modulo: valor } },
        create: { usuarioId: usuarioAlvoId, modulo: valor, podeVer, podeEditar },
        update: { podeVer, podeEditar },
      });
    })
  );

  revalidatePath(`/usuarios/${usuarioAlvoId}/permissoes`);
  revalidatePath("/usuarios");

  return { ok: true, mensagem: `Permissões de "${alvo.nome}" atualizadas com sucesso!` };
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

  const usuarios = await prisma.usuario.findMany({
    where: { graficaId: usuario.graficaId },
    select: { id: true },
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

  revalidatePath("/usuarios");

  return { ok: true, mensagem: "Comissão por vendedor atualizada com sucesso!" };
}
