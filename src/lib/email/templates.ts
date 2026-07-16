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

export type ItemEstoqueBaixo = {
  nome: string;
  estoqueAtual: number;
  estoqueMinimo: number;
  unidade: string;
};

export function templateEstoqueBaixo(
  graficaNome: string,
  itens: ItemEstoqueBaixo[]
): { assunto: string; html: string; texto: string } {
  const assunto =
    itens.length === 1
      ? `Estoque baixo: ${itens[0].nome} — ${graficaNome}`
      : `${itens.length} itens com estoque baixo — ${graficaNome}`;

  const linhaTexto = (i: ItemEstoqueBaixo) =>
    `- ${i.nome}: ${i.estoqueAtual} ${i.unidade} (mínimo: ${i.estoqueMinimo} ${i.unidade})`;
  const linhaHtml = (i: ItemEstoqueBaixo) => `
        <li style="margin-bottom: 8px;">
          <strong>${i.nome}</strong> — ${i.estoqueAtual} ${i.unidade}
          <span style="color: #64748b;">(mínimo: ${i.estoqueMinimo} ${i.unidade})</span>
        </li>`;

  return {
    assunto,
    texto: `Itens com estoque no limite ou abaixo do mínimo cadastrado:\n\n${itens.map(linhaTexto).join("\n")}\n\nVeja e reponha em: /catalogo/estoque`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #0f172a;">Estoque baixo</h2>
        <p style="color: #334155;">Estes itens estão no limite ou abaixo do estoque mínimo cadastrado:</p>
        <ul style="color: #0f172a; padding-left: 20px;">${itens.map(linhaHtml).join("")}
        </ul>
        <p style="color: #64748b; font-size: 14px;">Confira e reponha na tela de Catálogo → Previsão de estoque.</p>
      </div>
    `,
  };
}

// Disparado pelo cron diário (src/app/api/cron/lifecycle/route.ts) 2 dias
// antes do trial expirar. `orcamentosGerados` é a contagem TOTAL de
// orçamentos da gráfica desde o cadastro (não só do mês corrente) — o
// objetivo aqui é reforçar valor já recebido pra persuadir a assinar, não
// medir uso pra limite de plano (isso já é papel de calcularUsoAtual em
// src/lib/billing/uso.ts, que é mensal e serve a outro propósito).
export function templateTrialExpirando(
  orcamentosGerados: number,
  linkAssinatura: string
): { assunto: string; html: string; texto: string } {
  const orcamentosTexto =
    orcamentosGerados === 1 ? "1 orçamento" : `${orcamentosGerados} orçamentos`;

  return {
    assunto: "Seu teste grátis termina em 2 dias — não perca o acesso",
    texto: `Seu período de testes está quase no fim!\n\nVocê já gerou ${orcamentosTexto} no Gráfica+ — imagina quanto tempo isso já economizou do seu cálculo manual.\n\nPra não perder o acesso ao seu painel e ao histórico dos seus clientes, escolha um plano a partir de R$ 110,00:\n${linkAssinatura}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #0f172a;">Seu teste grátis está quase no fim</h2>
        <p style="color: #334155;">
          Faltam só 2 dias! Você já gerou <strong>${orcamentosTexto}</strong> no Gráfica+ —
          imagina quanto tempo isso já economizou do seu cálculo manual.
        </p>
        <p style="color: #334155;">
          Pra não perder o acesso ao seu painel e ao histórico dos seus clientes, escolha um plano:
        </p>
        <p>
          <a href="${linkAssinatura}" style="display: inline-block; background: #0d9488; color: #ffffff; padding: 12px 20px; border-radius: 10px; text-decoration: none; font-weight: 600;">
            Escolher plano a partir de R$ 110,00
          </a>
        </p>
        <p style="color: #64748b; font-size: 14px;">Se preferir, acesse ${linkAssinatura} diretamente no navegador.</p>
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
