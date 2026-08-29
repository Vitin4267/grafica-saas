import { z } from "zod";
import { dataInputParaUTC } from "@/lib/data";

const FORMAS_PAGAMENTO = ["DINHEIRO", "PIX", "CARTAO", "BOLETO", "TRANSFERENCIA", "OUTRO"] as const;

// Mesma ordem do enum PeriodicidadeDespesa no schema.prisma.
const PERIODICIDADES_DESPESA = [
  "SEMANAL",
  "QUINZENAL",
  "MENSAL",
  "BIMESTRAL",
  "TRIMESTRAL",
  "SEMESTRAL",
  "ANUAL",
] as const;

export const despesaSchema = z.object({
  descricao: z.string().trim().min(2, "Descrição muito curta").max(160),
  categoria: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((v) => (v ? v : undefined)),
  // Preenchido quando o usuário escolhe uma categoria da lista (em vez de
  // digitar uma nova em `categoria`) — ver CampoCategoriaDespesa.tsx. A
  // action valida que o id pertence à gráfica antes de gravar; aqui só a
  // forma do dado.
  categoriaCustoId: z
    .string()
    .trim()
    .max(50)
    .optional()
    .transform((v) => (v ? v : undefined)),
  valor: z.coerce.number().finite().positive("Informe um valor maior que zero."),
  vencimento: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data de vencimento inválida")
    .transform((v) => dataInputParaUTC(v)),
  // Só usado quando "recorrente" está marcado — a action ignora quando não
  // está (ver criarDespesa/editarDespesa em actions.ts). Default MENSAL
  // preserva o único comportamento que existia antes deste campo.
  periodicidade: z.enum(PERIODICIDADES_DESPESA).optional().default("MENSAL"),
  // Opcional: string vazia (campo de data não preenchido) vira undefined,
  // não erro de validação — "sem fim" é o comportamento de hoje.
  recorrenciaAteEm: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data de fim da recorrência inválida")
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? dataInputParaUTC(v) : undefined)),
});

// Schema separado de propósito: status/pagoEm nunca aparecem no form
// genérico de criar/editar despesa, só nessa action dedicada — ver
// comentário no model Despesa no schema.prisma.
export const marcarComoPagaSchema = z.object({
  despesaId: z.string().min(1),
  formaPagamento: z.enum(FORMAS_PAGAMENTO),
  // Só usado quando formaPagamento === "OUTRO" (cheque, vale-troca,
  // permuta...) — a action zera esse campo se a forma escolhida não for
  // OUTRO, pra nunca sobrar texto órfão de uma forma antiga.
  formaPagamentoDetalhe: z
    .string()
    .trim()
    .max(160)
    .optional()
    .transform((v) => (v ? v : undefined)),
  // Opcional (achado A8 da Parte 4, 2026-08-29): string vazia/ausente vira
  // undefined e a action usa o SALDO em aberto inteiro — preserva o
  // comportamento de sempre ("Marcar como paga" = valor cheio) pra quem não
  // mexe no campo. Só quando preenchido com um valor MENOR que o saldo é
  // que vira um pagamento parcial de verdade.
  valor: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : undefined))
    .refine((v) => v === undefined || (Number.isFinite(v) && v > 0), {
      message: "Informe um valor maior que zero.",
    }),
});
