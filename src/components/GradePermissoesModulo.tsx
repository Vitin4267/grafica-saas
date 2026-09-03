"use client";

import { Card } from "@/components/ui/Card";
import { MODULOS_PERMISSAO } from "@/lib/modulos-permissao";

export type ModuloValorPermissao = (typeof MODULOS_PERMISSAO)[number]["valor"];

export type PermissoesPorModulo = Record<ModuloValorPermissao, { ver: boolean; editar: boolean }>;

// Grade módulo × podeVer/podeEditar — extraída de PermissoesForm.tsx
// (permissão individual, /usuarios/[id]/permissoes) pra ser reaproveitada
// também em PerfilAcessoForm.tsx (achado A5 da auditoria de abrangência,
// Parte 6/Configurações, 2026-08-27), em vez de duplicar a mesma tabela nas
// duas telas. Componente burro: quem chama guarda o estado e decide o que
// fazer com cada mudança (nome dos campos do form varia entre as duas telas).
export function GradePermissoesModulo({
  permissoes,
  onAlternarVer,
  onAlternarEditar,
  prefixoNomeCampo = "",
}: {
  permissoes: PermissoesPorModulo;
  onAlternarVer: (modulo: ModuloValorPermissao, ver: boolean) => void;
  onAlternarEditar: (modulo: ModuloValorPermissao, editar: boolean) => void;
  // Prefixo pro `name` dos checkboxes no FormData — PermissoesForm usa
  // "ver_"/"editar_" sem prefixo, PerfilAcessoForm pode usar o mesmo (o
  // formulário de perfil é um form HTML separado, sem colisão de nome).
  prefixoNomeCampo?: string;
}) {
  return (
    <Card className="divide-y divide-slate-100 dark:divide-slate-800">
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 p-4 text-xs font-medium uppercase tracking-wide text-slate-400">
        <span>Tela</span>
        <span>Ver</span>
        <span>Editar</span>
      </div>
      {MODULOS_PERMISSAO.map(({ valor, rotulo }) => (
        <div key={valor} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 p-4">
          <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{rotulo}</span>
          <input
            type="checkbox"
            name={`${prefixoNomeCampo}ver_${valor}`}
            checked={permissoes[valor].ver}
            onChange={(e) => onAlternarVer(valor, e.target.checked)}
            aria-label={`Ver ${rotulo}`}
            className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
          />
          <input
            type="checkbox"
            name={`${prefixoNomeCampo}editar_${valor}`}
            checked={permissoes[valor].editar}
            disabled={!permissoes[valor].ver}
            onChange={(e) => onAlternarEditar(valor, e.target.checked)}
            aria-label={`Editar ${rotulo}`}
            className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 disabled:opacity-30"
          />
        </div>
      ))}
    </Card>
  );
}

// Estado inicial padrão — todos os módulos desmarcados, ou preenchidos a
// partir de uma lista de linhas já existentes (PermissaoUsuario ou
// PermissaoPerfil, mesmo formato podeVer/podeEditar nas duas tabelas).
export function permissoesIniciaisPorModulo(
  linhas: { modulo: ModuloValorPermissao; podeVer: boolean; podeEditar: boolean }[]
): PermissoesPorModulo {
  return Object.fromEntries(
    MODULOS_PERMISSAO.map(({ valor }) => {
      const existente = linhas.find((p) => p.modulo === valor);
      return [valor, { ver: existente?.podeVer ?? false, editar: existente?.podeEditar ?? false }];
    })
  ) as PermissoesPorModulo;
}

// Alterna "ver" no state — desmarcar "ver" também desmarca "editar" (não faz
// sentido editar o que não pode nem ver). Mesma regra nas duas telas.
export function alternarVerPermissao(
  atual: PermissoesPorModulo,
  modulo: ModuloValorPermissao,
  ver: boolean
): PermissoesPorModulo {
  return { ...atual, [modulo]: { ver, editar: ver ? atual[modulo].editar : false } };
}

export function alternarEditarPermissao(
  atual: PermissoesPorModulo,
  modulo: ModuloValorPermissao,
  editar: boolean
): PermissoesPorModulo {
  return { ...atual, [modulo]: { ...atual[modulo], editar } };
}
