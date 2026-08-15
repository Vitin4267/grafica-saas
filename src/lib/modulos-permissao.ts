import type { ModuloPermissao } from "@/generated/prisma/enums";

// Sem "server-only" de propósito: PermissoesForm.tsx (client component) e
// lib/auth/permissoes.ts (server-only) precisam dos mesmos rótulos — separado
// num arquivo neutro pra não puxar o Prisma inteiro (e o pacote `pg`) pro
// bundle do navegador quando o componente client importa isso.
export const MODULOS_PERMISSAO: { valor: ModuloPermissao; rotulo: string }[] = [
  { valor: "ORCAMENTO", rotulo: "Orçamento" },
  { valor: "CLIENTES", rotulo: "Clientes" },
  { valor: "CATALOGO", rotulo: "Catálogo" },
  { valor: "PRODUCAO", rotulo: "Produção" },
  { valor: "CUSTOS", rotulo: "Custos (lançar e ver lucro do pedido)" },
  { valor: "FINANCEIRO", rotulo: "Financeiro" },
  { valor: "CONFIGURACOES", rotulo: "Configurações" },
];
