import "server-only";
import { prisma } from "@/lib/prisma";
import type { FuncaoPerfil, ModuloPermissao } from "@/generated/prisma/enums";

type PermissaoPerfilSugerida = {
  modulo: ModuloPermissao;
  podeVer: boolean;
  podeEditar: boolean;
};

export type PerfilAcessoSugerido = {
  nome: string;
  funcaoBase: FuncaoPerfil;
  permissoes: PermissaoPerfilSugerida[];
};

// Atalho: ver+editar no mesmo módulo (a maioria das linhas da grade abaixo).
function verEEditar(modulo: ModuloPermissao): PermissaoPerfilSugerida {
  return { modulo, podeVer: true, podeEditar: true };
}
function soVer(modulo: ModuloPermissao): PermissaoPerfilSugerida {
  return { modulo, podeVer: true, podeEditar: false };
}

// Feature "cargos com permissão pré-configurada" (2026-09-06) — os 6 cargos
// que toda gráfica costuma precisar, cada um já com uma grade de permissão
// sensata (ver PerfilAcesso/PermissaoPerfil no schema), editável depois pelo
// DONO em /configuracoes/perfis-acesso exatamente como qualquer perfil
// customizado — este ponto de partida não é mais "especial" que o resto
// depois de semeado. `funcaoBase` marca a função de negócio de cada um
// (usado por buscarUsuariosVendedores pra achar quem tem cargo Vendedor,
// entre outros usos futuros) — distinto de `nome`, que o DONO pode renomear
// livremente sem quebrar nada.
//
// Nenhum cargo dá CUSTOS pra Produção por padrão (o próprio schema já
// documenta a intenção de isolar o P&L do chão de fábrica — ver comentário
// do enum ModuloPermissao) — se uma gráfica quiser liberar, o DONO ajusta a
// grade depois, normalmente.
export const PERFIS_ACESSO_PADRAO: PerfilAcessoSugerido[] = [
  {
    nome: "Vendedor",
    funcaoBase: "VENDEDOR",
    permissoes: [verEEditar("ORCAMENTO"), verEEditar("CLIENTES"), soVer("CATALOGO")],
  },
  {
    nome: "Financeiro",
    funcaoBase: "FINANCEIRO",
    permissoes: [
      verEEditar("FINANCEIRO"),
      verEEditar("CUSTOS"),
      soVer("ORCAMENTO"),
      soVer("CLIENTES"),
    ],
  },
  {
    nome: "Produção",
    funcaoBase: "PRODUCAO",
    permissoes: [verEEditar("PRODUCAO"), soVer("CATALOGO")],
  },
  {
    nome: "Compras",
    funcaoBase: "COMPRAS",
    permissoes: [verEEditar("COMPRAS"), verEEditar("CATALOGO")],
  },
  {
    nome: "Administrativo",
    funcaoBase: "ADMINISTRATIVO",
    permissoes: [
      verEEditar("ORCAMENTO"),
      verEEditar("CLIENTES"),
      verEEditar("CATALOGO"),
      verEEditar("PRODUCAO"),
      verEEditar("FINANCEIRO"),
      verEEditar("CONFIGURACOES"),
      verEEditar("CUSTOS"),
      verEEditar("COMPRAS"),
    ],
  },
  {
    nome: "Atendimento",
    funcaoBase: "ATENDIMENTO",
    permissoes: [verEEditar("CLIENTES"), soVer("ORCAMENTO")],
  },
];

// Idempotente: só cria os 6 cargos padrão se a gráfica ainda não tem NENHUM
// PerfilAcesso cadastrado — mesmo princípio de garantirCategoriasCustoPadrao
// (src/lib/custo-pedido.ts) e garantirCondicoesPagamentoPadrao
// (src/lib/condicao-pagamento.ts). Se a gráfica já tinha perfis (pré-
// semeados numa sessão anterior, ou 100% customizados) e apagou todos de
// propósito, isto NUNCA recria sozinho. Chamado sob demanda antes de listar
// a tela que precisa dos dados (/usuarios), nunca no fluxo de criação de
// conta/gráfica.
export async function garantirPerfisAcessoPadrao(graficaId: string): Promise<void> {
  const existentes = await prisma.perfilAcesso.count({ where: { graficaId } });
  if (existentes > 0) return;

  for (const sugestao of PERFIS_ACESSO_PADRAO) {
    await prisma.perfilAcesso.create({
      data: {
        graficaId,
        nome: sugestao.nome,
        funcaoBase: sugestao.funcaoBase,
        permissoes: {
          create: sugestao.permissoes.map((p) => ({
            modulo: p.modulo,
            podeVer: p.podeVer,
            podeEditar: p.podeEditar,
          })),
        },
      },
    });
  }
}
