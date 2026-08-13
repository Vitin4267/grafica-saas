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
  // Identidade física do material — necessária pra agregar linhas antes de
  // validar (ver chaveFisicaMaterial abaixo). `chave` (item×ficha técnica) é
  // granularidade demais pra isso: dois produtos diferentes do MESMO
  // orçamento podem ter `chave` distintas mas consumir o mesmo saldo físico.
  materiaPrimaId: string;
  varianteId: string | null;
};

export type ValidacaoEstoqueResult = { ok: true } | { ok: false; mensagem: string };

// A granularidade real de um saldo em estoque — NÃO é "item do orçamento ×
// ficha técnica" (isso é só a granularidade da confirmação de perda, ver
// montarChavePerda acima). Duas linhas de itensParaBaixa apontam pro MESMO
// saldo físico quando dois produtos do orçamento consomem o mesmo material
// (ex: dois produtos impressos no mesmo papel) — precisam ser somadas antes
// de validar/alertar, nunca checadas isoladamente. varianteId, quando
// existe, já é específico o bastante (uma variante é um saldo próprio); só
// cai pra materiaPrimaId quando a linha não tem variante. Nunca soma
// uma variante com a matéria-prima "genérica" sem variante — são saldos
// físicos diferentes.
export function chaveFisicaMaterial(item: { materiaPrimaId: string; varianteId: string | null }): string {
  return item.varianteId ?? item.materiaPrimaId;
}

// Bloqueia a transição inteira se consumo + perda deixaria algum material
// negativo — cobre tanto uma perda digitada errada (ex: 5000 em vez de 50)
// quanto uma ficha técnica pedindo mais do que existe. Roda ANTES da
// transação (usa o mesmo estoqueAtual já lido pra montar itensParaBaixa em
// avancarPedido), então nunca decrementa nada que não passe por aqui antes.
//
// Agrega por chaveFisicaMaterial ANTES de comparar contra estoqueAtual: como
// itensParaBaixa é achatado por item×ficha técnica, dois produtos do mesmo
// orçamento que usam o mesmo material geram duas linhas com o MESMO
// estoqueAtual (cheio) cada uma — validar linha a linha deixa passar um
// total que, somado, estoura o estoque de verdade (bug real: nenhuma linha
// sozinha excede, mas a baixa de fato desconta as duas cumulativamente).
export function validarEstoqueSuficiente(
  itens: ItemParaValidacaoEstoque[],
  perdasPorChave: Map<string, number>
): ValidacaoEstoqueResult {
  const porMaterial = new Map<
    string,
    { estoqueAtual: number; materiaPrimaNome: string; quantidadeConsumida: number; perdaAplicada: number }
  >();

  for (const item of itens) {
    const perdaAplicada = perdasPorChave.get(item.chave) ?? 0;
    const chaveFisica = chaveFisicaMaterial(item);
    const existente = porMaterial.get(chaveFisica);
    if (existente) {
      existente.quantidadeConsumida += item.quantidadeConsumida;
      existente.perdaAplicada += perdaAplicada;
    } else {
      porMaterial.set(chaveFisica, {
        estoqueAtual: item.estoqueAtual,
        materiaPrimaNome: item.materiaPrimaNome,
        quantidadeConsumida: item.quantidadeConsumida,
        perdaAplicada,
      });
    }
  }

  const insuficientes = Array.from(porMaterial.values())
    .filter((m) => calcularEstoqueDepois(m.estoqueAtual, m.quantidadeConsumida, m.perdaAplicada) < 0)
    .map((m) => m.materiaPrimaNome);

  if (insuficientes.length === 0) return { ok: true };
  return {
    ok: false,
    mensagem: `Estoque insuficiente para: ${insuficientes.join(", ")}. Confira as quantidades antes de iniciar a impressão.`,
  };
}
