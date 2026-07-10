import { z } from "zod";

export type ParseJsonArrayResult<T> =
  | { ok: true; data: T[] }
  | { ok: false; mensagem: string };

// Padrão comum a todo formulário que envia uma lista editável (bobinas, formatos
// de folha, ficha técnica, itens de orçamento) via um campo hidden com JSON.stringify
// no cliente — valida a forma (array) e cada item contra o schema zod fornecido.
export function parseJsonArray<T>(
  raw: FormDataEntryValue | null,
  schema: z.ZodType<T>
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
