import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Criptografia de campo pra credencial sigilosa (token de API de terceiro,
// URL de webhook com segredo embutido no path) — NUNCA pra dado operacional
// que a própria gráfica precisa ver/imprimir (CPF/CNPJ de cliente
// permanecem em texto claro, decisão de escopo: cifrar ali derrubaria
// `Cliente.@@unique([graficaId, documento])` sem proteção real, já que o
// app teria que decifrar em toda listagem mesmo assim — ver achado da
// auditoria de segurança 2026-09-13).
//
// AES-256-GCM: autenticado (um valor cifrado adulterado falha a decifra em
// vez de devolver lixo em silêncio), IV aleatório por valor (o mesmo texto
// cifrado duas vezes nunca produz a mesma saída, então o banco não vaza
// "estes dois registros têm o mesmo token"). Formato de armazenamento:
//
//   v1:<iv em base64>:<authTag em base64>:<texto cifrado em base64>
//
// O prefixo de versão existe pra permitir trocar de algoritmo/derivar a
// chave de outro jeito no futuro sem quebrar valores já gravados — decifrar
// despacha pela versão, nunca assume o formato atual pra sempre.
const VERSAO_ATUAL = "v1";
const ALGORITMO = "aes-256-gcm";
const TAMANHO_IV_BYTES = 12; // recomendado pro GCM (96 bits)

function obterChave(): Buffer {
  const chaveBase64 = process.env.ENCRYPTION_KEY;
  if (!chaveBase64) {
    throw new Error(
      "ENCRYPTION_KEY não configurada — operação de criptografia de credencial abortada (nunca grava/lê segredo sem cifra). Gere uma com `openssl rand -base64 32` e configure na env."
    );
  }
  const chave = Buffer.from(chaveBase64, "base64");
  if (chave.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY inválida — esperado 32 bytes (256 bits) em base64, recebido ${chave.length} bytes. Gere de novo com \`openssl rand -base64 32\`.`
    );
  }
  return chave;
}

// Cifra um texto (nunca vazio — usar null/undefined no campo em vez de
// cifrar string vazia, ver call sites). Saída determinística em FORMATO,
// nunca em VALOR: dois cifrar() do mesmo texto produzem saídas diferentes
// (IV aleatório), de propósito.
export function cifrar(texto: string): string {
  const chave = obterChave();
  const iv = randomBytes(TAMANHO_IV_BYTES);
  const cipher = createCipheriv(ALGORITMO, chave, iv);
  const cifrado = Buffer.concat([cipher.update(texto, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [VERSAO_ATUAL, iv.toString("base64"), authTag.toString("base64"), cifrado.toString("base64")].join(":");
}

// Decifra um valor gravado por cifrar(). Lança (nunca devolve lixo) se a
// chave estiver errada, o valor foi adulterado (authTag não bate) ou o
// formato não é reconhecido — nenhum desses casos deveria fingir sucesso.
export function decifrar(valor: string): string {
  const partes = valor.split(":");
  const [versao, ivBase64, authTagBase64, cifradoBase64] = partes;
  if (partes.length !== 4 || versao !== VERSAO_ATUAL) {
    throw new Error(`Valor cifrado em formato desconhecido (esperado prefixo "${VERSAO_ATUAL}:").`);
  }
  const chave = obterChave();
  const iv = Buffer.from(ivBase64, "base64");
  const authTag = Buffer.from(authTagBase64, "base64");
  const cifrado = Buffer.from(cifradoBase64, "base64");
  const decipher = createDecipheriv(ALGORITMO, chave, iv);
  decipher.setAuthTag(authTag);
  const decifrado = Buffer.concat([decipher.update(cifrado), decipher.final()]);
  return decifrado.toString("utf8");
}

// Helpers pra campo nullable (padrão do resto do motor: `?? null` em vez de
// lançar quando o dado simplesmente não foi cadastrado ainda).
export function cifrarOuNull(texto: string | null | undefined): string | null {
  if (texto === null || texto === undefined || texto === "") return null;
  return cifrar(texto);
}

export function decifrarOuNull(valor: string | null | undefined): string | null {
  if (valor === null || valor === undefined) return null;
  return decifrar(valor);
}

// Últimos N caracteres do texto EM CLARO, pra montar máscara de exibição
// (`•••• 1234`) sem decifrar — ver ContaFiscalForm/telas de configuração.
// Roda ANTES de cifrar, sobre o texto original, nunca sobre o cifrado.
export function ultimosCaracteres(texto: string, quantidade: number): string {
  return texto.slice(-quantidade);
}
