// Puro (sem "server-only", sem Prisma) — testável isolado, mesmo padrão de
// src/lib/dre.ts/src/lib/csv.ts. Achado A2/Parte 5-Fiscal da auditoria de
// abrangência (pesquisa-abrangencia-modulos.md) — "Fase A": até aqui
// Cliente.documento (clienteSchema, src/lib/clientes.ts) aceitava qualquer
// texto livre, sem checar dígito verificador nem normalizar pontuação.
//
// Não confundir com src/lib/focus-nfe.ts (normalizarDocumentoDestinatario/
// normalizarCnpjEmitente) — aquele arquivo só REMOVE pontuação pra montar o
// payload da Focus NFe (já corrigido numa rodada anterior, não mexido
// aqui). Este arquivo VALIDA dígito verificador de verdade (CPF e CNPJ,
// numérico e alfanumérico), pra uso no cadastro de cliente.
//
// ---------------------------------------------------------------------------
// Algoritmo do CNPJ alfanumérico (vigente desde 31/07/2026, padrão Serpro/
// Nota Técnica Conjunta 2025.001): as 14 posições continuam existindo, mas
// só as 2 últimas (dígitos verificadores) são SEMPRE numéricas — as 12
// primeiras podem ser dígito OU letra maiúscula (0-9, A-Z). O cálculo do DV
// continua em módulo 11, mas o valor de cada caractere passa a ser o código
// ASCII do caractere MENOS 48 (dígitos '0'-'9' → 0-9, igual a sempre;
// letras 'A'-'Z' → 17-42) — confirmado contra a documentação oficial
// (gov.br/receitafederal, blog.tecnospeed.com.br/novo-cnpj-nota-tecnica) e
// RECALCULADO À MÃO contra o vetor de teste oficial divulgado pela Receita
// Federal/Serpro: base "PC3D315K0001" → DV "93" (CNPJ "PC3D315K000193"),
// batido também no teste deste arquivo. Os pesos usados são os MESMOS do
// CNPJ numérico clássico (nada muda na sequência de pesos, só o valor de
// cada caractere-base):
//   DV1 (12 posições da base): 5,4,3,2,9,8,7,6,5,4,3,2
//   DV2 (13 posições: base + DV1): 6,5,4,3,2,9,8,7,6,5,4,3,2
// resto = soma ponderada % 11; DV = 0 se resto < 2, senão DV = 11 - resto.
// ---------------------------------------------------------------------------

/** Remove tudo que não é letra/número e normaliza pra maiúsculo. Nunca rejeita — é só limpeza de pontuação. */
export function normalizarDocumento(valor: string): string {
  return valor.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
}

// Valor numérico de um caractere já normalizado (maiúsculo) — código ASCII
// menos 48. Dígitos '0'-'9' (código 48-57) viram 0-9; letras 'A'-'Z' (código
// 65-90) viram 17-42. Não é chamado com caractere fora desse conjunto (a
// regex de formato em validarCnpj já filtrou antes).
function valorCaractere(c: string): number {
  return c.charCodeAt(0) - 48;
}

function digitoVerificador(valores: number[], pesos: number[]): number {
  const soma = valores.reduce((acumulado, valor, indice) => acumulado + valor * pesos[indice], 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

const PESOS_CNPJ_DV1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const PESOS_CNPJ_DV2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const PESOS_CPF_DV1 = [10, 9, 8, 7, 6, 5, 4, 3, 2];
const PESOS_CPF_DV2 = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2];

/**
 * Valida CPF (11 dígitos numéricos) por dígito verificador — módulo 11
 * clássico, inalterado pela mudança do CNPJ. Aceita o valor com ou sem
 * pontuação (normaliza internamente). Sequências com todos os dígitos
 * iguais (ex: "00000000000", "11111111111") são rejeitadas mesmo quando o
 * checksum bateria — são CPFs sabidamente falsos, mesma blacklist que
 * qualquer validador de CPF de mercado aplica.
 */
export function validarCpf(valor: string): boolean {
  const limpo = normalizarDocumento(valor);
  if (!/^\d{11}$/.test(limpo)) return false;
  if (/^(\d)\1{10}$/.test(limpo)) return false;

  const digitos = limpo.split("").map(Number);
  const dv1 = digitoVerificador(digitos.slice(0, 9), PESOS_CPF_DV1);
  if (dv1 !== digitos[9]) return false;
  const dv2 = digitoVerificador(digitos.slice(0, 10), PESOS_CPF_DV2);
  return dv2 === digitos[10];
}

/**
 * Valida CNPJ (14 posições) por dígito verificador — cobre TANTO o CNPJ
 * numérico clássico QUANTO o alfanumérico (Serpro, vigente desde
 * 31/07/2026): as 12 primeiras posições podem ser dígito ou letra
 * maiúscula, as 2 últimas (dígitos verificadores) são sempre numéricas.
 * Aceita o valor com ou sem pontuação/minúsculas (normaliza internamente).
 * Mesma blacklist de "todos os caracteres iguais" do CPF acima, só pro caso
 * 100% numérico (CNPJ alfanumérico não tem essa lista pública conhecida, e
 * a base é atribuída pelo Serpro, não digitada à mão — não especulamos essa
 * blacklist pra caracteres alfanuméricos).
 */
export function validarCnpj(valor: string): boolean {
  const limpo = normalizarDocumento(valor);
  if (!/^[0-9A-Z]{12}\d{2}$/.test(limpo)) return false;
  if (/^\d{14}$/.test(limpo) && /^(\d)\1{13}$/.test(limpo)) return false;

  const base = limpo
    .slice(0, 12)
    .split("")
    .map(valorCaractere);
  const dv1Esperado = Number(limpo[12]);
  const dv2Esperado = Number(limpo[13]);

  const dv1 = digitoVerificador(base, PESOS_CNPJ_DV1);
  if (dv1 !== dv1Esperado) return false;
  const dv2 = digitoVerificador([...base, dv1], PESOS_CNPJ_DV2);
  return dv2 === dv2Esperado;
}
