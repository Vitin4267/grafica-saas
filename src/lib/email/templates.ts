// Templates montados como string direto (sem lib nova) — não vale a pena
// um sistema de template pra só 2 e-mails.
export function templateResetSenha(link: string): { assunto: string; html: string; texto: string } {
  return {
    assunto: "Redefinir sua senha — Gráfica+",
    texto: `Recebemos um pedido pra redefinir sua senha.\n\nAcesse o link abaixo (válido por 1 hora):\n${link}\n\nSe você não pediu isso, pode ignorar este e-mail — sua senha continua a mesma.`,
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
  };
}

export function templateVerificacaoEmail(codigo: string): {
  assunto: string;
  html: string;
  texto: string;
} {
  return {
    assunto: "Seu código de confirmação — Gráfica+",
    texto: `Seu código de confirmação é: ${codigo}\n\nEsse código vale por 15 minutos. Se você não pediu isso, pode ignorar este e-mail.`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #0f172a;">Confirme seu e-mail</h2>
        <p style="color: #334155;">Use o código abaixo pra confirmar seu e-mail e liberar o acesso à sua conta no Gráfica+.</p>
        <p style="font-family: monospace; font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #0d9488; text-align: center; padding: 16px 0;">
          ${codigo}
        </p>
        <p style="color: #64748b; font-size: 14px;">Esse código vale por 15 minutos. Se você não pediu isso, pode ignorar este e-mail.</p>
      </div>
    `,
  };
}
