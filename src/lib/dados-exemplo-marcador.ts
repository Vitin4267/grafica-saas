// Achado E5 da auditoria de abrangência (seção onboarding/dados de exemplo)
// — extraído de src/lib/dados-exemplo.ts (que tem `import "server-only"` no
// topo) pra este arquivo IRMÃO, sem essa marcação, porque a badge visual nos
// seletores de cliente/produto do orçamento (client components) também
// precisa saber reconhecer um nome de exemplo, e um client component nunca
// pode importar algo de um módulo "server-only". dados-exemplo.ts continua
// sendo a fonte "oficial" — reexporta PREFIXO_EXEMPLO daqui pra não quebrar
// nenhum import existente.
export const PREFIXO_EXEMPLO = "[Exemplo] ";

// Único ponto de verdade pra "este nome é de um registro de exemplo?" — usa
// SEMPRE isto em vez de checar `nome.startsWith("[Exemplo] ")` na mão (ver
// comentário em dados-exemplo.ts: não existe campo `isExample` no schema,
// então o nome prefixado é o único sinal que existe).
export function ehDadoDeExemplo(nome: string): boolean {
  return nome.startsWith(PREFIXO_EXEMPLO);
}
