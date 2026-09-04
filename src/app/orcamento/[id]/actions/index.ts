// Barrel de re-export — mantém o caminho de import original ("./actions",
// que resolve pra este arquivo por convenção de pasta) intacto pros ~15
// componentes/actions que importam daqui, depois que o antigo actions.ts
// (3421 linhas) foi dividido por responsabilidade em arquivos menores.
// Nenhuma lógica mora aqui, só reexporta o que cada arquivo já exportava.
//
// - status.ts: transição de status do orçamento (aprovar, enviar, etc.)
// - cabecalho.ts: edição de dados do cabeçalho (cliente, dados gerais, etapas)
// - arte.ts: upload/remoção de arte
// - itens.ts: CRUD de item do orçamento + desconto por item
// - ciclo-vida.ts: cancelar, duplicar, link público, validade
// - pagamentos.ts: registrar/excluir pagamento
// - nfe.ts: emissão e status de nota fiscal
// - helpers.ts: funções compartilhadas entre os arquivos acima (não é
//   "use server" — não são Server Actions por si só, só helpers de servidor)

export * from "./status";
export * from "./cabecalho";
export * from "./arte";
export * from "./itens";
export * from "./ciclo-vida";
export * from "./pagamentos";
export * from "./nfe";
