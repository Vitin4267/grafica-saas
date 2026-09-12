import "server-only";

// Achado em produção (2026-09-12) — upload de arquivo (logo, arte de
// pedido/orçamento, imagem de análise de tinta) começou a falhar por
// inteiro depois de uma reconfiguração dos stores de Blob na Vercel em
// 08/09. Causa raiz: a Vercel migrou a conexão pra OIDC (autenticação sem
// token fixo), e o SDK @vercel/blob, quando existe uma env var
// `BLOB_STORE_ID` (nome exato, sem prefixo, auto-gerada pela Vercel) E um
// token OIDC da própria Vercel está disponível no runtime, passa a IGNORAR
// até um `token` passado EXPLICITAMENTE nas chamadas — documentado em
// node_modules/@vercel/blob/dist/index.d.ts: "token - ... Ignored when
// Vercel OIDC token is available and either process.env.BLOB_STORE_ID or
// options.storeId is set." Com dois stores no projeto (público
// "grafica-saas-blob" e privado "grafica-privado"), essa env var ambígua
// resolve pra UM só dos dois — toda chamada do outro store (ou as duas,
// dependendo de qual ganhou) quebra ou, pior, silenciosamente tenta
// autenticar no store ERRADO (risco real: backup com Usuario.senhaHash e
// imagem de análise de tinta, que são PRIVADOS, indo pro storeId do
// público, ou vice-versa).
//
// Correção: nunca depender de env var ambígua. Cada chamada passa
// storeId+token EXPLÍCITOS, resolvidos aqui, pro store certo — storeId
// força o caminho OIDC (mais seguro, sem token fixo) quando a Vercel
// oferecer; token junto garante fallback funcional em ambiente sem OIDC
// (dev local). BLOB_STORE_ID_PUBLICO/BLOB_STORE_ID_PRIVADO são o "Unique
// Store ID" de cada store (aba Settings de cada um no dashboard da
// Vercel) — não são segredo, só identificador, mas ficam em env var (não
// hardcoded no código) pro mesmo motivo de Price ID do Stripe nunca ser
// hardcoded: se o store for recriado de novo no futuro, só troca a env
// var, sem precisar editar/redeployar código.
type OpcoesBlob = { storeId?: string; token?: string };

function opcoes(storeIdEnvVar: string, tokenEnvVar: string): OpcoesBlob {
  return {
    storeId: process.env[storeIdEnvVar]?.trim() || undefined,
    token: process.env[tokenEnvVar]?.trim() || undefined,
  };
}

// Store PÚBLICO ("grafica-saas-blob") — logo, arte de pedido/orçamento,
// qualquer arquivo acessível sem autenticação por URL direta.
export function opcoesBlobPublico(): OpcoesBlob {
  return opcoes("BLOB_STORE_ID_PUBLICO", "BLOB_READ_WRITE_TOKEN");
}

// Store PRIVADO ("grafica-privado") — imagem de análise de tinta, backup
// diário do banco. Nunca acessível por URL direta sem token assinado (ver
// urlAssinadaLeitura abaixo).
export function opcoesBlobPrivado(): OpcoesBlob {
  return opcoes("BLOB_STORE_ID_PRIVADO", "BLOB_PRIVATE_READ_WRITE_TOKEN");
}
