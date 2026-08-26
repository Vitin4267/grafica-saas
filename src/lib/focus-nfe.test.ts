import { describe, it, expect } from "vitest";
import { mapearItemNfePayload, normalizarDocumentoDestinatario, normalizarCnpjEmitente, type ItemNfe } from "./focus-nfe";

const itemBase: ItemNfe = {
  numeroItem: 1,
  codigoProduto: "item-1",
  descricao: "Cartão de Visita",
  ncm: "49111090",
  cfop: "5102",
  unidade: "UN",
  quantidade: 100,
  valorUnitario: 1.5,
  valorBruto: 150,
  icmsSituacaoTributaria: "102",
};

describe("mapearItemNfePayload", () => {
  it("Simples Nacional (CSOSN): não manda nenhum campo de ICMS do Regime Normal", () => {
    const payload = mapearItemNfePayload(itemBase);

    expect(payload.icms_situacao_tributaria).toBe("102");
    expect(payload.icms_origem).toBe("0");
    expect(payload).not.toHaveProperty("icms_modalidade_base_calculo");
    expect(payload).not.toHaveProperty("icms_base_calculo");
    expect(payload).not.toHaveProperty("icms_aliquota");
    expect(payload).not.toHaveProperty("icms_valor");
  });

  it("Simples Nacional: PIS/COFINS caem no default '07' preservando o comportamento atual", () => {
    const payload = mapearItemNfePayload(itemBase);

    expect(payload.pis_situacao_tributaria).toBe("07");
    expect(payload.cofins_situacao_tributaria).toBe("07");
  });

  it("Regime Normal (CST): manda os 4 campos de ICMS + icms_valor calculado", () => {
    const item: ItemNfe = {
      ...itemBase,
      icmsSituacaoTributaria: "00",
      icmsAliquota: 18,
      icmsBaseCalculo: 150,
      icmsModalidadeBaseCalculo: "3",
      pisSituacaoTributaria: "01",
      cofinsSituacaoTributaria: "01",
    };

    const payload = mapearItemNfePayload(item);

    expect(payload.icms_situacao_tributaria).toBe("00");
    expect(payload.icms_modalidade_base_calculo).toBe("3");
    expect(payload.icms_base_calculo).toBe("150.00");
    expect(payload.icms_aliquota).toBe("18.00");
    expect(payload.icms_valor).toBe("27.00"); // 150 * 18% = 27
    expect(payload.pis_situacao_tributaria).toBe("01");
    expect(payload.cofins_situacao_tributaria).toBe("01");
  });

  it("Regime Normal: icms_valor arredonda pra 2 casas decimais", () => {
    const item: ItemNfe = {
      ...itemBase,
      icmsAliquota: 17,
      icmsBaseCalculo: 33.33,
      icmsModalidadeBaseCalculo: "3",
    };

    const payload = mapearItemNfePayload(item);

    // 33.33 * 17 / 100 = 5.6661 -> "5.67"
    expect(payload.icms_valor).toBe("5.67");
  });

  it("campos numéricos e de identificação básicos continuam mapeados como antes", () => {
    const payload = mapearItemNfePayload(itemBase);

    expect(payload.numero_item).toBe("1");
    expect(payload.codigo_produto).toBe("item-1");
    expect(payload.descricao).toBe("Cartão de Visita");
    expect(payload.cfop).toBe("5102");
    expect(payload.unidade_comercial).toBe("UN");
    expect(payload.quantidade_comercial).toBe("100");
    expect(payload.valor_unitario_comercial).toBe("1.5000");
    expect(payload.codigo_ncm).toBe("49111090");
    expect(payload.valor_bruto).toBe("150.00");
  });
});

// Achado A2 da auditoria de abrangência (2026-08-24): a normalização antiga
// (`documento.replace(/\D/g, "")`) apagava as LETRAS do CNPJ alfanumérico
// (vigente desde 31/07/2026) e o número mutilado caía no branch de CPF, sem
// erro nenhum — dado fiscal errado enviado em silêncio.
describe("normalizarDocumentoDestinatario", () => {
  it("CNPJ numérico puro (14 dígitos) vira cnpj_destinatario", () => {
    expect(normalizarDocumentoDestinatario("12.345.678/0001-99")).toEqual({
      cnpj_destinatario: "12345678000199",
    });
  });

  it("CPF (11 dígitos) vira cpf_destinatario", () => {
    expect(normalizarDocumentoDestinatario("123.456.789-01")).toEqual({
      cpf_destinatario: "12345678901",
    });
  });

  it("CNPJ alfanumérico (12 posições alfanuméricas + 2 dígitos verificadores) mantém as letras — não trunca pra CPF", () => {
    expect(normalizarDocumentoDestinatario("12.ABC.345/01DE-35")).toEqual({
      cnpj_destinatario: "12ABC34501DE35",
    });
  });

  it("normaliza minúsculas pra maiúsculas (o CNPJ alfanumérico é sempre maiúsculo)", () => {
    expect(normalizarDocumentoDestinatario("12abc34501de35")).toEqual({
      cnpj_destinatario: "12ABC34501DE35",
    });
  });
});

describe("normalizarCnpjEmitente", () => {
  it("CNPJ numérico puro (14 dígitos) é mantido", () => {
    expect(normalizarCnpjEmitente("12345678000199")).toBe("12345678000199");
  });

  it("CNPJ numérico com pontuação é limpo", () => {
    expect(normalizarCnpjEmitente("12.345.678/0001-99")).toBe("12345678000199");
  });

  it("CNPJ alfanumérico (12 posições alfanuméricas + 2 dígitos verificadores) mantém as letras", () => {
    expect(normalizarCnpjEmitente("12ABC34501DE35")).toBe("12ABC34501DE35");
  });

  it("CNPJ alfanumérico com pontuação é limpo mantendo as letras", () => {
    expect(normalizarCnpjEmitente("12.ABC.345/01DE-35")).toBe("12ABC34501DE35");
  });

  it("normaliza minúsculas pra maiúsculas", () => {
    expect(normalizarCnpjEmitente("12abc34501de35")).toBe("12ABC34501DE35");
  });
});
