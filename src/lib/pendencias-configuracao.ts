import "server-only";
import { prisma } from "@/lib/prisma";
import { calcularSituacaoAliquotaSimples } from "@/lib/simples-nacional-db";

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
export type PendenciaConfiguracao =
  | {
      tipo: "BOBINA_ETIQUETA_FALTANDO";
      itemGraficaId: string;
      nomeProduto: string;
    }
  | {
      tipo: "PAPEL_MATERIA_PRIMA_FALTANDO";
      itemGraficaId: string;
      nomeProduto: string;
    }
  | {
      tipo: "MAQUINA_NAO_VINCULADA";
      itemGraficaId: string;
      nomeProduto: string;
    }
  | {
      // Achado A10 da Parte 4 da auditoria de abrangência (2026-09-07) —
      // ParametrosGrafica.impostoPercent é fixo, mas no Simples Nacional a
      // alíquota efetiva CRESCE com o RBT12 (faturamento acumulado nos
      // últimos 12 meses). Dispara quando a alíquota efetiva apurada pra
      // faixa atual do Anexo III supera o que está configurado — a gráfica
      // continua precificando com o percentual antigo enquanto paga mais
      // imposto de verdade. Ver src/lib/simples-nacional(-db).ts.
      tipo: "ALIQUOTA_SIMPLES_ACIMA_DO_CONFIGURADO";
      rbt12: number;
      aliquotaEfetiva: number;
      impostoConfigurado: number;
      faixaIndice: number;
    };

export async function listarPendenciasConfiguracao(
  graficaId: string
): Promise<PendenciaConfiguracao[]> {
  // Produto M2 (ou DTF, achado A5 — reaproveita o MESMO motor calcularM2 e a
  // mesma exigência de bobina, ver src/lib/pricing/carregar.ts) ativo sem
  // nenhuma bobina cadastrada — o motor de preço nem roda pra ele
  // (MATERIAL_SEM_BOBINA), mas isso só aparece pro vendedor na hora de
  // montar um orçamento. Pega antes.
  const itensSemBobina = await prisma.itemGrafica.findMany({
    where: {
      graficaId,
      ativo: true,
      modeloCalculo: { in: ["M2", "DTF"] },
      bobinas: { none: {} },
    },
    include: { itemCatalogo: true },
  });

  const pendenciasBobina = itensSemBobina.map((item) => ({
    tipo: "BOBINA_ETIQUETA_FALTANDO" as const,
    itemGraficaId: item.id,
    nomeProduto: item.itemCatalogo.nome,
  }));

  // Produto com clichê de etiqueta configurado depende de existir pelo
  // menos uma matéria-prima ativa pra ser escolhida como papel no orçamento
  // (mesmo filtro de src/lib/orcamento/page.tsx e orcamento-precificacao.ts:
  // qualquer MATERIA_PRIMA ativa da gráfica, sem categoria obrigatória). Sem
  // isso o seletor de papel aparece vazio pro vendedor. Contagem primeiro —
  // só busca os produtos afetados se a gráfica realmente não tem nenhuma.
  const totalMateriasPrimas = await prisma.itemGrafica.count({
    where: { graficaId, ativo: true, itemCatalogo: { tipo: "MATERIA_PRIMA" } },
  });

  let pendenciasPapel: PendenciaConfiguracao[] = [];
  if (totalMateriasPrimas === 0) {
    const itensComCliche = await prisma.itemGrafica.findMany({
      where: {
        graficaId,
        ativo: true,
        configuracaoClicheEtiqueta: { isNot: null },
      },
      include: { itemCatalogo: true },
    });

    pendenciasPapel = itensComCliche.map((item) => ({
      tipo: "PAPEL_MATERIA_PRIMA_FALTANDO" as const,
      itemGraficaId: item.id,
      nomeProduto: item.itemCatalogo.nome,
    }));
  }

  // Produto OFFSET/FLEXOGRAFIA/DIGITAL/SERIGRAFIA/SUBLIMACAO/
  // ESTAMPAGEM_QUENTE/PERSONALIZACAO/BORDADO/TEMPO_MAQUINA ativo sem a
  // máquina correspondente vinculada — o motor de preço lança
  // ErroPrecificacao pra qualquer um desses (ver PRENSA_NAO_CONFIGURADA/
  // MAQUINA_FLEXO_NAO_CONFIGURADA/IMPRESSORA_DIGITAL_NAO_CONFIGURADA/
  // MAQUINA_SETUP_POR_PECA_NAO_CONFIGURADA/MAQUINA_BORDADO_NAO_CONFIGURADA/
  // MAQUINA_TEMPO_NAO_CONFIGURADA em src/lib/pricing/carregar.ts), mas hoje
  // só aparece pro vendedor na hora de montar um orçamento. Igual à
  // checagem de bobina acima: pega antes, independente do segmento da
  // gráfica — vale pra qualquer perfil.
  const itensSemMaquina = await prisma.itemGrafica.findMany({
    where: {
      graficaId,
      ativo: true,
      OR: [
        { modeloCalculo: "OFFSET", prensaId: null },
        { modeloCalculo: "FLEXOGRAFIA", maquinaFlexografiaId: null },
        { modeloCalculo: "DIGITAL", impressoraDigitalId: null },
        {
          modeloCalculo: { in: ["SERIGRAFIA", "SUBLIMACAO", "ESTAMPAGEM_QUENTE", "PERSONALIZACAO"] },
          maquinaSetupPorPecaId: null,
        },
        { modeloCalculo: "BORDADO", maquinaBordadoId: null },
        { modeloCalculo: "TEMPO_MAQUINA", maquinaTempoId: null },
      ],
    },
    include: { itemCatalogo: true },
  });

  const pendenciasMaquina = itensSemMaquina.map((item) => ({
    tipo: "MAQUINA_NAO_VINCULADA" as const,
    itemGraficaId: item.id,
    nomeProduto: item.itemCatalogo.nome,
  }));

  // Achado A10 — só se aplica no Simples Nacional (calcularSituacaoAliquotaSimples
  // devolve null pra Presumido/Real ou fiscal ainda não cadastrado). Sem
  // motor tributário completo: só avisa quando a alíquota efetiva apurada
  // supera o que está configurado, nunca ajusta nada sozinho.
  const situacaoSimples = await calcularSituacaoAliquotaSimples(graficaId);
  const pendenciasImposto: PendenciaConfiguracao[] =
    situacaoSimples && situacaoSimples.aliquotaEfetiva > situacaoSimples.impostoConfigurado
      ? [
          {
            tipo: "ALIQUOTA_SIMPLES_ACIMA_DO_CONFIGURADO" as const,
            rbt12: situacaoSimples.rbt12,
            aliquotaEfetiva: situacaoSimples.aliquotaEfetiva,
            impostoConfigurado: situacaoSimples.impostoConfigurado,
            faixaIndice: situacaoSimples.faixaIndice,
          },
        ]
      : [];

  return [...pendenciasBobina, ...pendenciasPapel, ...pendenciasMaquina, ...pendenciasImposto];
}
