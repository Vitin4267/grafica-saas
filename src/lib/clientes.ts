import { z } from "zod";

const opcional = z.string().trim().max(160).optional().or(z.literal(""));

export const clienteSchema = z.object({
  nome: z.string().trim().min(2, "Nome muito curto").max(120),
  email: z.union([z.string().trim().toLowerCase().email("E-mail inválido"), z.literal("")]).optional(),
  telefone: opcional,
  documento: opcional,
  enderecoCep: opcional,
  enderecoLogradouro: opcional,
  enderecoNumero: opcional,
  enderecoComplemento: opcional,
  enderecoBairro: opcional,
  enderecoMunicipio: opcional,
  enderecoCodigoIbge: opcional,
  enderecoUf: opcional,
});
