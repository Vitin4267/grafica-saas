import { z } from "zod";
import { UNIDADES_DIMENSAO } from "@/lib/unidade-dimensao";

// Schema do item de carrinho (entrada não confiável do client) — extraído de
// src/app/orcamento/actions.ts (criarOrcamento) pra ser reaproveitado por
// qualquer fluxo que precise montar um conjunto de itens de uma vez só, como
// um carrinho: hoje são dois — criarOrcamento (Orcamento novo) e
// adicionarOpcaoOrcamento (Opção B/C alternativa dentro de um Orcamento já
// existente, ver src/app/orcamento/[id]/opcoes.actions.ts). Nunca confia nos
// preços vindos daqui — quem chama sempre recalcula tudo de novo com
// calcularItemOrcamento (src/lib/orcamento-precificacao.ts) antes de gravar.

// Nunca confia na unidade que vem do formulário/JSON — validada contra as
// únicas 3 que existem (ver src/lib/unidade-dimensao.ts) antes de converter
// pra centímetro na fronteira.
export const unidadeDimensaoSchema = z.enum(UNIDADES_DIMENSAO);

// Detalhe descritivo/de produção de etiqueta (OrcamentoItemEtiqueta) — só
// relevante quando o item usa modeloCalculo=M2 (flexografia). NÃO entra na
// conta de preço (ver src/lib/pricing/m2.ts), então esse bloco fica solto do
// resto do cálculo, só carregado até o create de quem chama.
const ladoEtiquetaSchema = z.enum(["ROTULO", "CONTRA_ROTULO"]);
const materialSubstratoSchema = z.enum([
  "PAPEL_TERMICO",
  "COUCHE_C_ROT",
  "BOPP_METALIZADO_ROT",
  "BOPP_BCO_PEROLIZADO",
  "BOPP_BCO_FOSCO",
  "BOPP_TRANSPARENTE",
  "L2_SEM_ADESIVO",
  "POLIETILENO_BRANCO",
  "POLIETILENO_TRANSPARENTE",
  "POLIESTER_BRANCO",
  "POLIESTER_TRANSPARENTE",
  "POLIESTER_CROMO_FOSCO",
  "ELETROSTATICO_SEM_COLA",
  "OUTRO",
]);
const tipoAdesivoSchema = z.enum([
  "ACRILICO_20G",
  "ACRILICO_30G",
  "BORRACHA_20G",
  "BORRACHA_25G",
  "BORRACHA_30G",
  "BORRACHA_50G",
  "OUTRO",
]);
const superficieAplicacaoSchema = z.enum(["VIDRO", "PLASTICO", "METAL", "PAPEL", "PAPELAO", "OUTROS"]);
const tipoRotulagemSchema = z.enum(["MANUAL", "AUTOMATICA"]);
const tipoSerrilhaSchema = z.enum(["SERRILHA", "MICRO_SERRILHA", "GAP", "OUTRO"]);
const tipoLaminacaoSchema = z.enum(["BRILHO", "FOSCO", "SOFT_TOUCH", "METALIZADA", "OUTRO"]);
const tipoAcabamentoVernizSchema = z.enum(["BRILHO", "FOSCO", "RIBBON", "SOFT_TOUCH", "OUTRO"]);
const tipoHotStampingSchema = z.enum(["HOT", "COLD", "OUTRO"]);

const hotStampingEntradaSchema = z
  .object({
    lado: ladoEtiquetaSchema,
    tipo: tipoHotStampingSchema,
    tipoOutro: z.string().max(60).nullable(),
    tipoEfeitoHotStamping: z.string().max(120).nullable(),
    medida: z.string().max(60).nullable(),
    cor: z.string().max(60).nullable(),
  })
  .refine((dados) => dados.tipo !== "OUTRO" || Boolean(dados.tipoOutro?.trim()), {
    message: 'Descreva o tipo quando escolher "Outro" como tipo de hot/cold stamping.',
  });

