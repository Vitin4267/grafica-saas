import "server-only";
import { Resend } from "resend";

// Instância criada de forma preguiçosa (só no primeiro uso real, não no
// import do módulo) — mesmo cuidado de src/lib/billing/stripe-client.ts:
// evita que o processo quebre no build/testes só por RESEND_API_KEY não
// estar configurada ainda.
let instancia: Resend | undefined;

export function obterResend(): Resend {
  if (!instancia) {
    const chave = process.env.RESEND_API_KEY;
    if (!chave) {
      throw new Error("RESEND_API_KEY não configurada — veja .env.example.");
    }
    instancia = new Resend(chave);
  }
  return instancia;
}

export function obterEmailRemetente(): string {
  const remetente = process.env.EMAIL_REMETENTE;
  if (!remetente) {
    throw new Error("EMAIL_REMETENTE não configurada — veja .env.example.");
  }
  return remetente;
}
