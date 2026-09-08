// Validações puras dos campos de etiqueta (OrcamentoItemEtiqueta) — extraído
// à parte porque as mesmas regras se repetem em criarOrcamento,
// adicionarItemOrcamento e editarOrcamento (src/app/orcamento/actions.ts e
// src/app/orcamento/[id]/actions.ts).

export type ResultadoValidacao<T> =
  | { ok: true; valor: T }
  | { ok: false; mensagem: string };

// Mesmo raciocínio de numeroOuNulo em src/app/catalogo/actions.ts — string
// vazia/ausente vira null (campo opcional), qualquer outra coisa precisa ser
// um número válido e não-negativo.
function numeroInteiroOuNulo(valor: string | null | undefined): number | null | false {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 0) return false;
  return n;
}

export function validarContagemCor(
  valor: string | null | undefined,
  rotuloCampo: string
): ResultadoValidacao<number | null> {
  const n = numeroInteiroOuNulo(valor);
  if (n === false) {
    return { ok: false, mensagem: `${rotuloCampo} precisa ser um número inteiro não-negativo.` };
  }
  return { ok: true, valor: n };
}

// Rótulos pra cada uma das 8 posições da tabela padrão de "sentido de
// rebobinamento" (winding direction) do mercado de rótulos em rolo — como a
// etiqueta fica posicionada quando o rolo é desenrolado, informação que a
// rotuladora automática do CLIENTE final (não da gráfica) precisa pra
// aplicar sem reconfiguração.
//
// Pesquisa de mercado (2026-09-08): o CONCEITO é confirmado por várias
// fontes do setor de etiquetas — chart de "unwind/winding direction 1-8",
// fontes americanas (Kwality Labels, Blue Label Packaging, Great Lakes
// Label) concordando entre si que as posições 1-4 são "wound out"/face pra
// fora e 5-8 "wound in"/face pra dentro, cada grupo de 4 subdividido por
// qual borda sai primeiro do rolo (topo/base/direita/esquerda). Só que uma
// fonte portuguesa (Codimarc) descreve a MESMA tabela de 8 posições por um
// critério diferente (orientação vertical do texto nas posições 1-4,
// horizontal nas 5-8) — sem nenhuma fonte brasileira confirmando qual das
// duas convenções o mercado local segue, e as duas descrições técnicas não
// são conciliáveis com segurança.
//
// Pra não arriscar um rótulo tecnicamente errado que confunda quem opera a
// rotuladora (pior que não ter rótulo nenhum), optou-se pela via
// conservadora: "Posição N" genérico, na mesma numeração do formulário
// físico de Pedido Interno da Assus Graphics — quem preenche já sabe de cor
// qual posição vale pra cada rotuladora do cliente, o campo só precisa
// preservar o número certo (1-8) com uma apresentação mais amigável que um
// input numérico cru.
export const ROTULO_REBOBINAMENTO: Record<number, string> = {
  1: "Posição 1",
  2: "Posição 2",
  3: "Posição 3",
  4: "Posição 4",
  5: "Posição 5",
  6: "Posição 6",
  7: "Posição 7",
  8: "Posição 8",
};

// Fallback pra um valor fora de 1-8 salvo por fora da validação (script,
// seed) — mesmo raciocínio de rotuloPrioridadePedido em
// src/lib/prioridade-pedido.ts.
export function rotuloRebobinamento(valor: number): string {
  return ROTULO_REBOBINAMENTO[valor] ?? `Posição ${valor}`;
}

// Rebobinamento é 1-8 (opções numeradas do formulário físico, sem nome
// próprio ainda) — fora dessa faixa não tem o que significar.
export function normalizarRebobinamento(valor: string | null | undefined): ResultadoValidacao<number | null> {
  const n = numeroInteiroOuNulo(valor);
  if (n === false) {
    return { ok: false, mensagem: "Rebobinamento precisa ser um número inteiro." };
  }
  if (n !== null && (n < 1 || n > 8)) {
    return { ok: false, mensagem: "Rebobinamento precisa estar entre 1 e 8." };
  }
  return { ok: true, valor: n };
}

// Regra genérica: quando um campo de escolha (Select) recebe o valor-gatilho
// de "outro" (OUTRO na maioria dos enums, OUTROS em SuperficieAplicacao), o
// texto livre pareado precisa estar preenchido — senão a escolha "outro" fica
// sem significado nenhum registrado. Reaproveitada por todo par
// campo/campoOutro de OrcamentoItemEtiqueta e OrcamentoItemHotStamping.
export function validarCampoOutro(
  valor: string | null,
  valorOutro: string | null,
  mensagem: string,
  valorGatilho: string = "OUTRO"
): ResultadoValidacao<true> {
  if (valor === valorGatilho && !valorOutro?.trim()) {
    return { ok: false, mensagem };
  }
  return { ok: true, valor: true };
}

// materialSubstrato = OUTRO exige o texto livre preenchido — sem isso a
// escolha "outro" fica sem significado nenhum registrado.
export function validarMaterialSubstratoOutro(
  materialSubstrato: string | null,
  materialSubstratoOutro: string | null
): ResultadoValidacao<true> {
  return validarCampoOutro(
    materialSubstrato,
    materialSubstratoOutro,
    'Descreva o material quando escolher "Outro" como substrato.'
  );
}
