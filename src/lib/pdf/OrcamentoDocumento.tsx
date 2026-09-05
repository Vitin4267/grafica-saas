import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import { formatoInstanteReal, formatoInstanteRealHora, formatoInstanteRealComHora } from "@/lib/data";
import { TERMOS_CONDICOES_PDF_PADRAO } from "./termos-padrao";

// Mesmo recorte de informação do link público (/o/[token]) — nunca inclui
// breakdown (custo/margem), que é dado comercial sensível da gráfica.
// Observações internas e as 5 etapas de produção também nunca entram aqui —
// ver mapearDadosPdf, que nem chega a preencher esses campos no tipo.
export type ItemPdfOrcamento = {
  nome: string;
  quantidade: number;
  medidas: string | null;
  // Achado F7 — "Espessura: 3mm", separado de `medidas` acima porque é
  // outra unidade (chapa é vendida em mm no Brasil).
  espessura: string | null;
  cores: string | null;
  acabamento: string | null;
  acabamentosEstruturados: string[];
  precoUnitario: string;
  precoTotal: string;
  // "R$ X / milheiro", "R$ Y / rolo (N un.)" — só exibição, nunca muda o
  // total cobrado (ver src/lib/unidade-contagem.ts). Vazio quando o produto
  // não tem unidadeContagem/fatorConversao nem o item tem embalagemQtdPorRolo.
  conversoesPreco: string[];
  etiquetaLinhas: [string, string][];
  hotStampingLinhas: string[];
  // Achado B5 da auditoria de abrangência (Parte 1) — tiragens alternativas
  // deste item ("1.000/3.000/5.000 unidades"), tabela comparativa exibida
  // logo abaixo da linha do item. Vazio pra todo item sem faixa cadastrada
  // (o caso de sempre) — nunca soma no total do orçamento.
  faixasQuantidade: { quantidade: string; precoUnitario: string; precoTotal: string }[];
};

export type DadosPdfPedido = {
  vendedor: string | null;
  tipoPedido: string | null;
  condicoesPagamento: string | null;
  frete: string | null;
  transportadora: string | null;
  localEntrega: string | null;
  notaEmpenho: string | null;
  processoLicitatorio: string | null;
  prazoEntregaEstimadoDias: number | null;
};

export type DadosPdfOrcamento = {
  graficaNome: string;
  logoUrl: string | null;
  corPrimaria: string | null;
  // Dados de contato (comerciais, não fiscais) — mesmo nível de logoUrl/corPrimaria.
  // Aparecem no rodapé do PDF. Nunca dado sensível ou interno.
  telefone: string | null;
  emailContato: string | null;
  site: string | null;
  enderecoResumido: string | null;
  // Achado F6 da Parte 7 (auditoria de abrangência, 2026-08-31) — dados de
  // RECEBIMENTO da gráfica, mesmo nível de telefone/emailContato acima:
  // aparecem no rodapé do PDF sempre que preenchidos, nunca validados.
  // tipoChavePix já chega convertido pro rótulo em português (ver
  // mapearDadosPdf) — este componente não conhece o enum TipoChavePix.
  chavePix: string | null;
  tipoChavePix: string | null;
  favorecidoPix: string | null;
  dadosBancarios: string | null;
  clienteNome: string;
  status: "RASCUNHO" | "ENVIADO" | "APROVADO" | "REJEITADO";
  criadoEm: Date;
  respostaPublicaNome: string | null;
  respostaPublicaEm: Date | null;
  validoAteEm: Date | null;
  // Snapshot em % de ParametrosGrafica.toleranciaTiragemPadraoPercent no
  // momento do ENVIO (ver Orcamento.toleranciaTiragemPercent) — mesmo ciclo
  // de vida de validoAteEm acima, null enquanto RASCUNHO.
  toleranciaTiragemPercent: number | null;
  itens: ItemPdfOrcamento[];
  total: string;
  dadosPedido: DadosPdfPedido | null;
  // Achado A2 da Parte 6 (auditoria de abrangência, 2026-08-27) — decide se
  // "Prazo estimado de entrega" (abaixo) fala em "dias úteis" ou "dias
  // corridos", em vez do literal "dias úteis" fixo de sempre. Ver
  // ParametrosGrafica.prazoEmDiasUteis no schema.
  prazoEmDiasUteis: boolean;
  // Texto livre configurado pela gráfica em /configuracoes (ver
  // ParametrosGrafica.termosCondicoesPdf). Null = gráfica nunca configurou —
  // o rodapé usa TERMOS_CONDICOES_PDF_PADRAO em vez de ficar em branco.
  // Mesmo recorte seguro do resto do tipo: dado que a própria gráfica
  // escreveu sobre política comercial, nunca custo/margem interno.
  termosCondicoesPdf: string | null;
};

