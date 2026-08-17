"use server";

import { revalidatePath } from "next/cache";
import { put, del } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import {
  validarArquivoPlanilha,
  ehPlanilhaXlsx,
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
import { tentarRegistrarImportacao } from "@/lib/rate-limit-importacao";
import { solicitarMapeamentoPlanilha, ErroWebhookImportacao } from "@/lib/webhook-importacao";
import { urlAssinadaLeitura, exigirTokenBlobPrivado } from "@/lib/blob-assinado";
import { ehConflitoDeSerializacao } from "@/lib/prisma-conflito";
import { parsePlanilha, amostraParaIA, aplicarMapeamento } from "@/lib/importacao/planilha";
import { CAMPOS_POR_TIPO } from "@/lib/importacao/campos";
import { resolverLimiteImportacaoMes } from "@/lib/billing/limite-importacao";
import { obterPlanoPorPriceId } from "@/lib/billing/planos";
import { escreverLinha } from "@/lib/importacao/escritores";
import type { TipoImportacaoPlanilha, ModuloPermissao } from "@/generated/prisma/enums";

// Server Actions do Importador de planilha com IA — mesmo gate/rollback de
// src/app/orcamento/[id]/AnaliseTinta.actions.ts (auth → permissão → cota
// ANTES de qualquer coisa cara → env var → registra uso ANTES da chamada de
// rede → reserva armazenamento ANTES do put() → reverte blob se o webhook
// falhar). A diferença de fluxo: aqui são DUAS Server Actions (sugerir
// mapeamento, depois confirmar e escrever), porque existe um humano no meio
// decidindo a coluna→campo — a tinta é uma chamada só, sem esse passo manual.

const TIPOS_VALIDOS = new Set<TipoImportacaoPlanilha>(["CLIENTES", "CATALOGO", "PEDIDOS"]);

const MODULO_DO_TIPO: Record<TipoImportacaoPlanilha, ModuloPermissao> = {
  CLIENTES: "CLIENTES",
  CATALOGO: "CATALOGO",
  PEDIDOS: "ORCAMENTO",
};

const MENSAGEM_SEM_PERMISSAO: Record<TipoImportacaoPlanilha, string> = {
  CLIENTES: "Você não tem permissão pra editar clientes.",
  CATALOGO: "Você não tem permissão pra editar catálogo.",
  PEDIDOS: "Você não tem permissão pra editar orçamentos.",
};

// Janela de confirmação do mapeamento — depois disso a URL assinada de
// leitura do arquivo original já teria que ser reemitida de qualquer jeito
// (ver urlAssinadaLeitura, 5min de validade), então trata como expirado e
// pede pra recomeçar. Mesmo valor usado por expirarImportacoesAbandonadas
// (24h) seria longo demais aqui — este é um limite de UX da sessão de
// mapeamento em si, não o cron de limpeza.
const JANELA_CONFIRMACAO_MS = 30 * 60 * 1000;

// Tamanho do lote de escrita concorrente no passo 2 (confirmarEImportar) —
// mesmo raciocínio de TAMANHO_LOTE_BACKFILL em src/lib/lifecycle-cron.ts:
// grande o bastante pra não estourar duração de requisição em planilhas de
// até MAX_LINHAS_PLANILHA linhas, pequeno o bastante pra não abrir conexão
// de mais com o Postgres de uma vez.
const TAMANHO_LOTE_ESCRITA = 10;

async function emLotes<T>(
  itens: T[],
  tamanhoLote: number,
  tarefa: (item: T, indice: number) => Promise<void>
): Promise<void> {
  for (let i = 0; i < itens.length; i += tamanhoLote) {
    await Promise.all(itens.slice(i, i + tamanhoLote).map((item, offset) => tarefa(item, i + offset)));
  }
}

// --- Passo 1: upload + sugestão de mapeamento pela IA ---------------------

export type SolicitarMapeamentoResult =
  | {
      ok: true;
      importacaoId: string;
      cabecalhos: string[];
      linhasAmostra: string[][];
      linhasTotal: number;
      sugestoes: { indice: number; campo: string; confianca: string }[];
    }
  | { ok: false; mensagem: string };

export async function solicitarMapeamento(
  _estadoAnterior: SolicitarMapeamentoResult | null,
  formData: FormData
): Promise<SolicitarMapeamentoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);

  // FormData é controlado pelo atacante (Server Action é um endpoint HTTP
  // normal por baixo) — nunca confia que só a UI própria manda "tipo" válido.
  const tipoBruto = formData.get("tipo");
  if (typeof tipoBruto !== "string" || !TIPOS_VALIDOS.has(tipoBruto as TipoImportacaoPlanilha)) {
    return { ok: false, mensagem: "Tipo de importação inválido." };
  }
  const tipo = tipoBruto as TipoImportacaoPlanilha;

  if (!(await podeEditarModulo(usuario, MODULO_DO_TIPO[tipo]))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO[tipo] };
  }

  // Síncrono, sem await — calculado agora pra passar pra
  // tentarRegistrarImportacao mais abaixo (mesmo raciocínio do gate de
  // recurso pago em AnaliseTinta.actions.ts: decisão de plano ANTES de
  // qualquer coisa cara).
  const limiteMes = resolverLimiteImportacaoMes({
    status: usuario.grafica.assinatura?.status ?? null,
    cortesia: usuario.grafica.assinatura?.cortesia ?? false,
    planoId: obterPlanoPorPriceId(usuario.grafica.assinatura?.stripePriceId ?? null)?.id ?? null,
  });

  // Falha alto se o store privado não estiver configurado — mesmo cuidado de
  // AnaliseTintaItem, antes de reservar espaço/gastar cota.
  const tokenPrivado = exigirTokenBlobPrivado();

  const arquivo = formData.get("arquivo");
  if (!(arquivo instanceof File)) {
    return { ok: false, mensagem: "Selecione um arquivo." };
  }
  const validacaoArquivo = validarArquivoPlanilha({
    type: arquivo.type,
    size: arquivo.size,
    name: arquivo.name,
  });
  if (!validacaoArquivo.ok) {
    return { ok: false, mensagem: validacaoArquivo.mensagem };
  }
  // Assinatura de bytes só existe pra xlsx (ZIP) — CSV é texto puro, sem
  // magic bytes pra conferir (ver comentário de assinaturaBateComTipo).
  if (ehPlanilhaXlsx(arquivo.name)) {
    const cabecalhoBytes = new Uint8Array(await arquivo.slice(0, BYTES_ASSINATURA).arrayBuffer());
    if (!assinaturaBateComTipo(cabecalhoBytes, arquivo.type)) {
      return { ok: false, mensagem: "O conteúdo do arquivo não corresponde a uma planilha .xlsx válida." };
    }
  }

  // Parse em memória ANTES de gastar cota/armazenamento — barato, sem
  // efeito colateral nenhum.
  const resultadoParse = await parsePlanilha(Buffer.from(await arquivo.arrayBuffer()), arquivo.name);
  if (!resultadoParse.ok) {
    return { ok: false, mensagem: resultadoParse.mensagem };
  }
  const dados = resultadoParse.dados;

  const webhookUrl = process.env.IMPORTACAO_WEBHOOK_URL;
  const webhookSecret = process.env.IMPORTACAO_WEBHOOK_SECRET;
  if (!webhookUrl || !webhookSecret) {
    return { ok: false, mensagem: "Importador de planilha com IA não está configurado." };
  }

  // Registra o uso da cota ANTES do put()/chamada de IA — mesmo raciocínio
  // de tentarRegistrarAnaliseTinta: falha de rede depois ainda consome cota,
  // porque a plataforma já corre o risco de pagar a chamada.
  let limite;
  try {
    limite = await tentarRegistrarImportacao(
      usuario.graficaId,
      usuario.id,
      tipo,
      limiteMes,
      arquivo.name,
      dados.linhas.length
    );
  } catch (erro) {
    if (ehConflitoDeSerializacao(erro)) {
      return { ok: false, mensagem: "Muitas importações ao mesmo tempo. Tente de novo em instantes." };
    }
    throw erro;
  }
  if (limite.bloqueado) {
    return { ok: false, mensagem: limite.mensagem ?? "Limite de uso atingido." };
  }
  const importacaoId = limite.importacaoId!;

  // Reserva o espaço ANTES do put() — nunca depois (mesmo padrão de
  // enviarArte/salvarLogo/analisarTintaItem).
  const contextoArmazenamento = resolverContextoArmazenamento(usuario);
  const reserva = await reservarEspaco({
    graficaId: usuario.graficaId,
    tipo: "PLANILHA_IMPORTACAO",
    referenciaId: importacaoId,
    bytes: arquivo.size,
    contexto: contextoArmazenamento,
  });
  if (!reserva.ok) {
    // A cota já foi consumida (tentarRegistrarImportacao, acima) — não tem
    // como/motivo pra devolver. Só registra o que aconteceu.
    await prisma.importacaoPlanilha.update({
      where: { id: importacaoId },
      data: { status: "ERRO", mensagemErro: reserva.mensagem },
    });
    return { ok: false, mensagem: reserva.mensagem };
  }

  const extensao = ehPlanilhaXlsx(arquivo.name) ? "xlsx" : "csv";
  let blob;
  try {
    blob = await put(`importacao-planilha/${usuario.graficaId}/${importacaoId}-${Date.now()}.${extensao}`, arquivo, {
      access: "private",
      addRandomSuffix: true,
      contentType: arquivo.type,
      token: tokenPrivado,
    });
  } catch (erro) {
    await cancelarReserva(reserva.arquivoId);
    throw erro;
  }
  await confirmarArquivo(reserva.arquivoId, { url: blob.url, pathname: blob.pathname });
  await prisma.importacaoPlanilha.update({
    where: { id: importacaoId },
    data: { arquivoPathname: blob.pathname },
  });

  let resultado;
  try {
    // Diferente da tinta (que manda uma URL assinada pro n8n baixar a
    // imagem), aqui o corpo do webhook já leva cabeçalhos+amostra direto
    // (ver SolicitacaoMapeamentoPlanilha) — a planilha inteira NUNCA sai
    // daqui, só amostraParaIA (poucas linhas, célula truncada). Sem URL
    // assinada nesta chamada; urlAssinadaLeitura só entra depois, no passo
    // 2 (confirmarEImportar), pra reler o arquivo na hora de escrever.
    resultado = await solicitarMapeamentoPlanilha(
      { webhookUrl, secret: webhookSecret },
      {
        mapeamentoId: importacaoId,
        tipo,
        graficaNome: usuario.grafica.nome,
        camposDisponiveis: CAMPOS_POR_TIPO[tipo].map((c) => c.valor),
        cabecalhos: dados.cabecalhos,
        linhasAmostra: amostraParaIA(dados),
      }
    );
  } catch (erro) {
    // O blob já foi CONFIRMADO acima — reverte, mesmo raciocínio de
    // analisarTintaItem: sem isso, a cota de armazenamento fica ocupada pra
    // sempre por um upload cuja sugestão nunca chegou.
    const arquivoRevertido = await removerArquivo({
      graficaId: usuario.graficaId,
      tipo: "PLANILHA_IMPORTACAO",
      referenciaId: importacaoId,
    });
    if (arquivoRevertido) {
      await del(arquivoRevertido.url, { token: tokenPrivado }).catch(() => {});
    }
    if (erro instanceof ErroWebhookImportacao) {
      // A cota (a própria linha ImportacaoPlanilha) continua consumida —
      // só o status muda, nunca apaga/decrementa.
      await prisma.importacaoPlanilha.update({
        where: { id: importacaoId },
        data: { status: "ERRO", mensagemErro: erro.message },
      });
      return { ok: false, mensagem: erro.message };
    }
    throw erro;
  }

  // Nunca confia cegamente no `campo` que a IA sugeriu — só aceita um valor
  // que exista de fato em CAMPOS_POR_TIPO[tipo]; qualquer outra coisa vira
  // "ignorar" (ver doc comment de SolicitacaoMapeamentoPlanilha).
  const camposValidos = new Set(CAMPOS_POR_TIPO[tipo].map((c) => c.valor));
  const sugestaoPorIndice = new Map(resultado.sugestoes.map((s) => [s.indice, s]));
  const mapeamentoSugerido: Record<string, string> = {};
  const sugestoesValidadas = dados.cabecalhos.map((cabecalho, indice) => {
    const sugestaoIa = sugestaoPorIndice.get(indice);
    const campo = sugestaoIa && camposValidos.has(sugestaoIa.campo) ? sugestaoIa.campo : "ignorar";
    mapeamentoSugerido[cabecalho] = campo;
    return { indice, campo, confianca: sugestaoIa?.confianca ?? "baixa" };
  });

  // Continua MAPEANDO — este passo só sugeriu, quem confirma é a pessoa em
  // confirmarEImportar.
  await prisma.importacaoPlanilha.update({
    where: { id: importacaoId },
    data: { mapeamentoSugerido, status: "MAPEANDO" },
  });

  return {
    ok: true,
    importacaoId,
    cabecalhos: dados.cabecalhos,
    linhasAmostra: amostraParaIA(dados),
    linhasTotal: dados.linhas.length,
    sugestoes: sugestoesValidadas,
  };
}

