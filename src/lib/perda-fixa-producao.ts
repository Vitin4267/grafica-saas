// Lógica pura da baixa de estoque por "perda fixa de calibragem" (ver
// avancarPedido em src/app/producao/actions.ts). Cada material consumido por
// um pedido é identificado por uma "chave" (item do orçamento × item da
// ficha técnica) — a mesma granularidade do loop de consumo por BOM já
// existente, pra que a perda fixa possa ser confirmada/editada por linha na
// tela de "Iniciar impressão" sem misturar produtos diferentes que usam o
// mesmo material.

export function montarChavePerda(orcamentoItemId: string, fichaTecnicaItemId: string): string {
  return `${orcamentoItemId}::${fichaTecnicaItemId}`;
}

export type ItemParaBaixa = {
  chave: string;
  quantidadeConsumida: number;
  perdaPadrao: number;
};

export type LinhaPerdaConfirmada = {
  chave: string;
  perdaAplicada: number;
};

export type ResolucaoPerdas =
  | { ok: true; porChave: Map<string, number> }
  | { ok: false; mensagem: string };

// Decisão de negócio: se a confirmação enviada não cobrir TODAS as chaves
// esperadas (uma por item×ficha técnica), bloqueia a transição inteira em
// vez de aplicar um padrão silenciosamente ou processar parcialmente — força
// o usuário a recarregar a tela de "Iniciar impressão" e confirmar de novo.
export function resolverPerdasConfirmadas(
  itens: ItemParaBaixa[],
  perdasConfirmadas: LinhaPerdaConfirmada[]
): ResolucaoPerdas {
  const porChave = new Map(perdasConfirmadas.map((p) => [p.chave, p.perdaAplicada]));
  for (const item of itens) {
    if (!porChave.has(item.chave)) {
      return {
        ok: false,
        mensagem:
          "A confirmação de perda de material está incompleta ou desatualizada. Recarregue a página e confirme de novo antes de iniciar a impressão.",
      };
    }
  }
  return { ok: true, porChave };
}

// Estoque final considerando as duas deduções (consumo pela ficha técnica +
// a perda fixa confirmada pro material) — usado tanto pra decrementar quanto
// pra alimentar cruzouLimiteMinimo (src/lib/estoque-critico.ts) com o estado
// real pós-transição, não só o consumo por BOM.
export function calcularEstoqueDepois(
  estoqueAtual: number,
  quantidadeConsumida: number,
  perdaAplicada: number
): number {
  return estoqueAtual - quantidadeConsumida - perdaAplicada;
}

export type ItemParaValidacaoEstoque = ItemParaBaixa & {
  estoqueAtual: number;
  materiaPrimaNome: string;
};

export type ValidacaoEstoqueResult = { ok: true } | { ok: false; mensagem: string };

// Bloqueia a transição inteira se consumo + perda deixaria algum material
// negativo — cobre tanto uma perda digitada errada (ex: 5000 em vez de 50)
// quanto uma ficha técnica pedindo mais do que existe. Roda ANTES da
// transação (usa o mesmo estoqueAtual já lido pra montar itensParaBaixa em
// avancarPedido), então nunca decrementa nada que não passe por aqui antes.
export function validarEstoqueSuficiente(
  itens: ItemParaValidacaoEstoque[],
  perdasPorChave: Map<string, number>
): ValidacaoEstoqueResult {
  const insuficientes = itens
    .filter((item) => {
      const perdaAplicada = perdasPorChave.get(item.chave) ?? 0;
      return calcularEstoqueDepois(item.estoqueAtual, item.quantidadeConsumida, perdaAplicada) < 0;
    })
    .map((item) => item.materiaPrimaNome);

  if (insuficientes.length === 0) return { ok: true };
  return {
    ok: false,
    mensagem: `Estoque insuficiente para: ${insuficientes.join(", ")}. Confira as quantidades antes de iniciar a impressão.`,
  };
}
