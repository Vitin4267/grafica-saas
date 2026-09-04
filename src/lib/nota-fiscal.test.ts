import { describe, it, expect } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import type { TipoFrete } from "@/generated/prisma/enums";
import {
  verificarProntidaoFiscal,
  resolverCfop,
  resolverModalidadeFrete,
  resolverCfopTerceirizacao,
  fornecedorProntoParaNfe,
  type DadosFiscaisParaChecagem,
  type ClienteParaChecagem,
  type FornecedorParaChecagemNfe,
} from "./nota-fiscal";

const dadosFiscaisCompletos: DadosFiscaisParaChecagem = {
  focusNfeToken: "token-123",
  cnpj: "12345678000199",
  razaoSocial: "Gráfica Teste LTDA",
  enderecoLogradouro: "Rua A",
  enderecoNumero: "100",
  enderecoBairro: "Centro",
  enderecoMunicipio: "Curitiba",
  enderecoUf: "PR",
  enderecoCep: "80000000",
  regimeTributario: "SIMPLES_NACIONAL",
  cstIcmsPadrao: null,
  icmsAliquotaPadrao: null,
  icmsModalidadeBaseCalculoPadrao: null,
  pisCofinsSituacaoTributariaPadrao: null,
};

const dadosFiscaisRegimeNormalCompletos: DadosFiscaisParaChecagem = {
  ...dadosFiscaisCompletos,
  regimeTributario: "LUCRO_PRESUMIDO",
  cstIcmsPadrao: "00",
  icmsAliquotaPadrao: new Prisma.Decimal(18),
  icmsModalidadeBaseCalculoPadrao: "3",
  pisCofinsSituacaoTributariaPadrao: "01",
};

const clienteCompleto: ClienteParaChecagem = {
  documento: "12345678900",
  enderecoLogradouro: "Av B",
  enderecoNumero: "200",
  enderecoBairro: "Bairro",
  enderecoMunicipio: "Curitiba",
  enderecoUf: "PR",
  enderecoCep: "80000001",
};

