// Texto padrão de termos e condições impresso no rodapé do PDF de orçamento
// (ver OrcamentoDocumento.tsx) quando a gráfica não configurou o próprio
// texto em ParametrosGrafica.termosCondicoesPdf (/configuracoes). Usado
// também como sugestão pré-carregada no formulário de configurações, pra
// nenhuma gráfica começar com o campo em branco — expor a gráfica
// juridicamente se um pedido for contestado depois.
//
// Referencia "a data indicada acima" em vez de reimprimir uma data literal
// de propósito: esse texto é armazenado como está (sem substituição por
// orçamento), então uma data fixa aqui ficaria desatualizada assim que o
// orçamento fosse duplicado ou reenviado. A data de verdade já é renderizada
// dinamicamente logo acima, na linha "Válido até" (ver dados.validoAteEm em
// OrcamentoDocumento.tsx), quando o orçamento tem uma.
export const TERMOS_CONDICOES_PDF_PADRAO =
  "Termos e condições: esta proposta tem validade até a data indicada acima " +
  "(quando informada); após esse prazo, os preços podem ser alterados sem " +
  "aviso prévio. Em caso de erro de arte aprovada pelo cliente, a " +
  "reimpressão terá custo adicional por conta do cliente. Condições de " +
  "pagamento conforme especificado neste orçamento; na ausência de " +
  "indicação, a combinar no fechamento do pedido.";
