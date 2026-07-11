"use client";

import { useActionState } from "react";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { salvarConfiguracaoAcabamento } from "./actions";

type BaseCobranca =
  | "UNIDADE"
  | "M2"
  | "FOLHA_IMPRESSA"
  | "METRO_LINEAR"
  | "FIXO"
  | "HORA";
type EstagioAcabamento = "PRE_REFILE" | "POS_REFILE";

const ROTULO_BASE_COBRANCA: Record<BaseCobranca, string> = {
  UNIDADE: "Por unidade/peça",
  M2: "Por m² da peça",
  FOLHA_IMPRESSA: "Por folha impressa (antes do refile)",
  METRO_LINEAR: "Por metro linear",
  FIXO: "Valor fixo por orçamento",
  HORA: "Por hora estimada",
};

export function ConfiguracaoAcabamentoForm({
  itemGraficaId,
  precoCompra,
  configuracao,
}: {
  itemGraficaId: string;
  precoCompra: string;
  configuracao: {
    baseCobranca: BaseCobranca;
    estagio: EstagioAcabamento;
    custoSetup: string;
    custoMinimo: string;
    custoFerramental: string;
  } | null;
}) {
  const [state, formAction, isPending] = useActionState(salvarConfiguracaoAcabamento, null);

  return (
    <form action={formAction}>
      <input type="hidden" name="itemGraficaId" value={itemGraficaId} />
      <Card className="flex flex-col gap-5 p-6">
        <Alert variant="success">
          Custo unitário usado na fórmula ={" "}
          {precoCompra ? `R$ ${Number(precoCompra).toFixed(2)}` : "não definido"} — é o
          preço de compra deste serviço, editável em Catálogo.
        </Alert>

        <Select
          label="Base de cobrança"
          name="baseCobranca"
          defaultValue={configuracao?.baseCobranca ?? "UNIDADE"}
        >
          {(Object.keys(ROTULO_BASE_COBRANCA) as BaseCobranca[]).map((valor) => (
            <option key={valor} value={valor}>
              {ROTULO_BASE_COBRANCA[valor]}
            </option>
          ))}
        </Select>

        <Select
          label="Estágio de aplicação"
          name="estagio"
          defaultValue={configuracao?.estagio ?? "POS_REFILE"}
          hint="Pré-refile cobra pela folha de máquina antes do corte final (ex: BOPP em offset). Pós-refile cobra pela peça já cortada."
        >
          <option value="PRE_REFILE">Antes do refile (folha de máquina)</option>
          <option value="POS_REFILE">Depois do refile (peça final)</option>
        </Select>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Custo de setup (R$)"
            name="custoSetup"
            type="number"
            step="0.0001"
            min="0"
            defaultValue={configuracao?.custoSetup ?? "0"}
          />
          <Input
            label="Custo mínimo (R$)"
            name="custoMinimo"
            type="number"
            step="0.0001"
            min="0"
            defaultValue={configuracao?.custoMinimo ?? "0"}
          />
        </div>
        <Input
          label="Custo de ferramental (opcional, R$)"
          name="custoFerramental"
          type="number"
          step="0.0001"
          min="0"
          defaultValue={configuracao?.custoFerramental ?? ""}
          hint="Ex: molde de faca para corte especial. Deixe em branco se não houver."
        />

        {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}

        <Button type="submit" loading={isPending} className="self-start">
          {isPending ? "Salvando..." : "Salvar configuração"}
        </Button>
      </Card>
    </form>
  );
}
