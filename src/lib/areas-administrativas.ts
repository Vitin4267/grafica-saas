import type { AreaAdministrativa } from "@/generated/prisma/enums";

// Sem "server-only" de propósito — importado tanto por código de servidor
// (usuarios/actions.ts) quanto por um client component
// (usuarios/ResponsaveisAdministrativoForm.tsx), mesma razão de
// producao-estagios.ts. Ficou de fora de usuarios/actions.ts (bug real de
// produção corrigido em 2026-09-02: aquele arquivo tem "use server" no topo
// — arquivo inteiro vira um módulo de Server Actions, e Next.js só permite
// exportar função async dele; exportar uma constante (array/record) junto
// funciona em `next dev` mas quebra em produção, "TypeError: X.map is not a
// function" na SSR do client component que importava direto de "./actions" —
// bug presente desde e538226, rodadas 1-10, nunca detectado porque só se
// manifesta no build de produção).

// Lista fechada — extensível: qualquer área nova entra aqui e no rótulo
// abaixo, sem precisar mudar a lógica de salvarResponsaveisAdministrativo.
// PRAZO_PRODUCAO adicionado 2026-08-24 (achado A9 da auditoria de
// abrangência) pra rotear o alerta de prazo/atraso de pedido
// (src/lib/alerta-prazo-email.ts) pra um responsável dedicado em vez de
// sempre cair em todos os DONOs. COMPRAS adicionado 2026-08-31 (achado A9,
// restante pendente) pro mesmo tratamento no alerta de estoque crítico
// (src/lib/alerta-estoque.ts). COBRANCA adicionado junto (mesmo achado,
// mesma rodada) só como valor cadastrável — hoje não existe nenhum disparo
// de e-mail de "conta a receber vencida" no código pra rotear (só a tela
// /financeiro/contas-receber destacando visualmente as vencidas), então
// marcar um funcionário aqui não liga nada ainda; fica pronto pro dia que
// esse alerta for construído.
export const AREAS_ADMINISTRATIVAS: AreaAdministrativa[] = ["NOTA_FISCAL", "PRAZO_PRODUCAO", "COBRANCA", "COMPRAS"];
export const ROTULO_AREA_ADMINISTRATIVA: Record<AreaAdministrativa, string> = {
  NOTA_FISCAL: "Emissão de Nota Fiscal",
  PRAZO_PRODUCAO: "Alerta de prazo/atraso de pedido",
  COBRANCA: "Cobrança (conta a receber vencida)",
  COMPRAS: "Alerta de estoque crítico",
};
