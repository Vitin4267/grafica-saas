import { describe, it, expect, vi, afterEach } from "vitest";
import { dispararEventoAutomacao } from "./webhook-automacao";

describe("dispararEventoAutomacao", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const webhookUrl = "https://exemplo.app.n8n.cloud/webhook/abc";

  it("envia o payload envelopado com o tipo e dados corretos", async () => {
    let corpoCapturado: string | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, opts: RequestInit) => {
        corpoCapturado = opts.body as string;
        return new Response(null, { status: 200 });
      })
    );

    await dispararEventoAutomacao(webhookUrl, {
      tipo: "estoque_critico",
      graficaNome: "Gráfica Teste",
      itemNome: "Papel Couché 300g",
      estoqueAtual: 8.5,
      estoqueMinimo: 10,
    });

    const corpo = JSON.parse(corpoCapturado!);
    expect(corpo.tipo).toBe("estoque_critico");
    expect(corpo.idEvento).toMatch(/^evt_/);
    expect(corpo.versao).toBe(1);
    expect(corpo.dados).toEqual({
      graficaNome: "Gráfica Teste",
      itemNome: "Papel Couché 300g",
      estoqueAtual: 8.5,
      estoqueMinimo: 10,
    });
    // `tipo` não deve vazar duplicado dentro de `dados`
    expect(corpo.dados).not.toHaveProperty("tipo");
  });

  it("dois eventos disparados em sequência têm idEvento diferente", async () => {
    const corpos: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, opts: RequestInit) => {
        corpos.push(opts.body as string);
        return new Response(null, { status: 200 });
      })
    );

    const evento = {
      tipo: "estoque_critico" as const,
      graficaNome: "Gráfica Teste",
      itemNome: "Papel",
      estoqueAtual: 1,
      estoqueMinimo: 5,
    };
    await dispararEventoAutomacao(webhookUrl, evento);
    await dispararEventoAutomacao(webhookUrl, evento);

    const [primeiro, segundo] = corpos.map((c) => JSON.parse(c));
    expect(primeiro.idEvento).not.toBe(segundo.idEvento);
  });

  it("nunca lança erro com URL interna/inválida — não chega a chamar fetch", async () => {
    const fetchEspiao = vi.fn();
    vi.stubGlobal("fetch", fetchEspiao);

    await expect(
      dispararEventoAutomacao("https://127.0.0.1/webhook", {
        tipo: "estoque_critico",
        graficaNome: "Gráfica Teste",
        itemNome: "Papel",
        estoqueAtual: 1,
        estoqueMinimo: 5,
      })
    ).resolves.toBeUndefined();
    expect(fetchEspiao).not.toHaveBeenCalled();
  });

  it("nunca lança erro em timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const erro = new Error("timeout");
        erro.name = "TimeoutError";
        throw erro;
      })
    );

    await expect(
      dispararEventoAutomacao(webhookUrl, {
        tipo: "pedido_status_mudou",
        graficaNome: "Gráfica Teste",
        clienteNome: "Cliente Teste",
        clienteTelefone: null,
        statusAnterior: "FILA",
        statusNovo: "IMPRESSAO",
        orcamentoId: "orc_1",
      })
    ).resolves.toBeUndefined();
  });

  it("nunca lança erro em resposta não-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("erro", { status: 500 })));

    await expect(
      dispararEventoAutomacao(webhookUrl, {
        tipo: "estoque_critico",
        graficaNome: "Gráfica Teste",
        itemNome: "Papel",
        estoqueAtual: 1,
        estoqueMinimo: 5,
      })
    ).resolves.toBeUndefined();
  });
});
