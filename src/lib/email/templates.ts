// Templates montados como string direto (sem lib nova) — não vale a pena
// um sistema de template pra só 2 e-mails.

// Só usado onde o HTML interpola texto livre de usuário (nome de item de
// catálogo) — os outros templates só interpolam link/código gerados pelo
// servidor, sem precisar escapar. Sem isso, um nome de item tipo
// "<img src=x onerror=...>" iria cru pro HTML do e-mail.
export function escapeHtml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Nome de cliente/gráfica só faz `.trim()` na validação de entrada (remove
// quebra de linha só das BORDAS, ver src/lib/clientes.ts e
// src/lib/auth/validation.ts) — uma quebra de linha no MEIO do nome
// sobrevive e vai parar direto no campo `assunto` do envelope de e-mail. Se o
// nó de e-mail do n8n mapear `assunto` pro header Subject sem sanitizar, isso
// é header injection de SMTP (o "atacante" aqui só consegue mirar contra o
// próprio dono da gráfica, por isso baixo risco — mas custa nada fechar).
// Aplicado a todo nome que entra em `assunto` abaixo.
function removerQuebrasDeLinha(texto: string): string {
  return texto.replace(/[\r\n]+/g, " ");
}
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
      ? `Estoque baixo: ${removerQuebrasDeLinha(itens[0].nome)} — ${removerQuebrasDeLinha(graficaNome)}`
      : `${itens.length} itens com estoque baixo — ${removerQuebrasDeLinha(graficaNome)}`;

  const linhaTexto = (i: ItemEstoqueBaixo) =>
    `- ${i.nome}: ${i.estoqueAtual} ${i.unidade} (mínimo: ${i.estoqueMinimo} ${i.unidade})`;
  const linhaHtml = (i: ItemEstoqueBaixo) => `
        <li style="margin-bottom: 8px;">
          <strong>${escapeHtml(i.nome)}</strong> — ${i.estoqueAtual} ${i.unidade}
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

// Disparado por responderArtePublica (src/app/a/[token]/actions.ts) quando o
// cliente final pede alteração numa arte — vai pro(s) DONO(s) da gráfica,
// mesmo padrão de destinatário de templateEstoqueBaixo/alerta-estoque.ts.
// comentario é texto livre vindo de um formulário público sem autenticação —
// escapeHtml é obrigatório aqui, mesmo motivo do nome de item em
// templateEstoqueBaixo.
export function templateArteAlteracaoSolicitada(
  graficaNome: string,
  clienteNome: string,
  comentario: string,
  linkProducao: string
): { assunto: string; html: string; texto: string } {
  return {
    assunto: `${removerQuebrasDeLinha(clienteNome)} pediu alteração na arte — ${removerQuebrasDeLinha(graficaNome)}`,
    texto: `${clienteNome} pediu uma alteração na arte de um pedido.\n\nComentário do cliente:\n"${comentario}"\n\nVeja o pedido em: ${linkProducao}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #0f172a;">Alteração de arte solicitada</h2>
        <p style="color: #334155;"><strong>${escapeHtml(clienteNome)}</strong> pediu uma alteração na arte de um pedido.</p>
        <blockquote style="margin: 0; padding: 12px 16px; border-left: 3px solid #0d9488; background: #f0fdfa; color: #0f172a;">
          ${escapeHtml(comentario)}
        </blockquote>
        <p>
          <a href="${linkProducao}" style="display: inline-block; background: #0d9488; color: #ffffff; padding: 12px 20px; border-radius: 10px; text-decoration: none; font-weight: 600; margin-top: 16px;">
            Ver pedido
          </a>
        </p>
      </div>
    `,
  };
}

export type ItemPedidoResumo = { nome: string; quantidade: number };

// Disparado por responderArtePublica quando o cliente APROVA a arte — mesmo
// destinatário (DONO(s) da gráfica) de templateArteAlteracaoSolicitada,
// avisando que o pedido já pode seguir pra impressão. clienteNome escapado
// pelo mesmo motivo: vem de um cadastro de Cliente, texto livre.
export function templateArteAprovada(
  graficaNome: string,
  clienteNome: string,
  itens: ItemPedidoResumo[],
  linkProducao: string
): { assunto: string; html: string; texto: string } {
  const linhaTexto = (i: ItemPedidoResumo) => `- ${i.nome} (qtd: ${i.quantidade})`;
  const linhaHtml = (i: ItemPedidoResumo) => `
        <li style="margin-bottom: 4px;">
          ${escapeHtml(i.nome)} <span style="color: #64748b;">(qtd: ${i.quantidade})</span>
        </li>`;

  return {
    assunto: `Arte aprovada — pedido de ${removerQuebrasDeLinha(clienteNome)} — ${removerQuebrasDeLinha(graficaNome)}`,
    texto: `${clienteNome} aprovou a arte do pedido — já pode seguir pra impressão.\n\nItens:\n${itens.map(linhaTexto).join("\n")}\n\nVeja o pedido em: ${linkProducao}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #0f172a;">Arte aprovada</h2>
        <p style="color: #334155;"><strong>${escapeHtml(clienteNome)}</strong> aprovou a arte do pedido — já pode seguir pra impressão.</p>
        <ul style="color: #0f172a; padding-left: 20px;">${itens.map(linhaHtml).join("")}
        </ul>
        <p>
          <a href="${linkProducao}" style="display: inline-block; background: #0d9488; color: #ffffff; padding: 12px 20px; border-radius: 10px; text-decoration: none; font-weight: 600; margin-top: 16px;">
            Ver pedido
          </a>
        </p>
      </div>
    `,
  };
}

// Disparado por avancarStatusPedido (src/app/producao/status-transicao.ts)
// quando um Pedido ENTRA numa etapa que tem responsável(is) atribuído(s) em
// /usuarios. Vai direto pro(s) funcionário(s) responsável(is) por essa
// etapa — diferente de templateArteAprovada/templateArteAlteracaoSolicitada,
// que sempre vão pro(s) DONO(s). linkConfirmar é o link evergreen
// /p/[token] (sem login) que confirma a etapa atual e avança o pedido.
// "Confirmar {rotulo.toLowerCase()} pronta" só soava natural pra Impressão
// ("confirmar impressão pronta"); nas outras duas etapas dava "confirmar
// acabamento pronta" (concordância errada, "acabamento" é masculino) e
// "confirmar pronto pronta" (redundante — o rótulo da etapa PRONTO já é
// "Pronto"). Chaveado pelo rótulo (não pelo StatusPedido) porque é só o que
// esta função recebe — o call site (avancarStatusPedido em
// producao/status-transicao.ts) passa ROTULOS_STATUS_PEDIDO[proximoStatus],
// e os 3 valores possíveis vêm de ESTAGIOS_ATRIBUIVEIS em
// producao-estagios.ts. Fallback genérico cobre uma eventual etapa nova sem
// quebrar o envio do e-mail.
const FRASES_CONFIRMACAO_ESTAGIO: Record<string, string> = {
  Impressão: "Confirmar impressão concluída",
  Acabamento: "Confirmar acabamento concluído",
  Pronto: "Confirmar pedido pronto",
};

export function templateEstagioResponsavel(
  graficaNome: string,
  clienteNome: string,
  rotuloEtapa: string,
  itens: ItemPedidoResumo[],
  linkConfirmar: string
): { assunto: string; html: string; texto: string } {
  const linhaTexto = (i: ItemPedidoResumo) => `- ${i.nome} (qtd: ${i.quantidade})`;
  const linhaHtml = (i: ItemPedidoResumo) => `
        <li style="margin-bottom: 4px;">
          ${escapeHtml(i.nome)} <span style="color: #64748b;">(qtd: ${i.quantidade})</span>
        </li>`;
  const fraseConfirmacao =
    FRASES_CONFIRMACAO_ESTAGIO[rotuloEtapa] ?? `Confirmar ${rotuloEtapa.toLowerCase()}`;

  return {
    assunto: `Pedido de ${removerQuebrasDeLinha(clienteNome)} chegou em ${removerQuebrasDeLinha(rotuloEtapa)} — ${removerQuebrasDeLinha(graficaNome)}`,
    texto: `O pedido de ${clienteNome} chegou na etapa "${rotuloEtapa}" e está sob sua responsabilidade.\n\nItens:\n${itens.map(linhaTexto).join("\n")}\n\nQuando terminar, confirme aqui (não precisa logar):\n${linkConfirmar}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #0f172a;">Pedido chegou em ${escapeHtml(rotuloEtapa)}</h2>
        <p style="color: #334155;">O pedido de <strong>${escapeHtml(clienteNome)}</strong> chegou nessa etapa e está sob sua responsabilidade.</p>
        <ul style="color: #0f172a; padding-left: 20px;">${itens.map(linhaHtml).join("")}
        </ul>
        <p>
          <a href="${linkConfirmar}" style="display: inline-block; background: #0d9488; color: #ffffff; padding: 12px 20px; border-radius: 10px; text-decoration: none; font-weight: 600; margin-top: 16px;">
            ${escapeHtml(fraseConfirmacao)}
          </a>
        </p>
        <p style="color: #64748b; font-size: 14px;">Não precisa logar — o link já confirma direto.</p>
      </div>
    `,
  };
}

function formatarValorBRL(valor: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valor);
}

// Disparado por responderOrcamentoPublico (src/app/o/[token]/actions.ts)
// quando o cliente APROVA o orçamento pelo link público. Diferente de
// templateArteAprovada/templateArteAlteracaoSolicitada (que vão só pro(s)
// DONO(s) da gráfica), este vai pro VENDEDOR (Orcamento.usuarioId) +
// DONO(s), deduplicados — decisão do dono do produto: venda fechada é mais
// urgente que venda perdida, mas o vendedor é quem precisa agir e quem
// ganha comissão, então ele entra como destinatário principal; donos são
// garantia de que alguém vê, mesmo com o vendedor fora. respondidoPor é o
// nome DECLARADO por quem respondeu (Orcamento.respostaPublicaNome — não
// verificado, ver comentário no schema), por isso escapado como qualquer
// texto livre vindo de fora. linkOrcamento é a tela AUTENTICADA
// (/orcamento/[id]), não o link público — quem recebe isto já loga na
// gráfica.
export function templateOrcamentoAprovado(
  graficaNome: string,
  clienteNome: string,
  respondidoPor: string,
  valorTotal: number,
  linkOrcamento: string
): { assunto: string; html: string; texto: string } {
  const valorFormatado = formatarValorBRL(valorTotal);
  return {
    assunto: `Orçamento aprovado — ${removerQuebrasDeLinha(clienteNome)} — ${removerQuebrasDeLinha(graficaNome)}`,
    texto: `${respondidoPor} aprovou o orçamento de ${clienteNome} (${valorFormatado}) pelo link público.\n\nVeja o orçamento em: ${linkOrcamento}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #0f172a;">Orçamento aprovado</h2>
        <p style="color: #334155;"><strong>${escapeHtml(respondidoPor)}</strong> aprovou o orçamento de <strong>${escapeHtml(clienteNome)}</strong> pelo link público.</p>
        <p style="color: #0f172a; font-size: 22px; font-weight: 700;">${valorFormatado}</p>
        <p>
          <a href="${linkOrcamento}" style="display: inline-block; background: #0d9488; color: #ffffff; padding: 12px 20px; border-radius: 10px; text-decoration: none; font-weight: 600; margin-top: 16px;">
            Ver orçamento
          </a>
        </p>
      </div>
    `,
  };
}

// Disparado por responderOrcamentoPublico quando o cliente RECUSA o
// orçamento pelo link público. Mesmo destinatário de
// templateOrcamentoAprovado (vendedor + donos). motivo é
// Orcamento.respostaPublicaMotivo — texto livre e OPCIONAL preenchido pelo
// cliente no próprio formulário público (ver comentário do campo no
// schema); quando vazio, o e-mail precisa dizer isso explicitamente ("não
// informado") em vez de simplesmente omitir a seção, senão o vendedor não
// sabe se o cliente não quis dizer o motivo ou se o e-mail perdeu a
// informação.
export function templateOrcamentoRecusado(
  graficaNome: string,
  clienteNome: string,
  respondidoPor: string,
  valorTotal: number,
  motivo: string,
  linkOrcamento: string
): { assunto: string; html: string; texto: string } {
  const valorFormatado = formatarValorBRL(valorTotal);
  const motivoTexto = motivo ? motivo : "Não informado.";
  const motivoHtml = motivo
    ? escapeHtml(motivo)
    : `<em style="color: #64748b;">Não informado.</em>`;

  return {
    assunto: `Orçamento recusado — ${removerQuebrasDeLinha(clienteNome)} — ${removerQuebrasDeLinha(graficaNome)}`,
    texto: `${respondidoPor} recusou o orçamento de ${clienteNome} (${valorFormatado}) pelo link público.\n\nMotivo informado pelo cliente:\n${motivoTexto}\n\nVeja o orçamento em: ${linkOrcamento}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #0f172a;">Orçamento recusado</h2>
        <p style="color: #334155;"><strong>${escapeHtml(respondidoPor)}</strong> recusou o orçamento de <strong>${escapeHtml(clienteNome)}</strong> pelo link público.</p>
        <p style="color: #0f172a; font-size: 22px; font-weight: 700;">${valorFormatado}</p>
        <p style="color: #334155; margin-bottom: 4px;">Motivo informado pelo cliente:</p>
        <blockquote style="margin: 0; padding: 12px 16px; border-left: 3px solid #dc2626; background: #fef2f2; color: #0f172a;">
          ${motivoHtml}
        </blockquote>
        <p>
          <a href="${linkOrcamento}" style="display: inline-block; background: #0d9488; color: #ffffff; padding: 12px 20px; border-radius: 10px; text-decoration: none; font-weight: 600; margin-top: 16px;">
            Ver orçamento
          </a>
        </p>
      </div>
    `,
  };
}

// Disparado pelo cron diário (enviarAlertasPrazoEmail, src/lib/alerta-prazo-email.ts)
// quando um pedido chega a 5 ou 3 dias do prazo de entrega — canal SEPARADO
// do alerta_atraso antigo (webhook de automação da própria gráfica, dispara
// sob demanda só depois do prazo já vencido). Vai pro vendedor do orçamento
// + DONO(s) da gráfica, mesmo destinatário de templateOrcamentoAprovado.
// diasRestantes é sempre 5 ou 3 na prática (os dois limiares "com
// antecedência" da cascata em alerta-prazo-email.ts), mas fica genérico
// (number) em vez de união de literais — não vale a pena travar o tipo por
// só 2 valores possíveis.
export function templatePedidoPrazoProximo(
  graficaNome: string,
  clienteNome: string,
  itens: ItemPedidoResumo[],
  diasRestantes: number,
  prazoFormatado: string,
  linkProducao: string
): { assunto: string; html: string; texto: string } {
  const linhaTexto = (i: ItemPedidoResumo) => `- ${i.nome} (qtd: ${i.quantidade})`;
  const linhaHtml = (i: ItemPedidoResumo) => `
        <li style="margin-bottom: 4px;">
          ${escapeHtml(i.nome)} <span style="color: #64748b;">(qtd: ${i.quantidade})</span>
        </li>`;
  const diasTexto = diasRestantes === 1 ? "1 dia" : `${diasRestantes} dias`;

  return {
    assunto: `Faltam ${diasTexto} pro prazo — pedido de ${removerQuebrasDeLinha(clienteNome)} — ${removerQuebrasDeLinha(graficaNome)}`,
    texto: `Faltam ${diasTexto} pro prazo de entrega prometido do pedido de ${clienteNome} (prazo: ${prazoFormatado}).\n\nItens:\n${itens.map(linhaTexto).join("\n")}\n\nAcompanhe em: ${linkProducao}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #0f172a;">Faltam ${diasTexto} pro prazo de entrega</h2>
        <p style="color: #334155;">O pedido de <strong>${escapeHtml(clienteNome)}</strong> tem prazo prometido pra <strong>${prazoFormatado}</strong>.</p>
        <ul style="color: #0f172a; padding-left: 20px;">${itens.map(linhaHtml).join("")}
        </ul>
        <p>
          <a href="${linkProducao}" style="display: inline-block; background: #0d9488; color: #ffffff; padding: 12px 20px; border-radius: 10px; text-decoration: none; font-weight: 600; margin-top: 16px;">
            Ver fila de produção
          </a>
        </p>
      </div>
    `,
  };
}

// Disparado pelo mesmo cron, quando o prazo de um pedido chega (diasAtraso=0,
// vence hoje) ou já passou (diasAtraso>0) sem o pedido ter sido concluído —
// limiar 0 da cascata, o mais urgente, e o único que nunca reenvia depois
// (ver comentário de Pedido.alertaPrazoUltimoLimiarDias no schema).
export function templatePedidoPrazoAtrasado(
  graficaNome: string,
  clienteNome: string,
  itens: ItemPedidoResumo[],
  diasAtraso: number,
  prazoFormatado: string,
  linkProducao: string
): { assunto: string; html: string; texto: string } {
  const linhaTexto = (i: ItemPedidoResumo) => `- ${i.nome} (qtd: ${i.quantidade})`;
  const linhaHtml = (i: ItemPedidoResumo) => `
        <li style="margin-bottom: 4px;">
          ${escapeHtml(i.nome)} <span style="color: #64748b;">(qtd: ${i.quantidade})</span>
        </li>`;
  const situacaoTexto =
    diasAtraso <= 0
      ? "O prazo de entrega vence hoje"
      : diasAtraso === 1
        ? "O prazo de entrega venceu há 1 dia"
        : `O prazo de entrega venceu há ${diasAtraso} dias`;

  return {
    assunto: `${diasAtraso <= 0 ? "Prazo vence hoje" : "Prazo vencido"} — pedido de ${removerQuebrasDeLinha(clienteNome)} — ${removerQuebrasDeLinha(graficaNome)}`,
    texto: `${situacaoTexto} — pedido de ${clienteNome} (prazo: ${prazoFormatado}), ainda não concluído.\n\nItens:\n${itens.map(linhaTexto).join("\n")}\n\nAcompanhe em: ${linkProducao}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #b91c1c;">${situacaoTexto}</h2>
        <p style="color: #334155;">O pedido de <strong>${escapeHtml(clienteNome)}</strong> (prazo: <strong>${prazoFormatado}</strong>) ainda não foi concluído.</p>
        <ul style="color: #0f172a; padding-left: 20px;">${itens.map(linhaHtml).join("")}
        </ul>
        <p>
          <a href="${linkProducao}" style="display: inline-block; background: #0d9488; color: #ffffff; padding: 12px 20px; border-radius: 10px; text-decoration: none; font-weight: 600; margin-top: 16px;">
            Ver fila de produção
          </a>
        </p>
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
