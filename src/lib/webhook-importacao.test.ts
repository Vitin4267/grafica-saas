import { describe, it, expect, vi, afterEach } from "vitest";
import { solicitarMapeamentoPlanilha, ErroWebhookImportacao } from "./webhook-importacao";

const config = { webhookUrl: "https://exemplo.app.n8n.cloud/webhook/importacao", secret: "segredo-teste" };
const input = {
  mapeamentoId: "imp_abc123",
  tipo: "CLIENTES" as const,
  graficaNome: "Gráfica Teste",
  camposDisponiveis: ["nome", "email", "telefone", "ignorar"],
  cabecalhos: ["Nome do cliente", "E-mail", "Telefone"],
  linhasAmostra: [
    ["Fulano de Tal", "fulano@teste.com", "11999999999"],
    ["Beltrano Silva", "beltrano@teste.com", ""],
  ],
};

const respostaSucesso = {
  ok: true,
  mapeamentoId: input.mapeamentoId,
  sugestoes: [
    { indice: 0, campo: "nome", confianca: "alta" },
    { indice: 1, campo: "email", confianca: "alta" },
    { indice: 2, campo: "telefone", confianca: "media" },
  ],
};

describe("solicitarMapeamentoPlanilha", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("envia envelopado com o header X-Importacao-Secret e sem campo extra em dados", async () => {
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

    await solicitarMapeamentoPlanilha(config, {
      ...input,
      // @ts-expect-error -- simula um chamador que tenta passar campo extra por engano
      precoTotal: 999,
    });

    const corpo = JSON.parse(corpoCapturado!);
    expect(Object.keys(corpo).sort()).toEqual(["dados", "idEvento", "timestamp", "tipo", "versao"]);
    expect(corpo.tipo).toBe("mapeamento_planilha_solicitado");
    expect(corpo.dados).not.toHaveProperty("precoTotal");
    expect((headersCapturados as Record<string, string>)["X-Importacao-Secret"]).toBe("segredo-teste");
  });

  it("caminho feliz: devolve as sugestões", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(respostaSucesso), { status: 200 })));

    const resultado = await solicitarMapeamentoPlanilha(config, input);
    expect(resultado.sugestoes).toHaveLength(3);
    expect(resultado.sugestoes[0]).toEqual({ indice: 0, campo: "nome", confianca: "alta" });
  });

  it("rejeita quando o mapeamentoId da resposta não bate com o enviado", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ...respostaSucesso, mapeamentoId: "outro-id" }), { status: 200 }))
    );

    await expect(solicitarMapeamentoPlanilha(config, input)).rejects.toThrow(/não corresponde/);
  });

  it("trata ok:false como erro, usando a mensagem devolvida", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: false, mapeamentoId: input.mapeamentoId, erro: "Cabeçalho vazio." }), {
            status: 200,
          })
      )
    );

    await expect(solicitarMapeamentoPlanilha(config, input)).rejects.toThrow(/Cabeçalho vazio/);
  });

  it("rejeita sugestão com confiança fora do enum", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ok: true,
              mapeamentoId: input.mapeamentoId,
              sugestoes: [{ indice: 0, campo: "nome", confianca: "certeza-absoluta" }],
            }),
            { status: 200 }
          )
      )
    );

    await expect(solicitarMapeamentoPlanilha(config, input)).rejects.toBeInstanceOf(ErroWebhookImportacao);
  });

  it("rejeita corpo maior que 100KB antes mesmo de tentar parsear", async () => {
    const corpoEnorme = "a".repeat(100_001);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(corpoEnorme, { status: 200 })));

    await expect(solicitarMapeamentoPlanilha(config, input)).rejects.toThrow(/grande demais/);
  });

  it("lança ErroWebhookImportacao quando o corpo da resposta excede o limite de bytes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("a".repeat(2_100_000), { status: 200 })));

    await expect(solicitarMapeamentoPlanilha(config, input)).rejects.toThrow(/grande demais/);
  });

  it("lança ErroWebhookImportacao em resposta não-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("erro interno", { status: 500 })));

    await expect(solicitarMapeamentoPlanilha(config, input)).rejects.toBeInstanceOf(ErroWebhookImportacao);
  });

  it("lança ErroWebhookImportacao em timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const erro = new Error("timeout");
        erro.name = "TimeoutError";
        throw erro;
      })
    );

    await expect(solicitarMapeamentoPlanilha(config, input)).rejects.toThrow(/demorou demais/);
  });

  it("rejeita antes de chamar fetch se a URL salva for interna", async () => {
    const fetchEspiao = vi.fn();
    vi.stubGlobal("fetch", fetchEspiao);

    await expect(
      solicitarMapeamentoPlanilha({ webhookUrl: "https://127.0.0.1/webhook", secret: "x" }, input)
    ).rejects.toBeInstanceOf(ErroWebhookImportacao);
    expect(fetchEspiao).not.toHaveBeenCalled();
  });
});
