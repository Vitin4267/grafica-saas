"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { salvarParametros } from "./actions";
import type { ParametrosTenant } from "@/lib/pricing";
import type { BaseComissao } from "@/generated/prisma/enums";
import {
  UNIDADES_DIMENSAO,
  ROTULO_UNIDADE_DIMENSAO,
  type UnidadeDimensao,
} from "@/lib/unidade-dimensao";

export function ParametrosForm({
  parametros,
  comissaoVendedorBase,
  custoTintaPorMl,
  unidadePadraoDimensao,
}: {
  parametros: ParametrosTenant;
  comissaoVendedorBase: BaseComissao;
  custoTintaPorMl: number | null;
  unidadePadraoDimensao: UnidadeDimensao;
}) {
  const [state, formAction, isPending] = useActionState(salvarParametros, null);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <Card className="flex flex-col gap-4 p-6">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">
          Composição de preço
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Overhead (%)"
            name="overheadPercent"
            type="number"
            step="0.0001"
            min="0"
            defaultValue={parametros.overheadPercent}
            hint="ex: 0.15 = 15% sobre o custo direto"
          />
          <Input
            label="Margem padrão (%)"
            name="margemPadrao"
            type="number"
            step="0.0001"
            min="0"
            defaultValue={parametros.margemPadrao}
          />
          <Input
            label="Imposto (%)"
            name="impostoPercent"
            type="number"
            step="0.0001"
            min="0"
            defaultValue={parametros.impostoPercent}
          />
          <Input
            label="Comissão (%)"
            name="comissaoPercent"
            type="number"
            step="0.0001"
            min="0"
            defaultValue={parametros.comissaoPercent}
          />
          <Input
            label="Taxa financeira (%)"
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
            Prensas offset
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Custo de máquina, torres, chapas e rodagem agora são configurados por
            prensa — uma gráfica pode ter mais de uma.
          </p>
        </div>
        <Link href="/configuracoes/prensas">
          <Button type="button" variant="outline">
            Gerenciar prensas
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
            Status da cobrança do grafica-saas — trial, plano ativo, fatura.
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

      <Card className="flex flex-col gap-4 p-6">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">
          Nesting de bobina
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Margem de segurança padrão (%)"
            name="margemSegurancaPadrao"
            type="number"
            step="0.0001"
            min="0"
            defaultValue={parametros.margemSegurancaPadrao}
          />
          <Input
            label="Gap entre peças padrão (m)"
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

      {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}

      <Button type="submit" loading={isPending} className="self-start">
        {isPending ? "Salvando..." : "Salvar parâmetros"}
      </Button>
    </form>
  );
}
