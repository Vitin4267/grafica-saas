// Puro (sem "server-only", sem Prisma) — testável isolado, mesmo padrão de
// src/lib/estoque-critico.ts.

// Neutraliza CSV/Formula Injection: um campo de TEXTO (nunca um number que a
// própria app formatou) que comece com =, +, -, @ ou tab seria interpretado
// como fórmula pelo Excel/Sheets ao abrir o arquivo — um nome de cliente
// "=cmd|'/c calc'!A1" ou "=WEBSERVICE(...)" executaria/vazaria dado quando
// quem exportou só esperava abrir uma planilha (achado da auditoria de
// 2026-07-23, ver src/app/financeiro/exportar/route.ts). Prefixo de
// apóstrofo força leitura como texto puro, sem mudar o que aparece na
// célula. Só se aplica a `string` (não a `number`) de propósito: um valor
// numérico negativo formatado pela própria app (ex: -5) não deve virar texto
// só por começar com "-".
//
// \r (CR) entrou na lista em 2026-07-26: faz parte da lista canônica da OWASP
// e faltava aqui. Um campo de texto livre (ex: descrição de despesa) contendo
// CR cria uma segunda linha lógica dentro da célula citada, e essa linha pode
// começar com "=" mesmo que o campo inteiro não comece.
function sanitizarCelulaCsv(valor: string): string {
  return /^[=+\-@\t\r]/.test(valor) ? `'${valor}` : valor;
}

export function linhaCsv(campos: (string | number)[]): string {
  return (
    campos
      .map((campo) => {
        const texto = typeof campo === "string" ? sanitizarCelulaCsv(campo) : String(campo);
        return `"${texto.replace(/"/g, '""')}"`;
      })
      .join(";") + "\r\n"
  );
}
