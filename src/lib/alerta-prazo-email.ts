import "server-only";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { dataInputParaUTC, hojeBrasiliaInputValue, formatoData } from "@/lib/data";
import { contarDiasUteis, type CalendarioTrabalho } from "@/lib/dias-uteis";
import { dispararEventoEmail } from "@/lib/email/webhook-email";
import {
  templatePedidoPrazoProximo,
  templatePedidoPrazoAtrasado,
  type ItemPedidoResumo,
} from "@/lib/email/templates";

const MS_POR_DIA = 86_400_000;

// Defaults espelhando ParametrosGrafica no schema (alertaPrazoLimiar1Dias=5,
// 2=3, 3=0, alertaPrazoAtivo=true) — usados quando a gráfica nunca configurou
// nada em /configuracoes (linha ausente em ParametrosGrafica), mesmo padrão
// de margemFaixaBaixa/margemFaixaBoa em src/app/meu-negocio/relatorios/page.tsx.
const LIMIAR_1_PADRAO = 5;
const LIMIAR_2_PADRAO = 3;
const LIMIAR_3_PADRAO = 0;

// Generaliza a cascata que antes era um ternário fixo (`diasParaPrazo <= 0 ?
// 0 : diasParaPrazo <= 3 ? 3 : diasParaPrazo <= 5 ? 5 : null`) pra qualquer
// trio de limiares configurado pela gráfica (ordenados do maior pro menor,
// ex: [5, 3, 0] ou [7, 4, 1]) — devolve o MENOR limiar que ainda "cobre"
// diasParaPrazo (ou seja, o mais urgente aplicável agora), ou null se o prazo
// está longe demais até do limiar mais folgado. A validação em
// src/app/configuracoes/actions.ts garante limiar1 > limiar2 > limiar3 antes
// de chegar aqui, então não precisa reordenar defensivamente — mas ordena
// mesmo assim (custo desprezível) pra este helper nunca depender dessa
// garantia externa pra se comportar certo.
export function calcularLimiarAplicavel(diasParaPrazo: number, limiares: number[]): number | null {
  const limiaresAsc = [...limiares].sort((a, b) => a - b);
  for (const limiar of limiaresAsc) {
    if (diasParaPrazo <= limiar) return limiar;
  }
  return null;
}

