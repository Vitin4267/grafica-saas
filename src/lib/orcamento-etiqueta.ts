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

// materialSubstrato = OUTRO exige o texto livre preenchido — sem isso a
// escolha "outro" fica sem significado nenhum registrado.
export function validarMaterialSubstratoOutro(
  materialSubstrato: string | null,
  materialSubstratoOutro: string | null
): ResultadoValidacao<true> {
  if (materialSubstrato === "OUTRO" && !materialSubstratoOutro?.trim()) {
    return {
      ok: false,
      mensagem: "Descreva o material quando escolher \"Outro\" como substrato.",
    };
  }
  return { ok: true, valor: true };
}
