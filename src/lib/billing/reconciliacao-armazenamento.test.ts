import { describe, it, expect } from "vitest";
import { diferencaReconciliacao, type LinhaRazao, type BlobReal } from "./reconciliacao-armazenamento";

const AGORA = new Date("2026-08-12T12:00:00Z");
const HORAS_ATRAS = (h: number) => new Date(AGORA.getTime() - h * 60 * 60 * 1000);

describe("diferencaReconciliacao", () => {
  it("razão e Blob idênticos: nenhuma ação", () => {
    const linhas: LinhaRazao[] = [{ id: "l1", url: "https://x/a.png", bytes: 100, createdAt: HORAS_ATRAS(48) }];
    const blobs: BlobReal[] = [{ url: "https://x/a.png", pathname: "arte/a.png", size: 100, uploadedAt: HORAS_ATRAS(48) }];
    const resultado = diferencaReconciliacao(linhas, blobs, AGORA);
    expect(resultado).toEqual({
      reservasExpiradas: [],
      paraCorrigirBytes: [],
      paraRemoverDoRazao: [],
      orfaosParaApagar: [],
    });
  });

  it("linha confirmada sem blob correspondente: remove do razão", () => {
    const linhas: LinhaRazao[] = [{ id: "l1", url: "https://x/sumiu.png", bytes: 100, createdAt: HORAS_ATRAS(48) }];
    const resultado = diferencaReconciliacao(linhas, [], AGORA);
    expect(resultado.paraRemoverDoRazao).toEqual(["l1"]);
  });

  it("bytes divergentes: corrige pro valor real do blob", () => {
    const linhas: LinhaRazao[] = [{ id: "l1", url: "https://x/a.png", bytes: 100, createdAt: HORAS_ATRAS(48) }];
    const blobs: BlobReal[] = [{ url: "https://x/a.png", pathname: "arte/a.png", size: 999, uploadedAt: HORAS_ATRAS(48) }];
    const resultado = diferencaReconciliacao(linhas, blobs, AGORA);
    expect(resultado.paraCorrigirBytes).toEqual([{ id: "l1", bytesCorreto: 999 }]);
  });

  it("blob sem linha, mais velho que 24h: órfão a apagar", () => {
    const blobs: BlobReal[] = [{ url: "https://x/orfao.png", pathname: "arte/orfao.png", size: 100, uploadedAt: HORAS_ATRAS(25) }];
    const resultado = diferencaReconciliacao([], blobs, AGORA);
    expect(resultado.orfaosParaApagar).toEqual([{ pathname: "arte/orfao.png", url: "https://x/orfao.png" }]);
  });

  it("blob sem linha, mais novo que 24h: NUNCA apaga (pode ser upload em voo)", () => {
    const blobs: BlobReal[] = [{ url: "https://x/novo.png", pathname: "arte/novo.png", size: 100, uploadedAt: HORAS_ATRAS(1) }];
    const resultado = diferencaReconciliacao([], blobs, AGORA);
    expect(resultado.orfaosParaApagar).toEqual([]);
  });

  it("blob sob backups/ nunca é considerado órfão, mesmo sem linha e antigo", () => {
    const blobs: BlobReal[] = [{ url: "https://x/backups/dump.json", pathname: "backups/dump.json", size: 5000, uploadedAt: HORAS_ATRAS(200) }];
    const resultado = diferencaReconciliacao([], blobs, AGORA);
    expect(resultado.orfaosParaApagar).toEqual([]);
  });

  it("reserva (url null) com menos de 1h: mantida", () => {
    const linhas: LinhaRazao[] = [{ id: "l1", url: null, bytes: 100, createdAt: HORAS_ATRAS(0.5) }];
    const resultado = diferencaReconciliacao(linhas, [], AGORA);
    expect(resultado.reservasExpiradas).toEqual([]);
  });

  it("reserva (url null) com mais de 1h: expirada", () => {
    const linhas: LinhaRazao[] = [{ id: "l1", url: null, bytes: 100, createdAt: HORAS_ATRAS(2) }];
    const resultado = diferencaReconciliacao(linhas, [], AGORA);
    expect(resultado.reservasExpiradas).toEqual(["l1"]);
  });
});
