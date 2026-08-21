import { describe, it, expect } from "vitest";
import {
  TRANSICOES_VALIDAS,
  ROTULOS_STATUS_ORCAMENTO,
  orcamentoEstaExpirado,
  diasParado,
  orcamentoEstaParado,
  type StatusOrcamento,
} from "./orcamento-status";

const TODOS_STATUS: StatusOrcamento[] = ["RASCUNHO", "ENVIADO", "APROVADO", "REJEITADO"];

describe("TRANSICOES_VALIDAS", () => {
  it("RASCUNHO só pode virar ENVIADO", () => {
    expect(TRANSICOES_VALIDAS.RASCUNHO).toEqual(["ENVIADO"]);
  });

  it("ENVIADO pode virar APROVADO, REJEITADO ou voltar pra RASCUNHO (pedido de ajuste)", () => {
    expect(TRANSICOES_VALIDAS.ENVIADO).toEqual(["APROVADO", "REJEITADO", "RASCUNHO"]);
  });

  it("APROVADO e REJEITADO são estados terminais — nunca têm transição de saída", () => {
    // Invariante de negócio importante: uma vez aprovado ou rejeitado, o
    // orçamento nunca deve poder mudar de status de novo (ver comentário em
    // atualizarStatusOrcamento). Se isso quebrar, é uma regressão séria.
    expect(TRANSICOES_VALIDAS.APROVADO).toEqual([]);
    expect(TRANSICOES_VALIDAS.REJEITADO).toEqual([]);
  });

  it("nenhum status tem transição pra si mesmo (sem loop)", () => {
    for (const status of TODOS_STATUS) {
      expect(TRANSICOES_VALIDAS[status]).not.toContain(status);
    }
  });

  it("só ENVIADO tem transição de volta pra RASCUNHO — pedido de ajuste do cliente", () => {
    // Antes desta feature nenhum status voltava pra RASCUNHO (invariante
    // antiga). Mudou de propósito: reabrir só a partir de ENVIADO, nunca de
    // um estado terminal (APROVADO/REJEITADO) nem de RASCUNHO em si.
    for (const status of TODOS_STATUS) {
      if (status === "ENVIADO") {
        expect(TRANSICOES_VALIDAS[status]).toContain("RASCUNHO");
      } else {
        expect(TRANSICOES_VALIDAS[status]).not.toContain("RASCUNHO");
      }
    }
  });

  it("todo status tem um rótulo em português definido", () => {
    for (const status of TODOS_STATUS) {
      expect(ROTULOS_STATUS_ORCAMENTO[status]).toBeTruthy();
    }
  });
});

describe("orcamentoEstaExpirado", () => {
  it("nunca expira sem validoAteEm configurado", () => {
    expect(orcamentoEstaExpirado({ status: "ENVIADO", validoAteEm: null })).toBe(false);
  });

  it("não expira se o status não for ENVIADO, mesmo com validoAteEm no passado", () => {
    const passado = new Date(Date.now() - 1000);
    for (const status of ["RASCUNHO", "APROVADO", "REJEITADO"] as const) {
      expect(orcamentoEstaExpirado({ status, validoAteEm: passado })).toBe(false);
    }
  });

  it("expira quando ENVIADO e validoAteEm já passou", () => {
    const passado = new Date(Date.now() - 1000);
    expect(orcamentoEstaExpirado({ status: "ENVIADO", validoAteEm: passado })).toBe(true);
  });

  it("não expira quando ENVIADO mas validoAteEm ainda está no futuro", () => {
    const futuro = new Date(Date.now() + 1000);
    expect(orcamentoEstaExpirado({ status: "ENVIADO", validoAteEm: futuro })).toBe(false);
  });
});

describe("diasParado", () => {
  it("conta dias inteiros completos, arredondado pra baixo", () => {
    const agora = new Date("2026-08-21T12:00:00Z");
    expect(diasParado(new Date("2026-08-21T06:00:00Z"), agora)).toBe(0);
    expect(diasParado(new Date("2026-08-16T12:00:00Z"), agora)).toBe(5);
    expect(diasParado(new Date("2026-08-16T13:00:00Z"), agora)).toBe(4); // ainda não completou 5 dias inteiros
  });
});

describe("orcamentoEstaParado", () => {
  const agora = new Date("2026-08-21T12:00:00Z");
  const enviadoHa5Dias = new Date("2026-08-16T12:00:00Z");
  const enviadoHa10Dias = new Date("2026-08-11T12:00:00Z");
  const enviadoHa2Dias = new Date("2026-08-19T12:00:00Z");

  it("não está parado se o status não for ENVIADO, mesmo com envio antigo", () => {
    for (const status of ["RASCUNHO", "APROVADO", "REJEITADO"] as const) {
      expect(
        orcamentoEstaParado(
          { status, enviadoEm: enviadoHa10Dias, respostaPublicaEm: null },
          5,
          agora
        )
      ).toBe(false);
    }
  });

  it("não está parado sem enviadoEm (nunca foi enviado, ou orçamento antigo)", () => {
    expect(
      orcamentoEstaParado({ status: "ENVIADO", enviadoEm: null, respostaPublicaEm: null }, 5, agora)
    ).toBe(false);
  });

  it("não está parado se o cliente já respondeu pelo link público", () => {
    expect(
      orcamentoEstaParado(
        { status: "ENVIADO", enviadoEm: enviadoHa10Dias, respostaPublicaEm: agora },
        5,
        agora
      )
    ).toBe(false);
  });

  it("está parado quando ENVIADO, sem resposta e enviadoEm passou do limiar configurado", () => {
    expect(
      orcamentoEstaParado(
        { status: "ENVIADO", enviadoEm: enviadoHa10Dias, respostaPublicaEm: null },
        5,
        agora
      )
    ).toBe(true);
    expect(
      orcamentoEstaParado(
        { status: "ENVIADO", enviadoEm: enviadoHa5Dias, respostaPublicaEm: null },
        5,
        agora
      )
    ).toBe(true); // no limite exato (>=) já conta
  });

  it("não está parado se ainda não passou do limiar configurado pela gráfica", () => {
    expect(
      orcamentoEstaParado(
        { status: "ENVIADO", enviadoEm: enviadoHa2Dias, respostaPublicaEm: null },
        5,
        agora
      )
    ).toBe(false);
  });

  it("respeita um limiar diferente configurado por gráfica", () => {
    expect(
      orcamentoEstaParado(
        { status: "ENVIADO", enviadoEm: enviadoHa2Dias, respostaPublicaEm: null },
        2,
        agora
      )
    ).toBe(true);
  });
});
