import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import { formatoInstanteReal, formatoInstanteRealHora, formatoData } from "@/lib/data";

// Documento interno (chão de fábrica), diferente do PDF de orçamento
// (OrcamentoDocumento.tsx) que vai pro cliente — por isso aqui é o oposto:
// NUNCA mostra preço/margem (não é o que importa pra quem produz), mas SEMPRE
// mostra observações internas e a ficha técnica de matéria-prima, que o PDF
// de orçamento nunca mostra de propósito.
export type MateriaPrimaPdfOrdem = {
  materiaPrimaNome: string;
  varianteRotulo: string | null;
  quantidadeNecessaria: string; // já formatada com unidade, ex: "12,5 kg"
  // null = ficha técnica do próprio produto; preenchido = nome do acabamento
  // (ex: "Laminação fosco") que consome este material — distingue as duas
  // origens possíveis de uma mesma linha de ficha técnica (ver
  // buscarOrcamentoParaBaixa em src/app/producao/status-transicao.ts).
  origemAcabamento: string | null;
};

export type ItemPdfOrdemProducao = {
  nome: string;
  quantidade: number;
  medidas: string | null;
  // Achado F7 — espessura de chapa (corte a laser/router), separada de
  // `medidas` acima porque é outra unidade (sempre mm).
  espessura: string | null;
  cores: string | null;
  acabamento: string | null;
  acabamentosEstruturados: string[];
  etiquetaLinhas: [string, string][];
  hotStampingLinhas: string[];
  materiaPrima: MateriaPrimaPdfOrdem[];
};

export type DadosPdfOrdemProducao = {
  graficaNome: string;
  pedidoNumero: string; // id curto, ex: "a1b2c3d4"
  status: string;
  clienteNome: string;
  criadoEm: Date;
  prazoEntrega: Date | null;
  observacoes: string | null;
  // Achado A11 da auditoria de abrangência: preferência do CLIENTE (ex:
  // "sempre mandar arte em RGB", "não aceita variação de tom entre
  // lotes") — diferente de `observacoes` acima, que é nota do PEDIDO.
  preferenciasProducaoCliente: string | null;
  // Achado A13 da Parte 6 (auditoria de abrangência, 2026-08-29) —
  // tolerância de tiragem para exibir faixa aceitável de quantidade.
  // 0 = sem tolerância.
  toleranciaTiragemPercent: number;
  itens: ItemPdfOrdemProducao[];
};

const ROTULO_STATUS: Record<string, string> = {
  ARTE: "Arte",
  CLICHE_FACA: "Clichê/Faca",
  PRODUCAO: "Produção",
  ACABAMENTO: "Acabamento",
  CONFERENCIA: "Conferência",
  EMBALAGEM: "Embalagem",
  EXPEDICAO: "Expedição",
  ENTREGUE: "Entregue",
  CANCELADO: "Cancelado",
};

// Laranja — deliberadamente diferente do teal do PDF de orçamento, pra quem
// manuseia os dois documentos no chão de fábrica distinguir de longe qual é
// qual (documento interno vs. o que vai pro cliente).
const COR_DESTAQUE = "#c2410c";

