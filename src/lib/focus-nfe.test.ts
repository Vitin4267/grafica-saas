import { describe, it, expect } from "vitest";
import {
  mapearItemNfePayload,
  normalizarDocumentoDestinatario,
  normalizarCnpjEmitente,
  mapearIndicadorInscricaoEstadual,
  mapearOrigemMercadoria,
  montarCamposIeDestinatario,
  resolverNomeDestinatario,
  type ItemNfe,
} from "./focus-nfe";
import type { IndicadorInscricaoEstadual, OrigemMercadoria } from "@/generated/prisma/enums";

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

  // Achado N6 da auditoria de abrangência (Parte 7, 2026-09-03):
  // mapearItemNfePayload mandava icms_origem: "0" fixo pra todo item, de
  // toda gráfica — sem campo nenhum de origem no catálogo. Regressão zero:
  // item sem origem configurada continua caindo em "0" (nacional).
  it("item sem origemMercadoria configurada (undefined): icms_origem cai em '0' — regressão zero", () => {
    const payload = mapearItemNfePayload(itemBase);
    expect(payload.icms_origem).toBe("0");
  });

  it("item com origemMercadoria null: icms_origem cai em '0'", () => {
    const payload = mapearItemNfePayload({ ...itemBase, origemMercadoria: null });
    expect(payload.icms_origem).toBe("0");
  });

  it("item com origemMercadoria NACIONAL_0: icms_origem '0'", () => {
    const payload = mapearItemNfePayload({ ...itemBase, origemMercadoria: "NACIONAL_0" });
    expect(payload.icms_origem).toBe("0");
  });

  it("item com origemMercadoria de brinde importado (ESTRANGEIRA_IMPORTACAO_DIRETA_1): icms_origem '1'", () => {
    const payload = mapearItemNfePayload({
      ...itemBase,
      origemMercadoria: "ESTRANGEIRA_IMPORTACAO_DIRETA_1",
    });
    expect(payload.icms_origem).toBe("1");
  });

  it("item com origemMercadoria estrangeira adquirida no mercado interno (ex: ACM importado comprado de distribuidor nacional): icms_origem '2'", () => {
    const payload = mapearItemNfePayload({
      ...itemBase,
      origemMercadoria: "ESTRANGEIRA_MERCADO_INTERNO_2",
    });
    expect(payload.icms_origem).toBe("2");
  });

  it("item com conteúdo de importação acima de 70% (NACIONAL_CONTEUDO_IMPORTACAO_ACIMA_70_8): icms_origem '8'", () => {
    const payload = mapearItemNfePayload({
      ...itemBase,
      origemMercadoria: "NACIONAL_CONTEUDO_IMPORTACAO_ACIMA_70_8",
    });
    expect(payload.icms_origem).toBe("8");
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

// Achado A1 da auditoria de abrangência (2026-08-27): antes disso o payload
// nunca mandava indicador_inscricao_estadual_destinatario nem
// inscricao_estadual_destinatario pra Focus NFe/SEFAZ. Códigos confirmados
// contra pesquisa-abrangencia-modulos.md (Parte 5, achado A1), que cita a
// doc da Focus NFe (tag indIEDest da NF-e 4.0) e as rejeições SEFAZ 728/791.
describe("mapearIndicadorInscricaoEstadual", () => {
  const casos: [IndicadorInscricaoEstadual, string][] = [
    ["CONTRIBUINTE", "1"],
    ["ISENTO", "2"],
    ["NAO_CONTRIBUINTE", "9"],
  ];

  it.each(casos)("%s mapeia pro código %s", (indicador, codigo) => {
    expect(mapearIndicadorInscricaoEstadual(indicador)).toBe(codigo);
  });

  it("null (cliente antigo, sem indicador cadastrado) retorna undefined", () => {
    expect(mapearIndicadorInscricaoEstadual(null)).toBeUndefined();
  });
});

// Achado N6 da auditoria de abrangência (2026-09-03): os 9 códigos da
// Tabela B do CST/ICMS (Convênio S/N 70/2012).
describe("mapearOrigemMercadoria", () => {
  const casos: [OrigemMercadoria, string][] = [
    ["NACIONAL_0", "0"],
    ["ESTRANGEIRA_IMPORTACAO_DIRETA_1", "1"],
    ["ESTRANGEIRA_MERCADO_INTERNO_2", "2"],
    ["NACIONAL_CONTEUDO_IMPORTACAO_40_A_70_3", "3"],
    ["NACIONAL_PROCESSO_PRODUTIVO_BASICO_4", "4"],
    ["NACIONAL_CONTEUDO_IMPORTACAO_ATE_40_5", "5"],
    ["ESTRANGEIRA_IMPORTACAO_DIRETA_SEM_SIMILAR_6", "6"],
    ["ESTRANGEIRA_MERCADO_INTERNO_SEM_SIMILAR_7", "7"],
    ["NACIONAL_CONTEUDO_IMPORTACAO_ACIMA_70_8", "8"],
  ];

  it.each(casos)("%s mapeia pro código %s", (origem, codigo) => {
    expect(mapearOrigemMercadoria(origem)).toBe(codigo);
  });

  it("null (item sem origem configurada) retorna '0' — mesmo comportamento fixo de sempre", () => {
    expect(mapearOrigemMercadoria(null)).toBe("0");
  });

  it("undefined (campo nem passado) retorna '0'", () => {
    expect(mapearOrigemMercadoria(undefined)).toBe("0");
  });
});

describe("montarCamposIeDestinatario", () => {
  it("CONTRIBUINTE com IE preenchida: manda os dois campos", () => {
    const campos = montarCamposIeDestinatario("CONTRIBUINTE", "1234567890");
    expect(campos).toEqual({
      indicador_inscricao_estadual_destinatario: "1",
      inscricao_estadual_destinatario: "1234567890",
    });
  });

  it("CONTRIBUINTE sem IE preenchida: manda só o indicador, nunca inscricao_estadual_destinatario vazio", () => {
    const campos = montarCamposIeDestinatario("CONTRIBUINTE", null);
    expect(campos).toEqual({ indicador_inscricao_estadual_destinatario: "1" });
  });

  it("ISENTO: manda só o indicador, NUNCA a IE — mesmo se ela vier preenchida (evita rejeição SEFAZ 791)", () => {
    const campos = montarCamposIeDestinatario("ISENTO", "1234567890");
    expect(campos).toEqual({ indicador_inscricao_estadual_destinatario: "2" });
  });

  it("NAO_CONTRIBUINTE: manda só o indicador, nunca a IE", () => {
    const campos = montarCamposIeDestinatario("NAO_CONTRIBUINTE", "1234567890");
    expect(campos).toEqual({ indicador_inscricao_estadual_destinatario: "9" });
  });

  it("indicador null (cliente antigo): não manda nenhum dos dois campos, mesmo comportamento de hoje", () => {
    expect(montarCamposIeDestinatario(null, null)).toEqual({});
  });

  it("indicador undefined (campo nem passado): mesmo resultado de null", () => {
    expect(montarCamposIeDestinatario(undefined, undefined)).toEqual({});
  });
});

// Achado A1 — a nota DEVE usar razão social, nome fantasia não tem validade
// jurídica pra documento fiscal.
describe("resolverNomeDestinatario", () => {
  it("razaoSocial presente: usa razaoSocial, não nome", () => {
    expect(resolverNomeDestinatario({ nome: "Fantasia Ltda", razaoSocial: "Razão Social Real LTDA" })).toBe(
      "Razão Social Real LTDA"
    );
  });

  it("razaoSocial ausente (null): cai em nome — comportamento de hoje pra cliente antigo/pessoa física", () => {
    expect(resolverNomeDestinatario({ nome: "João da Silva", razaoSocial: null })).toBe("João da Silva");
  });

  it("razaoSocial ausente (undefined): cai em nome", () => {
    expect(resolverNomeDestinatario({ nome: "João da Silva" })).toBe("João da Silva");
  });

  it("razaoSocial string vazia: cai em nome (nunca manda destinatário vazio)", () => {
    expect(resolverNomeDestinatario({ nome: "João da Silva", razaoSocial: "" })).toBe("João da Silva");
  });
});
