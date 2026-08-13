import { z } from "zod";

export type ParseJsonArrayResult<T> =
  | { ok: true; data: T[] }
  | { ok: false; mensagem: string };

// Padrão comum a todo formulário que envia uma lista editável (bobinas, formatos
// de folha, ficha técnica, itens de orçamento) via um campo hidden com JSON.stringify
// no cliente — valida a forma (array) e cada item contra o schema zod fornecido.
export function parseJsonArray<T>(
  raw: FormDataEntryValue | null,
  schema: z.ZodType<T>,
  opcoes?: { max?: number }
): ParseJsonArrayResult<T> {
  if (!raw) return { ok: true, data: [] };

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(String(raw));
  } catch {
    return { ok: false, mensagem: "Dados inválidos enviados pelo formulário." };
  }
  if (!Array.isArray(parsedJson)) {
    return { ok: false, mensagem: "Dados inválidos enviados pelo formulário." };
  }
  // Sem isso, um POST forjado podia mandar dezenas de milhares de linhas — cada
  // uma validada e gravada, deixando a página/PDF permanentemente pesados.
  if (opcoes?.max !== undefined && parsedJson.length > opcoes.max) {
    return { ok: false, mensagem: `Envie no máximo ${opcoes.max} itens.` };
  }

  const resultado: T[] = [];
  for (const item of parsedJson) {
    const parsed = schema.safeParse(item);
    if (!parsed.success) {
      return {
        ok: false,
        mensagem: parsed.error.issues[0]?.message ?? "Dados inválidos.",
      };
    }
    resultado.push(parsed.data);
  }
  return { ok: true, data: resultado };
}