const estilos = StyleSheet.create({
  pagina: { padding: 40, fontSize: 10, color: "#0f172a" },
  cabecalho: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 20,
    borderBottomWidth: 2,
    borderBottomColor: COR_DESTAQUE,
    paddingBottom: 12,
  },
  graficaNome: { fontSize: 12, color: "#64748b" },
  tituloDocumento: { fontSize: 18, fontWeight: "bold", color: "#0f172a" },
  numeroPedido: { fontSize: 10, color: "#64748b", marginTop: 2 },
  statusBadge: {
    fontSize: 9,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: "#fff7ed",
    color: COR_DESTAQUE,
  },
  secao: { marginBottom: 16 },
  dadosBox: {
    marginBottom: 16,
    padding: 10,
    borderRadius: 4,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    flexDirection: "row",
    flexWrap: "wrap",
  },
  dadosItem: { width: "50%", marginBottom: 4 },
  dadosRotulo: { fontSize: 7, color: "#94a3b8" },
  dadosValor: { fontSize: 10, color: "#0f172a", fontWeight: "bold" },
  observacoesBox: {
    marginBottom: 16,
    padding: 10,
    borderRadius: 4,
    backgroundColor: "#fefce8",
    borderWidth: 1,
    borderColor: "#fef08a",
  },
  observacoesTitulo: { fontSize: 8, fontWeight: "bold", color: "#854d0e", marginBottom: 4 },
  observacoesTexto: { fontSize: 9, color: "#713f12" },
  // Cor deliberadamente diferente da observacoesBox (amarelo, nota do
  // PEDIDO) — azul aqui, pra quem manuseia o documento no chão de fábrica
  // distinguir de longe "nota deste pedido" de "preferência permanente
  // deste cliente".
  preferenciasBox: {
    marginBottom: 16,
    padding: 10,
    borderRadius: 4,
    backgroundColor: "#eff6ff",
    borderWidth: 1,
    borderColor: "#bfdbfe",
  },
  preferenciasTitulo: { fontSize: 8, fontWeight: "bold", color: "#1e40af", marginBottom: 4 },
  preferenciasTexto: { fontSize: 9, color: "#1e3a8a" },
  itemBox: {
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 4,
  },
  itemCabecalho: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#f8fafc",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  itemNome: { fontSize: 11, fontWeight: "bold" },
  itemQtd: { fontSize: 11, fontWeight: "bold", color: COR_DESTAQUE },
  itemCorpo: { padding: 10 },
  detalhesItem: { fontSize: 9, color: "#475569", marginBottom: 6 },
  etiquetaBox: {
    marginTop: 4,
    marginBottom: 6,
    padding: 6,
    borderRadius: 3,
    backgroundColor: "#f8fafc",
  },
  etiquetaTitulo: { fontSize: 7, fontWeight: "bold", color: "#94a3b8", marginBottom: 2 },
  etiquetaLinha: { fontSize: 7, color: "#64748b" },
  fichaTecnicaBox: { marginTop: 4 },
  fichaTecnicaTitulo: { fontSize: 7, fontWeight: "bold", color: "#94a3b8", marginBottom: 3 },
  fichaTecnicaLinha: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 2,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  fichaTecnicaNome: { fontSize: 8.5, color: "#334155" },
  fichaTecnicaOrigem: { fontSize: 7, color: "#94a3b8" },
  fichaTecnicaQtd: { fontSize: 8.5, color: "#0f172a", fontWeight: "bold" },
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

export function OrdemProducaoDocumento({ dados }: { dados: DadosPdfOrdemProducao }) {
  const agora = new Date();

  return (
    <Document title={`Ordem de Produção — ${dados.clienteNome}`}>
      <Page size="A4" style={estilos.pagina}>
        <View style={estilos.cabecalho}>
          <View>
            <Text style={estilos.tituloDocumento}>ORDEM DE PRODUÇÃO</Text>
            <Text style={estilos.graficaNome}>{dados.graficaNome}</Text>
            <Text style={estilos.numeroPedido}>Pedido #{dados.pedidoNumero}</Text>
          </View>
          <Text style={estilos.statusBadge}>{ROTULO_STATUS[dados.status] ?? dados.status}</Text>
        </View>

        <View style={estilos.dadosBox}>
          <View style={estilos.dadosItem}>
            <Text style={estilos.dadosRotulo}>Cliente</Text>
            <Text style={estilos.dadosValor}>{dados.clienteNome}</Text>
          </View>
          <View style={estilos.dadosItem}>
            <Text style={estilos.dadosRotulo}>Prazo de entrega</Text>
            <Text style={estilos.dadosValor}>
              {dados.prazoEntrega ? formatoData.format(dados.prazoEntrega) : "Sem prazo definido"}
            </Text>
          </View>
          <View style={estilos.dadosItem}>
            <Text style={estilos.dadosRotulo}>Pedido criado em</Text>
            <Text style={estilos.dadosValor}>{formatoInstanteReal.format(dados.criadoEm)}</Text>
          </View>
        </View>

        {dados.preferenciasProducaoCliente && (
          <View style={estilos.preferenciasBox}>
            <Text style={estilos.preferenciasTitulo}>PREFERÊNCIAS DE PRODUÇÃO DO CLIENTE</Text>
            <Text style={estilos.preferenciasTexto}>{dados.preferenciasProducaoCliente}</Text>
          </View>
        )}

        {dados.observacoes && (
          <View style={estilos.observacoesBox}>
            <Text style={estilos.observacoesTitulo}>OBSERVAÇÕES INTERNAS</Text>
            <Text style={estilos.observacoesTexto}>{dados.observacoes}</Text>
          </View>
        )}

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
            <View key={indice} style={estilos.itemBox} wrap={false}>
              <View style={estilos.itemCabecalho}>
                <Text style={estilos.itemNome}>{item.nome}</Text>
                <Text style={estilos.itemQtd}>
                  {item.quantidade} un.
                  {dados.toleranciaTiragemPercent > 0 && (
                    <>
                      {" (aceita entre "}
                      {Math.round(item.quantidade * (1 - dados.toleranciaTiragemPercent / 100))}{" e "}
                      {Math.round(item.quantidade * (1 + dados.toleranciaTiragemPercent / 100))}
                      {")"}
                    </>
                  )}
                </Text>
              </View>
              <View style={estilos.itemCorpo}>
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
                {item.materiaPrima.length > 0 && (
                  <View style={estilos.fichaTecnicaBox}>
                    <Text style={estilos.fichaTecnicaTitulo}>MATÉRIA-PRIMA NECESSÁRIA</Text>
                    {item.materiaPrima.map((mp, i) => (
                      <View key={i} style={estilos.fichaTecnicaLinha}>
                        <View>
                          <Text style={estilos.fichaTecnicaNome}>
                            {mp.materiaPrimaNome}
                            {mp.varianteRotulo ? ` (${mp.varianteRotulo})` : ""}
                          </Text>
                          {mp.origemAcabamento && (
                            <Text style={estilos.fichaTecnicaOrigem}>
                              Para: {mp.origemAcabamento}
                            </Text>
                          )}
                        </View>
                        <Text style={estilos.fichaTecnicaQtd}>{mp.quantidadeNecessaria}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            </View>
          );
        })}

        <Text style={estilos.rodape} fixed>
          Documento interno de produção — gerado em {formatoInstanteReal.format(agora)} às{" "}
          {formatoInstanteRealHora.format(agora)}
        </Text>
      </Page>
    </Document>
  );
}
