// Puro (sem "server-only", sem Prisma, sem @vercel/blob) — decide O QUE
// fazer; quem chama (src/lib/lifecycle-cron.ts) faz o I/O de verdade
// (list/del/prisma). Mesma separação de src/lib/billing/limite-uso.ts.
//
// Existe porque o razão (tabela ArquivoArmazenado) pode divergir da verdade
// do Blob por três caminhos, todos precisando de tratamento diferente:
// reserva que nunca foi confirmada (crash entre reservar e subir), linha
// confirmada cujo blob sumiu por fora do app, e blob órfão (upload sem
// linha, ou linha apagada sem apagar o arquivo).

export type LinhaRazao = {
  id: string;
  url: string | null; // null = reserva pendente, ainda não confirmada
  bytes: number;
  createdAt: Date;
};

export type BlobReal = {
  url: string;
  pathname: string;
  size: number;
  uploadedAt: Date;
};

export type DiferencaReconciliacao = {
  // Reserva (url ainda null) criada há mais de 1h — o upload nunca
  // completou (crash, timeout). Segura de apagar: nada no Blob depende dela.
  reservasExpiradas: string[]; // ids de ArquivoArmazenado
  // Linha confirmada cujo `bytes` não bate com o tamanho real do blob —
  // corrige o número em vez de mexer no arquivo.
  paraCorrigirBytes: { id: string; bytesCorreto: number }[];
  // Linha confirmada cujo blob não existe mais no Blob (apagado por fora do
  // app) — a linha está superestimando o uso do tenant, remove do razão.
  paraRemoverDoRazao: string[];
  // Blob sem nenhuma linha de razão apontando pra ele, mais velho que 24h
  // (nunca um upload em voo) e fora do prefixo backups/ — é lixo do bug que
  // motivou esta feature (upload cuja linha nunca foi criada/confirmada).
  orfaosParaApagar: { pathname: string; url: string }[];
};

const UMA_HORA_MS = 60 * 60 * 1000;
const VINTE_QUATRO_HORAS_MS = 24 * 60 * 60 * 1000;

export function diferencaReconciliacao(
  linhasRazao: LinhaRazao[],
  blobsReais: BlobReal[],
  agora: Date = new Date()
): DiferencaReconciliacao {
  const blobsPorUrl = new Map(blobsReais.map((b) => [b.url, b]));
  const urlsReferenciadas = new Set(
    linhasRazao.map((l) => l.url).filter((url): url is string => url !== null)
  );

  const reservasExpiradas: string[] = [];
  const paraCorrigirBytes: { id: string; bytesCorreto: number }[] = [];
  const paraRemoverDoRazao: string[] = [];

  for (const linha of linhasRazao) {
    if (linha.url === null) {
      if (agora.getTime() - linha.createdAt.getTime() >= UMA_HORA_MS) {
        reservasExpiradas.push(linha.id);
      }
      continue;
    }
    const blob = blobsPorUrl.get(linha.url);
    if (!blob) {
      paraRemoverDoRazao.push(linha.id);
      continue;
    }
    if (blob.size !== linha.bytes) {
      paraCorrigirBytes.push({ id: linha.id, bytesCorreto: blob.size });
    }
  }

  const orfaosParaApagar = blobsReais
    .filter((blob) => {
      if (blob.pathname.startsWith("backups/")) return false; // nunca do tenant, ver §3 do design
      if (urlsReferenciadas.has(blob.url)) return false;
      return agora.getTime() - blob.uploadedAt.getTime() >= VINTE_QUATRO_HORAS_MS;
    })
    .map((blob) => ({ pathname: blob.pathname, url: blob.url }));

  return { reservasExpiradas, paraCorrigirBytes, paraRemoverDoRazao, orfaosParaApagar };
}
