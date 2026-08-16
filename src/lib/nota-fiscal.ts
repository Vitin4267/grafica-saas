import "server-only";

import { prisma } from "@/lib/prisma";

// Checagem do que falta configurar antes de conseguir emitir uma nota fiscal
// — usada tanto pra decidir o que mostrar no NotaFiscalCard quanto (defesa em
// profundidade) dentro da própria Server Action de emissão.

export type DadosFiscaisParaChecagem = {
  focusNfeToken: string | null;
  cnpj: string | null;
  razaoSocial: string | null;
  enderecoLogradouro: string | null;
  enderecoNumero: string | null;
  enderecoBairro: string | null;
  enderecoMunicipio: string | null;
  enderecoUf: string | null;
  enderecoCep: string | null;
} | null;

export type ClienteParaChecagem = {
  documento: string | null;
  enderecoLogradouro: string | null;
  enderecoNumero: string | null;
  enderecoBairro: string | null;
  enderecoMunicipio: string | null;
  enderecoUf: string | null;
  enderecoCep: string | null;
};

export type ItemParaChecagem = { nome: string; ncm: string | null };

export type ChecagemFiscal = { pronto: boolean; pendencias: string[] };

function enderecoCompleto(e: {
  enderecoLogradouro: string | null;
  enderecoNumero: string | null;
  enderecoBairro: string | null;
  enderecoMunicipio: string | null;
  enderecoUf: string | null;
  enderecoCep: string | null;
}): boolean {
  return Boolean(
    e.enderecoLogradouro &&
      e.enderecoNumero &&
      e.enderecoBairro &&
      e.enderecoMunicipio &&
      e.enderecoUf &&
      e.enderecoCep
  );
}

export function verificarProntidaoFiscal(input: {
  dadosFiscais: DadosFiscaisParaChecagem;
  cliente: ClienteParaChecagem;
  itens: ItemParaChecagem[];
}): ChecagemFiscal {
  const pendencias: string[] = [];

  if (!input.dadosFiscais?.focusNfeToken) {
    pendencias.push("Token da Focus NFe não configurado (Configurações → Dados fiscais).");
  }
  if (!input.dadosFiscais?.cnpj || !input.dadosFiscais.razaoSocial) {
    pendencias.push("CNPJ e razão social da gráfica não configurados (Configurações → Dados fiscais).");
  }
  if (!input.dadosFiscais || !enderecoCompleto(input.dadosFiscais)) {
    pendencias.push("Endereço da gráfica incompleto (Configurações → Dados fiscais).");
  }
  if (!input.cliente.documento) {
    pendencias.push("Cliente sem CPF/CNPJ cadastrado.");
  }
  if (!enderecoCompleto(input.cliente)) {
    pendencias.push("Endereço do cliente incompleto.");
  }
  const semNcm = input.itens.filter((i) => !i.ncm);
  if (semNcm.length > 0) {
    pendencias.push(`NCM não configurado para: ${semNcm.map((i) => i.nome).join(", ")}.`);
  }

  return { pronto: pendencias.length === 0, pendencias };
}

export type DestinatarioNotaFiscal = { email: string; nome: string };

export type NotificacaoNotaFiscal = {
  destinatarios: DestinatarioNotaFiscal[];
  graficaNome: string;
  corPrimaria: string | null;
  clienteNome: string;
  valorTotal: number;
};

// Helper compartilhado pelos dois caminhos de aprovação de orçamento
// (atualizarStatusOrcamento em src/app/orcamento/[id]/actions.ts e
// responderOrcamentoPublico em src/app/o/[token]/actions.ts) — chamado
// depois que a transação de aprovação já confirmou sucesso (nunca em caso de
// conflito de concorrência). Retorna null quando não há nada a notificar:
// ou ninguém está configurado como responsável pela área NOTA_FISCAL em
// /usuarios, ou o orçamento ainda não está pronto fiscalmente (falta CNPJ,
// endereço, NCM etc — o card na tela já mostra a pendência pro usuário
// resolver, não faz sentido mandar e-mail antes disso). O disparo do e-mail
// em si (after() + dispararEventoEmail, um por destinatário) fica em cada
// call site, não aqui — after() depende do contexto de requisição de cada
// rota.
export async function prepararNotificacaoNotaFiscal(
  orcamentoId: string,
  graficaId: string
): Promise<NotificacaoNotaFiscal | null> {
  const responsaveis = await prisma.responsavelAdministrativo.findMany({
    where: { area: "NOTA_FISCAL", usuario: { graficaId, desativadoEm: null } },
    include: { usuario: { select: { email: true, nome: true } } },
  });
  if (responsaveis.length === 0) return null;

  const [orcamento, dadosFiscais] = await Promise.all([
    prisma.orcamento.findFirst({
      where: { id: orcamentoId, graficaId },
      include: {
        cliente: true,
        grafica: { select: { nome: true, corPrimaria: true } },
        itens: { include: { itemGrafica: { include: { itemCatalogo: true } } } },
      },
    }),
    prisma.dadosFiscaisGrafica.findUnique({ where: { graficaId } }),
  ]);
  if (!orcamento) return null;

  const checagem = verificarProntidaoFiscal({
    dadosFiscais,
    cliente: orcamento.cliente,
    itens: orcamento.itens.map((item) => ({
      nome: item.itemGrafica.itemCatalogo.nome,
      ncm: item.itemGrafica.itemCatalogo.ncm,
    })),
  });
  if (!checagem.pronto) return null;

  return {
    destinatarios: responsaveis.map((r) => ({ email: r.usuario.email, nome: r.usuario.nome })),
    graficaNome: orcamento.grafica.nome,
    corPrimaria: orcamento.grafica.corPrimaria,
    clienteNome: orcamento.cliente.nome,
    valorTotal: Number(orcamento.total),
  };
}
