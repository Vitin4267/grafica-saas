import "server-only";

import { unstable_cache, updateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import type { AssinaturaGrafica } from "@/generated/prisma/client";
import type { TipoArquivoArmazenado } from "@/generated/prisma/enums";
import { obterPlanoPorPriceId } from "@/lib/billing/planos";
import { ehConflitoDeSerializacao } from "@/lib/prisma-conflito";
import { mbParaBytes, cabeNoLimite, resolverLimiteArmazenamentoMb, mensagemEspacoInsuficiente } from "@/lib/billing/limite-armazenamento";

// Camada server da cota de armazenamento — reserva→confirma→(cancela em
// falha) sobre a tabela ArquivoArmazenado (razão de todo arquivo no Blob,
// ver comentário do model no schema). Mesma disciplina de
// src/lib/billing/uso.ts: leitura cacheada só pra EXIBIÇÃO, nunca pra
// decisão de bloqueio (ver somarArmazenamentoUsado vs. calcularArmazenamentoUsado).

export class ErroEspacoInsuficiente extends Error {}

export type ContextoArmazenamento = { limiteMb: number; ehTrial: boolean; nomePlano: string };

// Resolve de uma vez o limite aplicável + o que a UI/mensagem de erro
// precisa saber — composição de resolverLimiteArmazenamentoMb (puro) com o
// lookup de plano, mesmo padrão de verificarRecursoPago em
// src/lib/auth/recurso-pago.ts.
export function resolverContextoArmazenamento(usuario: {
  grafica: { assinatura: AssinaturaGrafica | null };
}): ContextoArmazenamento {
  const assinatura = usuario.grafica.assinatura;
  const plano = obterPlanoPorPriceId(assinatura?.stripePriceId ?? null);
  const limiteMb = resolverLimiteArmazenamentoMb({
    status: assinatura?.status ?? null,
    cortesia: assinatura?.cortesia ?? false,
    plano,
  });
  return {
    limiteMb,
    ehTrial: assinatura?.status === "TRIALING" && !plano,
    nomePlano: plano?.nome ?? "atual",
  };
}

type ClientePrisma = typeof prisma | Prisma.TransactionClient;

// SEM cache de propósito — chamada de dentro da transação de reserva
// (reservarEspaco), onde a decisão é "aceita ou rejeita este upload agora".
// Um cache de 60s aqui (como o de calcularUsoAtual) abriria uma janela de
// burst que fura a cota: uploads são raros, uma query extra por upload é
// irrelevante.
export function somarArmazenamentoUsado(cliente: ClientePrisma, graficaId: string): Promise<number> {
  return cliente.arquivoArmazenado
    .aggregate({ where: { graficaId }, _sum: { bytes: true } })
    .then((r) => r._sum.bytes ?? 0);
}

async function buscarArmazenamentoUsado(graficaId: string): Promise<number> {
  return somarArmazenamentoUsado(prisma, graficaId);
}

// Cacheada (60s, tag armazenamento-${graficaId}), só pra EXIBIÇÃO — mesmo
// padrão de calcularUsoAtual em src/lib/billing/uso.ts. Invalidada sob
// demanda via updateTag em toda escrita (reservarEspaco/confirmarArquivo/
// removerArquivo).
export function calcularArmazenamentoUsado(graficaId: string): Promise<number> {
  return unstable_cache(buscarArmazenamentoUsado, ["armazenamento-usado"], {
    tags: [`armazenamento-${graficaId}`],
    revalidate: 60,
  })(graficaId);
}

export type ReservaArmazenamentoResult =
  | { ok: true; arquivoId: string }
  | { ok: false; mensagem: string };

const MENSAGEM_CONFLITO = "Outro envio está acontecendo agora — tente de novo em alguns segundos.";

// Passo 1/3 do fluxo (ver comentário do model ArquivoArmazenado no schema):
// dentro de uma transação Serializable, soma o uso atual + o que uma
// substituição do MESMO tipo+referenciaId vai liberar, e só então cria a
// linha (url: null = reserva pendente). Chamar ANTES do put() no Blob —
// nunca depois — senão o upload já foi pago mesmo quando rejeitado.
export async function reservarEspaco(input: {
  graficaId: string;
  tipo: TipoArquivoArmazenado;
  referenciaId: string;
  bytes: number;
  contexto: ContextoArmazenamento;
}): Promise<ReservaArmazenamentoResult> {
  try {
    const arquivoId = await prisma.$transaction(
      async (tx) => {
        const [usadoBytes, linhaAnterior] = await Promise.all([
          somarArmazenamentoUsado(tx, input.graficaId),
          tx.arquivoArmazenado.findFirst({
            where: { graficaId: input.graficaId, tipo: input.tipo, referenciaId: input.referenciaId },
          }),
        ]);

        const limiteBytes = mbParaBytes(input.contexto.limiteMb);
        const cabe = cabeNoLimite({
          usadoBytes,
          bytesLiberados: linhaAnterior?.bytes ?? 0,
          arquivoBytes: input.bytes,
          limiteBytes,
        });
        if (!cabe) {
          throw new ErroEspacoInsuficiente(
            mensagemEspacoInsuficiente({
              usadoBytes,
              limiteBytes,
              nomePlano: input.contexto.nomePlano,
              ehTrial: input.contexto.ehTrial,
            })
          );
        }

        const linha = await tx.arquivoArmazenado.create({
          data: {
            graficaId: input.graficaId,
            tipo: input.tipo,
            referenciaId: input.referenciaId,
            bytes: input.bytes,
            url: null,
            pathname: null,
          },
        });
        return linha.id;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
    return { ok: true, arquivoId };
  } catch (erro) {
    if (erro instanceof ErroEspacoInsuficiente) {
      return { ok: false, mensagem: erro.message };
    }
    if (ehConflitoDeSerializacao(erro)) {
      return { ok: false, mensagem: MENSAGEM_CONFLITO };
    }
    throw erro;
  }
}

// Passo 2/3: chamar depois que o put() no Blob confirmou. Grava a
// url/pathname reais na linha reservada e apaga qualquer linha ANTERIOR do
// mesmo tipo+referenciaId (a substituição, ex: reenviar arte) — só agora,
// nunca antes, senão uma falha no meio do caminho deixaria o tenant sem
// nenhuma linha cobrindo o arquivo antigo que ainda está no Blob.
export async function confirmarArquivo(
  arquivoId: string,
  dados: { url: string; pathname: string }
): Promise<void> {
  const arquivo = await prisma.arquivoArmazenado.findUniqueOrThrow({ where: { id: arquivoId } });
  await prisma.$transaction(async (tx) => {
    await tx.arquivoArmazenado.update({ where: { id: arquivoId }, data: dados });
    await tx.arquivoArmazenado.deleteMany({
      where: {
        graficaId: arquivo.graficaId,
        tipo: arquivo.tipo,
        referenciaId: arquivo.referenciaId,
        id: { not: arquivoId },
      },
    });
  });
  updateTag(`armazenamento-${arquivo.graficaId}`);
}

// Passo 3/3 (caminho de erro): o put() no Blob falhou depois da reserva —
// desfaz a linha reservada. Best-effort (chamado de dentro de um catch).
export async function cancelarReserva(arquivoId: string): Promise<void> {
  await prisma.arquivoArmazenado.delete({ where: { id: arquivoId } }).catch(() => {});
}

// Usado por removerArte/removerLogo: apaga a linha do razão e devolve
// url/pathname pra quem chama fazer o del() no Blob (best-effort, fora
// desta função — mesmo padrão de enviarArte/salvarLogo).
export async function removerArquivo(input: {
  graficaId: string;
  tipo: TipoArquivoArmazenado;
  referenciaId: string;
}): Promise<{ url: string; pathname: string | null } | null> {
  const linha = await prisma.arquivoArmazenado.findFirst({
    where: { graficaId: input.graficaId, tipo: input.tipo, referenciaId: input.referenciaId },
  });
  if (!linha) return null;

  await prisma.arquivoArmazenado.delete({ where: { id: linha.id } });
  updateTag(`armazenamento-${input.graficaId}`);

  return linha.url ? { url: linha.url, pathname: linha.pathname } : null;
}
