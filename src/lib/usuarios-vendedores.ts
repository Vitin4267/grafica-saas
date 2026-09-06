import "server-only";
import { prisma } from "@/lib/prisma";

export type UsuarioVendedorOpcao = { id: string; nome: string };

// Achado A8 da auditoria de abrangência (Cliente.vendedorId) + feature
// "vendedor real no orçamento" (Orcamento.vendedorUsuarioId, 2026-09-06) —
// lista fechada de quem pode ser escolhido como vendedor: usuários ATIVOS
// da gráfica com cargo Vendedor (PerfilAcesso.funcaoBase = "VENDEDOR", ver
// garantirPerfisAcessoPadrao em src/lib/perfis-acesso-padrao.ts) OU papel
// DONO/ADMIN — que sempre podem vender (mesmo princípio de
// Usuario.comissaoPercent: taxa pessoal, independente do papel).
//
// Corrige o gap documentado em clientes/page.tsx e clientes/[id]/page.tsx
// ("sem role vendedor no sistema hoje, então lista todos os usuários
// ativos") e é a mesma lista usada pelo <select> de vendedor do orçamento —
// um único helper, nunca duas queries divergentes pro mesmo conceito.
export async function buscarUsuariosVendedores(graficaId: string): Promise<UsuarioVendedorOpcao[]> {
  return prisma.usuario.findMany({
    where: {
      graficaId,
      desativadoEm: null,
      OR: [
        { papel: { in: ["DONO", "ADMIN"] } },
        { perfis: { some: { perfilAcesso: { funcaoBase: "VENDEDOR" } } } },
      ],
    },
    select: { id: true, nome: true },
    orderBy: { nome: "asc" },
  });
}
