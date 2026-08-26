// Catálogo de campos-alvo por tipo de importação — usado tanto pro dropdown
// de mapeamento na tela de confirmação quanto pro `camposDisponiveis`
// mandado no request de sugestão (src/lib/webhook-importacao.ts). Sem
// "server-only": consumido também por um client component (a tela de
// mapeamento), mesmo raciocínio de src/lib/producao-estagios.ts.
import type { TipoImportacaoPlanilha } from "@/generated/prisma/enums";

export type CampoImportacao = { valor: string; rotulo: string; obrigatorio: boolean };

const IGNORAR: CampoImportacao = { valor: "ignorar", rotulo: "Não importar essa coluna", obrigatorio: false };

export const CAMPOS_CLIENTES: CampoImportacao[] = [
  { valor: "nome", rotulo: "Nome", obrigatorio: true },
  { valor: "email", rotulo: "E-mail", obrigatorio: false },
  { valor: "telefone", rotulo: "Telefone", obrigatorio: false },
  { valor: "documento", rotulo: "CPF/CNPJ", obrigatorio: false },
  { valor: "enderecoCep", rotulo: "CEP", obrigatorio: false },
  { valor: "enderecoLogradouro", rotulo: "Endereço", obrigatorio: false },
  { valor: "enderecoNumero", rotulo: "Número", obrigatorio: false },
  { valor: "enderecoComplemento", rotulo: "Complemento", obrigatorio: false },
  { valor: "enderecoBairro", rotulo: "Bairro", obrigatorio: false },
  { valor: "enderecoMunicipio", rotulo: "Cidade", obrigatorio: false },
  { valor: "enderecoUf", rotulo: "UF", obrigatorio: false },
  { valor: "observacoes", rotulo: "Observações internas", obrigatorio: false },
  { valor: "preferenciasProducao", rotulo: "Preferências de produção", obrigatorio: false },
  { valor: "origem", rotulo: "Origem do cliente", obrigatorio: false },
  IGNORAR,
];

// Campos de identificação (categoria/tipo) ficam OPCIONAIS de propósito,
// diferente do form manual de catálogo (criarItemCatalogo exige os dois) —
// a maioria das planilhas reais de "lista de produto" não tem essas
// colunas, e o importador aplica default (categoria "Importado", tipo
// PRODUTO) em vez de rejeitar a linha. Exigir aqui derrotaria o motivo da
// feature existir.
export const CAMPOS_CATALOGO: CampoImportacao[] = [
  { valor: "nome", rotulo: "Nome do produto/serviço", obrigatorio: true },
  { valor: "tipo", rotulo: "Tipo (produto/matéria-prima/serviço)", obrigatorio: false },
  { valor: "categoria", rotulo: "Categoria", obrigatorio: false },
  { valor: "descricao", rotulo: "Descrição", obrigatorio: false },
  { valor: "unidade", rotulo: "Unidade de medida", obrigatorio: false },
  { valor: "precoCompra", rotulo: "Preço de compra/custo", obrigatorio: false },
  { valor: "precoVenda", rotulo: "Preço de venda", obrigatorio: false },
  { valor: "estoqueAtual", rotulo: "Estoque atual", obrigatorio: false },
  { valor: "ncm", rotulo: "NCM", obrigatorio: false },
  IGNORAR,
];

// Pedido histórico: sem precoCompra/custo (a planilha de pedido já vendido
// não traz isso) — só o valor final cobrado, pra reconstituir faturamento
// no relatório. Ver escritor-pedidos.ts pro porquê de não recalcular preço.
export const CAMPOS_PEDIDOS: CampoImportacao[] = [
  { valor: "clienteNome", rotulo: "Nome do cliente", obrigatorio: true },
  { valor: "clienteDocumento", rotulo: "CPF/CNPJ do cliente", obrigatorio: false },
  { valor: "produtoDescricao", rotulo: "Produto/serviço", obrigatorio: true },
  { valor: "quantidade", rotulo: "Quantidade", obrigatorio: false },
  { valor: "valorTotal", rotulo: "Valor total (R$)", obrigatorio: true },
  { valor: "data", rotulo: "Data do pedido", obrigatorio: true },
  { valor: "vendedor", rotulo: "Vendedor", obrigatorio: false },
  { valor: "observacoes", rotulo: "Observações", obrigatorio: false },
  IGNORAR,
];

export const CAMPOS_POR_TIPO: Record<TipoImportacaoPlanilha, CampoImportacao[]> = {
  CLIENTES: CAMPOS_CLIENTES,
  CATALOGO: CAMPOS_CATALOGO,
  PEDIDOS: CAMPOS_PEDIDOS,
};
