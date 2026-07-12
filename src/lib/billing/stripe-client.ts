import "server-only";
import Stripe from "stripe";

// Instância criada de forma preguiçosa (só no primeiro uso real, não no
// import do módulo) — evita que o processo quebre no build/testes só por
// STRIPE_SECRET_KEY não estar configurada ainda (mesmo cuidado que qualquer
// env var obrigatória só-em-runtime no projeto).
let instancia: Stripe | undefined;

export function obterStripe(): Stripe {
  if (!instancia) {
    const chave = process.env.STRIPE_SECRET_KEY;
    if (!chave) {
      throw new Error("STRIPE_SECRET_KEY não configurada — veja .env.example.");
    }
    instancia = new Stripe(chave);
  }
  return instancia;
}
