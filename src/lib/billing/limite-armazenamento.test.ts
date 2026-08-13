import { describe, it, expect } from "vitest";
import {
  mbParaBytes,
  formatarBytes,
  resolverLimiteArmazenamentoMb,
  cabeNoLimite,
  espacoDisponivelBytes,
  percentualUsado,
  mensagemEspacoInsuficiente,
  LIMITE_ARMAZENAMENTO_TRIAL_MB,
  LIMITE_ARMAZENAMENTO_SEM_PLANO_MB,
} from "./limite-armazenamento";

describe("mbParaBytes", () => {
  it("converte MB pra bytes", () => {
    expect(mbParaBytes(1)).toBe(1024 * 1024);
    expect(mbParaBytes(250)).toBe(250 * 1024 * 1024);
  });
});

describe("formatarBytes", () => {
  it("bytes puros, sem casa decimal", () => {
    expect(formatarBytes(500)).toBe("500 B");
  });

  it("KB", () => {
    expect(formatarBytes(2048)).toBe("2,0 KB");
  });

  it("MB", () => {
    expect(formatarBytes(200 * 1024 * 1024)).toBe("200,0 MB");
  });

  it("GB", () => {
    expect(formatarBytes(1.2 * 1024 * 1024 * 1024)).toBe("1,2 GB");
  });

  it("fronteira: valor que arredonda pra 1024,0 KB sobe pra 1,0 MB", () => {
    expect(formatarBytes(1048530)).toBe("1,0 MB");
  });
});

describe("resolverLimiteArmazenamentoMb", () => {
  it("cortesia sempre usa o teto alto, mesmo com plano ausente", () => {
    expect(
      resolverLimiteArmazenamentoMb({ status: "ATIVA", cortesia: true, plano: null })
    ).toBe(LIMITE_ARMAZENAMENTO_SEM_PLANO_MB);
  });

  it("trial sem plano usa o teto de trial", () => {
    expect(
      resolverLimiteArmazenamentoMb({ status: "TRIALING", cortesia: false, plano: null })
    ).toBe(LIMITE_ARMAZENAMENTO_TRIAL_MB);
  });

  it("status ruim sem plano (grandfathered/cancelada) usa o teto alto, não o de trial", () => {
    expect(
      resolverLimiteArmazenamentoMb({ status: "CANCELADA", cortesia: false, plano: null })
    ).toBe(LIMITE_ARMAZENAMENTO_SEM_PLANO_MB);
  });

  it("plano presente sempre vence, mesmo em TRIALING (ex: trial via Stripe com cartão)", () => {
    expect(
      resolverLimiteArmazenamentoMb({
        status: "TRIALING",
        cortesia: false,
        plano: { limiteArmazenamentoMb: 25600 },
      })
    ).toBe(25600);
  });

  it("plano ATIVA usa o limite do próprio plano", () => {
    expect(
      resolverLimiteArmazenamentoMb({
        status: "ATIVA",
        cortesia: false,
        plano: { limiteArmazenamentoMb: 5120 },
      })
    ).toBe(5120);
  });
});

describe("cabeNoLimite", () => {
  it("cabe quando soma fica exatamente no teto", () => {
    expect(
      cabeNoLimite({ usadoBytes: 900, bytesLiberados: 0, arquivoBytes: 100, limiteBytes: 1000 })
    ).toBe(true);
  });

  it("não cabe 1 byte acima do teto", () => {
    expect(
      cabeNoLimite({ usadoBytes: 900, bytesLiberados: 0, arquivoBytes: 101, limiteBytes: 1000 })
    ).toBe(false);
  });

  it("substituição do mesmo tamanho a 100% da cota cabe, via bytesLiberados", () => {
    expect(
      cabeNoLimite({ usadoBytes: 1000, bytesLiberados: 500, arquivoBytes: 500, limiteBytes: 1000 })
    ).toBe(true);
  });

  it("bytesLiberados maior que o arquivo novo libera espaço extra", () => {
    expect(
      cabeNoLimite({ usadoBytes: 1000, bytesLiberados: 800, arquivoBytes: 300, limiteBytes: 1000 })
    ).toBe(true);
  });
});

describe("espacoDisponivelBytes", () => {
  it("calcula a diferença", () => {
    expect(espacoDisponivelBytes({ usadoBytes: 300, limiteBytes: 1000 })).toBe(700);
  });

  it("nunca fica negativo, mesmo passado do limite", () => {
    expect(espacoDisponivelBytes({ usadoBytes: 1500, limiteBytes: 1000 })).toBe(0);
  });
});

describe("percentualUsado", () => {
  it("calcula a proporção", () => {
    expect(percentualUsado({ usadoBytes: 250, limiteBytes: 1000 })).toBe(25);
  });

  it("satura em 100 mesmo passado do limite", () => {
    expect(percentualUsado({ usadoBytes: 1500, limiteBytes: 1000 })).toBe(100);
  });

  it("nunca fica negativo", () => {
    expect(percentualUsado({ usadoBytes: -10, limiteBytes: 1000 })).toBe(0);
  });
});

describe("mensagemEspacoInsuficiente", () => {
  it("mensagem de trial", () => {
    const mensagem = mensagemEspacoInsuficiente({
      usadoBytes: mbParaBytes(243),
      limiteBytes: mbParaBytes(250),
      nomePlano: "Básico",
      ehTrial: true,
    });
    expect(mensagem).toContain("teste gratuito");
    expect(mensagem).toContain("250,0 MB");
  });

  it("mensagem de plano pago inclui o nome do plano", () => {
    const mensagem = mensagemEspacoInsuficiente({
      usadoBytes: mbParaBytes(24800),
      limiteBytes: mbParaBytes(25600),
      nomePlano: "Pro",
      ehTrial: false,
    });
    expect(mensagem).toContain("plano Pro");
  });
});