// Canal SEPARADO de src/lib/alerta-atraso.ts (webhook de automação da
// própria gráfica, roda sob demanda a cada carregamento de /producao, só
// dispara UMA vez, depois do prazo já vencido). Este aqui é o cron diário
// (src/app/api/cron/lifecycle/route.ts) e manda E-MAIL de sistema (via
// EMAIL_WEBHOOK_URL, mesmo padrão de enviarAvisosTrialExpirando em
// src/lib/lifecycle-cron.ts) pro vendedor do orçamento + os destinatários
// administrativos, em 3 momentos: 5 dias antes do prazo, 3 dias antes, e no
// dia em que o prazo vence/já venceu.
//
// DESTINATÁRIOS (achado A9 da auditoria de abrangência, 2026-08-24): antes
// disto, o alerta ia sempre pro vendedor + TODOS os DONOs da gráfica,
// hardcoded — sem jeito de rotear pra um PCP dedicado sem promovê-lo a DONO.
// Agora usa o mesmo mecanismo de ResponsavelAdministrativo já usado por
// prepararNotificacaoNotaFiscal (src/lib/nota-fiscal.ts), com a área
// PRAZO_PRODUCAO: se a gráfica tem pelo menos 1 responsável configurado em
// /usuarios pra essa área, os destinatários são vendedor + esses
// responsáveis (SEM os DONOs, a menos que um DONO também esteja marcado como
// responsável). Se a gráfica nunca configurou nenhum responsável de
// PRAZO_PRODUCAO, cai no fallback de sempre (vendedor + todos os DONOs) —
// zero regressão pra quem nunca mexeu em /usuarios.
//
// A CASCATA (Pedido.alertaPrazoUltimoLimiarDias, ver comentário no schema):
// cada pedido guarda só o limiar MAIS URGENTE já avisado (5, 3 ou 0 — null
// = nenhum ainda). A cada run, calculamos o limiar que DEVERIA estar valendo
// agora pra este pedido (limiarAplicavel) e comparamos com o que já foi
// avisado:
//   - limiarAplicavel === null → prazo ainda longe (mais de 5 dias), nada a
//     fazer.
//   - ultimoLimiarJaEnviado !== null && ultimoLimiarJaEnviado <= limiarAplicavel
//     → ESTE limiar (ou um mais urgente) já foi avisado, pula. Cobre tanto
//     "rodou duas vezes no mesmo dia" (5<=5) quanto "já passou desse ponto"
//     (0<=3 seria falso, mas 3<=0 nunca acontece porque a ordem numérica dos
//     limiares É a ordem de urgência: 0 é sempre o mais urgente).
//   - senão → dispara o limiar aplicável.
// O pulo de limiar acontece sozinho por causa da comparação: se o cron
// perder um dia inteiro (ex: pedido tinha 6 dias restantes na última vez que
// rodou e amanheceu com 2), ultimoLimiarJaEnviado continua null,
// limiarAplicavel calcula direto 3 (não 5) — nunca manda um "faltam 5 dias"
// que já não é verdade. No dia seguinte, se o pedido ficar atrasado
// (diasParaPrazo=-1), ultimoLimiarJaEnviado=3 e limiarAplicavel=0; como
// 3<=0 é falso, o limiar 0 dispara normalmente. E uma vez ultimoLimiarJaEnviado
// chega a 0, o filtro da query abaixo já exclui o pedido de toda run futura
// — 0 é terminal, nunca reenvia mesmo que o atraso aumente.
export async function enviarAlertasPrazoEmail(
  origemPublica: string
): Promise<{ processados: number }> {
  // "Hoje" no calendário de BRASÍLIA, não UTC (ver comentário grande em
  // src/lib/data.ts sobre INSTANTE REAL vs DATA-PURA) — nas ~3h finais de
  // cada dia em Brasília, `new Date()` já teria virado o dia em UTC e
  // calcularia diasParaPrazo um dia adiantado, mandando (ou deixando de
  // mandar) o alerta um dia cedo demais.
  const hoje = dataInputParaUTC(hojeBrasiliaInputValue());
  // Janela de busca: precisa cobrir o MAIOR limiar1 configurado por qualquer
  // gráfica com o alerta ligado (o padrão é 5 dias, mas uma gráfica pode
  // configurar mais em /configuracoes) — sem isso, um pedido de uma gráfica
  // com limiar1=10 nunca chegaria nem a ser buscado. Continua evitando
  // escanear pedidos com prazo daqui a meses, só que com o corte dinâmico em
  // vez de fixo em 5.
  const limiar1MaisAlto = await prisma.parametrosGrafica.aggregate({
    where: { alertaPrazoAtivo: true },
    _max: { alertaPrazoLimiar1Dias: true },
  });
  const janelaDias = Math.max(LIMIAR_1_PADRAO, limiar1MaisAlto._max.alertaPrazoLimiar1Dias ?? LIMIAR_1_PADRAO);
  const janelaMaxima = new Date(hoje.getTime() + janelaDias * MS_POR_DIA);

  const pedidos = await prisma.pedido.findMany({
    where: {
      status: { notIn: ["ENTREGUE", "CANCELADO"] },
      prazoEntrega: { not: null, lte: janelaMaxima },
      // 0 é terminal pro trio de limiares PADRÃO (filtra no banco em vez de
      // só no loop, pra não reprocessar pra sempre todo pedido atrasado
      // antigo). Uma gráfica que configurar um limiar3 diferente de 0 perde
      // só essa otimização de banco pros próprios pedidos (o findMany
      // continua trazendo de volta um pedido cujo terminal real já foi
      // avisado) — a dedup de verdade é o `ultimoLimiarJaEnviado <=
      // limiarAplicavel` dentro do loop abaixo, que funciona com qualquer
      // limiar3, então nenhum e-mail duplicado chega a sair; só um pouco
      // mais de linhas trafegando da query.
      //
      // OR explícito com `null` em vez de só `{ not: 0 }`: um filtro
      // `{ not: 0 }` sozinho, num campo NULLABLE, compila pra SQL `<> 0` —
      // e em lógica de três valores do Postgres, `NULL <> 0` dá UNKNOWN (não
      // TRUE), então a linha é excluída. Isso excluiria EXATAMENTE o caso
      // mais comum (pedido que nunca recebeu nenhum alerta ainda,
      // alertaPrazoUltimoLimiarDias=null) — achado ao rodar os testes de
      // integração deste arquivo, que pegaram o bug na hora.
      OR: [{ alertaPrazoUltimoLimiarDias: null }, { alertaPrazoUltimoLimiarDias: { not: 0 } }],
    },
    include: {
      grafica: { select: { nome: true, corPrimaria: true } },
      orcamento: {
        select: {
          cliente: { select: { nome: true } },
          usuario: { select: { email: true } },
          itens: { select: { quantidade: true, itemGrafica: { select: { itemCatalogo: { select: { nome: true } } } } } },
        },
      },
    },
  });

  let processados = 0;
  const linkProducao = `${origemPublica}/producao`;
  // Cache por gráfica dentro desta run — evita repetir a mesma query de
  // DONOs pra cada pedido atrasado da mesma gráfica.
  const donosPorGrafica = new Map<string, { email: string }[]>();
  // Cache irmão de donosPorGrafica — responsáveis administrativos pela área
  // PRAZO_PRODUCAO (ver comentário grande acima). Lista vazia (não ausência
  // de entrada no Map) é o sinal de "gráfica sem responsável configurado,
  // usa o fallback de DONOs" — igual a donosPorGrafica não precisar de
  // distinção "ausente vs vazio" porque toda gráfica sempre tem ao menos 1
  // DONO, mas aqui a lista pode legitimamente vir vazia.
  const responsaveisPrazoPorGrafica = new Map<string, { email: string }[]>();
  // Cache dos parâmetros de alerta (ativo + os 3 limiares) por gráfica dentro
  // desta run — mesmo raciocínio de donosPorGrafica. Ausência de linha em
  // ParametrosGrafica (gráfica que nunca configurou nada em /configuracoes)
  // usa os defaults do schema, mesmo padrão de margemFaixaBaixa/margemFaixaBoa
  // em src/app/meu-negocio/relatorios/page.tsx.
  const parametrosAlertaPorGrafica = new Map<
    string,
    { ativo: boolean; limiares: number[]; prazoEmDiasUteis: boolean; diasFuncionamento: number }
  >();
  // Cache do calendário de dias úteis (feriados cadastrados em
  // FeriadoGrafica) por gráfica dentro desta run — só populado sob demanda,
  // pra gráfica que efetivamente cota em dias úteis (achado A2 da Parte 6,
  // 2026-08-27): a maioria dos pedidos processados numa run não precisa
  // dessa query extra.
  const calendarioPorGrafica = new Map<string, CalendarioTrabalho>();

  for (const pedido of pedidos) {
    if (!parametrosAlertaPorGrafica.has(pedido.graficaId)) {
      const parametros = await prisma.parametrosGrafica.findUnique({
        where: { graficaId: pedido.graficaId },
        select: {
          alertaPrazoAtivo: true,
          alertaPrazoLimiar1Dias: true,
          alertaPrazoLimiar2Dias: true,
          alertaPrazoLimiar3Dias: true,
          prazoEmDiasUteis: true,
          diasFuncionamento: true,
        },
      });
      parametrosAlertaPorGrafica.set(pedido.graficaId, {
        ativo: parametros?.alertaPrazoAtivo ?? true,
        limiares: [
          parametros?.alertaPrazoLimiar1Dias ?? LIMIAR_1_PADRAO,
          parametros?.alertaPrazoLimiar2Dias ?? LIMIAR_2_PADRAO,
          parametros?.alertaPrazoLimiar3Dias ?? LIMIAR_3_PADRAO,
        ],
        // Defaults espelhando ParametrosGrafica no schema (mesmo raciocínio
        // do comentário grande no topo do arquivo) — achado A2 da Parte 6.
        prazoEmDiasUteis: parametros?.prazoEmDiasUteis ?? true,
        diasFuncionamento: parametros?.diasFuncionamento ?? 31,
      });
    }
    // Gate logo no início do processamento desta gráfica: se ela desligou o
    // alerta de prazo (alertaPrazoAtivo=false), pula o pedido sem gerar
    // nenhum e-mail — nem marca alertaPrazoUltimoLimiarDias, então se a
    // gráfica reativar depois o pedido volta a ser avaliado normalmente.
    const { ativo, limiares, prazoEmDiasUteis, diasFuncionamento } = parametrosAlertaPorGrafica.get(
      pedido.graficaId
    )!;
    if (!ativo) continue;

    const prazoEntrega = pedido.prazoEntrega!;
    // Ambos já são meia-noite UTC representando um dia de calendário — a
    // subtração dá dias inteiros exatos, sem arredondamento necessário.
    const diasParaPrazoCalendario = (prazoEntrega.getTime() - hoje.getTime()) / MS_POR_DIA;
    // Achado A2 da Parte 6 (auditoria de abrangência, 2026-08-27): o PDF/link
    // público prometem "N dias ÚTEIS" — o alerta de prazo precisa contar do
    // mesmo jeito quando a gráfica cota assim, senão o limiar "faltam 5 dias"
    // pode disparar cedo/tarde demais em relação ao que o cliente leu. Só
    // entra em ação enquanto o prazo ainda não chegou (diasParaPrazoCalendario
    // > 0) — pedido no dia do prazo ou atrasado continua em dias corridos
    // simples (ver `-diasParaPrazo` no template de "venceu há N dias" abaixo,
    // onde "dias úteis de atraso" não faz sentido de exibir).
    let diasParaPrazo = diasParaPrazoCalendario;
    if (prazoEmDiasUteis && diasParaPrazoCalendario > 0) {
      if (!calendarioPorGrafica.has(pedido.graficaId)) {
        const feriados = await prisma.feriadoGrafica.findMany({
          where: { graficaId: pedido.graficaId },
          select: { data: true, recorrenteAnual: true },
        });
        calendarioPorGrafica.set(pedido.graficaId, { diasFuncionamento, feriados });
      }
      diasParaPrazo = contarDiasUteis(hoje, prazoEntrega, calendarioPorGrafica.get(pedido.graficaId)!);
    }

    const limiarAplicavel = calcularLimiarAplicavel(diasParaPrazo, limiares);
    if (limiarAplicavel === null) continue; // prazo longe demais ainda pros limiares desta gráfica

    const ultimoLimiarJaEnviado = pedido.alertaPrazoUltimoLimiarDias;
    if (ultimoLimiarJaEnviado !== null && ultimoLimiarJaEnviado <= limiarAplicavel) continue; // já avisou este limiar (ou um mais urgente)

    // Marca a idempotência ANTES de disparar o e-mail: dispararEventoEmail
    // nunca lança (melhor esforço, ver webhook-email.ts), então não existe
    // "tentar de novo depois de falha real" — sem marcar antes, um pedido
    // sem nenhum destinatário resolvido (não deveria acontecer, ver abaixo)
    // ou com EMAIL_WEBHOOK_URL fora do ar seria reprocessado pra sempre.
    // Mesmo padrão de enviarAvisosTrialExpirando (src/lib/lifecycle-cron.ts).
    await prisma.pedido.update({
      where: { id: pedido.id },
      data: { alertaPrazoUltimoLimiarDias: limiarAplicavel },
    });
    processados += 1;

    if (!responsaveisPrazoPorGrafica.has(pedido.graficaId)) {
      const responsaveis = await prisma.responsavelAdministrativo.findMany({
        where: { area: "PRAZO_PRODUCAO", usuario: { graficaId: pedido.graficaId, desativadoEm: null } },
        select: { usuario: { select: { email: true } } },
      });
      responsaveisPrazoPorGrafica.set(
        pedido.graficaId,
        responsaveis.map((r) => ({ email: r.usuario.email }))
      );
    }
    const responsaveisPrazo = responsaveisPrazoPorGrafica.get(pedido.graficaId)!;

    // Fallback de zero regressão: só busca (e usa) os DONOs quando a gráfica
    // não configurou nenhum responsável de PRAZO_PRODUCAO em /usuarios — pra
    // não gastar a query de DONOs à toa numa gráfica que já migrou pro
    // roteamento novo.
    if (responsaveisPrazo.length === 0 && !donosPorGrafica.has(pedido.graficaId)) {
      const donos = await prisma.usuario.findMany({
        where: { graficaId: pedido.graficaId, papel: "DONO" },
        select: { email: true },
      });
      donosPorGrafica.set(pedido.graficaId, donos);
    }

    // Vendedor (Orcamento.usuarioId → Usuario.email) + responsáveis de
    // PRAZO_PRODUCAO (ou, na ausência deles, todo DONO da gráfica — ver
    // comentário grande no topo do arquivo), deduplicados por e-mail — o
    // vendedor pode ele mesmo ser um dos dois. Mesmo padrão de
    // notificarRespostaOrcamento (src/app/o/[token]/actions.ts).
    const destinatarios = new Set<string>();
    if (pedido.orcamento.usuario?.email) destinatarios.add(pedido.orcamento.usuario.email);
    if (responsaveisPrazo.length > 0) {
      for (const responsavel of responsaveisPrazo) destinatarios.add(responsavel.email);
    } else {
      for (const dono of donosPorGrafica.get(pedido.graficaId)!) destinatarios.add(dono.email);
    }
    if (destinatarios.size === 0) continue; // defensivo — não deveria acontecer (toda gráfica tem ao menos 1 DONO)

    const clienteNome = pedido.orcamento.cliente.nome;
    const itens: ItemPedidoResumo[] = pedido.orcamento.itens.map((i) => ({
      nome: i.itemGrafica.itemCatalogo.nome,
      quantidade: i.quantidade,
    }));
    const graficaNome = pedido.grafica.nome;
    const prazoFormatado = formatoData.format(prazoEntrega);

    const { tipo, template } =
      limiarAplicavel === 0
        ? {
            tipo: "pedido_prazo_atrasado" as const,
            // diasParaPrazo <= 0 aqui — negar dá o número de dias JÁ
            // vencido (0 = vence hoje), mesmo cálculo de alerta-atraso.ts,
            // só que a partir do `hoje`/`diasParaPrazo` corretos de
            // Brasília, não o hojeUTC (com o bug de fuso) do arquivo antigo.
            template: templatePedidoPrazoAtrasado(
              graficaNome,
              clienteNome,
              itens,
              -diasParaPrazo,
              prazoFormatado,
              linkProducao,
              pedido.grafica.corPrimaria
            ),
          }
        : {
            tipo: "pedido_prazo_proximo" as const,
            template: templatePedidoPrazoProximo(
              graficaNome,
              clienteNome,
              itens,
              limiarAplicavel,
              prazoFormatado,
              linkProducao,
              pedido.grafica.corPrimaria
            ),
          };

    for (const destinatario of destinatarios) {
      // after() em vez de await: mesma justificativa de
      // enviarAvisosTrialExpirando — dispararEventoEmail é melhor esforço
      // (nunca lança) e o resultado nunca é usado depois, não precisa
      // bloquear o loop/a resposta do cron.
      after(() => dispararEventoEmail({ tipo, destinatario, ...template }));
    }
  }

  return { processados };
}
