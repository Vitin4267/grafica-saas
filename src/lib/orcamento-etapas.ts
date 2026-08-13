// Fonte única das 5 etapas de produção rastreadas por orçamento (data/hora +
// responsável cada) — usada tanto pelo form (EtapasOrcamentoForm.tsx) quanto
// pela action (editarEtapasOrcamento em src/app/orcamento/[id]/actions.ts),
// pra `chave` nunca ficar dessincronizada entre os dois lugares.
//
// `chave` gera os nomes dos campos no schema por convenção: "layout" vira
// etapaLayoutEm/etapaLayoutResponsavel (ver montarNomeCampoEtapa abaixo).
// etapaConfirmacaoPedido* corresponde ao rótulo "Pedido" do formulário
// físico original — o nome do campo é diferente pra não colidir com o model
// Pedido (produção) já existente no schema.
export const ETAPAS_ORCAMENTO = [
  { chave: "orcamentoDesenvolvimento", rotulo: "Orçamento/Desenvolvimento" },
  { chave: "layout", rotulo: "Layout" },
  { chave: "aprovacao", rotulo: "Aprovação" },
  { chave: "confirmacaoPedido", rotulo: "Pedido" },
  { chave: "entrega", rotulo: "Entrega" },
] as const;

export type ChaveEtapaOrcamento = (typeof ETAPAS_ORCAMENTO)[number]["chave"];

function capitalizar(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export function nomeCampoEtapaEm(chave: ChaveEtapaOrcamento): string {
  return `etapa${capitalizar(chave)}Em`;
}

export function nomeCampoEtapaResponsavel(chave: ChaveEtapaOrcamento): string {
  return `etapa${capitalizar(chave)}Responsavel`;
}
