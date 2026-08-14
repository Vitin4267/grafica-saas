import { describe, it, expect, vi, afterEach } from "vitest";
import { solicitarAnaliseTinta, ErroWebhookTinta } from "./webhook-tinta";

const config = { webhookUrl: "https://exemplo.app.n8n.cloud/webhook/tinta", secret: "segredo-teste" };
const input = {
  analiseId: "atn_abc123",
  imagemUrl: "https://store.private.blob.vercel-storage.com/tinta/img.png?sig=x",
  imagemTipo: "image/png",
  graficaNome: "Gráfica Teste",
  job: {
    produtoNome: "Rótulo BOPP",
    modeloCalculo: "M2" as const,
    quantidade: 1000,
    larguraCm: 9.5,
    alturaCm: 5,
    cores: "4x0",
    corFrente: 4,
    corVerso: 0,
    substrato: "BOPP_BCO_FOSCO",
  },
};

const respostaSucesso = {
  ok: true,
  analiseId: input.analiseId,
  coberturaPercentual: 22.6,
  coberturaPorCor: { ciano: 22.1, magenta: 15.4, amarelo: 40.2, preto: 12.8 },
  consumoMlPorPeca: 0.0134,
  consumoMlTotal: 13.4,
  confianca: "media",
  observacao: "Fundo amarelo domina o consumo.",
  modelo: "gpt-4o-mini",
};

describe("solicitarAnaliseTinta", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("envia envelopado com o header X-Tinta-Secret e sem campo extra em dados", async () => {
    let corpoCapturado: string | undefined;
    let headersCapturados: HeadersInit | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, opts: RequestInit) => {
        corpoCapturado = opts.body as string;
        headersCapturados = opts.headers;
        return new Response(JSON.stringify(respostaSucesso), { status: 200 });
      })
    );

    await solicitarAnaliseTinta(config, {
      ...input,
      // @ts-expect-error -- simula um chamador que tenta passar campo extra por engano
      precoTotal: 999,
    });

    const corpo = JSON.parse(corpoCapturado!);
    expect(Object.keys(corpo).sort()).toEqual(["dados", "idEvento", "timestamp", "tipo", "versao"]);
    expect(corpo.tipo).toBe("analise_tinta_solicitada");
    expect(corpo.dados).not.toHaveProperty("precoTotal");
    expect(corpo.dados.job).not.toHaveProperty("precoTotal");
    expect((headersCapturados as Record<string, string>)["X-Tinta-Secret"]).toBe("segredo-teste");
  });

  it("caminho feliz: devolve os campos normalizados", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(respostaSucesso), { status: 200 })));

    const resultado = await solicitarAnaliseTinta(config, input);
    expect(resultado.consumoMlTotal).toBe(13.4);
    expect(resultado.confianca).toBe("media");
  });

  it("rejeita quando o analiseId da resposta não bate com o enviado", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ...respostaSucesso, analiseId: "outro-id" }), { status: 200 }))
    );

    await expect(solicitarAnaliseTinta(config, input)).rejects.toThrow(/não corresponde/);
  });

  it("trata ok:false como erro, usando a mensagem devolvida", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: false, analiseId: input.analiseId, erro: "Sem dimensão." }), {
            status: 200,
          })
      )
    );

    await expect(solicitarAnaliseTinta(config, input)).rejects.toThrow(/Sem dimensão/);
  });

  it("rejeita cobertura fora de faixa (0-100)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ...respostaSucesso, coberturaPercentual: 150 }), { status: 200 })
      )
    );

    await expect(solicitarAnaliseTinta(config, input)).rejects.toBeInstanceOf(ErroWebhookTinta);
  });

  it("rejeita corpo maior que 20KB antes mesmo de tentar parsear", async () => {
    const corpoEnorme = "a".repeat(20_001);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(corpoEnorme, { status: 200 })));

    await expect(solicitarAnaliseTinta(config, input)).rejects.toThrow(/grande demais/);
  });

  it("lança ErroWebhookTinta quando o corpo da resposta excede o limite de bytes (antes mesmo do corte de 20KB)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("a".repeat(2_100_000), { status: 200 }))
    );

    await expect(solicitarAnaliseTinta(config, input)).rejects.toThrow(/grande demais/);
  });

  it("lança ErroWebhookTinta em resposta não-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("erro interno", { status: 500 })));

    await expect(solicitarAnaliseTinta(config, input)).rejects.toBeInstanceOf(ErroWebhookTinta);
  });

  it("lança ErroWebhookTinta em timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const erro = new Error("timeout");
        erro.name = "TimeoutError";
        throw erro;
      })
    );

    await expect(solicitarAnaliseTinta(config, input)).rejects.toThrow(/demorou demais/);
  });

  it("rejeita antes de chamar fetch se a URL salva for interna", async () => {
    const fetchEspiao = vi.fn();
    vi.stubGlobal("fetch", fetchEspiao);

    await expect(
      solicitarAnaliseTinta({ webhookUrl: "https://127.0.0.1/webhook", secret: "x" }, input)
    ).rejects.toBeInstanceOf(ErroWebhookTinta);
    expect(fetchEspiao).not.toHaveBeenCalled();
  });
});