export const etiquetaEntradaSchema = z
  .object({
    materialSubstrato: materialSubstratoSchema.nullable(),
    materialSubstratoOutro: z.string().max(120).nullable(),
    tipoAdesivo: tipoAdesivoSchema.nullable(),
    tipoAdesivoOutro: z.string().max(120).nullable(),
    durabilidadeAdesivo: z.string().max(120).nullable(),
    superficieAplicacao: superficieAplicacaoSchema.nullable(),
    superficieAplicacaoOutro: z.string().max(120).nullable(),
    formatoEtiqueta: z.string().max(120).nullable(),
    coresRotulo: z.number().int().min(0).nullable(),
    coresContraRotulo: z.number().int().min(0).nullable(),
    embalagemQtdPorRolo: z.number().int().min(0).nullable(),
    tubeteMedida: z.string().max(60).nullable(),
    rotulagem: tipoRotulagemSchema.nullable(),
    serrilha: tipoSerrilhaSchema.nullable(),
    serrilhaOutro: z.string().max(120).nullable(),
    vernizRotuloTotal: z.boolean(),
    vernizRotuloReserva: z.boolean(),
    vernizRotuloTipo: tipoAcabamentoVernizSchema.nullable(),
    vernizRotuloTipoOutro: z.string().max(120).nullable(),
    vernizContraRotuloTotal: z.boolean(),
    vernizContraRotuloReserva: z.boolean(),
    vernizContraRotuloTipo: tipoAcabamentoVernizSchema.nullable(),
    vernizContraRotuloTipoOutro: z.string().max(120).nullable(),
    laminacaoRotulo: tipoLaminacaoSchema.nullable(),
    laminacaoRotuloOutro: z.string().max(120).nullable(),
    laminacaoContraRotulo: tipoLaminacaoSchema.nullable(),
    laminacaoContraRotuloOutro: z.string().max(120).nullable(),
    rebobinamento: z.number().int().min(1).max(8).nullable(),
    // Teto generoso (ninguém cadastra 20 variações de hot stamping num item de
    // verdade) só pra impedir um POST forjado com milhares de linhas.
    hotStampings: hotStampingEntradaSchema.array().max(20),
  })
  .refine(
    (dados) => dados.materialSubstrato !== "OUTRO" || Boolean(dados.materialSubstratoOutro?.trim()),
    { message: 'Descreva o material quando escolher "Outro" como substrato.' }
  )
  .refine((dados) => dados.tipoAdesivo !== "OUTRO" || Boolean(dados.tipoAdesivoOutro?.trim()), {
    message: 'Descreva o adesivo quando escolher "Outro" como tipo de adesivo.',
  })
  .refine(
    (dados) => dados.superficieAplicacao !== "OUTROS" || Boolean(dados.superficieAplicacaoOutro?.trim()),
    { message: 'Descreva a superfície quando escolher "Outros" como superfície de aplicação.' }
  )
  .refine((dados) => dados.serrilha !== "OUTRO" || Boolean(dados.serrilhaOutro?.trim()), {
    message: 'Descreva a serrilha quando escolher "Outro" como serrilha.',
  })
  .refine(
    (dados) => dados.vernizRotuloTipo !== "OUTRO" || Boolean(dados.vernizRotuloTipoOutro?.trim()),
    { message: 'Descreva o acabamento de verniz do rótulo quando escolher "Outro".' }
  )
  .refine(
    (dados) =>
      dados.vernizContraRotuloTipo !== "OUTRO" || Boolean(dados.vernizContraRotuloTipoOutro?.trim()),
    { message: 'Descreva o acabamento de verniz do contra-rótulo quando escolher "Outro".' }
  )
  .refine((dados) => dados.laminacaoRotulo !== "OUTRO" || Boolean(dados.laminacaoRotuloOutro?.trim()), {
    message: 'Descreva a laminação do rótulo quando escolher "Outro".',
  })
  .refine(
    (dados) => dados.laminacaoContraRotulo !== "OUTRO" || Boolean(dados.laminacaoContraRotuloOutro?.trim()),
    { message: 'Descreva a laminação do contra-rótulo quando escolher "Outro".' }
  );

