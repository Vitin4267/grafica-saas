// Puro (sem "server-only", sem Prisma) — testável isolado, mesmo padrão de
// src/lib/exportacao-financeira.ts (detectarCandidatosDuplicidade, achado
// A16). Achado A2/Parte 5-Fiscal da auditoria de abrangência ("Fase A"):
// antes de validar dígito verificador (src/lib/documento.ts), o
// `@@unique([graficaId, documento])` do schema não pegava dois cadastros do
// MESMO CPF/CNPJ com pontuação diferente ("111.444.777-35" e
// "11144477735" são strings diferentes pro Postgres) — este arquivo agrupa
// os clientes de uma gráfica pelo documento JÁ normalizado, pra revelar
// esses grupos escondidos. Não decide nada sozinho (não sugere qual manter,
// não desativa, não mescla) — só lista pro dono decidir manualmente, mesmo
// espírito de detectarCandidatosDuplicidade.

import { normalizarDocumento } from "@/lib/documento";

export interface ClienteParaDuplicidade {
  id: string;
  nome: string;
  documento: string | null;
  desativadoEm: Date | null;
}

export interface GrupoClienteDuplicado {
  documentoNormalizado: string;
  clientes: ClienteParaDuplicidade[];
}

// Agrupa por normalizarDocumento(documento) e retorna só os grupos com 2+
// clientes DIFERENTES compartilhando o mesmo documento normalizado.
// Clientes sem documento (null/"") nunca entram — não há nada a comparar
// (mesmo tratamento de "NULL não colide" do unique index do schema).
export function agruparClientesPorDocumento(
  clientes: ClienteParaDuplicidade[]
): GrupoClienteDuplicado[] {
  const porDocumento = new Map<string, ClienteParaDuplicidade[]>();

  for (const cliente of clientes) {
    if (!cliente.documento) continue;
    const documentoNormalizado = normalizarDocumento(cliente.documento);
    if (!documentoNormalizado) continue;
    const lista = porDocumento.get(documentoNormalizado);
    if (lista) {
      lista.push(cliente);
    } else {
      porDocumento.set(documentoNormalizado, [cliente]);
    }
  }

  const grupos: GrupoClienteDuplicado[] = [];
  for (const [documentoNormalizado, lista] of porDocumento) {
    if (lista.length < 2) continue; // 1 cliente só nunca é candidato
    grupos.push({ documentoNormalizado, clientes: lista });
  }

  // Grupo com mais clientes primeiro (mais urgente revisar); empate
  // resolvido por ordem alfabética do documento pra saída determinística.
  return grupos.sort(
    (a, b) =>
      b.clientes.length - a.clientes.length ||
      a.documentoNormalizado.localeCompare(b.documentoNormalizado)
  );
}
