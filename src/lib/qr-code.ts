import "server-only";
import QRCode from "qrcode";

// Wrapper fino sobre a lib `qrcode` — escolhida por ser a mais estabelecida
// do ecossistema Node pra geração de QR (sem dependência nativa, gera
// direto em Buffer/data URI, sem precisar de canvas/DOM), leve o bastante
// pra rodar em serverless sem custo perceptível. Só usada no servidor (ver
// server-only acima): a etiqueta é montada inteira no backend antes de virar
// PDF (ver src/lib/pdf/EtiquetaPedidoDocumento.tsx e
// src/app/producao/[pedidoId]/etiqueta/route.tsx).
//
// Data URI (PNG base64) em vez de SVG bruto porque @react-pdf/renderer
// consome a mesma prop `src` de <Image> que já usa pro logo da gráfica em
// OrcamentoDocumento.tsx — nenhum código novo de embutir imagem no PDF.
// Nível de correção de erro "M" (padrão da lib): o conteúdo é sempre uma URL
// curta, não precisa da tolerância a dano físico dos níveis mais altos.
export async function gerarQrCodeDataUrl(conteudo: string): Promise<string> {
  return QRCode.toDataURL(conteudo, { margin: 1, width: 512 });
}
