import { z } from "zod";
import { dataInputParaUTC } from "@/lib/data";

const FORMAS_PAGAMENTO = ["DINHEIRO", "PIX", "CARTAO", "BOLETO", "TRANSFERENCIA", "OUTRO"] as const;

export const despesaSchema = z.object({
  descricao: z.string().trim().min(2, "Descrição muito curta").max(160),
  categoria: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((v) => (v ? v : undefined)),
  valor: z.coerce.number().finite().positive("Informe um valor maior que zero."),
  vencimento: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data de vencimento inválida")
    .transform((v) => dataInputParaUTC(v)),
});

// Schema separado de propósito: status/pagoEm nunca aparecem no form
// genérico de criar/editar despesa, só nessa action dedicada — ver
// comentário no model Despesa no schema.prisma.
export const marcarComoPagaSchema = z.object({
  despesaId: z.string().min(1),
  formaPagamento: z.enum(FORMAS_PAGAMENTO),
});
