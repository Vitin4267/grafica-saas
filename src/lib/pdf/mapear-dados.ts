import type { Prisma } from "@/generated/prisma/client";
import { formatoMoeda } from "@/lib/moeda";
import { slugify } from "@/lib/slug";
import { linhasEtiqueta, ROTULO_LADO, rotuloTipoHotStamping } from "@/app/orcamento/[id]/EtiquetaResumo";
import { converterDeCm, ROTULO_UNIDADE_DIMENSAO, type UnidadeDimensao } from "@/lib/unidade-dimensao";
import { calcularConversoesPreco } from "@/lib/unidade-contagem";
import { ROTULO_TIPO_CHAVE_PIX } from "@/lib/tipos-grafica";
import type { TipoChavePix } from "@/generated/prisma/enums";
import type { DadosPdfOrcamento } from "./OrcamentoDocumento";

const ROTULO_TIPO_PEDIDO: Record<string, string> = {
  MODELO_NOVO: "Modelo novo",
  REPETICAO_SEM_ALTERACAO: "Repetição sem alteração",
  REPETICAO_COM_ALTERACAO: "Repetição com alteração",
};
const ROTULO_FRETE: Record<string, string> = { EMITENTE: "Emitente", DESTINATARIO: "Destinatário" };

// Formato compartilhado pelas duas rotas de PDF (autenticada e pública) — os
// `include` do Prisma nas duas telas irmãs (orcamento/[id]/page.tsx e
// o/[token]/page.tsx) já produzem essa mesma forma de dado.
export type OrcamentoParaPdf = {
  status: "RASCUNHO" | "ENVIADO" | "APROVADO" | "REJEITADO";
  createdAt: Date;
  total: Prisma.Decimal;
  // Nome DECLARADO por quem respondeu pelo link público — não verificado
  // (ver comentário de Orcamento.respostaPublicaNome no schema). Só existe
  // quando status já é APROVADO/REJEITADO; nunca escrever "confirmado por"
  // a partir disto, só "aprovado/recusado por".
  respostaPublicaNome: string | null;
  respostaPublicaEm: Date | null;
  validoAteEm: Date | null;
  // Snapshot de ParametrosGrafica.toleranciaTiragemPadraoPercent no momento
  // do ENVIO (ver Orcamento.toleranciaTiragemPercent no schema) — mesmo
  // ciclo de vida de validoAteEm acima, null enquanto RASCUNHO.
  toleranciaTiragemPercent: Prisma.Decimal | null;
  cliente: { nome: string };
  grafica: {
    nome: string;
    logoUrl: string | null;
    corPrimaria: string | null;
    // Dados de contato (comerciais, não fiscais) que aparecem no rodapé do PDF
    // de orçamento — mesmo nível de logoUrl/corPrimaria. Nunca dado sensível
    // ou interno da gráfica (custo/margem/comissão), apenas contato pro cliente.
    telefone: string | null;
    emailContato: string | null;
    site: string | null;
    enderecoResumido: string | null;
    // Achado F6 da Parte 7 (auditoria de abrangência, 2026-08-31) — dados de
    // RECEBIMENTO da gráfica, só exibição (nunca validados). Impressos no
    // rodapé do PDF junto do contato, sempre que preenchidos — ao contrário
    // de "Como pagar" em /o/[token] (só depois de APROVADO), o PDF não sabe
    // olhar o status do orçamento em tempo real depois de baixado, então
    // mostra sempre que a gráfica cadastrou.
    chavePix: string | null;
    tipoChavePix: TipoChavePix | null;
    favorecidoPix: string | null;
    dadosBancarios: string | null;
    // Só o texto de termos e o toggle de especificações técnicas — nunca os
    // demais campos de ParametrosGrafica (overhead, margem, comissão etc.),
    // que são dado comercial interno e não podem chegar no PDF (nem no
    // autenticado, nem no público). Ver comentário equivalente no topo de
    // DadosPdfOrcamento.
    parametros: {
      termosCondicoesPdf: string | null;
      mostrarEspecificacoesTecnicas: boolean;
      // Achado A2 da Parte 6 (auditoria de abrangência, 2026-08-27) — decide
      // se o rótulo do prazo estimado (abaixo) fala em "dias úteis" ou "dias
      // corridos", em vez do literal fixo de sempre. Ver
      // ParametrosGrafica.prazoEmDiasUteis no schema.
      prazoEmDiasUteis: boolean;
      // Achado A13 da Parte 6 (auditoria de abrangência, 2026-08-29) —
      // tolerância de tiragem para interpolar no texto padrão de termos
      // e exibir faixa aceitável na Ordem de Produção. 0 = sem tolerância.
      toleranciaTiragemPercent: Prisma.Decimal;
    } | null;
  };
  // Bloco 1 (dados gerais) — seguros pro cliente ver, ao contrário de
  // observações (interno) e etapas de produção (interno), que nunca entram
  // aqui de propósito (ver comentário em DadosPdfOrcamento).
  vendedor: string | null;
  tipoPedido: string | null;
  condicoesPagamento: string | null;
  frete: string | null;
  transportadora: string | null;
  localEntrega: string | null;
  // Achado A12 da Parte 5 da auditoria de abrangência — campos opcionais
  // pra cliente órgão público.
  notaEmpenho: string | null;
  processoLicitatorio: string | null;
  prazoEntregaEstimadoDias: number | null;
  itens: {
    quantidade: number;
    larguraCm: Prisma.Decimal | null;
    alturaCm: Prisma.Decimal | null;
    unidadeDimensao: UnidadeDimensao;
    cores: string | null;
    acabamento: string | null;
    // Achado B6 — quando preenchido, sobrepõe `itemGrafica.itemCatalogo.nome`
    // como o nome exibido do item (ver mapearDadosPdf abaixo). Puramente
    // descritivo, nunca afeta preço.
    descricaoLivre: string | null;
    acabamentos: { itemGrafica: { itemCatalogo: { nome: string } } }[];
    precoUnitario: Prisma.Decimal;
    precoTotal: Prisma.Decimal;
    itemGrafica: {
      itemCatalogo: { nome: string };
      unidadeContagem: string | null;
      fatorConversao: Prisma.Decimal | null;
    };
    etiqueta: {
      materialSubstrato: string | null;
      materialSubstratoOutro: string | null;
      tipoAdesivo: string | null;
      tipoAdesivoOutro: string | null;
      superficieAplicacao: string | null;
      superficieAplicacaoOutro: string | null;
      formatoEtiqueta: string | null;
      coresRotulo: number | null;
      coresContraRotulo: number | null;
      embalagemQtdPorRolo: number | null;
      tubeteMedida: string | null;
      rotulagem: string | null;
      serrilha: string | null;
      serrilhaOutro: string | null;
      vernizRotuloTotal: boolean;
      vernizRotuloReserva: boolean;
      vernizRotuloTipo: string | null;
      vernizRotuloTipoOutro: string | null;
      vernizContraRotuloTotal: boolean;
      vernizContraRotuloReserva: boolean;
      vernizContraRotuloTipo: string | null;
      vernizContraRotuloTipoOutro: string | null;
      laminacaoRotulo: string | null;
      laminacaoRotuloOutro: string | null;
      laminacaoContraRotulo: string | null;
      laminacaoContraRotuloOutro: string | null;
      rebobinamento: number | null;
      hotStampings: {
        lado: string;
        tipo: string;
        tipoOutro: string | null;
        medida: string | null;
        cor: string | null;
      }[];
    } | null;
  }[];
};

