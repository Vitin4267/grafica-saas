// Query string, não POST — é um link que o navegador abre direto, não uma
// chamada servidor-a-servidor (por isso não tem X-*-Secret como os outros
// webhooks). Pré-preencher poupa o cliente de digitar quem ele é; ver
// SUPORTE_FORM_URL em .env.example pro cuidado sobre recursos de terceiros
// vazando isso via Referer.
export function montarUrlSuporte(dados: {
  nome: string;
  email: string;
  graficaNome: string;
}): string | null {
  const base = process.env.SUPORTE_FORM_URL;
  if (!base) return null;

  try {
    const url = new URL(base);
    // Chaves batem com o Field Label exato de cada campo no n8n Form
    // Trigger (Nome/Email/Gráfica, maiúscula e com acento) — este form não
    // tem um Field Name customizado, então o label É a chave, confirmado
    // testando uma submissão real e conferindo o JSON que o node recebeu.
    url.searchParams.set("Nome", dados.nome);
    url.searchParams.set("Email", dados.email);
    url.searchParams.set("Gráfica", dados.graficaNome);
    return url.toString();
  } catch {
    return null;
  }
}
