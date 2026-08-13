"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/password";
import { criarSessao } from "@/lib/auth/session";
import { tentarRegistrarCadastro } from "@/lib/auth/rate-limit";
import { obterIpRequisicao } from "@/lib/auth/ip";
import { ehConflitoDeSerializacao } from "@/lib/prisma-conflito";
import { registroSchema } from "@/lib/auth/validation";
import { slugify } from "@/lib/slug";
import { TRIAL_DIAS } from "@/lib/billing/planos";
import { gerarEEnviarCodigoVerificacao } from "@/lib/email/verificacao-email";
import { dispararMetrica } from "@/lib/webhook-metricas";

const MENSAGEM_GENERICA = "Não foi possível concluir o cadastro. Tente novamente.";

export type RegistroResult = {
  ok: boolean;
  mensagem: string;
};

async function gerarSlugUnico(nome: string): Promise<string> {
  const base = slugify(nome) || "grafica";
  let candidato = base;
  let sufixo = 1;

  while (await prisma.grafica.findUnique({ where: { slug: candidato } })) {
    sufixo += 1;
    candidato = `${base}-${sufixo}`;
  }

  return candidato;
}

export async function registrar(
  _estadoAnterior: RegistroResult | null,
  formData: FormData
): Promise<RegistroResult> {
  // Honeypot: campo escondido via CSS que só um preenchedor automático de
  // formulário (bot) preenche — uma pessoa de verdade nunca vê nem toca nele.
  // Rejeitado com a mesma mensagem genérica de erro, pra não entregar ao bot
  // qual campo é a armadilha.
  if (String(formData.get("site") || "").trim()) {
    return { ok: false, mensagem: MENSAGEM_GENERICA };
  }

  const ip = await obterIpRequisicao();
  const MENSAGEM_BLOQUEIO = "Muitas tentativas de cadastro. Aguarde um pouco e tente novamente.";
  let bloqueado: boolean;
  try {
    bloqueado = await tentarRegistrarCadastro(ip);
  } catch (erro) {
    if (ehConflitoDeSerializacao(erro)) {
      return { ok: false, mensagem: MENSAGEM_BLOQUEIO };
    }
    throw erro;
  }
  if (bloqueado) {
    return { ok: false, mensagem: MENSAGEM_BLOQUEIO };
  }

  if (formData.get("aceiteTermos") !== "on") {
    return {
      ok: false,
      mensagem: "É preciso concordar com os Termos de Uso e a Política de Privacidade.",
    };
  }

  const parsed = registroSchema.safeParse({
    graficaNome: formData.get("graficaNome"),
    nome: formData.get("nome"),
    email: formData.get("email"),
    senha: formData.get("senha"),
  });

  if (!parsed.success) {
    return { ok: false, mensagem: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const { graficaNome, nome, email, senha } = parsed.data;

  let emailExistente = await prisma.usuario.findUnique({ where: { email } });

  // Conta nunca verificada (ninguém confirmou o código de 6 dígitos) e
  // parada há mais de 24h: trata como abandonada e libera o e-mail. Sem
  // isso, alguém podia "reservar" o e-mail de outra pessoa e travar o
  // cadastro dela pra sempre. Convidado (usuarios/actions.ts) sempre nasce
  // com emailVerificadoEm preenchido, então nunca cai aqui; e um DONO não
  // verificado não consegue convidar ninguém (exigirEmailVerificado bloqueia
  // isso), então a Grafica dele nunca tem outro usuário — apagar em cascata
  // é seguro.
  if (emailExistente && !emailExistente.emailVerificadoEm) {
    const VINTE_QUATRO_HORAS_MS = 1000 * 60 * 60 * 24;
    const contaAbandonada =
      Date.now() - emailExistente.createdAt.getTime() > VINTE_QUATRO_HORAS_MS;
    if (contaAbandonada) {
      // deleteMany (não delete): não lança se outra requisição concorrente do
      // mesmo e-mail já apagou a gráfica (dois cadastros simultâneos), e a
      // condição `usuarios.every.emailVerificadoEm = null` garante que a
      // gráfica não seja apagada se o dono legítimo acabou de verificar o
      // e-mail na janela de corrida. Reconsulto depois pra refletir o estado
      // real: se ainda existir (ninguém apagou / virou verificada), bloqueia.
      await prisma.grafica.deleteMany({
        where: {
          id: emailExistente.graficaId,
          usuarios: { every: { emailVerificadoEm: null } },
        },
      });
      emailExistente = await prisma.usuario.findUnique({ where: { email } });
    }
  }

  if (emailExistente) {
    return { ok: false, mensagem: "Este e-mail já está cadastrado." };
  }

  const slug = await gerarSlugUnico(graficaNome);
  const senhaHash = await hashPassword(senha);

  const trialExpiraEm = new Date();
  trialExpiraEm.setUTCDate(trialExpiraEm.getUTCDate() + TRIAL_DIAS);

  const usuario = await prisma.$transaction(async (tx) => {
    const grafica = await tx.grafica.create({
      data: { nome: graficaNome, slug },
    });

    // O relógio do trial começa no cadastro, não na primeira vez que o DONO
    // abre /configuracoes/assinatura — senão alguém que nunca visita essa
    // tela ficaria com trial "infinito" por omissão.
    await tx.assinaturaGrafica.create({
      data: { graficaId: grafica.id, status: "TRIALING", trialExpiraEm },
    });

    return tx.usuario.create({
      data: {
        graficaId: grafica.id,
        nome,
        email,
        senhaHash,
        papel: "DONO",
      },
    });
  });

  await criarSessao(usuario.id);

  // Continua com `await` aqui (diferente de dispararMetrica logo abaixo):
  // gerarEEnviarCodigoVerificacao GRAVA o código no banco (transação) antes
  // de disparar o e-mail — essa gravação precisa terminar ANTES do redirect,
  // senão o usuário podia cair em /verificar-email sem o código ainda
  // existir. O disparo do e-mail em si já não bloqueia mais este `await`:
  // dentro da função (src/lib/email/verificacao-email.ts) o webhook agora
  // roda via after(), então esperar a função inteira aqui é rápido (só
  // espera o banco, não o e-mail).
  await gerarEEnviarCodigoVerificacao(usuario);

  // after() em vez de await: métrica pro n8n acompanhar novos registros,
  // puramente fire-and-forget (nenhum resultado é usado depois) — não
  // precisa bloquear o redirect. Garante também que a instância serverless
  // continua viva até o webhook terminar, mesmo depois da resposta já ter
  // sido enviada ao cliente.
  after(() =>
    dispararMetrica({
      tipo: "novo_registro",
      dados: { graficaId: usuario.graficaId, graficaNome, criadoEm: new Date().toISOString() },
    })
  );

  redirect("/verificar-email");
}