// --- Passo 2: confirmação do mapeamento + escrita em massa ----------------

export type ConfirmarImportacaoResult =
  | { ok: true; linhasImportadas: number; linhasComErro: number; erros: { linha: number; mensagem: string }[] }
  | { ok: false; mensagem: string };

export async function confirmarEImportar(
  _estadoAnterior: ConfirmarImportacaoResult | null,
  formData: FormData
): Promise<ConfirmarImportacaoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);

  const importacaoId = String(formData.get("importacaoId") ?? "");
  // Escopado por graficaId — mesmo cuidado de todo findFirst deste projeto
  // que recebe id vindo de fora (proteção IDOR).
  const importacao = await prisma.importacaoPlanilha.findFirst({
    where: { id: importacaoId, graficaId: usuario.graficaId },
  });
  if (!importacao) {
    return { ok: false, mensagem: "Importação não encontrada." };
  }

  // Só sabe qual módulo checar depois de carregar a linha (o tipo mora nela)
  // — por isso o gate de permissão vem DEPOIS do lookup aqui, diferente do
  // passo 1 (onde o tipo chega direto no FormData).
  if (!(await podeEditarModulo(usuario, MODULO_DO_TIPO[importacao.tipo]))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO[importacao.tipo] };
  }

  if (importacao.status !== "MAPEANDO") {
    return { ok: false, mensagem: "Esta importação já foi processada ou expirou." };
  }
  if (Date.now() - importacao.createdAt.getTime() > JANELA_CONFIRMACAO_MS) {
    await prisma.importacaoPlanilha.update({
      where: { id: importacaoId },
      data: { status: "ERRO", mensagemErro: "Expirado — mapeamento não confirmado a tempo." },
    });
    return { ok: false, mensagem: "Esta importação já foi processada ou expirou." };
  }

  // Duas listas paralelas — mesmo índice em `colunas[i]`/`campos[i]` é um
  // par coluna→campo (ver ImportadorWizard.tsx, que monta os hidden inputs
  // nessa mesma ordem).
  const colunas = formData.getAll("coluna").map(String);
  const camposEscolhidos = formData.getAll("campo").map(String);
  if (colunas.length === 0 || colunas.length !== camposEscolhidos.length) {
    return { ok: false, mensagem: "Mapeamento inválido." };
  }
  const mapeamento: Record<string, string> = {};
  colunas.forEach((coluna, i) => {
    mapeamento[coluna] = camposEscolhidos[i];
  });

  // Defesa em profundidade — o client já deveria impedir isso, mas FormData
  // é sempre atacante-controlado. Diferente da leniência do passo 1 (sugestão
  // da IA vira "ignorar" se inválida): aqui é confirmação humana explícita,
  // um valor inválido é erro de verdade, nunca some silenciosamente.
  const camposDisponiveis = CAMPOS_POR_TIPO[importacao.tipo];
  const valoresValidos = new Set(camposDisponiveis.map((c) => c.valor));
  for (const campo of camposEscolhidos) {
    if (!valoresValidos.has(campo)) {
      return { ok: false, mensagem: "Mapeamento inválido — coluna mapeada pra um campo desconhecido." };
    }
  }
  const camposMapeados = new Set(Object.values(mapeamento));
  const faltando = camposDisponiveis.filter((c) => c.obrigatorio && !camposMapeados.has(c.valor));
  if (faltando.length > 0) {
    return {
      ok: false,
      mensagem: `Mapeie pelo menos uma coluna para: ${faltando.map((c) => c.rotulo).join(", ")}.`,
    };
  }

  await prisma.importacaoPlanilha.update({
    where: { id: importacaoId },
    data: { mapeamentoConfirmado: mapeamento, status: "CONFIRMADO" },
  });

  if (!importacao.arquivoPathname) {
    await prisma.importacaoPlanilha.update({
      where: { id: importacaoId },
      data: { status: "ERRO", mensagemErro: "Arquivo da importação não foi encontrado." },
    });
    return { ok: false, mensagem: "Arquivo da importação não foi encontrado." };
  }

  // Nunca confia na linha que o client mandaria — rebaixa do arquivo salvo
  // no store privado, mesmo raciocínio de urlAssinadaLeitura em
  // AnaliseTinta.actions.ts.
  const urlLeitura = await urlAssinadaLeitura(importacao.arquivoPathname, 5 * 60 * 1000);
  const respostaArquivo = await fetch(urlLeitura);
  if (!respostaArquivo.ok) {
    await prisma.importacaoPlanilha.update({
      where: { id: importacaoId },
      data: { status: "ERRO", mensagemErro: "Não consegui reler o arquivo enviado." },
    });
    return { ok: false, mensagem: "Não consegui reler o arquivo enviado." };
  }
  const buffer = Buffer.from(await respostaArquivo.arrayBuffer());
  const resultadoParse = await parsePlanilha(buffer, importacao.nomeArquivo);
  if (!resultadoParse.ok) {
    await prisma.importacaoPlanilha.update({
      where: { id: importacaoId },
      data: { status: "ERRO", mensagemErro: resultadoParse.mensagem },
    });
    return { ok: false, mensagem: resultadoParse.mensagem };
  }
  const dados = resultadoParse.dados;

  await prisma.importacaoPlanilha.update({ where: { id: importacaoId }, data: { status: "PROCESSANDO" } });

  const erros: { linha: number; mensagem: string }[] = [];
  let linhasImportadas = 0;

  // Uma transação POR LINHA, nunca uma transação envolvendo todas — o
  // Postgres aborta a transação inteira depois de qualquer erro dentro dela,
  // mesmo com try/catch em volta em JS, então uma transação múltiplas-linhas
  // não teria como dar sucesso parcial de verdade. Lotes de
  // TAMANHO_LOTE_ESCRITA em paralelo (não sequencial, não Promise.all sem
  // limite) pra caber num tempo de requisição razoável sem abrir conexão
  // demais de uma vez.
  await emLotes(dados.linhas, TAMANHO_LOTE_ESCRITA, async (linha, indice) => {
    const linhaMapeada = aplicarMapeamento(dados.cabecalhos, linha, mapeamento);
    // Cabeçalho é a linha 1 da planilha — a primeira linha de dado (índice 0
    // do array) é a linha 2 pra quem está olhando o arquivo original.
    const numeroLinha = indice + 2;
    try {
      const resultadoLinha = await prisma.$transaction((tx) =>
        escreverLinha(importacao.tipo, tx, { graficaId: usuario.graficaId, usuarioId: usuario.id }, linhaMapeada)
      );
      if (resultadoLinha.ok) {
        linhasImportadas++;
      } else {
        erros.push({ linha: numeroLinha, mensagem: resultadoLinha.mensagem });
      }
    } catch {
      // Exceção inesperada (não um {ok:false} de retorno) — não pode
      // derrubar o lote inteiro, cada linha é isolada.
      erros.push({ linha: numeroLinha, mensagem: "Erro inesperado ao importar esta linha." });
    }
  });

  const linhasComErro = erros.length;
  const errosLimitados = erros.slice(0, 50);

  await prisma.importacaoPlanilha.update({
    where: { id: importacaoId },
    data: {
      status: "CONCLUIDO",
      linhasImportadas,
      linhasComErro,
      erros: errosLimitados,
      concluidoEm: new Date(),
    },
  });

  // Arquivo já foi 100% consumido — sem motivo pra manter no store privado.
  const arquivoRevertido = await removerArquivo({
    graficaId: usuario.graficaId,
    tipo: "PLANILHA_IMPORTACAO",
    referenciaId: importacaoId,
  });
  if (arquivoRevertido) {
    await del(arquivoRevertido.url, { token: exigirTokenBlobPrivado() }).catch(() => {});
  }

  if (importacao.tipo === "CLIENTES") {
    revalidatePath("/clientes");
  } else if (importacao.tipo === "CATALOGO") {
    revalidatePath("/catalogo");
  } else {
    // PEDIDOS histórico toca as três telas — orçamento (o pedido nasce de
    // um orçamento), produção e o resumo de Meu Negócio.
    revalidatePath("/orcamento");
    revalidatePath("/producao");
    revalidatePath("/meu-negocio");
  }

  return { ok: true, linhasImportadas, linhasComErro, erros: errosLimitados };
}