// Item já digitado/computado no carrinho local (client) — o servidor NUNCA confia
// nos preços vindos daqui, só nos dados de entrada; recalcula tudo de novo com
// calcularItemOrcamento antes de gravar (ver criarOrcamento e
// adicionarOpcaoOrcamento).
export const itemEntradaSchema = z.object({
  itemGraficaId: z.string().min(1),
  quantidade: z.number().int().positive().max(1_000_000, "Quantidade não pode passar de 1.000.000 unidades."),
  // Valor DIGITADO na unidade abaixo — NÃO é necessariamente centímetro (ver
  // SeletorItemOrcamento.tsx). Convertido pra cm logo no início de quem
  // chama, antes de qualquer validação/cálculo.
  largura: z.number().positive().nullable(),
  altura: z.number().positive().nullable(),
  // Achado A11 (auditoria de abrangência, Parte 1/Embalagem) — dimensão do
  // DESENVOLVIMENTO DA FACA (planificação da embalagem aberta), não do
  // produto acabado fechado. Mesma unidade `unidadeDimensao` abaixo que
  // largura/altura, convertida pra cm na fronteira igual às duas. Opcional
  // (nullable E `.optional()`, diferente de largura/altura acima) — chave
  // ausente do JSON e chave presente com null são tratados igual (fixtures
  // de teste anteriores ao achado A11 nem mandam esta chave); quando
  // ausente/null, o motor de nesting (calcularItemOrcamento) cai em
  // largura/altura normais (comportamento de sempre).
  larguraPlanificada: z.number().positive().nullable().optional(),
  alturaPlanificada: z.number().positive().nullable().optional(),
  // Achado F7 (auditoria de abrangência, Parte 7) — terceira dimensão do
  // item VENDIDO (caixa/embalagem, acrílico, livro). Mesma unidade
  // `unidadeDimensao` abaixo que largura/altura, convertida pra cm na
  // fronteira igual às duas. Opcional e ignorada por 100% dos motores de
  // preço (nunca chega em calcularItemOrcamento) — puramente descritivo.
  profundidade: z.number().positive().nullable(),
  // Espessura de chapa/placa (corte a laser/router) do item VENDIDO —
  // distinta da espessura do lado da matéria-prima. SEMPRE em milímetro
  // (chapa é vendida em mm no Brasil), nunca passa pela conversão de
  // unidadeDimensao abaixo. Também nunca chega no motor de preço.
  espessuraMm: z.number().positive().nullable(),
  unidadeDimensao: unidadeDimensaoSchema,
  corFrente: z.number().int().nullable(),
  corVerso: z.number().int().nullable(),
  // Motor Flexografia — deliberadamente separado de corFrente/corVerso (ver
  // src/lib/orcamento-precificacao.ts).
  numeroCoresFlexo: z.number().int().nullable(),
  // Motor Digital — opcional (default 1 se ausente).
  numeroCliques: z.number().int().nullable(),
  // Motores Serigrafia/Sublimação/Estampagem a quente — os 3 compartilham
  // este campo (ver src/lib/orcamento-precificacao.ts).
  numeroSetups: z.number().int().nullable(),
  // Motor Bordado (achado A4) — nº de pontos da arte deste pedido, driver de
  // custo POR PEDIDO (diferente de numeroSetups acima, fixo na máquina).
  numeroPontos: z.number().int().nullable(),
  // Motor Tempo de máquina (achado A6) — a gráfica escolhe a base na máquina
  // (tempo, metro de corte, ou os dois somados); ambos opcionais, mas
  // calcularItemOrcamento exige ao menos um preenchido.
  tempoEstimadoMin: z.number().positive().nullable(),
  metrosCorte: z.number().positive().nullable(),
  // Acabamento cobrado por hora (ex: instalação, criação de arte) — não é
  // model-gated, independente do modeloCalculo do item.
  horasEstimadas: z.number().positive().nullable(),
  cores: z.string().max(60).nullable(),
  acabamento: z.string().max(200).nullable(),
  // Achado B6 — texto livre que sobrepõe o nome do catálogo no PDF/link
  // público quando preenchido (ver src/lib/pdf/mapear-dados.ts). Disponível
  // pra QUALQUER modeloCalculo, ao contrário de acabamento acima (que só se
  // aplica ao modo SIMPLES) — nunca entra no motor de preço.
  descricaoLivre: z.string().max(500).nullable(),
  acabamentoIds: z.array(z.string().min(1)).max(20).default([]),
  etiqueta: etiquetaEntradaSchema.nullable(),
  // Motor de clichê de etiqueta (só M2 com ConfiguracaoClicheEtiqueta) — ver
  // src/lib/orcamento-precificacao.ts.
  papelId: z.string().min(1).nullable(),
  quantidadeCores: z.number().int().positive().nullable(),
  custoFaca: z.number().min(0).nullable(),
  custoFrete: z.number().min(0).nullable(),
  // Motor Offset (achado N8) — gramatura escolhida NESTE orçamento,
  // sobrepondo ItemGrafica.gramaturaGm2 do produto quando preenchida; o
  // papel reaproveita o mesmo campo papelId compartilhado acima.
  gramaturaGm2: z.number().positive().nullable(),
  // Motor Revenda/terceirização (achado A12) — override opcional, POR
  // ORÇAMENTO, do custo de aquisição do fornecedor; quando ausente, o motor
  // cai no ItemGrafica.precoCompra do catálogo (ver src/lib/pricing/carregar.ts).
  custoAquisicaoUnitario: z.number().nonnegative().nullable(),
  // "Material fornecido pelo cliente" (achado B7) — DIGITAL/SERIGRAFIA/
  // SUBLIMACAO/ESTAMPAGEM_QUENTE/PERSONALIZACAO/BORDADO only; zera o custo
  // do substrato pra este item (ver src/lib/orcamento-precificacao.ts).
  materialFornecidoPeloCliente: z.boolean(),
});

export type ItemEntrada = z.infer<typeof itemEntradaSchema>;
export type EtiquetaEntrada = z.infer<typeof etiquetaEntradaSchema>;
