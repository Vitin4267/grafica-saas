"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { CampoAjuda } from "@/components/ui/CampoAjuda";
import { salvarParametros } from "./actions";
import type { ParametrosTenant } from "@/lib/pricing";
import type { BaseComissao } from "@/generated/prisma/enums";
import {
  UNIDADES_DIMENSAO,
  ROTULO_UNIDADE_DIMENSAO,
  type UnidadeDimensao,
} from "@/lib/unidade-dimensao";
import { TERMOS_CONDICOES_PDF_PADRAO } from "@/lib/pdf/termos-padrao";

// Convenção do bitmask de ParametrosGrafica.diasFuncionamento (ver comentário
// no schema): bit0=segunda...bit6=domingo.
const DIAS_SEMANA: { bit: number; rotulo: string }[] = [
  { bit: 0, rotulo: "Seg" },
  { bit: 1, rotulo: "Ter" },
  { bit: 2, rotulo: "Qua" },
  { bit: 3, rotulo: "Qui" },
  { bit: 4, rotulo: "Sex" },
  { bit: 5, rotulo: "Sáb" },
  { bit: 6, rotulo: "Dom" },
];

// Agrupa os ~19 cards de parâmetro num accordion por tema, pra não jogar tudo
// aberto na tela de uma vez (pedido do dono: "tem muita informação, dá pra
// filtrar?"). Mesmo padrão nativo de <details>/<summary> já usado em
// src/app/ajuda/page.tsx e CustosPedidoSecao.tsx — sem useState, sem JS
// extra. Cada card original continua exatamente igual por dentro, só ganhou
// um agrupador visual em volta.
function GrupoParametros({
  titulo,
  resumo,
  aberto,
  children,
}: {
  titulo: string;
  resumo: string;
  aberto?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      open={aberto}
      className="group rounded-2xl border border-slate-200 dark:border-slate-800"
    >
      <summary className="flex cursor-pointer list-none flex-col gap-0.5 rounded-2xl px-5 py-4 marker:content-none hover:bg-slate-50 dark:hover:bg-slate-800/50">
        <span className="text-base font-semibold text-slate-900 dark:text-white">{titulo}</span>
        <span className="text-sm font-normal text-slate-500">{resumo}</span>
      </summary>
      <div className="flex flex-col gap-6 border-t border-slate-100 p-5 dark:border-slate-800">
        {children}
      </div>
    </details>
  );
}

