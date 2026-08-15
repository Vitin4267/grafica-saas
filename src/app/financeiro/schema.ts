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
});
