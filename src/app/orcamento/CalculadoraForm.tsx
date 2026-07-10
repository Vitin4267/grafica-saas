"use client";

import { useActionState, useMemo, useState } from "react";
import { calcularPreco } from "@/lib/orcamento";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { ReceiptIcon, RulerIcon, SparklesIcon } from "@/components/icons";
import { criarOrcamento, precificarItem } from "./actions";
import {
  SeletorItemOrcamento,
  camposIniciais,
  type ItemVenda,
  type CamposItemOrcamento,
} from "./SeletorItemOrcamento";

type Cliente = {
  id: string;
  nome: string;
};

type ItemCarrinho = {
  chave: string;
  itemGraficaId: string;
  nome: string;
  categoria: string;
  quantidade: number;
  larguraCm: number | null;
  alturaCm: number | null;
  corFrente: number | null;
  corVerso: number | null;
  cores: string | null;
  acabamento: string | null;
  precoUnitario: string;
  precoTotal: string;
  modeloCalculo: "SIMPLES" | "M2" | "OFFSET";
};

function gerarChave() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

const formatoMoeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function CalculadoraForm({
  itens,
  clientes,
}: {
  itens: ItemVenda[];
  clientes: Cliente[];
}) {
  const [clienteId, setClienteId] = useState("");
  const [campos, setCampos] = useState<CamposItemOrcamento>(() => camposIniciais(itens));
  const [itensCarrinho, setItensCarrinho] = useState<ItemCarrinho[]>([]);
  const [adicionando, setAdicionando] = useState(false);
  const [erroAdicionar, setErroAdicionar] = useState<string | null>(null);
  const [state, formAction, isPending] = useActionState(criarOrcamento, null);

  const itemSelecionado = itens.find((i) => i.id === campos.itemGraficaId);
  const usaMotorAvancado =
    itemSelecionado?.modeloCalculo === "M2" || itemSelecionado?.modeloCalculo === "OFFSET";

  // Prévia instantânea, sem round-trip, só pra itens SIMPLES (matemática pura,
  // igual a src/lib/orcamento.ts). M2/Offset só têm preço real depois de
  // "Adicionar item" — o motor avançado (bobina/folha) só roda no servidor.
  const previewSimples = useMemo(() => {
    if (!itemSelecionado || usaMotorAvancado) return null;
    const quantidade = Number(campos.quantidade);
    return calcularPreco({
      precoBase: Number(itemSelecionado.precoVenda),
      quantidade: quantidade || 0,
      larguraCm: campos.larguraCm ? Number(campos.larguraCm) : null,
      alturaCm: campos.alturaCm ? Number(campos.alturaCm) : null,
    });
  }, [itemSelecionado, usaMotorAvancado, campos.quantidade, campos.larguraCm, campos.alturaCm]);

  const totalCarrinho = itensCarrinho.reduce((soma, i) => soma + Number(i.precoTotal), 0);

  async function adicionarAoCarrinho() {
    setErroAdicionar(null);
    const quantidade = Number(campos.quantidade);
    if (!campos.itemGraficaId || !quantidade || quantidade <= 0) {
      setErroAdicionar("Escolha um produto e uma quantidade válida.");
      return;
    }

    const larguraCm = campos.larguraCm ? Number(campos.larguraCm) : null;
    const alturaCm = campos.alturaCm ? Number(campos.alturaCm) : null;
    const corFrente = campos.corFrente !== "" ? Number(campos.corFrente) : null;
    const corVerso = campos.corVerso !== "" ? Number(campos.corVerso) : null;

    setAdicionando(true);
    const resultado = await precificarItem({
      itemGraficaId: campos.itemGraficaId,
      quantidade,
      larguraCm,
      alturaCm,
      corFrente,
      corVerso,
    });
    setAdicionando(false);

    if (!resultado.ok) {
      setErroAdicionar(resultado.mensagem);
      return;
    }

    setItensCarrinho((atual) => [
      ...atual,
      {
        chave: gerarChave(),
        itemGraficaId: campos.itemGraficaId,
        nome: resultado.nome,
        categoria: resultado.categoria,
        quantidade,
        larguraCm,
        alturaCm,
        corFrente,
        corVerso,
        cores: campos.cores.trim() || null,
        acabamento: campos.acabamento.trim() || null,
        precoUnitario: resultado.precoUnitario,
        precoTotal: resultado.precoTotal,
        modeloCalculo: resultado.modeloCalculo,
      },
    ]);
    setCampos(camposIniciais(itens));
  }

  function removerDoCarrinho(chave: string) {
    setItensCarrinho((atual) => atual.filter((i) => i.chave !== chave));
  }

  const itensJson = JSON.stringify(
    itensCarrinho.map((i) => ({
      itemGraficaId: i.itemGraficaId,
      quantidade: i.quantidade,
      larguraCm: i.larguraCm,
      alturaCm: i.alturaCm,
      corFrente: i.corFrente,
      corVerso: i.corVerso,
      cores: i.cores,
      acabamento: i.acabamento,
    }))
  );

  return (
    <div className="grid gap-6 lg:grid-cols-5 lg:items-start">
      <Card className="p-6 lg:col-span-3">
        <h2 className="mb-5 text-base font-semibold text-slate-900 dark:text-white">
          Dados do orçamento
        </h2>
        <div className="flex flex-col gap-5">
          <Select
            label="Cliente"
            value={clienteId}
            onChange={(e) => setClienteId(e.target.value)}
            required
          >
            <option value="" disabled>
              Selecione o cliente
            </option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </Select>

          <div className="border-t border-slate-100 pt-5 dark:border-slate-800">
            <SeletorItemOrcamento itens={itens} valores={campos} onChange={setCampos} />

            {erroAdicionar && (
              <div className="mt-4">
                <Alert variant="error">{erroAdicionar}</Alert>
              </div>
            )}

            <Button
              type="button"
              variant="outline"
              onClick={adicionarAoCarrinho}
              loading={adicionando}
              className="mt-4 w-full"
            >
              {adicionando ? "Calculando..." : "+ Adicionar item ao orçamento"}
            </Button>
          </div>

          {itensCarrinho.length > 0 && (
            <div className="border-t border-slate-100 pt-5 dark:border-slate-800">
              <p className="mb-3 text-sm font-medium text-slate-700 dark:text-slate-200">
                Itens no orçamento
              </p>
              <div className="flex flex-col divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                {itensCarrinho.map((item) => (
                  <div key={item.chave} className="flex items-center justify-between gap-3 p-3">
                    <div>
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                        {item.nome}
                      </p>
                      <p className="text-xs text-slate-500">
                        Qtd: {item.quantidade}
                        {item.larguraCm && item.alturaCm
                          ? ` · ${item.larguraCm} × ${item.alturaCm} cm`
                          : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">
                        {formatoMoeda.format(Number(item.precoTotal))}
                      </p>
                      <button
                        type="button"
                        onClick={() => removerDoCarrinho(item.chave)}
                        className="text-xs font-medium text-rose-600 hover:underline"
                      >
                        Remover
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between rounded-xl bg-teal-50 px-4 py-3 dark:bg-teal-950/50">
                <p className="text-sm font-medium text-teal-700 dark:text-teal-400">
                  Total geral
                </p>
                <p className="text-xl font-bold text-teal-800 dark:text-teal-300">
                  {formatoMoeda.format(totalCarrinho)}
                </p>
              </div>
            </div>
          )}

          <form action={formAction} className="contents">
            <input type="hidden" name="clienteId" value={clienteId} />
            <input type="hidden" name="itensJson" value={itensJson} />

            {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}

            <Button
              type="submit"
              loading={isPending}
              disabled={itensCarrinho.length === 0 || !clienteId}
              className="w-full"
            >
              {isPending
                ? "Salvando..."
                : `Salvar orçamento${itensCarrinho.length > 0 ? ` (${itensCarrinho.length} ${itensCarrinho.length > 1 ? "itens" : "item"})` : ""}`}
            </Button>
          </form>
        </div>
      </Card>

      <Card className="sticky top-24 p-6 lg:col-span-2">
        <h2 className="mb-5 flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
          <ReceiptIcon className="h-5 w-5 text-teal-600" />
          Item atual
        </h2>

        {usaMotorAvancado ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <SparklesIcon className="h-6 w-6 text-teal-600" />
            <p className="text-sm text-slate-500">
              Este item usa o cálculo avançado por área (bobina mais econômica,
              perda de material, etc). O valor exato aparece na lista depois de
              clicar em &quot;Adicionar item&quot;.
            </p>
          </div>
        ) : previewSimples ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-50 px-3 py-1 text-xs font-medium text-teal-700 dark:bg-teal-950 dark:text-teal-300">
                <RulerIcon className="h-3.5 w-3.5" />
                {previewSimples.temDimensoes ? "Cobrado por m²" : "Cobrado por unidade"}
              </span>
            </div>

            <dl className="flex flex-col gap-3 text-sm">
              {previewSimples.temDimensoes && (
                <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
                  <dt className="text-slate-500">Área</dt>
                  <dd className="font-medium text-slate-800 dark:text-slate-200">
                    {previewSimples.areaM2.toFixed(2)} m²
                  </dd>
                </div>
              )}
              <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
                <dt className="text-slate-500">Preço unitário</dt>
                <dd className="font-medium text-slate-800 dark:text-slate-200">
                  {formatoMoeda.format(previewSimples.precoUnitario)}
                </dd>
              </div>
              <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
                <dt className="text-slate-500">Quantidade</dt>
                <dd className="font-medium text-slate-800 dark:text-slate-200">
                  {Number(campos.quantidade) || 0}
                </dd>
              </div>
            </dl>

            <div className="rounded-xl bg-teal-50 px-4 py-4 dark:bg-teal-950/50">
              <p className="text-xs font-medium uppercase tracking-wide text-teal-700 dark:text-teal-400">
                Total deste item
              </p>
              <p className="text-3xl font-bold text-teal-800 dark:text-teal-300">
                {formatoMoeda.format(previewSimples.precoTotal)}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            Selecione um produto para ver a prévia do valor.
          </p>
        )}
      </Card>
    </div>
  );
}
