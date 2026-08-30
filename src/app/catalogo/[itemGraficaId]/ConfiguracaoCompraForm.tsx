"use client";

import { useActionState, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { UNIDADES_COMPRA, ROTULO_UNIDADE_COMPRA, type UnidadeCompra } from "@/lib/unidade-compra";
import { salvarConfiguracaoCompra } from "./actions";

// Achado A6 da auditoria de abrangência (Parte 3/Compras): configuração
// padrão de unidade de compra deste item, separada da unidade de ESTOQUE já
// cadastrada no Catálogo. Puramente pré-preenchimento/aviso na tela de nova
// solicitação de compra — nunca obrigatório, nunca muda como estoque é
// lançado (mesmo espírito de QuantidadePorEmbalagemForm ao lado).
export function ConfiguracaoCompraForm({
  itemGraficaId,
  unidadeEstoqueRotulo,
  valoresAtuais,
}: {
  itemGraficaId: string;
  unidadeEstoqueRotulo: string;
  valoresAtuais: {
    unidadeCompraPadrao: string;
    unidadeCompraPadraoOutro: string;
    fatorConversaoCompraPadrao: string;
    loteMinimoCompra: string;
    multiploCompra: string;
  };
}) {
  const [state, formAction, isPending] = useActionState(salvarConfiguracaoCompra, null);
  const [unidadeCompraPadrao, setUnidadeCompraPadrao] = useState(valoresAtuais.unidadeCompraPadrao);

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">
          Configuração de compra
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Opcional — unidade COMERCIAL em que este item costuma ser comprado (ex: fardo, resma,
          tonelada), diferente da unidade de estoque ({unidadeEstoqueRotulo || "não configurada"}).
          Só pré-preenche a tela de nova solicitação de compra e avisa arredondamento; nunca muda
          como o estoque é lançado.
        </p>
      </div>
      <form action={formAction} className="flex flex-col gap-3">
        <input type="hidden" name="itemGraficaId" value={itemGraficaId} />
        <div className="flex flex-wrap gap-3">
          <div className="w-48">
            <Select
              label="Unidade de compra padrão"
              name="unidadeCompraPadrao"
              value={unidadeCompraPadrao}
              onChange={(e) => setUnidadeCompraPadrao(e.target.value)}
            >
              <option value="">Nenhuma (compra na unidade de estoque)</option>
              {UNIDADES_COMPRA.map((u) => (
                <option key={u} value={u}>
                  {ROTULO_UNIDADE_COMPRA[u as UnidadeCompra]}
                </option>
              ))}
            </Select>
          </div>
          {unidadeCompraPadrao === "OUTRO" && (
            <div className="w-48">
              <Input
                label="Qual? (opcional)"
                name="unidadeCompraPadraoOutro"
                type="text"
                maxLength={60}
                defaultValue={valoresAtuais.unidadeCompraPadraoOutro}
              />
            </div>
          )}
          <div className="w-64">
            <Input
              label={`Quantas ${unidadeEstoqueRotulo || "unidades de estoque"} tem em cada unidade de compra? (opcional)`}
              name="fatorConversaoCompraPadrao"
              type="number"
              step="0.0001"
              min="0"
              defaultValue={valoresAtuais.fatorConversaoCompraPadrao}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="w-48">
            <Input
              label="Lote mínimo de compra (opcional)"
              name="loteMinimoCompra"
              type="number"
              step="0.0001"
              min="0"
              defaultValue={valoresAtuais.loteMinimoCompra}
            />
          </div>
          <div className="w-48">
            <Input
              label="Múltiplo de embalagem (opcional)"
              name="multiploCompra"
              type="number"
              step="0.0001"
              min="0"
              defaultValue={valoresAtuais.multiploCompra}
            />
          </div>
        </div>
        <Button type="submit" variant="outline" loading={isPending} className="self-start">
          {isPending ? "Salvando..." : "Salvar"}
        </Button>
      </form>
      {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}
    </Card>
  );
}
