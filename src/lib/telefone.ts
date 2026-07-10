// Cliente.telefone é texto livre, sem máscara nem validação — monta um link
// wa.me a partir do que o usuário digitou, assumindo DDI 55 (Brasil) quando o
// número já não vier com ele. Retorna null quando não dá pra montar um número
// plausível (vazio ou fora do range esperado de dígitos).
export function linkWhatsApp(
  telefone: string | null | undefined,
  mensagem: string
): string | null {
  if (!telefone) return null;

  const digitos = telefone.replace(/\D/g, "");
  const comDDI = digitos.length === 10 || digitos.length === 11 ? `55${digitos}` : digitos;

  if (comDDI.length !== 12 && comDDI.length !== 13) return null;

  return `https://wa.me/${comDDI}?text=${encodeURIComponent(mensagem)}`;
}
