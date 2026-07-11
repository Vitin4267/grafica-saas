import { z } from "zod";

// Limites evitam erro de digitação zerar o catálogo (-100%) ou multiplicar
// preço por engano (ex: querer 5% e digitar 500 sem querer).
export const reajusteInputSchema = z.object({
  percentual: z.coerce
    .number()
    .finite()
    .min(-90, "O reajuste não pode reduzir mais de 90%.")
    .max(500, "O reajuste não pode ultrapassar 500%.")
    .refine((v) => v !== 0, "Informe um percentual diferente de zero."),
  categoriaFiltro: z
    .string()
    .trim()
    .max(80)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null)),
});

export type ReajusteInput = z.infer<typeof reajusteInputSchema>;
