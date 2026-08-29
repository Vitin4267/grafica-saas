import { z } from "zod";
import type { TipoEnderecoCliente } from "@/generated/prisma/enums";

// Achado A5 da Parte 5 da auditoria de abrangência (pesquisa-abrangencia-modulos.md)
// — mesmo padrão de ORDEM_FUNCAO_CONTATO_CLIENTE (src/lib/contatos-cliente.ts):
// lista fechada sem OUTRO (só 3 papéis fixos, não uma categoria aberta).
export const ORDEM_TIPO_ENDERECO_CLIENTE: TipoEnderecoCliente[] = ["PRINCIPAL", "COBRANCA", "ENTREGA"];

export const ROTULO_TIPO_ENDERECO_CLIENTE: Record<TipoEnderecoCliente, string> = {
  PRINCIPAL: "Comercial / cadastro",
  COBRANCA: "Cobrança",
  ENTREGA: "Entrega",
};

const opcional = z.string().trim().max(160).optional().or(z.literal(""));
const textoLongoOpcional = z.string().trim().max(2000).optional().or(z.literal(""));

// Mesmo formato de cepOpcional em src/lib/clientes.ts — aceita "00000-000" ou
// só os 8 dígitos, nunca number (CEP começa com 0 em várias regiões).
const cepOpcional = z
  .string()
  .trim()
  .regex(/^\d{5}-?\d{3}$/, "CEP inválido — use o formato 00000-000")
  .optional()
  .or(z.literal(""));

// Mesmo shape dos campos `endereco*` de Cliente (src/lib/clientes.ts), sem o
// prefixo `endereco` — reaproveitado aqui porque EnderecoCliente é
// literalmente outro endereço da mesma família de dados, só que reutilizável
// e tipado (PRINCIPAL/COBRANCA/ENTREGA) em vez de único e fixo no Cliente.
export const enderecoClienteSchema = z.object({
  apelido: z.string().trim().min(2, "Apelido muito curto").max(120),
  cep: cepOpcional,
  logradouro: opcional,
  numero: opcional,
  complemento: opcional,
  bairro: opcional,
  municipio: opcional,
  codigoIbge: opcional,
  uf: opcional,
  contatoNome: opcional,
  contatoTelefone: opcional,
  instrucoesEntrega: textoLongoOpcional,
});