export function mapearDadosPdf(orcamento: OrcamentoParaPdf): DadosPdfOrcamento {
  // Default true (mesmo espírito do default no schema): gráfica sem
  // ParametrosGrafica ainda (não deveria acontecer, mas orcamento.grafica.
  // parametros é nullable) continua mostrando tudo, o comportamento de
  // sempre que já existia antes deste toggle.
  const mostrarEspecificacoesTecnicas = orcamento.grafica.parametros?.mostrarEspecificacoesTecnicas ?? true;
  // Default true preserva o texto de sempre ("dias úteis") pra gráfica sem
  // ParametrosGrafica ainda — mesmo espírito do default no schema.
  const prazoEmDiasUteis = orcamento.grafica.parametros?.prazoEmDiasUteis ?? true;
  const dadosPedido = {
    vendedor: orcamento.vendedor,
    tipoPedido: orcamento.tipoPedido ? (ROTULO_TIPO_PEDIDO[orcamento.tipoPedido] ?? orcamento.tipoPedido) : null,
    condicoesPagamento: orcamento.condicoesPagamento,
    frete: orcamento.frete ? (ROTULO_FRETE[orcamento.frete] ?? orcamento.frete) : null,
    transportadora: orcamento.transportadora,
    localEntrega: orcamento.localEntrega,
    notaEmpenho: orcamento.notaEmpenho,
    processoLicitatorio: orcamento.processoLicitatorio,
    prazoEntregaEstimadoDias: orcamento.prazoEntregaEstimadoDias,
  };
  const temDadosPedido = Object.values(dadosPedido).some((v) => v !== null);

  return {
    graficaNome: orcamento.grafica.nome,
    logoUrl: orcamento.grafica.logoUrl,
    corPrimaria: orcamento.grafica.corPrimaria,
    telefone: orcamento.grafica.telefone,
    emailContato: orcamento.grafica.emailContato,
    site: orcamento.grafica.site,
    enderecoResumido: orcamento.grafica.enderecoResumido,
    // Achado F6 — só exibição, chavePix nunca validada. tipoChavePix já sai
    // convertido pro rótulo em português (mesmo padrão de `frete`/
    // `tipoPedido` acima) pra OrcamentoDocumento não precisar saber do enum.
    chavePix: orcamento.grafica.chavePix,
    tipoChavePix: orcamento.grafica.tipoChavePix
      ? ROTULO_TIPO_CHAVE_PIX[orcamento.grafica.tipoChavePix]
      : null,
    favorecidoPix: orcamento.grafica.favorecidoPix,
    dadosBancarios: orcamento.grafica.dadosBancarios,
    clienteNome: orcamento.cliente.nome,
    status: orcamento.status,
    criadoEm: orcamento.createdAt,
    respostaPublicaNome: orcamento.respostaPublicaNome,
    respostaPublicaEm: orcamento.respostaPublicaEm,
    validoAteEm: orcamento.validoAteEm,
    toleranciaTiragemPercent:
      orcamento.toleranciaTiragemPercent !== null ? Number(orcamento.toleranciaTiragemPercent) : null,
    total: formatoMoeda.format(Number(orcamento.total)),
    dadosPedido: temDadosPedido ? dadosPedido : null,
    prazoEmDiasUteis,
    termosCondicoesPdf: orcamento.grafica.parametros?.termosCondicoesPdf ?? null,
    itens: orcamento.itens.map((item) => ({
      // Achado B6 — descrição específica do pedido (ex: "Banner 3×1m lona
      // 440g com bastão e corda") sobrepõe o nome genérico do catálogo
      // quando preenchida.
      nome: item.descricaoLivre?.trim() || item.itemGrafica.itemCatalogo.nome,
      quantidade: item.quantidade,
      medidas:
        item.larguraCm && item.alturaCm
          ? `${converterDeCm(Number(item.larguraCm), item.unidadeDimensao)} × ${converterDeCm(Number(item.alturaCm), item.unidadeDimensao)} ${ROTULO_UNIDADE_DIMENSAO[item.unidadeDimensao]}`
          : null,
      cores: item.cores,
      acabamento: item.acabamento,
      acabamentosEstruturados: item.acabamentos.map((a) => a.itemGrafica.itemCatalogo.nome),
      precoUnitario: formatoMoeda.format(Number(item.precoUnitario)),
      precoTotal: formatoMoeda.format(Number(item.precoTotal)),
      conversoesPreco: calcularConversoesPreco({
        precoUnitario: Number(item.precoUnitario),
        unidadeContagem: item.itemGrafica.unidadeContagem,
        fatorConversao: item.itemGrafica.fatorConversao ? Number(item.itemGrafica.fatorConversao) : null,
        embalagemQtdPorRolo: item.etiqueta?.embalagemQtdPorRolo ?? null,
      }).map((c) => `${c.valorFormatado} / ${c.rotulo}`),
      etiquetaLinhas:
        item.etiqueta && mostrarEspecificacoesTecnicas ? linhasEtiqueta(item.etiqueta) : [],
      hotStampingLinhas: mostrarEspecificacoesTecnicas
        ? (item.etiqueta?.hotStampings ?? []).map((h) => {
            const partes = [rotuloTipoHotStamping(h), h.medida, h.cor].filter(Boolean);
            return `Hot/cold stamping (${ROTULO_LADO[h.lado] ?? h.lado}): ${partes.join(" · ")}`;
          })
        : [],
    })),
  };
}

export function nomeArquivoPdf(clienteNome: string, idCurto: string): string {
  return `orcamento-${slugify(clienteNome)}-${idCurto.slice(0, 8)}.pdf`;
}
