// Cliente.telefone é texto livre, sem máscara nem validação — normaliza pra
// dígitos + DDI (assume 55/Brasil quando o número já não vier com ele).
// Retorna null quando não dá pra montar um número plausível (vazio ou fora
// do range esperado de dígitos). Fonte única usada tanto pro link do
// WhatsApp quanto pelo payload do webhook de automação (estoque-critico.ts).
export function normalizarTelefone(telefone: string | null | undefined): string | null {
  if (!telefone) return null;

  const digitos = telefone.replace(/\D/g, "");
  const comDDI = digitos.length === 10 || digitos.length === 11 ? `55${digitos}` : digitos;

  if (comDDI.length !== 12 && comDDI.length !== 13) return null;

  return comDDI;
}

export function linkWhatsApp(
  telefone: string | null | undefined,
  mensagem: string
): string | null {
  const numero = normalizarTelefone(telefone);
  if (!numero) return null;

  return `https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}`;
}
