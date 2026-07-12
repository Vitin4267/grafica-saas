import "server-only";

// Formato único de mensagem do hub de automações — TODO evento que sai pro
// webhook n8n de uma gráfica (chat do assistente incluso) passa por aqui,
// nunca monta o corpo da requisição na mão. Isso garante que idEvento/
// timestamp/versao existem sempre, do mesmo jeito, em todo lugar (padrão
// Stripe/GitHub/Shopify de webhook).
export type EnvelopeEvento<Tipo extends string, Dados> = {
  idEvento: string;
  tipo: Tipo;
  timestamp: string;
  versao: 1;
  dados: Dados;
};

// versao é um número só pro envelope inteiro, não por tipo de evento — se um
// tipo específico precisar de uma mudança incompatível no futuro, a saída é
// um novo `tipo` (ex: "pedido_status_mudou_v2"), não uma versão paralela.
export function construirEnvelope<Tipo extends string, Dados>(
  tipo: Tipo,
  dados: Dados
): EnvelopeEvento<Tipo, Dados> {
  return {
    idEvento: `evt_${crypto.randomUUID()}`,
    tipo,
    timestamp: new Date().toISOString(),
    versao: 1,
    dados,
  };
}
