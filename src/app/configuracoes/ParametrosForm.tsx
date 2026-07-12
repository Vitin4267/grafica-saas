"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { salvarParametros } from "./actions";
import type { ParametrosTenant } from "@/lib/pricing";

export function ParametrosForm({ parametros }: { parametros: ParametrosTenant }) {
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

      {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}

      <Button type="submit" loading={isPending} className="self-start">
        {isPending ? "Salvando..." : "Salvar parâmetros"}
      </Button>
    </form>
  );
}
