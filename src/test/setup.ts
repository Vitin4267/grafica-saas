import { beforeEach } from "vitest";
import { resetTenantParaTeste } from "@/lib/tenant-context";

// Achado investigando CI vermelho (2026-09-21) — ver comentário completo
// em resetTenantParaTeste (tenant-context.ts). Roda antes de CADA teste da
// suíte principal (vitest.config.ts: testes.setupFiles) — zera o contexto
// de tenant deixado por QUALQUER teste anterior que tenha exercitado o
// mecanismo de verdade (enterWith não reverte sozinho), evitando que um
// teste sem nenhuma relação com tenant veja um tenantAtivo de outro e
// trave com ErroIsolamentoTenant (falso positivo, não é bug de RLS/dado
// real).
beforeEach(() => {
  resetTenantParaTeste();
});