describe("verificarProntidaoFiscal", () => {
  it("tudo configurado: pronto=true e sem pendências", () => {
    const resultado = verificarProntidaoFiscal({
      dadosFiscais: dadosFiscaisCompletos,
      cliente: clienteCompleto,
      itens: [{ nome: "Cartão de Visita", ncm: "49111090" }],
    });
    expect(resultado).toEqual({ pronto: true, pendencias: [] });
  });

  it("sem dados fiscais configurados: acumula as 3 pendências da gráfica", () => {
    const resultado = verificarProntidaoFiscal({
      dadosFiscais: null,
      cliente: clienteCompleto,
      itens: [{ nome: "Item", ncm: "1" }],
    });
    expect(resultado.pronto).toBe(false);
    expect(resultado.pendencias).toEqual([
      "Token da Focus NFe não configurado (Configurações → Dados fiscais).",
      "CNPJ e razão social da gráfica não configurados (Configurações → Dados fiscais).",
      "Endereço da gráfica incompleto (Configurações → Dados fiscais).",
    ]);
  });

  it("cliente sem documento: uma pendência específica", () => {
    const resultado = verificarProntidaoFiscal({
      dadosFiscais: dadosFiscaisCompletos,
      cliente: { ...clienteCompleto, documento: null },
      itens: [{ nome: "Item", ncm: "1" }],
    });
    expect(resultado.pronto).toBe(false);
    expect(resultado.pendencias).toContain("Cliente sem CPF/CNPJ cadastrado.");
  });

  it("endereço do cliente incompleto (falta só um campo) já bloqueia", () => {
    const resultado = verificarProntidaoFiscal({
      dadosFiscais: dadosFiscaisCompletos,
      cliente: { ...clienteCompleto, enderecoUf: null },
      itens: [{ nome: "Item", ncm: "1" }],
    });
    expect(resultado.pendencias).toContain("Endereço do cliente incompleto.");
  });

  it("lista pelo nome todo item sem NCM, mas não os que já têm", () => {
    const resultado = verificarProntidaoFiscal({
      dadosFiscais: dadosFiscaisCompletos,
      cliente: clienteCompleto,
      itens: [
        { nome: "Com NCM", ncm: "123" },
        { nome: "Sem NCM 1", ncm: null },
        { nome: "Sem NCM 2", ncm: null },
      ],
    });
    expect(resultado.pendencias).toEqual(["NCM não configurado para: Sem NCM 1, Sem NCM 2."]);
  });

  it("Regime Normal com os 4 campos fiscais completos: pronto=true", () => {
    const resultado = verificarProntidaoFiscal({
      dadosFiscais: dadosFiscaisRegimeNormalCompletos,
      cliente: clienteCompleto,
      itens: [{ nome: "Cartão de Visita", ncm: "49111090" }],
    });
    expect(resultado).toEqual({ pronto: true, pendencias: [] });
  });

  it("Regime Normal sem nenhum dos 4 campos fiscais: bloqueia com mensagem listando o que falta", () => {
    const resultado = verificarProntidaoFiscal({
      dadosFiscais: { ...dadosFiscaisCompletos, regimeTributario: "LUCRO_PRESUMIDO" },
      cliente: clienteCompleto,
      itens: [{ nome: "Item", ncm: "1" }],
    });
    expect(resultado.pronto).toBe(false);
    const pendencia = resultado.pendencias.find((p) => p.startsWith("Regime tributário fora do Simples Nacional"));
    expect(pendencia).toBeDefined();
    expect(pendencia).toContain("CST-ICMS padrão");
    expect(pendencia).toContain("alíquota de ICMS padrão");
    expect(pendencia).toContain("modalidade de base de cálculo do ICMS padrão");
    expect(pendencia).toContain("situação tributária de PIS/COFINS padrão");
  });

  it("Regime Normal com só a alíquota faltando: pendência lista só o que falta", () => {
    const resultado = verificarProntidaoFiscal({
      dadosFiscais: { ...dadosFiscaisRegimeNormalCompletos, icmsAliquotaPadrao: null },
      cliente: clienteCompleto,
      itens: [{ nome: "Item", ncm: "1" }],
    });
    expect(resultado.pronto).toBe(false);
    const pendencia = resultado.pendencias.find((p) => p.startsWith("Regime tributário fora do Simples Nacional"));
    expect(pendencia).toBe(
      "Regime tributário fora do Simples Nacional exige a configuração de: alíquota de ICMS padrão (Configurações → Dados fiscais)."
    );
  });

  it("Simples Nacional nunca exige os 4 campos novos, mesmo se estiverem todos nulos", () => {
    const resultado = verificarProntidaoFiscal({
      dadosFiscais: dadosFiscaisCompletos, // regimeTributario: SIMPLES_NACIONAL, campos novos null
      cliente: clienteCompleto,
      itens: [{ nome: "Cartão de Visita", ncm: "49111090" }],
    });
    expect(resultado).toEqual({ pronto: true, pendencias: [] });
  });

  // Achado A1 da auditoria de abrangência (2026-08-27): sem essa pendência,
  // um cliente marcado como contribuinte de ICMS sem IE só aparecia como
  // rejeição SEFAZ 728 opaca, na hora de emitir.
  it("cliente CONTRIBUINTE sem Inscrição Estadual: bloqueia com pendência específica", () => {
    const resultado = verificarProntidaoFiscal({
      dadosFiscais: dadosFiscaisCompletos,
      cliente: { ...clienteCompleto, indicadorInscricaoEstadual: "CONTRIBUINTE", inscricaoEstadual: null },
      itens: [{ nome: "Item", ncm: "1" }],
    });
    expect(resultado.pronto).toBe(false);
    expect(resultado.pendencias).toContain(
      "Cliente marcado como contribuinte de ICMS sem Inscrição Estadual cadastrada."
    );
  });

  it("cliente CONTRIBUINTE com Inscrição Estadual cadastrada: não bloqueia", () => {
    const resultado = verificarProntidaoFiscal({
      dadosFiscais: dadosFiscaisCompletos,
      cliente: { ...clienteCompleto, indicadorInscricaoEstadual: "CONTRIBUINTE", inscricaoEstadual: "1234567890" },
      itens: [{ nome: "Cartão de Visita", ncm: "49111090" }],
    });
    expect(resultado).toEqual({ pronto: true, pendencias: [] });
  });

  it("cliente ISENTO sem IE: nunca dispara a pendência (IE não é obrigatória pra isento)", () => {
    const resultado = verificarProntidaoFiscal({
      dadosFiscais: dadosFiscaisCompletos,
      cliente: { ...clienteCompleto, indicadorInscricaoEstadual: "ISENTO", inscricaoEstadual: null },
      itens: [{ nome: "Cartão de Visita", ncm: "49111090" }],
    });
    expect(resultado).toEqual({ pronto: true, pendencias: [] });
  });

  it("cliente NAO_CONTRIBUINTE sem IE: nunca dispara a pendência", () => {
    const resultado = verificarProntidaoFiscal({
      dadosFiscais: dadosFiscaisCompletos,
      cliente: { ...clienteCompleto, indicadorInscricaoEstadual: "NAO_CONTRIBUINTE", inscricaoEstadual: null },
      itens: [{ nome: "Cartão de Visita", ncm: "49111090" }],
    });
    expect(resultado).toEqual({ pronto: true, pendencias: [] });
  });

  it("cliente antigo sem indicador cadastrado (undefined): não dispara a pendência nova, comportamento de hoje preservado", () => {
    const resultado = verificarProntidaoFiscal({
      dadosFiscais: dadosFiscaisCompletos,
      cliente: clienteCompleto, // sem indicadorInscricaoEstadual/inscricaoEstadual no objeto
      itens: [{ nome: "Cartão de Visita", ncm: "49111090" }],
    });
    expect(resultado).toEqual({ pronto: true, pendencias: [] });
  });
});

