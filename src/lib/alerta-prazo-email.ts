import "server-only";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { dataInputParaUTC, hojeBrasiliaInputValue, formatoData } from "@/lib/data";
import { dispararEventoEmail } from "@/lib/email/webhook-email";
import {
  templatePedidoPrazoProximo,
  templatePedidoPrazoAtrasado,
  type ItemPedidoResumo,
} from "@/lib/email/templates";

const MS_POR_DIA = 86_400_000;

// Canal SEPARADO de src/lib/alerta-atraso.ts (webhook de automação da
// própria gráfica, roda sob demanda a cada carregamento de /producao, só
// dispara UMA vez, depois do prazo já vencido). Este aqui é o cron diário
// (src/app/api/cron/lifecycle/route.ts) e manda E-MAIL de sistema (via
// EMAIL_WEBHOOK_URL, mesmo padrão de enviarAvisosTrialExpirando em
// src/lib/lifecycle-cron.ts) pro vendedor do orçamento + DONO(s) da gráfica,
// em 3 momentos: 5 dias antes do prazo, 3 dias antes, e no dia em que o
// prazo vence/já venceu.
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
  // Janela de busca: nenhum pedido com prazo a mais de 5 dias tem
  // limiarAplicavel != null, então não vale escanear pedidos com prazo daqui
  // a meses — evita crescer o findMany junto com o volume de pedidos em
  // fila da plataforma inteira.
  const janelaMaxima = new Date(hoje.getTime() + 5 * MS_POR_DIA);

  const pedidos = await prisma.pedido.findMany({
    where: {
      status: { notIn: ["ENTREGUE", "CANCELADO"] },
      prazoEntrega: { not: null, lte: janelaMaxima },
      // 0 é terminal (ver comentário acima) — filtra no banco em vez de só
      // no loop, pra não reprocessar pra sempre todo pedido atrasado antigo.
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
      grafica: { select: { nome: true } },
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

  for (const pedido of pedidos) {
    const prazoEntrega = pedido.prazoEntrega!;
    // Ambos já são meia-noite UTC representando um dia de calendário — a
    // subtração dá dias inteiros exatos, sem arredondamento necessário.
    const diasParaPrazo = (prazoEntrega.getTime() - hoje.getTime()) / MS_POR_DIA;

    const limiarAplicavel = diasParaPrazo <= 0 ? 0 : diasParaPrazo <= 3 ? 3 : diasParaPrazo <= 5 ? 5 : null;
    if (limiarAplicavel === null) continue; // prazo longe demais ainda (defensivo — a query acima já filtra isso)

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

    if (!donosPorGrafica.has(pedido.graficaId)) {
      const donos = await prisma.usuario.findMany({
        where: { graficaId: pedido.graficaId, papel: "DONO" },
        select: { email: true },
      });
      donosPorGrafica.set(pedido.graficaId, donos);
    }

    // Vendedor (Orcamento.usuarioId → Usuario.email) + todo DONO da gráfica,
    // deduplicados por e-mail — o vendedor pode ele mesmo ser o DONO. Mesmo
    // padrão de notificarRespostaOrcamento (src/app/o/[token]/actions.ts).
    const destinatarios = new Set<string>();
    if (pedido.orcamento.usuario?.email) destinatarios.add(pedido.orcamento.usuario.email);
    for (const dono of donosPorGrafica.get(pedido.graficaId)!) destinatarios.add(dono.email);
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
            template: templatePedidoPrazoAtrasado(graficaNome, clienteNome, itens, -diasParaPrazo, prazoFormatado, linkProducao),
          }
        : {
            tipo: "pedido_prazo_proximo" as const,
            template: templatePedidoPrazoProximo(graficaNome, clienteNome, itens, limiarAplicavel, prazoFormatado, linkProducao),
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
