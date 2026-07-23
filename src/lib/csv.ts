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
function sanitizarCelulaCsv(valor: string): string {
  return /^[=+\-@\t]/.test(valor) ? `'${valor}` : valor;
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
