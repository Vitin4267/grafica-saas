import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { TipoImportacaoPlanilha } from "@/generated/prisma/enums";
import { escreverLinhaCliente } from "./escritor-clientes";
import { escreverLinhaCatalogo } from "./escritor-catalogo";
import { escreverLinhaPedido } from "./escritor-pedidos";

export type ResultadoEscritaLinha = { ok: true } | { ok: false; mensagem: string };

// Único ponto de entrada pra gravar UMA linha já mapeada — quem chama (a
// Server Action de confirmação, feita em paralelo) não precisa saber que
// Pedidos usa `contexto.usuarioId` e os outros dois não; a diferença fica
// escondida aqui.
export async function escreverLinha(
  tipo: TipoImportacaoPlanilha,
  tx: Prisma.TransactionClient,
  contexto: { graficaId: string; usuarioId: string },
  linha: Record<string, string>
): Promise<ResultadoEscritaLinha> {
  switch (tipo) {
    case "CLIENTES":
      return escreverLinhaCliente(tx, contexto.graficaId, linha);
    case "CATALOGO":
      return escreverLinhaCatalogo(tx, contexto.graficaId, linha);
    case "PEDIDOS":
      return escreverLinhaPedido(tx, contexto.graficaId, contexto.usuarioId, linha);
  }
}