export function ParametrosForm({
  parametros,
  comissaoVendedorBase,
  custoTintaPorMl,
  diasValidadeOrcamentoPadrao,
  diasAlertaOrcamentoParado,
  unidadePadraoDimensao,
  alertaPrazoAtivo,
  alertaPrazoLimiar1Dias,
  alertaPrazoLimiar2Dias,
  alertaPrazoLimiar3Dias,
  termosCondicoesPdf,
  mostrarEspecificacoesTecnicas,
  custoAutomaticoConsumo,
  categoriaCustoConsumoPadraoId,
  categoriasCusto,
  perdaEhCustoDoPedido,
  comissaoEntraNoCustoPedido,
  bloqueiaAoUltrapassarLimiteCredito,
  margemFaixaBaixa,
  margemFaixaBoa,
  descontoMaxSemAprovacao,
  toleranciaTiragemPadraoPercent,
  toleranciaTiragemPercent,
  diasPrecoInsumoDesatualizado,
  prazoEmDiasUteis,
  diasFuncionamento,
}: {
  parametros: ParametrosTenant;
  comissaoVendedorBase: BaseComissao;
  custoTintaPorMl: number | null;
  diasValidadeOrcamentoPadrao: number;
  diasAlertaOrcamentoParado: number;
  unidadePadraoDimensao: UnidadeDimensao;
  alertaPrazoAtivo: boolean;
  alertaPrazoLimiar1Dias: number;
  alertaPrazoLimiar2Dias: number;
  alertaPrazoLimiar3Dias: number;
  termosCondicoesPdf: string | null;
  mostrarEspecificacoesTecnicas: boolean;
  custoAutomaticoConsumo: boolean;
  categoriaCustoConsumoPadraoId: string | null;
  categoriasCusto: { id: string; nome: string }[];
  perdaEhCustoDoPedido: boolean;
  comissaoEntraNoCustoPedido: boolean;
  bloqueiaAoUltrapassarLimiteCredito: boolean;
  margemFaixaBaixa: number;
  margemFaixaBoa: number;
  descontoMaxSemAprovacao: number;
  toleranciaTiragemPadraoPercent: number;
  toleranciaTiragemPercent: number;
  diasPrecoInsumoDesatualizado: number;
  prazoEmDiasUteis: boolean;
  diasFuncionamento: number;
}) {
  const [state, formAction, isPending] = useActionState(salvarParametros, null);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <GrupoParametros
        titulo="Precificação"
        resumo="Overhead, margem, imposto, comissão embutida, taxa financeira, faixas do medidor de margem, unidade de medida, nesting de bobina e custo de tinta."
        aberto
      >
        <Card className="flex flex-col gap-4 p-6">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Composição de preço
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label={
                <>
                  Overhead (%)
                  <CampoAjuda texto="Custos fixos da gráfica que não entram na conta de material e mão de obra de cada pedido — aluguel, luz, manutenção de máquina. Esse percentual é somado ao custo direto antes de calcular o preço final, pra esses gastos também serem cobertos pelas vendas." />
                </>
              }
              name="overheadPercent"
              type="number"
              step="0.0001"
              min="0"
              defaultValue={parametros.overheadPercent}
              hint="ex: 0.15 = 15% sobre o custo direto"
            />
            <Input
              label={
                <>
                  Margem padrão (%)
                  <CampoAjuda texto="Percentual de lucro embutido no preço quando o cliente não tem uma margem própria configurada no cadastro dele. É só o padrão geral da gráfica — clientes específicos podem usar uma margem diferente." />
                </>
              }
              name="margemPadrao"
              type="number"
              step="0.0001"
              min="0"
              defaultValue={parametros.margemPadrao}
            />
            <Input
              label={
                <>
                  Imposto (%)
                  <CampoAjuda texto="Fatia reservada dentro do preço de venda pra cobrir o imposto que sua gráfica paga sobre a venda. É uma estimativa embutida no cálculo do preço — não é lançado como despesa nem rastreado automaticamente." />
                </>
              }
              name="impostoPercent"
              type="number"
              step="0.0001"
              min="0"
              defaultValue={parametros.impostoPercent}
            />
            <Input
              label={
                <>
                  Comissão (%)
                  <CampoAjuda texto="Não é a comissão paga a cada vendedor (isso é configurado por pessoa em Usuários, com a base de cálculo definida mais abaixo) — é um percentual embutido no preço final pra garantir que sobre margem suficiente pra cobrir a comissão sem reduzir seu lucro." />
                </>
              }
              name="comissaoPercent"
              type="number"
              step="0.0001"
              min="0"
              defaultValue={parametros.comissaoPercent}
            />
            <Input
              label={
                <>
                  Taxa financeira (%)
                  <CampoAjuda texto="Custo de receber o pagamento — taxa de cartão, boleto ou parcelamento cobrada pela maquininha/banco. Some esse percentual no preço pra ele não sair do seu bolso quando o cliente paga parcelado ou no cartão." />
                </>
              }
              name="taxaFinanceiraPercent"
              type="number"
              step="0.0001"
              min="0"
              defaultValue={parametros.taxaFinanceiraPercent}
            />
            <Input
              label="Pedido mínimo (R$)"
              name="pedidoMinimo"
              type="number"
              step="0.01"
              min="0"
              defaultValue={parametros.pedidoMinimo}
            />
            <Input
              label="Incremento de arredondamento (R$)"
              name="incrementoArredondamento"
              type="number"
              step="0.01"
              min="0.01"
              defaultValue={parametros.incrementoArredondamento}
              hint="Preço final sempre arredonda para cima nesse múltiplo"
            />
          </div>
        </Card>

        <Card className="flex flex-col gap-4 p-6">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Medidor de margem
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Faixas usadas pelo medidor de margem (Meu Negócio e Produção ›
              Fechamento) pra colorir de vermelho, amarelo ou verde. Ajuste pro
              patamar de margem real do seu processo — comunicação visual
              trabalha com margens bem mais altas que offset comercial de
              tiragem longa, por exemplo.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Margem faixa baixa (%)"
              name="margemFaixaBaixa"
              type="number"
              step="0.1"
              min="0"
              max="100"
              defaultValue={margemFaixaBaixa}
              hint="Abaixo disso o medidor mostra vermelho"
            />
            <Input
              label="Margem faixa boa (%)"
              name="margemFaixaBoa"
              type="number"
              step="0.1"
              min="0"
              max="100"
              defaultValue={margemFaixaBoa}
              hint="Acima disso o medidor mostra verde"
            />
          </div>
        </Card>

        <Card className="flex flex-col gap-4 p-6">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Unidade de medida
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Em que unidade você prefere digitar largura e altura ao montar um
              orçamento. Vale só para a entrada e exibição das medidas — o
              sistema continua guardando tudo em centímetros por baixo dos
              panos, então trocar esta opção depois não altera orçamentos já
              salvos. Cada item de orçamento poderá futuramente usar uma
              unidade diferente desta, individualmente.
            </p>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Unidade padrão
            </span>
            <select
              name="unidadePadraoDimensao"
              defaultValue={unidadePadraoDimensao}
              className="w-full max-w-xs rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-slate-900 focus:border-teal-500 focus:ring-4 focus:ring-teal-500/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              {UNIDADES_DIMENSAO.map((unidade) => (
                <option key={unidade} value={unidade}>
                  {ROTULO_UNIDADE_DIMENSAO[unidade]}
                </option>
              ))}
            </select>
          </label>
        </Card>

        <Card className="flex flex-col gap-4 p-6">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Nesting de bobina
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label={
                <>
                  Margem de segurança padrão (%)
                  <CampoAjuda texto="Espaço extra que o sistema soma em volta de cada peça (largura e altura) antes de calcular quantas cabem na bobina — cobre a imprecisão de corte da máquina. Usado no cálculo automático de aproveitamento de M2 e Flexografia." />
                </>
              }
              name="margemSegurancaPadrao"
              type="number"
              step="0.0001"
              min="0"
              defaultValue={parametros.margemSegurancaPadrao}
            />
            <Input
              label={
                <>
                  Gap entre peças padrão (m)
                  <CampoAjuda texto="Distância mínima deixada entre uma peça e outra na bobina, pra sobrar espaço de corte entre elas. Também entra no cálculo de quantas peças cabem e quanto material é consumido." />
                </>
              }
              name="gapPecasPadrao"
              type="number"
              step="0.0001"
              min="0"
              defaultValue={parametros.gapPecasPadrao}
            />
          </div>
        </Card>

        <Card className="flex flex-col gap-4 p-6">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Cálculo de tinta com IA
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Custo do ml da sua tinta — usado só pra mostrar uma estimativa de
              valor ao lado do resultado da análise de tinta. Não afeta o preço
              de nenhum orçamento.
            </p>
          </div>
          <Input
            label="Custo do ml de tinta (R$)"
            name="custoTintaPorMl"
            type="number"
            step="0.0001"
            min="0"
            defaultValue={custoTintaPorMl ?? ""}
            placeholder="ex: 0.08"
            hint="Deixe em branco pra não mostrar estimativa de valor"
            className="max-w-xs"
          />
        </Card>
      </GrupoParametros>

      <GrupoParametros
        titulo="Aprovação, desconto e crédito"
        resumo="Teto de desconto sem aprovação de um DONO/ADMIN e bloqueio por limite de crédito do cliente."
      >
        <Card className="flex flex-col gap-4 p-6">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Alçada de desconto
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Teto de desconto que um vendedor comum pode dar num orçamento sem
              precisar de aprovação de um DONO/ADMIN.
            </p>
          </div>
          <Input
            label="Desconto máximo sem aprovação (%)"
            name="descontoMaxSemAprovacao"
            type="number"
            step="0.1"
            min="0"
            max="100"
            defaultValue={descontoMaxSemAprovacao}
            hint="100 = sem trava (qualquer desconto passa sem aprovação)"
            className="max-w-xs"
          />
        </Card>

        <Card className="flex flex-col gap-4 p-6">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Limite de crédito do cliente
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Cliente com limite de crédito cadastrado (Clientes {"›"} editar) que
              estoura o limite na aprovação de um orçamento — soma das contas a
              receber pendentes dele + este orçamento.
            </p>
          </div>
          <label className="flex items-center gap-2.5">
            <input
              type="checkbox"
              name="bloqueiaAoUltrapassarLimiteCredito"
              defaultChecked={bloqueiaAoUltrapassarLimiteCredito}
              className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
            />
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Bloquear aprovação ao ultrapassar limite de crédito
            </span>
          </label>
          <p className="text-xs text-slate-500">
            Desligado (padrão): só avisa quem está aprovando, a aprovação segue
            normalmente. Ligado: a aprovação é recusada — tanto no painel quanto
            no link público que o cliente usa pra aprovar. Não afeta o bloqueio
            manual de cliente (bloqueado para venda/faturamento), que continua
            só avisando sempre.
          </p>
        </Card>
      </GrupoParametros>

      <GrupoParametros
        titulo="Alertas e prazos"
        resumo="Prazo em dias úteis, alerta de prazo por e-mail, validade do orçamento, orçamentos parados, tolerância de tiragem e aviso de preço de insumo desatualizado."
      >
        <Card className="flex flex-col gap-4 p-6">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Prazo de entrega em dias úteis
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Como sua gráfica cota o prazo de entrega no PDF/link público do
              orçamento (&quot;N dias úteis&quot; ou &quot;N dias corridos&quot;
              após aprovação). Também usado pra sugerir o prazo de entrega na
              aprovação do orçamento e pro alerta de prazo por e-mail abaixo
              contar certo. Os feriados da sua cidade/estado entram em{" "}
              <Link href="/configuracoes/feriados" className="underline">
                Feriados
              </Link>
              .
            </p>
          </div>

          <label className="flex items-center gap-2.5">
            <input
              type="checkbox"
              name="prazoEmDiasUteis"
              defaultChecked={prazoEmDiasUteis}
              className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
            />
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Cotar prazo de entrega em dias úteis
            </span>
          </label>
          <p className="text-xs text-slate-500">
            Desligue se sua gráfica prefere prometer o prazo em dias corridos
            simples.
          </p>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Dias de funcionamento
            </span>
            <div className="flex flex-wrap gap-4">
              {DIAS_SEMANA.map((dia) => (
                <label
                  key={dia.bit}
                  className="flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-200"
                >
                  <input
                    type="checkbox"
                    name="diaFuncionamento"
                    value={dia.bit}
                    defaultChecked={(diasFuncionamento & (1 << dia.bit)) !== 0}
                    className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                  />
                  {dia.rotulo}
                </label>
              ))}
            </div>
          </div>
        </Card>

        <Card className="flex flex-col gap-4 p-6">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Alerta de prazo por e-mail
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Avisa o vendedor e o(s) DONO(s) da gráfica por e-mail conforme o
              prazo de entrega de um pedido se aproxima — em 3 momentos, do mais
              folgado pro dia do prazo/atrasado. Os valores abaixo são em dias
              antes do prazo (0 = no dia).
            </p>
          </div>

          <label className="flex items-center gap-2.5">
            <input
              type="checkbox"
              name="alertaPrazoAtivo"
              defaultChecked={alertaPrazoAtivo}
              className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
            />
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Enviar alerta de prazo por e-mail
            </span>
          </label>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Input
              label="1º aviso (dias antes)"
              name="alertaPrazoLimiar1Dias"
              type="number"
              step="1"
              min="0"
              defaultValue={alertaPrazoLimiar1Dias}
            />
            <Input
              label="2º aviso (dias antes)"
              name="alertaPrazoLimiar2Dias"
              type="number"
              step="1"
              min="0"
              defaultValue={alertaPrazoLimiar2Dias}
            />
            <Input
              label="3º aviso (dias antes)"
              name="alertaPrazoLimiar3Dias"
              type="number"
              step="1"
              min="0"
              defaultValue={alertaPrazoLimiar3Dias}
              hint="0 = no dia do prazo (ou já atrasado)"
            />
          </div>
          <p className="text-xs text-slate-500">
            Precisam estar em ordem decrescente (ex: 5, 3, 0) — o 1º aviso é o
            mais folgado, o 3º é o mais urgente.
          </p>
        </Card>

        <Card className="flex flex-col gap-4 p-6">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Validade do orçamento
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Quantos dias um orçamento fica válido depois de enviado — depois
              disso o cliente não consegue mais aprovar pelo link, precisa
              pedir um novo ou você renovar a validade.
            </p>
          </div>
          <Input
            label="Dias de validade do orçamento"
            name="diasValidadeOrcamentoPadrao"
            type="number"
            step="1"
            min="1"
            defaultValue={diasValidadeOrcamentoPadrao}
            className="max-w-xs"
          />
        </Card>

        <Card className="flex flex-col gap-4 p-6">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Tolerância de tiragem
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Variação de quantidade entregue tolerada sem reclamação — ex: 10%
              significa que entregar 1.080 numa tiragem de 1.000 não é motivo de
              disputa. Padrão do mercado offset (quebra de máquina, acerto de
              cor). Entra no PDF do orçamento como cláusula de respaldo
              contratual.
            </p>
          </div>
          <Input
            label="Tolerância de tiragem padrão (%)"
            name="toleranciaTiragemPadraoPercent"
            type="number"
            step="0.1"
            min="0"
            max="100"
            defaultValue={toleranciaTiragemPadraoPercent}
            hint="±% sobre a quantidade contratada (snapshot em Orcamento.toleranciaTiragemPercent)"
            className="max-w-xs"
          />
          <Input
            label="Tolerância de tiragem (%)"
            name="toleranciaTiragemPercent"
            type="number"
            step="0.1"
            min="0"
            max="100"
            defaultValue={toleranciaTiragemPercent}
            hint="Exibida em documentos e Ordem de Produção (0 = sem tolerância)"
            className="max-w-xs"
          />
        </Card>

        <Card className="flex flex-col gap-4 p-6">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Orçamentos parados
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Depois de quantos dias sem resposta um orçamento &quot;Enviado&quot;
              entra na lista de{" "}
              <Link href="/orcamento/parados" className="underline">
                orçamentos parados
              </Link>
              , pra você cobrar o cliente antes que a proposta expire.
            </p>
          </div>
          <Input
            label="Dias sem resposta até virar &quot;parado&quot;"
            name="diasAlertaOrcamentoParado"
            type="number"
            step="1"
            min="1"
            defaultValue={diasAlertaOrcamentoParado}
            className="max-w-xs"
          />
        </Card>

        <Card className="flex flex-col gap-4 p-6">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Preço de insumo desatualizado
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Avisa no Catálogo quando o preço de compra de uma matéria-prima
              não muda há muito tempo — sinal de que pode estar defasado em
              relação ao mercado.
            </p>
          </div>
          <Input
            label="Avisar depois de quantos dias sem mudar"
            name="diasPrecoInsumoDesatualizado"
            type="number"
            step="1"
            min="1"
            defaultValue={diasPrecoInsumoDesatualizado}
            className="max-w-xs"
          />
        </Card>
      </GrupoParametros>

      <GrupoParametros
        titulo="Estoque, custo automático e comissão"
        resumo="Como o custo real do pedido é lançado a partir da baixa de estoque e como a comissão do vendedor é calculada."
      >
        <Card className="flex flex-col gap-4 p-6">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Custo automático e lucro por pedido
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Como o custo real de cada pedido (Produção {"›"} Fechamento) é
              calculado a partir do consumo de estoque.
            </p>
          </div>

          <label className="flex items-center gap-2.5">
            <input
              type="checkbox"
              name="custoAutomaticoConsumo"
              defaultChecked={custoAutomaticoConsumo}
              className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
            />
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Lançar custo automaticamente ao baixar estoque na produção
            </span>
          </label>
          <p className="text-xs text-slate-500">
            Desligue se sua gráfica compra material específico por pedido (ex:
            comunicação visual ou corte a laser comprando a chapa pro job) — o
            custo real entra manualmente, via nota do fornecedor, em vez de
            duplicar com a baixa automática.
          </p>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Categoria de custo padrão
            </span>
            <select
              name="categoriaCustoConsumoPadraoId"
              defaultValue={categoriaCustoConsumoPadraoId ?? ""}
              className="w-full max-w-xs rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-slate-900 focus:border-teal-500 focus:ring-4 focus:ring-teal-500/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="">Nenhuma (usa a primeira categoria ativa por ordem)</option>
              {categoriasCusto.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
            <span className="text-xs text-slate-500">
              Usada quando a matéria-prima consumida não tem categoria de custo
              própria configurada no Catálogo.
            </span>
          </label>

          <label className="flex items-center gap-2.5">
            <input
              type="checkbox"
              name="perdaEhCustoDoPedido"
              defaultChecked={perdaEhCustoDoPedido}
              className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
            />
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Perda de calibragem conta como custo do pedido
            </span>
          </label>
          <p className="text-xs text-slate-500">
            Desligue pra tratar a perda de calibragem (folhas de acerto de
            máquina) como despesa geral da operação, não deste pedido
            específico — a baixa de estoque continua acontecendo do mesmo
            jeito, só o lançamento de custo no pedido fica de fora.
          </p>

          <label className="flex items-center gap-2.5">
            <input
              type="checkbox"
              name="comissaoEntraNoCustoPedido"
              defaultChecked={comissaoEntraNoCustoPedido}
              className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
            />
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Comissão do vendedor entra no custo do pedido
            </span>
          </label>
          <p className="text-xs text-slate-500">
            Afeta o lucro calculado em Produção {"›"} Fechamento e nos
            relatórios de Meu Negócio — a comissão continua sendo paga ao
            vendedor do mesmo jeito, independente desta opção.
          </p>
        </Card>

        <Card className="flex flex-col gap-4 p-6">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Comissão por vendedor
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Como calcular a comissão de quem vende, quando um orçamento é
              aprovado. Defina a taxa de cada pessoa em Usuários.
            </p>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Base de cálculo
            </span>
            <select
              name="comissaoVendedorBase"
              defaultValue={comissaoVendedorBase}
              className="w-full max-w-xs rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-slate-900 focus:border-teal-500 focus:ring-4 focus:ring-teal-500/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="VALOR">% sobre o valor do orçamento</option>
              <option value="LUCRO">% sobre o lucro (valor − custo estimado)</option>
            </select>
          </label>
        </Card>
      </GrupoParametros>

      <GrupoParametros
        titulo="Documento do orçamento"
        resumo="O que aparece pro cliente no PDF e no link público do orçamento."
      >
        <Card className="flex flex-col gap-4 p-6">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Especificações técnicas no orçamento do cliente
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Quando um item tem detalhe técnico de etiqueta (material,
              adesivo, verniz, laminação, hot/cold stamping...), esse bloco
              aparece no link público e no PDF pro cliente confirmar
              exatamente o que vai ser produzido. Desative se sua gráfica
              prefere não expor essa informação — a tela interna e a ordem de
              produção continuam mostrando tudo, sempre, independente disso.
            </p>
          </div>
          <label className="flex items-center gap-2.5">
            <input
              type="checkbox"
              name="mostrarEspecificacoesTecnicas"
              defaultChecked={mostrarEspecificacoesTecnicas}
              className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
            />
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Mostrar especificações técnicas pro cliente
            </span>
          </label>
        </Card>

        <Card className="flex flex-col gap-4 p-6">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Termos e condições do PDF
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Texto impresso no rodapé do PDF de orçamento (o mesmo baixado por
              você e visto pelo cliente no link público). Já vem preenchido com
              um texto padrão cobrindo validade da proposta, política de
              reimpressão por erro de arte e condições de pagamento — edite à
              vontade ou apague tudo pra voltar a usar o padrão do sistema.
            </p>
          </div>
          <Textarea
            label="Texto exibido no rodapé"
            name="termosCondicoesPdf"
            rows={6}
            defaultValue={termosCondicoesPdf ?? TERMOS_CONDICOES_PDF_PADRAO}
            hint="Deixe em branco pra usar o texto padrão do sistema"
          />
        </Card>
      </GrupoParametros>

      <GrupoParametros
        titulo="Cadastros auxiliares"
        resumo="Filiais, máquinas, categorias de custo, feriados, fornecedores e ferramentais."
      >
        <Card className="flex items-center justify-between gap-4 p-6">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Filiais
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Se sua gráfica tem mais de uma unidade, cadastre aqui pra marcar
              em qual filial cada orçamento foi feito. Catálogo e estoque
              continuam únicos pra gráfica toda.
            </p>
          </div>
          <Link href="/configuracoes/filiais">
            <Button type="button" variant="outline">
              Gerenciar filiais
            </Button>
          </Link>
        </Card>

        <Card className="flex items-center justify-between gap-4 p-6">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Máquinas
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Custo de máquina, torres, chapas e rodagem agora são configurados por
              máquina (offset ou flexografia) — uma gráfica pode ter mais de uma.
            </p>
          </div>
          <Link href="/configuracoes/maquinas">
            <Button type="button" variant="outline">
              Gerenciar máquinas
            </Button>
          </Link>
        </Card>

        <Card className="flex items-center justify-between gap-4 p-6">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Categorias de custo
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              As categorias (papel, laminação, mão de obra...) usadas pra
              lançar o custo real de cada pedido em Produção e calcular o
              lucro por pedido.
            </p>
          </div>
          <Link href="/configuracoes/categorias-custo">
            <Button type="button" variant="outline">
              Gerenciar categorias
            </Button>
          </Link>
        </Card>

        <Card className="flex items-center justify-between gap-4 p-6">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Feriados
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              O calendário de feriados da sua gráfica — usado pra calcular o
              prazo de entrega em dias úteis e pro alerta de prazo por e-mail.
            </p>
          </div>
          <Link href="/configuracoes/feriados">
            <Button type="button" variant="outline">
              Gerenciar feriados
            </Button>
          </Link>
        </Card>

        <Card className="flex items-center justify-between gap-4 p-6">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Fornecedores
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Quem vendeu cada material — aparece como opção ao registrar uma
              entrada de compra no Catálogo.
            </p>
          </div>
          <Link href="/configuracoes/fornecedores">
            <Button type="button" variant="outline">
              Gerenciar fornecedores
            </Button>
          </Link>
        </Card>

        <Card className="flex items-center justify-between gap-4 p-6">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Ferramentais
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Faca de corte e vinco, clichê, tela de serigrafia, matriz de
              bordado — a ferramenta física reutilizável, não só o custo dela.
            </p>
          </div>
          <Link href="/configuracoes/ferramentais">
            <Button type="button" variant="outline">
              Gerenciar ferramentais
            </Button>
          </Link>
        </Card>
      </GrupoParametros>

      <GrupoParametros
        titulo="Fiscal, identidade e assinatura"
        resumo="Dados fiscais, logo da gráfica, status da assinatura e webhook de automação (n8n)."
      >
        <Card className="flex items-center justify-between gap-4 p-6">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Dados fiscais
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              CNPJ, endereço e token da sua conta na Focus NFe — usados pra
              emitir nota fiscal pros seus clientes.
            </p>
          </div>
          <Link href="/configuracoes/fiscal">
            <Button type="button" variant="outline">
              Configurar dados fiscais
            </Button>
          </Link>
        </Card>

        <Card className="flex items-center justify-between gap-4 p-6">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Identidade visual
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Sua logo, exibida no PDF de orçamento enviado pros seus clientes.
            </p>
          </div>
          <Link href="/configuracoes/identidade">
            <Button type="button" variant="outline">
              Configurar logo
            </Button>
          </Link>
        </Card>

        <Card className="flex items-center justify-between gap-4 p-6">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Assinatura
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Status da cobrança do GrafPro — trial, plano ativo, fatura.
            </p>
          </div>
          <Link href="/configuracoes/assinatura">
            <Button type="button" variant="outline">
              Ver assinatura
            </Button>
          </Link>
        </Card>

        <Card className="flex items-center justify-between gap-4 p-6">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Automação (n8n)
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Receba eventos da sua gráfica (pedido atrasado, estoque crítico,
              status de pedido) no seu próprio webhook n8n.
            </p>
          </div>
          <Link href="/configuracoes/automacao">
            <Button type="button" variant="outline">
              Configurar automação
            </Button>
          </Link>
        </Card>
      </GrupoParametros>

      <GrupoParametros
        titulo="Importar dados de planilha"
        resumo="Suba planilhas de clientes, catálogo ou pedidos históricos pra importar de uma vez."
      >
        <Card className="flex items-center justify-between gap-4 p-6">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Importar clientes de planilha
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Suba uma planilha (.xlsx ou .csv) da sua base de clientes — a IA
              sugere o mapeamento de coluna, você confirma antes de importar.
            </p>
          </div>
          <Link href="/importar/clientes">
            <Button type="button" variant="outline">
              Importar clientes
            </Button>
          </Link>
        </Card>

        <Card className="flex items-center justify-between gap-4 p-6">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Importar catálogo de planilha
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Suba uma planilha de produtos, serviços ou matéria-prima —
              entram como itens de modelo Simples, prontos pra ajustar preço.
            </p>
          </div>
          <Link href="/importar/catalogo">
            <Button type="button" variant="outline">
              Importar catálogo
            </Button>
          </Link>
        </Card>

        <Card className="flex items-center justify-between gap-4 p-6">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Importar pedidos históricos de planilha
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Traga pra dentro pedidos que já foram vendidos, pra manter o
              histórico de faturamento nos relatórios de Meu Negócio.
            </p>
          </div>
          <Link href="/importar/pedidos">
            <Button type="button" variant="outline">
              Importar pedidos
            </Button>
          </Link>
        </Card>
      </GrupoParametros>

      {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}

      <Button type="submit" loading={isPending} className="self-start">
        {isPending ? "Salvando..." : "Salvar parâmetros"}
      </Button>
    </form>
  );
}
