import { z } from "zod";
import { prisma } from "@/lib/prisma";

// Achado F8 da auditoria de abrangência (Parte 7) — helpers compartilhados
// pelas ações de item de orçamento (adicionarItemOrcamento/editarOrcamento
// em src/app/orcamento/[id]/actions/itens.ts, criarOrcamento em
// src/app/orcamento/actions.ts, adicionarOpcaoOrcamento em
// src/app/orcamento/[id]/opcoes.actions.ts) — mesmo motivo de
// src/lib/orcamento-etiqueta.ts existir à parte: a mesma validação se repete
// em vários fluxos de escrita de item.

// Entrada de UMA linha de "cor especial" vinda do formulário (JSON num
// campo hidden, mesmo padrão de hotStampingsJson em
// src/lib/orcamento-item-entrada.ts). corEspecialId vazio/ausente = nome
// digitado sem estar na biblioteca do cliente ainda. salvarNaBiblioteca só
// tem efeito quando corEspecialId vem vazio E nomeDeclarado não é vazio —
// cria (ou reaproveita, se já existir com o mesmo nome) uma
// CorEspecialCliente pra este cliente, pra aparecer na biblioteca do
// próximo orçamento dele (ver resolverCoresEspeciais abaixo).
export const corEspecialEntradaSchema = z.object({
  corEspecialId: z.string().min(1).nullable(),
  nomeDeclarado: z.string().trim().min(1).max(120),
  salvarNaBiblioteca: z.boolean().optional().default(false),
});
export type CorEspecialEntrada = z.infer<typeof corEspecialEntradaSchema>;

// Uma cor da biblioteca (CorEspecialCliente) pronta pra popular o
// autocomplete/seleção da UI — nunca a linha inteira do banco (formulaMistura
// não precisa viajar até o client só pra listar opções).
export type CorEspecialDisponivel = {
  id: string;
  nome: string;
  referencia: string;
  sistemaCor: "PANTONE" | "RAL" | "OUTRO";
};

// Biblioteca de cor pra um orçamento: cores especificamente cadastradas pro
// CLIENTE deste orçamento + cores GENÉRICAS da gráfica (clienteId null, ver
// comentário de CorEspecialCliente no schema) — as duas juntas, cliente
// primeiro (mais provável de ser o que o vendedor quer).
export async function buscarCoresEspeciaisDisponiveis(
  graficaId: string,
  clienteId: string
): Promise<CorEspecialDisponivel[]> {
  const cores = await prisma.corEspecialCliente.findMany({
    where: { graficaId, OR: [{ clienteId }, { clienteId: null }] },
    orderBy: [{ clienteId: "desc" }, { nome: "asc" }],
    select: { id: true, nome: true, referencia: true, sistemaCor: true },
  });
  return cores;
}

export type ResolverCoresEspeciaisResultado =
  | {
      ok: true;
      linhas: { corEspecialId: string | null; nomeDeclarado: string }[];
    }
  | { ok: false; mensagem: string };

// Valida a propriedade de cada corEspecialId enviado (defesa contra IDOR —
// um POST forjado não pode amarrar o item a uma cor de OUTRA gráfica, nem à
// biblioteca privada de OUTRO cliente da mesma gráfica) e resolve o "salvar
// na biblioteca" — cria (ou reaproveita, por nome, case-insensitive) uma
// CorEspecialCliente nova pras linhas marcadas com salvarNaBiblioteca que
// ainda não apontam pra uma cor existente. Retorna as linhas prontas pra
// gravar em OrcamentoItemCor (create/createMany).
export async function resolverCoresEspeciais(
  linhas: CorEspecialEntrada[],
  graficaId: string,
  clienteId: string
): Promise<ResolverCoresEspeciaisResultado> {
  const resultado: { corEspecialId: string | null; nomeDeclarado: string }[] = [];

  for (const linha of linhas) {
    if (linha.corEspecialId) {
      // Ownership: precisa pertencer a esta gráfica E (ser genérica da
      // gráfica OU pertencer a este mesmo cliente) — mesma dupla checagem de
      // buscarCoresEspeciaisDisponiveis acima.
      const corEspecial = await prisma.corEspecialCliente.findFirst({
        where: { id: linha.corEspecialId, graficaId, OR: [{ clienteId }, { clienteId: null }] },
        select: { id: true },
      });
      if (!corEspecial) {
        return {
          ok: false,
          mensagem: `Cor especial "${linha.nomeDeclarado}" não encontrada na biblioteca deste cliente.`,
        };
      }
      resultado.push({ corEspecialId: corEspecial.id, nomeDeclarado: linha.nomeDeclarado });
      continue;
    }

    if (linha.salvarNaBiblioteca) {
      // find-or-create por nome (case-insensitive) — evita duplicar a mesma
      // cor na biblioteca se o vendedor digitar "Azul Institucional" duas
      // vezes em orçamentos diferentes do mesmo cliente.
      const existente = await prisma.corEspecialCliente.findFirst({
        where: { graficaId, clienteId, nome: { equals: linha.nomeDeclarado, mode: "insensitive" } },
        select: { id: true },
      });
      const corEspecial =
        existente ??
        (await prisma.corEspecialCliente.create({
          data: {
            graficaId,
            clienteId,
            nome: linha.nomeDeclarado,
            referencia: linha.nomeDeclarado,
          },
          select: { id: true },
        }));
      resultado.push({ corEspecialId: corEspecial.id, nomeDeclarado: linha.nomeDeclarado });
      continue;
    }

    resultado.push({ corEspecialId: null, nomeDeclarado: linha.nomeDeclarado });
  }

  return { ok: true, linhas: resultado };
}
