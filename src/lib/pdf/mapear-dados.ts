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

// Achado A8 da auditoria de abrangência (pesquisa-abrangencia-modulos.md,
// Parte 8/Clientes-Fiscal, restante pendente) — resolução por fallback
// filial → gráfica pra identidade visual/contato do PDF, MESMO PADRÃO que
// resolverDadosFiscais (src/lib/nota-fiscal.ts) já implementa pra dado
// fiscal. `site`/`enderecoResumido` não têm campo equivalente em Filial (ver
// comentário do model no schema) — vêm sempre da Grafica.
export type IdentidadeVisualFilial = {
  telefone: string | null;
  emailContato: string | null;
  logoUrl: string | null;
  corPrimaria: string | null;
} | null;

export type IdentidadeVisualGrafica = {
  logoUrl: string | null;
  corPrimaria: string | null;
  telefone: string | null;
  emailContato: string | null;
  site: string | null;
  enderecoResumido: string | null;
};

export type IdentidadeVisualResolvida = {
  logoUrl: string | null;
  corPrimaria: string | null;
  telefone: string | null;
  emailContato: string | null;
  site: string | null;
  enderecoResumido: string | null;
};

// Filial sem NENHUM campo preenchido (ou orçamento sem filial vinculada,
// filial === null) cai 100% no dado da Grafica — comportamento de hoje
// preservado. Filial com só um campo preenchido só sobrepõe aquele campo,
// os demais continuam vindo da Grafica (fallback campo a campo, não
// tudo-ou-nada).
export function resolverIdentidadeVisual(
  filial: IdentidadeVisualFilial,
  grafica: IdentidadeVisualGrafica
): IdentidadeVisualResolvida {
  return {
    logoUrl: filial?.logoUrl ?? grafica.logoUrl,
    corPrimaria: filial?.corPrimaria ?? grafica.corPrimaria,
    telefone: filial?.telefone ?? grafica.telefone,
    emailContato: filial?.emailContato ?? grafica.emailContato,
    site: grafica.site,
    enderecoResumido: grafica.enderecoResumido,
  };
}

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
  // Achado A8 — filial vinculada ao orçamento (Orcamento.filialId), pra
  // resolverIdentidadeVisual saber se sobrepõe algum campo da Grafica.
  // null = orçamento sem filial (o caso de sempre) ou filial sem nenhum dado
  // próprio cadastrado ainda — os dois caem 100% no dado da Grafica.
  filial: IdentidadeVisualFilial;
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
  // Achado novo (comparação com o "Pedido Interno" de papel da Assus
  // Graphics, 2026-09-08) — número que o CLIENTE usa pra rastrear a
  // própria compra, independente do id/número do GrafPro.
  numeroPedidoCliente: string | null;
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
    // Achado F7 da Parte 7 (auditoria de abrangência, 2026-08-31) — terceira
    // dimensão (profundidadeCm, mesma unidade de largura/altura) e
    // espessura de chapa (espessuraMm, sempre em milímetro) do item VENDIDO.
    // Puramente descritivo, nunca afeta preço.
    profundidadeCm: Prisma.Decimal | null;
    espessuraMm: Prisma.Decimal | null;
    unidadeDimensao: UnidadeDimensao;
    cores: string | null;
    acabamento: string | null;
    // Achado B6 — quando preenchido, sobrepõe `itemGrafica.itemCatalogo.nome`
    // como o nome exibido do item (ver mapearDadosPdf abaixo). Puramente
    // descritivo, nunca afeta preço.
    descricaoLivre: string | null;
    // Achado novo (comparação com o "Pedido Interno" de papel da Assus
    // Graphics, 2026-09-08) — checkbox "Modelo Novo / Repetição s/
    // alteração / Repetição c/ alteração", por item. Puramente
    // informativo, nunca afeta preço.
    tipoRepeticao: string | null;
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
      durabilidadeAdesivo: string | null;
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
        tipoEfeitoHotStamping: string | null;
        medida: string | null;
        cor: string | null;
      }[];
    } | null;
    // Achado B5 da auditoria de abrangência (Parte 1) — tiragens alternativas
    // deste item ("1.000/3.000/5.000 unidades"). Vazio pra todo item sem
    // faixa cadastrada (o caso de sempre).
    faixasQuantidade: {
      quantidade: number;
      precoUnitario: Prisma.Decimal;
      precoTotal: Prisma.Decimal;
    }[];
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
    numeroPedidoCliente: orcamento.numeroPedidoCliente,
    condicoesPagamento: orcamento.condicoesPagamento,
    frete: orcamento.frete ? (ROTULO_FRETE[orcamento.frete] ?? orcamento.frete) : null,
    transportadora: orcamento.transportadora,
    localEntrega: orcamento.localEntrega,
    notaEmpenho: orcamento.notaEmpenho,
    processoLicitatorio: orcamento.processoLicitatorio,
    prazoEntregaEstimadoDias: orcamento.prazoEntregaEstimadoDias,
  };
  const temDadosPedido = Object.values(dadosPedido).some((v) => v !== null);
  // Achado A8 — filial vinculada (se houver) sobrepõe logo/cor/telefone/
  // e-mail da Grafica campo a campo; null (sem filial, ou filial sem dado
  // próprio) cai 100% no dado da Grafica, comportamento de hoje preservado.
  const identidade = resolverIdentidadeVisual(orcamento.filial, orcamento.grafica);

  return {
    graficaNome: orcamento.grafica.nome,
    logoUrl: identidade.logoUrl,
    corPrimaria: identidade.corPrimaria,
    telefone: identidade.telefone,
    emailContato: identidade.emailContato,
    site: identidade.site,
    enderecoResumido: identidade.enderecoResumido,
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
          ? `${converterDeCm(Number(item.larguraCm), item.unidadeDimensao)} × ${converterDeCm(Number(item.alturaCm), item.unidadeDimensao)}${
              item.profundidadeCm
                ? ` × ${converterDeCm(Number(item.profundidadeCm), item.unidadeDimensao)}`
                : ""
            } ${ROTULO_UNIDADE_DIMENSAO[item.unidadeDimensao]}`
          : null,
      // Achado F7 — espessura de chapa (corte a laser/router), unidade
      // separada (sempre mm) de `medidas` acima.
      espessura: item.espessuraMm ? `Espessura: ${Number(item.espessuraMm)}mm` : null,
      cores: item.cores,
      acabamento: item.acabamento,
      // Achado novo (comparação com o "Pedido Interno" de papel da Assus
      // Graphics, 2026-09-08) — já convertido pro rótulo em português,
      // mesmo padrão de tipoPedido (dadosPedido) acima.
      tipoRepeticao: item.tipoRepeticao ? (ROTULO_TIPO_PEDIDO[item.tipoRepeticao] ?? item.tipoRepeticao) : null,
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
      // Achado B5 — já formatado (mesmo padrão de precoUnitario/precoTotal
      // acima); ordenado por quantidade crescente pela própria query
      // (ver `orderBy: { quantidade: "asc" }` nos includes de item.faixasQuantidade).
      faixasQuantidade: item.faixasQuantidade.map((faixa) => ({
        quantidade: faixa.quantidade.toLocaleString("pt-BR"),
        precoUnitario: formatoMoeda.format(Number(faixa.precoUnitario)),
        precoTotal: formatoMoeda.format(Number(faixa.precoTotal)),
      })),
    })),
  };
}

export function nomeArquivoPdf(clienteNome: string, idCurto: string): string {
  return `orcamento-${slugify(clienteNome)}-${idCurto.slice(0, 8)}.pdf`;
}
