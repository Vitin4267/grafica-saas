import "server-only";
import { prisma } from "@/lib/prisma";

// Split -db.ts (ver padrão #1 em arquitetura-resumo.md): manutencao-maquina.ts
// é importado por Client Component (ManutencaoMaquinaCard.tsx), então
// precisa continuar 100% puro/sem Prisma — esta função mora aqui do lado de
// fora dele.
//
// A mesma query (registros de manutenção ATIVOS — dataFim null — desta
// gráfica, só os 5 campos de máquina) era reescrita em cada tela que
// precisava saber "quais máquinas estão paradas agora": /configuracoes/
// maquinas, o cadastro de produto Offset/Flexografia, e agora o Kanban de
// produção (achado C1 da auditoria de abrangência, Parte 2/Produção,
// 2026-09-07). Extraída aqui pra as 3 nunca divergirem — o resultado
// alimenta indexarManutencoesAtivasPorMaquina (manutencao-maquina.ts) pra
// virar um Map/Set indexado por id de máquina.
export function buscarManutencoesAtivas(graficaId: string) {
  return prisma.registroManutencao.findMany({
    where: { graficaId, dataFim: null },
    select: {
      prensaId: true,
      maquinaFlexografiaId: true,
      equipamentoId: true,
      impressoraDigitalId: true,
      maquinaSetupPorPecaId: true,
    },
  });
}
