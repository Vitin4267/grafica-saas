import "server-only";

import { redirect } from "next/navigation";

// Mesmo formato de exigirPapel (src/lib/auth/permissoes.ts) — mas
// `superAdmin` não é um PapelUsuario (esses são sempre escopados à própria
// gráfica); é uma flag separada, cross-tenant, só true pro dono da
// plataforma. Chamado no topo de /admin/graficas e de toda Server Action
// daquela área — nunca confiar só no gate da página.
export function exigirSuperAdmin(usuario: { superAdmin: boolean }) {
  if (!usuario.superAdmin) {
    redirect("/orcamento");
  }
}