describe("resolverCfop", () => {
  const base = { cfopPadrao: "5102", cfopPadraoInterestadual: "6102" };

  it("mesma UF (emitente e destinatário): usa cfopPadrao (venda interna)", () => {
    const resultado = resolverCfop({ ufEmitente: "PR", ufDestinatario: "PR", ...base });
    expect(resultado).toBe("5102");
  });

  it("UF diferente entre emitente e destinatário: usa cfopPadraoInterestadual", () => {
    const resultado = resolverCfop({ ufEmitente: "PR", ufDestinatario: "SP", ...base });
    expect(resultado).toBe("6102");
  });

  it("UF do emitente ausente (null): cai no cfopPadrao, sem regressão pra dado incompleto", () => {
    const resultado = resolverCfop({ ufEmitente: null, ufDestinatario: "SP", ...base });
    expect(resultado).toBe("5102");
  });

  it("UF do destinatário ausente (null): cai no cfopPadrao, sem regressão pra dado incompleto", () => {
    const resultado = resolverCfop({ ufEmitente: "PR", ufDestinatario: null, ...base });
    expect(resultado).toBe("5102");
  });

  it("as duas UFs ausentes: cai no cfopPadrao", () => {
    const resultado = resolverCfop({ ufEmitente: null, ufDestinatario: null, ...base });
    expect(resultado).toBe("5102");
  });

  it("respeita CFOPs padrão customizados pela gráfica, não hardcoded", () => {
    const resultado = resolverCfop({
      ufEmitente: "PR",
      ufDestinatario: "SP",
      cfopPadrao: "5405",
      cfopPadraoInterestadual: "6404",
    });
    expect(resultado).toBe("6404");
  });
});

describe("resolverModalidadeFrete", () => {
  const casos: [TipoFrete, string][] = [
    ["CIF_REMETENTE", "0"],
    ["FOB_DESTINATARIO", "1"],
    ["TERCEIROS", "2"],
    ["PROPRIO_REMETENTE", "3"],
    ["PROPRIO_DESTINATARIO", "4"],
    ["SEM_FRETE", "9"],
  ];

  it.each(casos)("%s mapeia pro modFrete %s", (frete, modFrete) => {
    expect(resolverModalidadeFrete(frete)).toBe(modFrete);
  });

  it("null (frete não informado no orçamento) cai em 9 — sem ocorrência de transporte", () => {
    expect(resolverModalidadeFrete(null)).toBe("9");
  });
});

// Achado R3 da auditoria de abrangência (rodada 20, 2026-09-03).
describe("resolverCfopTerceirizacao", () => {
  it("REMESSA, mesma UF: 5901", () => {
    expect(resolverCfopTerceirizacao({ ufEmitente: "PR", ufFornecedor: "PR", tipo: "REMESSA" })).toBe("5901");
  });

  it("REMESSA, UF diferente: 6901", () => {
    expect(resolverCfopTerceirizacao({ ufEmitente: "PR", ufFornecedor: "SP", tipo: "REMESSA" })).toBe("6901");
  });

  it("RETORNO, mesma UF: 5902", () => {
    expect(resolverCfopTerceirizacao({ ufEmitente: "PR", ufFornecedor: "PR", tipo: "RETORNO" })).toBe("5902");
  });

  it("RETORNO, UF diferente: 6902", () => {
    expect(resolverCfopTerceirizacao({ ufEmitente: "PR", ufFornecedor: "SP", tipo: "RETORNO" })).toBe("6902");
  });

  it("UF do emitente ausente: cai no código de mesma UF (5901)", () => {
    expect(resolverCfopTerceirizacao({ ufEmitente: null, ufFornecedor: "SP", tipo: "REMESSA" })).toBe("5901");
  });

  it("UF do fornecedor ausente: cai no código de mesma UF (5901)", () => {
    expect(resolverCfopTerceirizacao({ ufEmitente: "PR", ufFornecedor: null, tipo: "REMESSA" })).toBe("5901");
  });

  it("as duas UFs ausentes: cai no código de mesma UF", () => {
    expect(resolverCfopTerceirizacao({ ufEmitente: null, ufFornecedor: null, tipo: "REMESSA" })).toBe("5901");
    expect(resolverCfopTerceirizacao({ ufEmitente: null, ufFornecedor: null, tipo: "RETORNO" })).toBe("5902");
  });
});

describe("fornecedorProntoParaNfe", () => {
  const fornecedorCompleto: FornecedorParaChecagemNfe = {
    documento: "12345678000199",
    enderecoLogradouro: "Rua A",
    enderecoNumero: "100",
    enderecoBairro: "Centro",
    enderecoMunicipio: "Curitiba",
    enderecoUf: "PR",
    enderecoCep: "80000000",
  };

  it("fornecedor null: não está pronto", () => {
    expect(fornecedorProntoParaNfe(null)).toBe(false);
  });

  it("documento e endereço completos: pronto", () => {
    expect(fornecedorProntoParaNfe(fornecedorCompleto)).toBe(true);
  });

  it("sem documento: não está pronto", () => {
    expect(fornecedorProntoParaNfe({ ...fornecedorCompleto, documento: null })).toBe(false);
  });

  it("endereço incompleto (falta só um campo): não está pronto", () => {
    expect(fornecedorProntoParaNfe({ ...fornecedorCompleto, enderecoUf: null })).toBe(false);
  });
});
