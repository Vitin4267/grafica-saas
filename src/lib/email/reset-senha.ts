import "server-only";
import { obterResend, obterEmailRemetente } from "@/lib/email/resend-client";

// HTML montado direto como string (sem lib de template nova) — só usado
// aqui por enquanto, não vale a pena um sistema de template pra 1 e-mail.
export async function enviarEmailResetSenha(destinatario: string, link: string): Promise<void> {
  const resend = obterResend();

  await resend.emails.send({
    from: obterEmailRemetente(),
    to: destinatario,
    subject: "Redefinir sua senha — Gráfica+",
    text: `Recebemos um pedido pra redefinir sua senha.\n\nAcesse o link abaixo (válido por 1 hora):\n${link}\n\nSe você não pediu isso, pode ignorar este e-mail — sua senha continua a mesma.`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #0f172a;">Redefinir sua senha</h2>
        <p style="color: #334155;">Recebemos um pedido pra redefinir a senha da sua conta no Gráfica+.</p>
        <p>
          <a href="${link}" style="display: inline-block; background: #0d9488; color: #ffffff; padding: 12px 20px; border-radius: 10px; text-decoration: none; font-weight: 600;">
            Redefinir senha
          </a>
        </p>
        <p style="color: #64748b; font-size: 14px;">Esse link vale por 1 hora. Se você não pediu isso, pode ignorar este e-mail — sua senha continua a mesma.</p>
      </div>
    `,
  });
}
