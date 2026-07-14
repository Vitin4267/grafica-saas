import "server-only";

const TIMEOUT_MS = 8_000;

// Widget puramente opcional (mesmo padrão de ASSISTENTE_WEBHOOK_URL): sem
// TURNSTILE_SECRET_KEY configurada, ninguém é bloqueado — o site continua
// funcionando exatamente como antes. O rate limit de login (rate-limit.ts)
// já é a defesa principal contra bot; isto é uma camada extra + visual.
export async function verificarTurnstile(
  token: string | null,
  ip: string | null
): Promise<boolean> {
  const secretKey = process.env.TURNSTILE_SECRET_KEY;
  if (!secretKey) return true;
  if (!token) return false;

  const corpo = new URLSearchParams({ secret: secretKey, response: token });
  if (ip) corpo.set("remoteip", ip);

  try {
    const resposta = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: corpo,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json: unknown = await resposta.json();
    return (
      typeof json === "object" &&
      json !== null &&
      "success" in json &&
      (json as { success: unknown }).success === true
    );
  } catch {
    // Cloudflare fora do ar não pode travar todo mundo de logar — falha
    // aberta de propósito (o rate limit continua de pé de qualquer jeito).
    return true;
  }
}
