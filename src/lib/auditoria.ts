import "server-only";
import { prisma } from "@/lib/prisma";

type RegistrarAuditoriaInput = {
  graficaId: string;
  usuarioId: string;
  usuarioNome: string;
  acao: string;
  entidade: string;
  entidadeId: string;
  descricao: string;
};

export async function registrarAuditoria(dados: RegistrarAuditoriaInput): Promise<void> {
  await prisma.logAuditoria.create({ data: dados });
}
