import { describe, it, expect } from "vitest";
import { resolverLimiteDesconto, resolverLimiteAprovacaoCompra, type AlcadaParaResolucao } from "./alcada-aprovacao";

// Testes de UNIDADE (função pura, sem banco) — achado A4 da auditoria de
// abrangência (pesquisa-abrangencia-modulos.md, Parte 6/Configurações).
// Cobertura de integração real (Vitest + Postgres) fica em
// src/app/orcamento/[id]/actions.alcada.test.ts e
// src/app/compras/alcada-aprovacao.test.ts.

describe("resolverLimiteDesconto", () => {
  it("sem nenhuma alçada configurada, DONO fica sem teto (100%) — comportamento de sempre", () => {
    const limite = resolverLimiteDesconto({ id: "u1", papel: "DONO" }, [], 15);
    expect(limite).toBe(100);
  });

  it("sem nenhuma alçada configurada, ADMIN fica sem teto (100%) — comportamento de sempre", () => {
    const limite = resolverLimiteDesconto({ id: "u1", papel: "ADMIN" }, [], 15);
    expect(limite).toBe(100);
  });

  it("sem nenhuma alçada configurada, OPERADOR fica travado no limite global da gráfica — comportamento de sempre", () => {
    const limite = resolverLimiteDesconto({ id: "u1", papel: "OPERADOR" }, [], 15);
    expect(limite).toBe(15);
  });

  it("alçada do PAPEL substitui o fallback (mesmo pra DONO/ADMIN, se alguém configurar)", () => {
    const alcadas: AlcadaParaResolucao[] = [{ papel: "OPERADOR", usuarioId: null, limite: 5 }];
    expect(resolverLimiteDesconto({ id: "u1", papel: "OPERADOR" }, alcadas, 15)).toBe(5);
    // DONO/ADMIN sem alçada própria configurada continuam no fallback de sempre.
    expect(resolverLimiteDesconto({ id: "u2", papel: "DONO" }, alcadas, 15)).toBe(100);
  });

  it("alçada do USUÁRIO tem prioridade sobre a alçada do PAPEL", () => {
    const alcadas: AlcadaParaResolucao[] = [
      { papel: "OPERADOR", usuarioId: null, limite: 5 },
      { papel: null, usuarioId: "vendedor-senior", limite: 10 },
    ];
    // Vendedor sênior (OPERADOR com alçada própria) usa a DELE, não a do papel.
    expect(resolverLimiteDesconto({ id: "vendedor-senior", papel: "OPERADOR" }, alcadas, 15)).toBe(10);
    // Outro OPERADOR qualquer, sem alçada própria, cai na alçada do papel.
    expect(resolverLimiteDesconto({ id: "outro-operador", papel: "OPERADOR" }, alcadas, 15)).toBe(5);
  });

  it("alçada do usuário pode ser MENOR que a do papel (restringe, não só amplia)", () => {
    const alcadas: AlcadaParaResolucao[] = [
      { papel: "OPERADOR", usuarioId: null, limite: 10 },
      { papel: null, usuarioId: "estagiario", limite: 2 },
    ];
    expect(resolverLimiteDesconto({ id: "estagiario", papel: "OPERADOR" }, alcadas, 15)).toBe(2);
  });
});

describe("resolverLimiteAprovacaoCompra", () => {
  it("sem nenhuma alçada configurada, devolve null (sem teto) — comportamento de sempre pra qualquer papel", () => {
    expect(resolverLimiteAprovacaoCompra({ id: "u1", papel: "OPERADOR" }, [])).toBeNull();
    expect(resolverLimiteAprovacaoCompra({ id: "u2", papel: "DONO" }, [])).toBeNull();
  });

  it("alçada do PAPEL vira o teto pra quem tem esse papel", () => {
    const alcadas: AlcadaParaResolucao[] = [{ papel: "OPERADOR", usuarioId: null, limite: 500 }];
    expect(resolverLimiteAprovacaoCompra({ id: "u1", papel: "OPERADOR" }, alcadas)).toBe(500);
    expect(resolverLimiteAprovacaoCompra({ id: "u2", papel: "DONO" }, alcadas)).toBeNull();
  });

  it("alçada do USUÁRIO tem prioridade sobre a alçada do PAPEL", () => {
    const alcadas: AlcadaParaResolucao[] = [
      { papel: "OPERADOR", usuarioId: null, limite: 500 },
      { papel: null, usuarioId: "comprador-chefe", limite: 5000 },
    ];
    expect(resolverLimiteAprovacaoCompra({ id: "comprador-chefe", papel: "OPERADOR" }, alcadas)).toBe(5000);
    expect(resolverLimiteAprovacaoCompra({ id: "outro", papel: "OPERADOR" }, alcadas)).toBe(500);
  });
});
