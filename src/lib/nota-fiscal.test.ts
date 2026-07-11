import { describe, it, expect } from "vitest";
import { verificarProntidaoFiscal, type DadosFiscaisParaChecagem, type ClienteParaChecagem } from "./nota-fiscal";

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
});
