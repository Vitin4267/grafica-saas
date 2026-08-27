import { z } from "zod";
import type { FuncaoContatoCliente } from "@/generated/prisma/enums";

// Achado A4 da Parte 5 da auditoria de abrangência (pesquisa-abrangencia-modulos.md)
// — mesmo padrão enum-fechado+OUTRO de ORDEM_ORIGEM_CLIENTE/ORDEM_SEGMENTO_CLIENTE
// (src/lib/tipos-cliente.ts).
export const ORDEM_FUNCAO_CONTATO_CLIENTE: FuncaoContatoCliente[] = [
  "COMPRADOR",
  "FINANCEIRO",
  "APROVACAO_ARTE",
  "RECEBIMENTO",
  "OUTRO",
];

export const ROTULO_FUNCAO_CONTATO_CLIENTE: Record<FuncaoContatoCliente, string> = {
  COMPRADOR: "Comprador",
  FINANCEIRO: "Financeiro",
  APROVACAO_ARTE: "Aprovação de arte",
  RECEBIMENTO: "Recebimento",
  OUTRO: "Outro",
};

const opcional = z.string().trim().max(160).optional().or(z.literal(""));

// Mesmo teto/formato de clienteSchema (src/lib/clientes.ts) — reaproveitado
// aqui porque ContatoCliente tem o mesmo shape de nome/e-mail/telefone que
// Cliente já usa, sem o campo de documento/endereço (que não fazem sentido
// pra um contato individual).
export const contatoClienteSchema = z.object({
  nome: z.string().trim().min(2, "Nome muito curto").max(120),
  cargo: opcional,
  departamento: opcional,
  email: z.union([z.string().trim().toLowerCase().email("E-mail inválido"), z.literal("")]).optional(),
  telefone: opcional,
  whatsapp: opcional,
});
