import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";

// Mesmo recorte de informação do link público (/o/[token]) — nunca inclui
// breakdown (custo/margem), que é dado comercial sensível da gráfica.
export type ItemPdfOrcamento = {
  nome: string;
  quantidade: number;
  medidas: string | null;
  cores: string | null;
  acabamento: string | null;
  precoUnitario: string;
  precoTotal: string;
};

export type DadosPdfOrcamento = {
  graficaNome: string;
  logoUrl: string | null;
  clienteNome: string;
  status: "RASCUNHO" | "ENVIADO" | "APROVADO" | "REJEITADO";
  criadoEm: Date;
  itens: ItemPdfOrcamento[];
  total: string;
};

const ROTULO_STATUS: Record<string, string> = {
  RASCUNHO: "Rascunho",
  ENVIADO: "Enviado",
  APROVADO: "Aprovado",
  REJEITADO: "Rejeitado",
};

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

  return (
    <Document title={`Orçamento — ${dados.clienteNome}`}>
      <Page size="A4" style={estilos.pagina}>
        <View style={estilos.cabecalho}>
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
            Orçamento criado em {dados.criadoEm.toLocaleDateString("pt-BR")}
          </Text>
        </View>

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
              item.cores ? `Cores: ${item.cores}` : null,
              item.acabamento ? `Acabamento: ${item.acabamento}` : null,
            ].filter(Boolean);

            return (
              <View key={indice} style={estilos.linha}>
                <View style={estilos.colNome}>
                  <Text>{item.nome}</Text>
                  {detalhes.length > 0 && (
                    <Text style={estilos.detalhesItem}>{detalhes.join(" · ")}</Text>
                  )}
                </View>
                <Text style={estilos.colQtd}>{item.quantidade}</Text>
                <Text style={estilos.colUnit}>{item.precoUnitario}</Text>
                <Text style={estilos.colTotal}>{item.precoTotal}</Text>
              </View>
            );
          })}
        </View>

        <View style={estilos.totalBox}>
          <Text style={estilos.totalLabel}>Total do orçamento</Text>
          <Text style={estilos.totalValor}>{dados.total}</Text>
        </View>

        <Text style={estilos.rodape} fixed>
          Gerado em {agora.toLocaleDateString("pt-BR")} às {agora.toLocaleTimeString("pt-BR")}
        </Text>
      </Page>
    </Document>
  );
}
