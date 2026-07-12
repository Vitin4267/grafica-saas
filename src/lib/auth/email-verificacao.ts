import "server-only";

import { redirect } from "next/navigation";

// Chamado logo depois de exigirUsuarioAutenticado() e ANTES de
// exigirAssinaturaAtiva() (confiança na identidade vem antes de confiança
// financeira) em toda página/Server Action — exceto /verificar-email em si
// (senão vira loop de redirect), /configuracoes/assinatura e logout (já
// excluídas do gate de assinatura pelo mesmo motivo: precisam continuar
// alcançáveis mesmo pra quem está bloqueado).
export async function exigirEmailVerificado(usuario: { emailVerificadoEm: Date | null }) {
  if (!usuario.emailVerificadoEm) {
    redirect("/verificar-email");
  }
}
