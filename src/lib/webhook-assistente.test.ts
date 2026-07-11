import { describe, it, expect, vi, afterEach } from "vitest";
import { validarWebhookUrl, perguntarAssistente, ErroWebhookAssistente } from "./webhook-assistente";

describe("validarWebhookUrl", () => {
  it("aceita uma URL https pública", () => {
    expect(validarWebhookUrl("https://minhaempresa.app.n8n.cloud/webhook/abc123")).toEqual({
      ok: true,
    });
  });

  it("rejeita http (não criptografado)", () => {
    expect(validarWebhookUrl("http://minhaempresa.app.n8n.cloud/webhook/abc").ok).toBe(false);
  });

  it("rejeita URL malformada", () => {
    expect(validarWebhookUrl("nem-uma-url").ok).toBe(false);
  });

  it.each([
    "https://localhost/webhook",
    "https://127.0.0.1/webhook",
    "https://10.0.0.5/webhook",
    "https://172.16.0.1/webhook",
    "https://192.168.1.1/webhook",
    "https://169.254.169.254/webhook", // metadata de nuvem — caso crítico
    "https://[::1]/webhook",
    "https://minha-maquina.local/webhook",
  ])("rejeita endereço interno/privado: %s", (url) => {
    expect(validarWebhookUrl(url).ok).toBe(false);
  });

  it("não rejeita um IP público parecido com privado só no primeiro octeto", () => {
    // 172.32.x.x está FORA da faixa privada 172.16.0.0/12 (16-31) — não deve barrar.
    expect(validarWebhookUrl("https://172.32.0.1/webhook").ok).toBe(true);
  });
});

describe("perguntarAssistente", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const config = { webhookUrl: "https://exemplo.app.n8n.cloud/webhook/abc" };
  const input = { pergunta: "Como cadastro um cliente?", pagina: "Clientes", graficaNome: "Gráfica Teste" };

  it("nunca envia mais do que pergunta/pagina/graficaNome no corpo", async () => {
    let corpoCapturado: string | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, opts: RequestInit) => {
        corpoCapturado = opts.body as string;
        return new Response(JSON.stringify({ resposta: "Oi!" }), { status: 200 });
      })
    );

    await perguntarAssistente(config, {
      ...input,
      // @ts-expect-error -- simula um chamador que tenta passar campo extra por engano
      orcamentoValor: 999,
    });

    const corpo = JSON.parse(corpoCapturado!);
    expect(Object.keys(corpo).sort()).toEqual(["graficaNome", "pagina", "pergunta"]);
    expect(corpo).not.toHaveProperty("orcamentoValor");
  });

  it("caminho feliz: resposta JSON com campo resposta", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ resposta: "Vá em Clientes > Novo." }), { status: 200 }))
    );

    const resultado = await perguntarAssistente(config, input);
    expect(resultado.resposta).toBe("Vá em Clientes > Novo.");
  });

  it("fallback: corpo não-JSON vira texto puro", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Vá em Clientes > Novo.", { status: 200 })));

    const resultado = await perguntarAssistente(config, input);
    expect(resultado.resposta).toBe("Vá em Clientes > Novo.");
  });

  it("lança ErroWebhookAssistente em resposta não-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("erro interno", { status: 500 })));

    await expect(perguntarAssistente(config, input)).rejects.toBeInstanceOf(ErroWebhookAssistente);
  });

  it("lança ErroWebhookAssistente em timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const erro = new Error("timeout");
        erro.name = "TimeoutError";
        throw erro;
      })
    );

    await expect(perguntarAssistente(config, input)).rejects.toThrow(/demorou demais/);
  });

  it("rejeita antes de chamar fetch se a URL salva for interna", async () => {
    const fetchEspiao = vi.fn();
    vi.stubGlobal("fetch", fetchEspiao);

    await expect(
      perguntarAssistente({ webhookUrl: "https://127.0.0.1/webhook" }, input)
    ).rejects.toBeInstanceOf(ErroWebhookAssistente);
    expect(fetchEspiao).not.toHaveBeenCalled();
  });
});
