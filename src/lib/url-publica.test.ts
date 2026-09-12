import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Achado de produção (2026-09-12): um espaço sobrando em APP_URL (erro de
// copiar/colar na env var da Vercel) contaminava toda URL pública montada
// por resolverOrigemPublica — Stripe Checkout (success_url/cancel_url)
// rejeitava com "url_invalid" quando o espaço caía no MEIO da URL final
// (ex: "https://site.app /configuracoes/...", concatenado com "/rota").
// Mesmo padrão de mock de next/headers já usado em opcoes.test.ts.
vi.mock("next/headers", () => ({ headers: vi.fn() }));

import { headers } from "next/headers";
import { resolverOrigemPublica } from "./url-publica";

const APP_URL_ORIGINAL = process.env.APP_URL;

afterEach(() => {
  if (APP_URL_ORIGINAL === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = APP_URL_ORIGINAL;
  vi.mocked(headers).mockReset();
});

describe("resolverOrigemPublica — APP_URL configurada", () => {
  beforeEach(() => {
    vi.mocked(headers).mockResolvedValue(new Headers() as never);
  });

  it("remove espaço sobrando no final (achado de produção)", async () => {
    process.env.APP_URL = "https://grafica-saas-peach.vercel.app ";
    const origem = await resolverOrigemPublica();
    expect(origem).toBe("https://grafica-saas-peach.vercel.app");
  });

  it("remove espaço E barra final juntos, em qualquer ordem", async () => {
    process.env.APP_URL = "https://grafica-saas-peach.vercel.app/ ";
    expect(await resolverOrigemPublica()).toBe("https://grafica-saas-peach.vercel.app");

    process.env.APP_URL = " https://grafica-saas-peach.vercel.app/";
    expect(await resolverOrigemPublica()).toBe("https://grafica-saas-peach.vercel.app");
  });

  it("remove barra(s) final(is) — comportamento de sempre, regressão zero", async () => {
    process.env.APP_URL = "https://grafica-saas-peach.vercel.app///";
    expect(await resolverOrigemPublica()).toBe("https://grafica-saas-peach.vercel.app");
  });

  it("sem espaço nem barra sobrando: valor passa intacto", async () => {
    process.env.APP_URL = "https://grafica-saas-peach.vercel.app";
    expect(await resolverOrigemPublica()).toBe("https://grafica-saas-peach.vercel.app");
  });
});

describe("resolverOrigemPublica — fallback por header (sem APP_URL, dev local)", () => {
  it("monta proto+host a partir dos headers quando APP_URL não está setada", async () => {
    delete process.env.APP_URL;
    vi.mocked(headers).mockResolvedValue(
      new Headers({ host: "localhost:3000", "x-forwarded-proto": "http" }) as never
    );

    const origem = await resolverOrigemPublica();
    expect(origem).toBe("http://localhost:3000");
  });
});