const ROTULO_STATUS: Record<string, string> = {
  RASCUNHO: "Rascunho",
  ENVIADO: "Enviado",
  APROVADO: "Aprovado",
  REJEITADO: "Rejeitado",
};

// Teal padrão da plataforma — usado quando a gráfica não configurou
// Grafica.corPrimaria (ver /configuracoes/identidade) ou configurou um
// valor em formato inválido (defesa em profundidade, mesmo já validado no
// salvamento — ver comentário equivalente em src/lib/email/templates.ts).
const COR_PADRAO = "#0d9488";
const HEX_REGEX_COR = /^#[0-9A-Fa-f]{6}$/;

function paraRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function paraHex([r, g, b]: [number, number, number]): string {
  const canal = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${canal(r)}${canal(g)}${canal(b)}`;
}

// Mistura a cor base com branco ou preto numa fração fixa — usado pra
// derivar, em runtime, os tons mais claro (fundo do total) e mais escuro
// (textos de destaque) que o teal fixo já usava (aproximação das paradas
// teal-50/teal-700/teal-900 do Tailwind, computada a partir de QUALQUER cor
// configurada em /configuracoes/identidade, não só o teal).
function misturar(hex: string, alvo: [number, number, number], fracao: number): string {
  const [r, g, b] = paraRgb(hex);
  const [ra, ga, ba] = alvo;
  return paraHex([r + (ra - r) * fracao, g + (ga - g) * fracao, b + (ba - b) * fracao]);
}

type CoresDocumento = { base: string; clara: string; escura: string; maisEscura: string };

// Tons exatos que o PDF já usava (teal-50/teal-700/teal-900 do Tailwind) —
// usados tal e qual quando a gráfica não configurou corPrimaria, pra manter
// o PDF byte-a-byte igual ao de hoje no caso mais comum (nenhuma gráfica
// configurou uma cor ainda). Só o `misturar()` acima entra em ação pra uma
// cor de verdade configurada, onde não existe "o tom certo" pré-definido.
const CORES_PADRAO: CoresDocumento = {
  base: COR_PADRAO,
  clara: "#f0fdfa",
  escura: "#0f766e",
  maisEscura: "#134e4a",
};

function resolverCores(corPrimaria: string | null): CoresDocumento {
  if (!corPrimaria || !HEX_REGEX_COR.test(corPrimaria)) {
    return CORES_PADRAO;
  }
  return {
    base: corPrimaria,
    clara: misturar(corPrimaria, [255, 255, 255], 0.93), // fundo do total (~teal-50)
    escura: misturar(corPrimaria, [0, 0, 0], 0.15), // texto sobre fundo claro (~teal-700)
    maisEscura: misturar(corPrimaria, [0, 0, 0], 0.4), // valor total, mais contraste (~teal-900)
  };
}

const estilos = StyleSheet.create({
  pagina: { padding: 40, fontSize: 10, color: "#0f172a" },
  cabecalho: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 24,
    borderBottomWidth: 2,
    borderBottomColor: "#0d9488",
    paddingBottom: 12,
  },
  logoImagem: { height: 40, maxWidth: 160, objectFit: "contain", marginBottom: 4 },
  graficaNomeComLogo: { fontSize: 9, color: "#64748b" },
  graficaNomeSemLogo: { fontSize: 16, fontWeight: "bold", color: "#0f172a" },
  statusBadge: {
    fontSize: 9,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: "#f1f5f9",
    color: "#475569",
  },
  secao: { marginBottom: 16 },
  tituloCliente: { fontSize: 14, fontWeight: "bold", marginBottom: 2 },
  dataCriacao: { fontSize: 9, color: "#64748b" },
  respostaPublica: { fontSize: 9, color: "#0f766e", marginTop: 2 },
  validoAte: { fontSize: 9, color: "#64748b", marginTop: 2 },
  tabela: { borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 4 },
  linhaCabecalho: {
    flexDirection: "row",
    backgroundColor: "#f8fafc",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  linha: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  colNome: { flexGrow: 3, flexBasis: 0 },
  colQtd: { flexGrow: 1, flexBasis: 0, textAlign: "right" },
  colUnit: { flexGrow: 1.3, flexBasis: 0, textAlign: "right" },
  colTotal: { flexGrow: 1.3, flexBasis: 0, textAlign: "right" },
  textoCabecalho: { fontSize: 8, fontWeight: "bold", color: "#475569" },
  detalhesItem: { fontSize: 8, color: "#64748b", marginTop: 2 },
  dadosPedidoBox: {
    marginBottom: 16,
    padding: 10,
    borderRadius: 4,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  dadosPedidoTitulo: { fontSize: 9, fontWeight: "bold", color: "#475569", marginBottom: 6 },
  dadosPedidoGrade: { flexDirection: "row", flexWrap: "wrap" },
  dadosPedidoItem: { width: "50%", marginBottom: 4 },
  dadosPedidoRotulo: { fontSize: 7, color: "#94a3b8" },
  dadosPedidoValor: { fontSize: 9, color: "#0f172a" },
  etiquetaBox: {
    marginTop: 4,
    padding: 6,
    borderRadius: 3,
    backgroundColor: "#f8fafc",
  },
  etiquetaTitulo: { fontSize: 7, fontWeight: "bold", color: "#94a3b8", marginBottom: 2 },
  etiquetaLinha: { fontSize: 7, color: "#64748b" },
  // Achado B5 — tabela comparativa de tiragens alternativas do item, mesmo
  // nível visual de etiquetaBox acima.
  faixasBox: {
    marginTop: 4,
    padding: 6,
    borderRadius: 3,
    backgroundColor: "#f8fafc",
  },
  faixasTitulo: { fontSize: 7, fontWeight: "bold", color: "#94a3b8", marginBottom: 2 },
  faixasLinha: {
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7,
    color: "#64748b",
  },
  totalBox: {
    marginTop: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#f0fdfa",
    padding: 12,
    borderRadius: 4,
  },
  totalLabel: { fontSize: 10, color: "#0f766e", fontWeight: "bold" },
  totalValor: { fontSize: 18, color: "#134e4a", fontWeight: "bold" },
  termosBox: {
    marginTop: 16,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
  },
  termosTexto: { fontSize: 7, color: "#94a3b8", lineHeight: 1.4 },
  contatoRodapeBox: {
    marginTop: 16,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
  },
  contatoRodapeLinha: { fontSize: 8, color: "#475569", marginBottom: 2 },
  pagamentoBox: {
    marginTop: 16,
    padding: 10,
    borderRadius: 4,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  pagamentoTitulo: { fontSize: 9, fontWeight: "bold", color: "#475569", marginBottom: 6 },
  pagamentoLinha: { fontSize: 9, color: "#0f172a", marginBottom: 2 },
  rodape: {
    position: "absolute",
    bottom: 30,
    left: 40,
    right: 40,
    fontSize: 8,
    color: "#94a3b8",
    textAlign: "center",
  },
});

export function OrcamentoDocumento({ dados }: { dados: DadosPdfOrcamento }) {
  const agora = new Date();
  const cores = resolverCores(dados.corPrimaria);

  return (
    <Document title={`Orçamento — ${dados.clienteNome}`}>
      <Page size="A4" style={estilos.pagina}>
        <View style={[estilos.cabecalho, { borderBottomColor: cores.base }]}>
          <View>
            {dados.logoUrl ? (
              <>
                {/* eslint-disable-next-line jsx-a11y/alt-text -- Image do @react-pdf/renderer (PDF), não <img> do DOM — esse componente nem tem prop alt */}
                <Image src={dados.logoUrl} style={estilos.logoImagem} />
                <Text style={estilos.graficaNomeComLogo}>{dados.graficaNome}</Text>
              </>
            ) : (
              <Text style={estilos.graficaNomeSemLogo}>{dados.graficaNome}</Text>
            )}
          </View>
          <Text style={estilos.statusBadge}>
            {ROTULO_STATUS[dados.status] ?? dados.status}
          </Text>
        </View>

        <View style={estilos.secao}>
          <Text style={estilos.tituloCliente}>{dados.clienteNome}</Text>
          <Text style={estilos.dataCriacao}>
            Orçamento criado em {formatoInstanteReal.format(dados.criadoEm)}
          </Text>
          {/* Nome DECLARADO por quem respondeu pelo link público, nunca
              verificado — "aprovado/recusado por", nunca "confirmado por"
              (ver comentário de Orcamento.respostaPublicaNome no schema). */}
          {(dados.status === "APROVADO" || dados.status === "REJEITADO") &&
            dados.respostaPublicaNome && (
              <Text style={[estilos.respostaPublica, { color: cores.escura }]}>
                {dados.status === "APROVADO" ? "Aprovado" : "Recusado"} por{" "}
                {dados.respostaPublicaNome}
                {dados.respostaPublicaEm &&
                  ` em ${formatoInstanteRealComHora.format(dados.respostaPublicaEm)}`}
              </Text>
            )}
          {dados.validoAteEm !== null && (
            <Text style={estilos.validoAte}>
              Válido até {formatoInstanteRealComHora.format(dados.validoAteEm)}
            </Text>
          )}
          {dados.toleranciaTiragemPercent !== null && (
            <Text style={estilos.validoAte}>
              Tolerância de tiragem: ±{dados.toleranciaTiragemPercent}% sobre a quantidade
              contratada
            </Text>
          )}
        </View>

        {dados.dadosPedido && (
          <View style={estilos.dadosPedidoBox}>
            <Text style={estilos.dadosPedidoTitulo}>DADOS DO PEDIDO</Text>
            <View style={estilos.dadosPedidoGrade}>
              {[
                ["Vendedor", dados.dadosPedido.vendedor],
                ["Tipo de pedido", dados.dadosPedido.tipoPedido],
                ["Condições de pagamento", dados.dadosPedido.condicoesPagamento],
                ["Frete", dados.dadosPedido.frete],
                ["Transportadora", dados.dadosPedido.transportadora],
                ["Local de entrega", dados.dadosPedido.localEntrega],
                ["Nota de empenho", dados.dadosPedido.notaEmpenho],
                ["Processo licitatório", dados.dadosPedido.processoLicitatorio],
                [
                  "Prazo estimado de entrega",
                  dados.dadosPedido.prazoEntregaEstimadoDias !== null
                    ? `${dados.dadosPedido.prazoEntregaEstimadoDias} ${dados.prazoEmDiasUteis ? "dias úteis" : "dias corridos"} após aprovação`
                    : null,
                ],
              ]
                .filter((par): par is [string, string] => par[1] !== null)
                .map(([rotulo, valor]) => (
                  <View key={rotulo} style={estilos.dadosPedidoItem}>
                    <Text style={estilos.dadosPedidoRotulo}>{rotulo}</Text>
                    <Text style={estilos.dadosPedidoValor}>{valor}</Text>
                  </View>
                ))}
            </View>
          </View>
        )}

        <View style={estilos.tabela}>
          <View style={estilos.linhaCabecalho}>
            <Text style={[estilos.textoCabecalho, estilos.colNome]}>ITEM</Text>
            <Text style={[estilos.textoCabecalho, estilos.colQtd]}>QTD</Text>
            <Text style={[estilos.textoCabecalho, estilos.colUnit]}>UNITÁRIO</Text>
            <Text style={[estilos.textoCabecalho, estilos.colTotal]}>TOTAL</Text>
          </View>
          {dados.itens.map((item, indice) => {
            const detalhes = [
              item.medidas,
              item.espessura,
              item.cores ? `Cores: ${item.cores}` : null,
              item.acabamento ? `Acabamento: ${item.acabamento}` : null,
              item.acabamentosEstruturados.length > 0
                ? `Acabamento: ${item.acabamentosEstruturados.join(", ")}`
                : null,
            ].filter(Boolean);

            return (
              <View key={indice} style={estilos.linha}>
                <View style={estilos.colNome}>
                  <Text>{item.nome}</Text>
                  {detalhes.length > 0 && (
                    <Text style={estilos.detalhesItem}>{detalhes.join(" · ")}</Text>
                  )}
                  {(item.etiquetaLinhas.length > 0 || item.hotStampingLinhas.length > 0) && (
                    <View style={estilos.etiquetaBox}>
                      <Text style={estilos.etiquetaTitulo}>DETALHES DE ETIQUETA</Text>
                      {item.etiquetaLinhas.map(([rotulo, valor]) => (
                        <Text key={rotulo} style={estilos.etiquetaLinha}>
                          {rotulo}: {valor}
                        </Text>
                      ))}
                      {item.hotStampingLinhas.map((linha, i) => (
                        <Text key={i} style={estilos.etiquetaLinha}>
                          {linha}
                        </Text>
                      ))}
                    </View>
                  )}
                  {item.faixasQuantidade.length > 0 && (
                    <View style={estilos.faixasBox}>
                      <Text style={estilos.faixasTitulo}>OUTRAS QUANTIDADES</Text>
                      {item.faixasQuantidade.map((faixa, i) => (
                        <View key={i} style={estilos.faixasLinha}>
                          <Text>{faixa.quantidade} un.</Text>
                          <Text>
                            {faixa.precoUnitario} / un. — {faixa.precoTotal}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
                <Text style={estilos.colQtd}>{item.quantidade}</Text>
                <View style={estilos.colUnit}>
                  <Text>{item.precoUnitario}</Text>
                  {item.conversoesPreco.map((c) => (
                    <Text key={c} style={[estilos.detalhesItem, { textAlign: "right" }]}>
                      {c}
                    </Text>
                  ))}
                </View>
                <Text style={estilos.colTotal}>{item.precoTotal}</Text>
              </View>
            );
          })}
        </View>

        <View style={[estilos.totalBox, { backgroundColor: cores.clara }]}>
          <Text style={[estilos.totalLabel, { color: cores.escura }]}>Total do orçamento</Text>
          <Text style={[estilos.totalValor, { color: cores.maisEscura }]}>{dados.total}</Text>
        </View>

        {/* Achado F6 — dados de recebimento da gráfica, nunca validados, só
            exibidos quando cadastrados em /configuracoes/identidade. */}
        {(dados.chavePix || dados.favorecidoPix || dados.dadosBancarios) && (
          <View style={estilos.pagamentoBox}>
            <Text style={estilos.pagamentoTitulo}>COMO PAGAR</Text>
            {dados.chavePix && (
              <Text style={estilos.pagamentoLinha}>
                Chave PIX{dados.tipoChavePix ? ` (${dados.tipoChavePix})` : ""}: {dados.chavePix}
              </Text>
            )}
            {dados.favorecidoPix && (
              <Text style={estilos.pagamentoLinha}>Favorecido: {dados.favorecidoPix}</Text>
            )}
            {dados.dadosBancarios && (
              <Text style={estilos.pagamentoLinha}>Dados bancários: {dados.dadosBancarios}</Text>
            )}
          </View>
        )}

        <View style={estilos.termosBox}>
          <Text style={estilos.termosTexto}>
            {dados.termosCondicoesPdf ||
              ((dados.toleranciaTiragemPercent ?? 0) > 0
                ? `${TERMOS_CONDICOES_PDF_PADRAO} Reservamo-nos o direito de variação de até ${dados.toleranciaTiragemPercent}% na quantidade final produzida, sem que isso seja motivo de disputa.`
                : TERMOS_CONDICOES_PDF_PADRAO)}
          </Text>
        </View>

        {(dados.telefone || dados.emailContato || dados.site || dados.enderecoResumido) && (
          <View style={estilos.contatoRodapeBox}>
            {dados.telefone && <Text style={estilos.contatoRodapeLinha}>Tel: {dados.telefone}</Text>}
            {dados.emailContato && (
              <Text style={estilos.contatoRodapeLinha}>E-mail: {dados.emailContato}</Text>
            )}
            {dados.site && <Text style={estilos.contatoRodapeLinha}>Site: {dados.site}</Text>}
            {dados.enderecoResumido && (
              <Text style={estilos.contatoRodapeLinha}>Endereço: {dados.enderecoResumido}</Text>
            )}
          </View>
        )}

        <Text style={estilos.rodape} fixed>
          Gerado em {formatoInstanteReal.format(agora)} às {formatoInstanteRealHora.format(agora)}
        </Text>
      </Page>
    </Document>
  );
}
