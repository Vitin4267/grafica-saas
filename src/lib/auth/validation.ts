import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("E-mail inválido"),
  senha: z.string().min(1, "Informe a senha"),
});

export const senhaSchema = z
  .string()
  .min(10, "A senha precisa ter no mínimo 10 caracteres")
  .max(200)
  .refine((s) => /[a-z]/.test(s), "A senha precisa ter uma letra minúscula")
  .refine((s) => /[A-Z]/.test(s), "A senha precisa ter uma letra maiúscula")
  .refine((s) => /[0-9]/.test(s), "A senha precisa ter um número");

export const registroSchema = z.object({
  graficaNome: z
    .string()
    .trim()
    .min(2, "Nome da gráfica muito curto")
    .max(120),
  nome: z.string().trim().min(2, "Nome muito curto").max(120),
  email: z.string().trim().toLowerCase().email("E-mail inválido"),
  senha: senhaSchema,
});
