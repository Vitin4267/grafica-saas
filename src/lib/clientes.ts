import { z } from "zod";

const opcional = z.string().trim().max(160).optional().or(z.literal(""));

// Aceita "00000-000" ou só os 8 dígitos — nunca number (CEP começa com 0 em
// várias regiões do país, então precisa continuar texto o tempo todo).
const cepOpcional = z
  .string()
  .trim()
  .regex(/^\d{5}-?\d{3}$/, "CEP inválido — use o formato 00000-000")
  .optional()
  .or(z.literal(""));

export const clienteSchema = z.object({
  nome: z.string().trim().min(2, "Nome muito curto").max(120),
  email: z.union([z.string().trim().toLowerCase().email("E-mail inválido"), z.literal("")]).optional(),
  telefone: opcional,
  documento: opcional,
  enderecoCep: cepOpcional,
  enderecoLogradouro: opcional,
  enderecoNumero: opcional,
  enderecoComplemento: opcional,
  enderecoBairro: opcional,
  enderecoMunicipio: opcional,
  enderecoCodigoIbge: opcional,
  enderecoUf: opcional,
});
