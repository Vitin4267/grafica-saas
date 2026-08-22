import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";

// Etiqueta física pra colar no produto (não um documento de várias páginas
// como OrdemProducaoDocumento) — por isso o tamanho de página é um
// quadrado pequeno (~90mm), não A4, pensado pra sair de impressora comum e
// ser recortado/colado no pacote. Ver src/app/producao/[pedidoId]/etiqueta/route.tsx.
export type DadosPdfEtiquetaPedido = {
  graficaNome: string;
  pedidoNumero: string; // id curto, ex: "a1b2c3d4"
  clienteNome: string;
  itensResumo: string;
  // Data URI (PNG base64) já pronta — gerada por src/lib/qr-code.ts antes de
  // renderizar, nunca calculada dentro do componente (mantém este arquivo
  // puramente de apresentação, mesmo padrão dos outros *Documento.tsx).
  qrDataUrl: string;
};

// 90mm × 90mm em pontos (1mm ≈ 2.83465pt) — tamanho de etiqueta comum pra
// colar em pacote/produto, cabe numa folha de adesivo A4 recortada em 2×2.
const TAMANHO_ETIQUETA_PT: [number, number] = [255, 255];

const estilos = StyleSheet.create({
  pagina: {
    padding: 14,
    fontSize: 9,
    color: "#0f172a",
    alignItems: "center",
  },
  graficaNome: {
    fontSize: 8,
    color: "#64748b",
    textAlign: "center",
    marginBottom: 6,
  },
  qrImagem: {
    width: 170,
    height: 170,
  },
  pedidoNumero: {
    fontSize: 13,
    fontWeight: "bold",
    color: "#0f172a",
    marginTop: 8,
  },
  clienteNome: {
    fontSize: 10,
    color: "#334155",
    textAlign: "center",
    marginTop: 2,
  },
  itensResumo: {
    fontSize: 8,
    color: "#64748b",
    textAlign: "center",
    marginTop: 2,
    paddingHorizontal: 4,
  },
  instrucao: {
    fontSize: 7,
    color: "#94a3b8",
    textAlign: "center",
    marginTop: 8,
  },
});

export function EtiquetaPedidoDocumento({ dados }: { dados: DadosPdfEtiquetaPedido }) {
  return (
    <Document title={`Etiqueta — Pedido ${dados.pedidoNumero}`}>
      <Page size={TAMANHO_ETIQUETA_PT} style={estilos.pagina}>
        <Text style={estilos.graficaNome}>{dados.graficaNome}</Text>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- Image do @react-pdf/renderer (PDF), não <img> do DOM — esse componente nem tem prop alt */}
        <Image src={dados.qrDataUrl} style={estilos.qrImagem} />
        <Text style={estilos.pedidoNumero}>Pedido #{dados.pedidoNumero}</Text>
        <View>
          <Text style={estilos.clienteNome}>{dados.clienteNome}</Text>
          <Text style={estilos.itensResumo}>{dados.itensResumo}</Text>
        </View>
        <Text style={estilos.instrucao}>Escaneie pra ver e atualizar o status</Text>
      </Page>
    </Document>
  );
}
