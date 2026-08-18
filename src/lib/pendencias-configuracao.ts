import "server-only";
import { prisma } from "@/lib/prisma";

// Registro de pendências de configuração que o DONO precisa resolver pra
// deixar o sistema pronto pra usar — mostrado como um "questionário" assim
// que ele loga (ver PendenciasConfiguracaoModal.tsx), sem precisar procurar
// onde configurar. Mesmo espírito de obterStatusOnboarding (src/lib/onboarding.ts):
// tudo calculado on-the-fly via query de contagem, nada persistido como flag
// de "concluído" — a pendência simplesmente para de existir quando o dado
// que faltava é preenchido.
//
// Extensível: cada pendência é um `tipo` do union abaixo. Adicionar uma nova
// checagem no futuro é só mais um item no array dentro de
// listarPendenciasConfiguracao, sem mexer no que já existe.
export type PendenciaConfiguracao = {
  tipo: "BOBINA_ETIQUETA_FALTANDO";
  itemGraficaId: string;
  nomeProduto: string;
};

export async function listarPendenciasConfiguracao(
  graficaId: string
): Promise<PendenciaConfiguracao[]> {
  // Produto M2 ativo sem nenhuma bobina cadastrada — o motor de preço nem
  // roda pra ele (ver src/lib/pricing/carregar.ts, MATERIAL_SEM_BOBINA), mas
  // isso só aparece pro vendedor na hora de montar um orçamento. Pega antes.
  const itensSemBobina = await prisma.itemGrafica.findMany({
    where: {
      graficaId,
      ativo: true,
      modeloCalculo: "M2",
      bobinas: { none: {} },
    },
    include: { itemCatalogo: true },
  });

  return itensSemBobina.map((item) => ({
    tipo: "BOBINA_ETIQUETA_FALTANDO" as const,
    itemGraficaId: item.id,
    nomeProduto: item.itemCatalogo.nome,
  }));
}
