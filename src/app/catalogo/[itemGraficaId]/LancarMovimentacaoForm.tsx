"use client";

import { useActionState, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { formatoMoeda } from "@/lib/moeda";
import { calcularDeltaAjusteInventario } from "@/lib/estoque-manual";
import { lancarEntradaCompra, lancarSaidaManual, lancarAjusteInventario } from "./actions";

type Variante = { id: string; rotulo: string; precoCompra: string; estoqueAtual: string };
type Tipo = "ENTRADA_COMPRA" | "SAIDA_MANUAL" | "AJUSTE_INVENTARIO";

const ROTULO_TIPO: Record<Tipo, string> = {
  ENTRADA_COMPRA: "Entrada de compra",
  SAIDA_MANUAL: "Saída manual",
  AJUSTE_INVENTARIO: "Ajuste de inventário",
};

// Formulário de lançamento manual de movimentação de estoque (fase "custo
// real", §4.3) — 3 tipos que compartilham alvo (item ou variante) mas têm
// campos obrigatórios bem diferentes, por isso viram 3 <form> distintos
// (um por Server Action), só um visível de cada vez conforme o tipo
// selecionado nas abas acima.
export function LancarMovimentacaoForm({
  itemGraficaId,
  nomeItem,
  unidadeRotulo,
  precoCompraAtual,
  estoqueAtual,
  variantes,
}: {
  itemGraficaId: string;
  nomeItem: string;
  unidadeRotulo: string;
  // "" quando não cadastrado/sem controle — só relevante quando o item NÃO
  // tem variante (com variante, o preço/estoque relevante é o da variante
  // selecionada, ver variantes abaixo).
  precoCompraAtual: string;
  estoqueAtual: string;
  variantes: Variante[];
}) {
  const [tipo, setTipo] = useState<Tipo>("ENTRADA_COMPRA");
  const [varianteId, setVarianteId] = useState(variantes[0]?.id ?? "");
  const [custoUnitario, setCustoUnitario] = useState("");
  const [novoEstoque, setNovoEstoque] = useState("");

  const varianteSelecionada = variantes.find((v) => v.id === varianteId) ?? null;
  const precoAtualRelevante = variantes.length > 0 ? (varianteSelecionada?.precoCompra ?? "") : precoCompraAtual;
  const estoqueAtualRelevante = variantes.length > 0 ? (varianteSelecionada?.estoqueAtual ?? "") : estoqueAtual;
  const nomeAlvo = varianteSelecionada ? `${nomeItem} (${varianteSelecionada.rotulo})` : nomeItem;

  const [estadoEntrada, actionEntrada, pendingEntrada] = useActionState(lancarEntradaCompra, null);
  const [estadoSaida, actionSaida, pendingSaida] = useActionState(lancarSaidaManual, null);
  const [estadoAjuste, actionAjuste, pendingAjuste] = useActionState(lancarAjusteInventario, null);

  const deltaPreview =
    novoEstoque !== "" && Number.isFinite(Number(novoEstoque))
      ? calcularDeltaAjusteInventario(
          estoqueAtualRelevante ? Number(estoqueAtualRelevante) : null,
          Number(novoEstoque)
        )
      : null;

  return (
    <Card className="flex flex-col gap-5 p-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">
          Lançar movimentação manual
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Entrada de compra atualiza o preço de custo cadastrado deste material. Saída manual e
          ajuste de inventário só corrigem a quantidade em estoque.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(Object.keys(ROTULO_TIPO) as Tipo[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTipo(t)}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
              tipo === t
                ? "bg-teal-600 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            }`}
          >
            {ROTULO_TIPO[t]}
          </button>
        ))}
      </div>

      {variantes.length > 0 && (
        <div className="w-48">
          <Select label="Variante" value={varianteId} onChange={(e) => setVarianteId(e.target.value)}>
            {variantes.map((v) => (
              <option key={v.id} value={v.id}>
                {v.rotulo}
              </option>
            ))}
          </Select>
        </div>
      )}

      {tipo === "ENTRADA_COMPRA" && (
        <form
          action={actionEntrada}
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            const novoPrecoTexto = formatoMoeda.format(Number(custoUnitario || 0));
            const precoAtualTexto = precoAtualRelevante
              ? formatoMoeda.format(Number(precoAtualRelevante))
              : "não cadastrado";
            if (
              !confirm(
                `Isso vai atualizar o preço de custo cadastrado de "${nomeAlvo}" de ${precoAtualTexto} pra ${novoPrecoTexto}. Confirma?`
              )
            ) {
              e.preventDefault();
            }
          }}
        >
          <input type="hidden" name="itemGraficaId" value={itemGraficaId} />
          {varianteId && <input type="hidden" name="varianteId" value={varianteId} />}
          <div className="flex flex-wrap gap-3">
            <div className="w-36">
              <Input
                label={`Quantidade${unidadeRotulo ? ` (${unidadeRotulo})` : ""}`}
                name="quantidade"
                type="number"
                step="0.0001"
                min="0"
                required
              />
            </div>
            <div className="w-40">
              <Input
                label="Custo unitário (R$)"
                name="custoUnitario"
                type="number"
                step="0.0001"
                min="0"
                required
                value={custoUnitario}
                onChange={(e) => setCustoUnitario(e.target.value)}
              />
            </div>
            <div className="w-40">
              <Input label="Nº da nota (opcional)" name="documento" type="text" maxLength={60} />
            </div>
          </div>
          {estadoEntrada && (
            <Alert variant={estadoEntrada.ok ? "success" : "error"}>{estadoEntrada.mensagem}</Alert>
          )}
          <Button type="submit" loading={pendingEntrada} className="self-start">
            {pendingEntrada ? "Registrando..." : "Registrar entrada"}
          </Button>
        </form>
      )}

      {tipo === "SAIDA_MANUAL" && (
        <form action={actionSaida} className="flex flex-col gap-4">
          <input type="hidden" name="itemGraficaId" value={itemGraficaId} />
          {varianteId && <input type="hidden" name="varianteId" value={varianteId} />}
          <div className="flex flex-wrap gap-3">
            <div className="w-36">
              <Input
                label={`Quantidade${unidadeRotulo ? ` (${unidadeRotulo})` : ""}`}
                name="quantidade"
                type="number"
                step="0.0001"
                min="0"
                required
              />
            </div>
            <div className="min-w-[220px] flex-1">
              <Input
                label="Motivo (perda, quebra, uso avulso)"
                name="motivo"
                type="text"
                maxLength={300}
                required
              />
            </div>
          </div>
          {estadoSaida && <Alert variant={estadoSaida.ok ? "success" : "error"}>{estadoSaida.mensagem}</Alert>}
          <Button type="submit" loading={pendingSaida} className="self-start">
            {pendingSaida ? "Registrando..." : "Registrar saída"}
          </Button>
        </form>
      )}

      {tipo === "AJUSTE_INVENTARIO" && (
        <form action={actionAjuste} className="flex flex-col gap-4">
          <input type="hidden" name="itemGraficaId" value={itemGraficaId} />
          {varianteId && <input type="hidden" name="varianteId" value={varianteId} />}
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-40">
              <Input
                label={`Novo estoque${unidadeRotulo ? ` (${unidadeRotulo})` : ""}`}
                name="novoEstoque"
                type="number"
                step="0.0001"
                min="0"
                required
                value={novoEstoque}
                onChange={(e) => setNovoEstoque(e.target.value)}
              />
            </div>
            <div className="min-w-[220px] flex-1">
              <Input label="Observação (opcional)" name="observacao" type="text" maxLength={300} />
            </div>
          </div>
          {deltaPreview !== null && (
            <p className="text-xs text-slate-500">
              Estoque atual: {estoqueAtualRelevante || "sem controle"}
              {unidadeRotulo ? ` ${unidadeRotulo}` : ""}. Isso vai gerar um ajuste de{" "}
              <span
                className={
                  deltaPreview >= 0
                    ? "font-medium text-emerald-600 dark:text-emerald-400"
                    : "font-medium text-rose-600 dark:text-rose-400"
                }
              >
                {deltaPreview >= 0 ? "+" : ""}
                {deltaPreview}
              </span>
              {unidadeRotulo ? ` ${unidadeRotulo}` : ""}.
            </p>
          )}
          {estadoAjuste && (
            <Alert variant={estadoAjuste.ok ? "success" : "error"}>{estadoAjuste.mensagem}</Alert>
          )}
          <Button type="submit" loading={pendingAjuste} className="self-start">
            {pendingAjuste ? "Registrando..." : "Registrar ajuste"}
          </Button>
        </form>
      )}
    </Card>
  );
}
