"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Alert } from "@/components/ui/Alert";
import { ROTULO_UNIDADE } from "@/lib/unidade";
import {
  BoxIcon,
  LayersIcon,
  WrenchIcon,
  SearchIcon,
  SlidersIcon,
  PlusIcon,
} from "@/components/icons";
import { salvarCatalogo, criarItemCatalogo, type CriarItemCatalogoResult } from "./actions";

type Tipo = "PRODUTO" | "MATERIA_PRIMA" | "SERVICO";

const ROTULO_TIPO_SINGULAR: Record<Tipo, string> = {
  PRODUTO: "produto",
  MATERIA_PRIMA: "matéria-prima",
  SERVICO: "serviço",
};

const ARTIGO_NOVO: Record<Tipo, string> = {
  PRODUTO: "Novo",
  MATERIA_PRIMA: "Nova",
  SERVICO: "Novo",
};

type ItemCatalogo = {
  id: string;
  tipo: Tipo;
  categoria: string;
  nome: string;
  unidade: string | null;
};

type Selecao = {
  id: string;
  ativo: boolean;
  precoCompra: string;
  precoVenda: string;
  estoqueAtual: string;
  estoqueMinimo: string;
};

const ABAS: { tipo: Tipo; titulo: string; icone: typeof BoxIcon }[] = [
  { tipo: "PRODUTO", titulo: "Produtos", icone: BoxIcon },
  { tipo: "MATERIA_PRIMA", titulo: "Matérias-primas", icone: LayersIcon },
  { tipo: "SERVICO", titulo: "Serviços", icone: WrenchIcon },
];

function agruparPorCategoria(itens: ItemCatalogo[]) {
  const grupos = new Map<string, ItemCatalogo[]>();
  for (const item of itens) {
    const lista = grupos.get(item.categoria) ?? [];
    lista.push(item);
    grupos.set(item.categoria, lista);
  }
  return grupos;
}

function CampoNumero({
  name,
  placeholder,
  defaultValue,
  prefixo,
}: {
  name: string;
  placeholder: string;
  defaultValue?: string;
  prefixo?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-slate-500">{placeholder}</span>
      <div className="relative">
        {prefixo && (
          <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-xs text-slate-400">
            {prefixo}
          </span>
        )}
        <input
          type="number"
          step="0.01"
          min="0"
          name={name}
          defaultValue={defaultValue}
          className={`w-28 rounded-lg border border-slate-300 py-1.5 text-sm text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${
            prefixo ? "pl-7 pr-2" : "px-2"
          }`}
        />
      </div>
    </label>
  );
}

function ItemLinha({
  item,
  selecionado,
  onToggle,
  selecaoInicial,
}: {
  item: ItemCatalogo;
  selecionado: boolean;
  onToggle: (id: string) => void;
  selecaoInicial?: Selecao;
}) {
  // Matéria-prima já mostra precoCompra como campo essencial (fora do "+ mais
  // detalhes"), então só estoque conta como detalhe extra pra decidir se
  // começa expandido; produto/serviço conta o custo também.
  const temDetalhesPreenchidos = Boolean(
    item.tipo === "MATERIA_PRIMA"
      ? selecaoInicial?.estoqueAtual || selecaoInicial?.estoqueMinimo
      : selecaoInicial?.precoCompra
  );
  const [expandido, setExpandido] = useState(temDetalhesPreenchidos);

  return (
    <div className="flex flex-col gap-3 border-b border-slate-100 py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          name={`sel_${item.id}`}
          checked={selecionado}
          onChange={() => onToggle(item.id)}
          className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
        />
        <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
          {item.nome}
        </span>
        {item.unidade && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 dark:bg-slate-800">
            {ROTULO_UNIDADE[item.unidade] ?? item.unidade}
          </span>
        )}
      </label>

      {selecionado && (
        <div className="flex flex-wrap items-center gap-3 pl-7 sm:pl-0">
          {(item.tipo === "PRODUTO" || item.tipo === "SERVICO") && (
            <CampoNumero
              name={`venda_${item.id}`}
              placeholder="Preço de venda"
              defaultValue={selecaoInicial?.precoVenda}
              prefixo="R$"
            />
          )}
          {item.tipo === "MATERIA_PRIMA" && (
            <CampoNumero
              name={`compra_${item.id}`}
              placeholder="Preço de compra"
              defaultValue={selecaoInicial?.precoCompra}
              prefixo="R$"
            />
          )}

          {expandido ? (
            <>
              {(item.tipo === "PRODUTO" || item.tipo === "SERVICO") && (
                <CampoNumero
                  name={`compra_${item.id}`}
                  placeholder="Custo (opcional)"
                  defaultValue={selecaoInicial?.precoCompra}
                  prefixo="R$"
                />
              )}
              {item.tipo === "MATERIA_PRIMA" && (
                <>
                  <CampoNumero
                    name={`estoqueAtual_${item.id}`}
                    placeholder="Estoque atual"
                    defaultValue={selecaoInicial?.estoqueAtual}
                  />
                  <CampoNumero
                    name={`estoqueMinimo_${item.id}`}
                    placeholder="Estoque mínimo"
                    defaultValue={selecaoInicial?.estoqueMinimo}
                  />
                </>
              )}
              {(item.tipo === "PRODUTO" || item.tipo === "SERVICO") &&
                (selecaoInicial?.id ? (
                  <Link
                    href={`/catalogo/${selecaoInicial.id}`}
                    className="flex items-center gap-1.5 self-center text-xs font-medium text-teal-700 hover:underline dark:text-teal-400"
                  >
                    <SlidersIcon className="h-3.5 w-3.5" />
                    Configuração avançada
                  </Link>
                ) : (
                  <span className="self-center text-xs text-slate-400">
                    Salve o catálogo para configurar em detalhe
                  </span>
                ))}
            </>
          ) : (
            <button
              type="button"
              onClick={() => setExpandido(true)}
              className="self-center text-xs font-medium text-teal-700 hover:underline dark:text-teal-400"
            >
              + mais detalhes
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function NovoItemForm({
  tipo,
  categoriasExistentes,
  onCriado,
  onCancelar,
}: {
  tipo: Tipo;
  categoriasExistentes: string[];
  onCriado: (itemId: string) => void;
  onCancelar: () => void;
}) {
  const [state, formAction, isPending] = useActionState<CriarItemCatalogoResult | null, FormData>(
    criarItemCatalogo,
    null
  );
  const datalistId = `categorias-${tipo}`;

  useEffect(() => {
    if (state?.ok && state.itemId) {
      onCriado(state.itemId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <div className="rounded-2xl border border-teal-200 bg-teal-50/50 p-5 dark:border-teal-900 dark:bg-teal-950/20">
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="tipo" value={tipo} />

        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            {ARTIGO_NOVO[tipo]} {ROTULO_TIPO_SINGULAR[tipo]}
          </h3>
          <button
            type="button"
            onClick={onCancelar}
            className="text-xs font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
          >
            Cancelar
          </button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Nome" name="nome" placeholder="ex: Adesivo Holográfico" required />
          <div>
            <Input
              label="Categoria"
              name="categoria"
              list={datalistId}
              placeholder="ex: Adesivos e Etiquetas"
              required
            />
            <datalist id={datalistId}>
              {categoriasExistentes.map((categoria) => (
                <option key={categoria} value={categoria} />
              ))}
            </datalist>
          </div>
        </div>

        {tipo !== "PRODUTO" && (
          <Select
            label="Unidade de medida"
            name="unidade"
            defaultValue="UNIDADE"
            hint="Base usada para comprar/cobrar esse item — igual aos itens já existentes."
          >
            {Object.entries(ROTULO_UNIDADE).map(([valor, rotulo]) => (
              <option key={valor} value={valor}>
                {rotulo}
              </option>
            ))}
          </Select>
        )}

        <Input
          label="Descrição (opcional)"
          name="descricao"
          placeholder="Algo que ajude a diferenciar esse item"
        />

        {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}

        <Button type="submit" loading={isPending} className="self-start">
          {isPending ? "Adicionando..." : "Adicionar ao catálogo"}
        </Button>
      </form>
    </div>
  );
}

export function CatalogoForm({
  itensCatalogo,
  selecoes,
}: {
  itensCatalogo: ItemCatalogo[];
  selecoes: Record<string, Selecao>;
}) {
  const [abaAtiva, setAbaAtiva] = useState<Tipo>("PRODUTO");
  const [busca, setBusca] = useState("");
  const [mostrarNovoItem, setMostrarNovoItem] = useState(false);
  const [selecionados, setSelecionados] = useState<Set<string>>(
    () => new Set(Object.entries(selecoes).filter(([, s]) => s.ativo).map(([id]) => id))
  );
  const [state, formAction, isPending] = useActionState(salvarCatalogo, null);

  const toggle = (id: string) => {
    setSelecionados((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  };

  const buscaNormalizada = busca.trim().toLowerCase();

  const contagemPorAba = useMemo(() => {
    const contagem: Record<Tipo, number> = { PRODUTO: 0, MATERIA_PRIMA: 0, SERVICO: 0 };
    for (const id of selecionados) {
      const item = itensCatalogo.find((i) => i.id === id);
      if (item) contagem[item.tipo]++;
    }
    return contagem;
  }, [selecionados, itensCatalogo]);

  const categoriasPorTipo = useMemo(() => {
    const mapa: Record<Tipo, Set<string>> = {
      PRODUTO: new Set(),
      MATERIA_PRIMA: new Set(),
      SERVICO: new Set(),
    };
    for (const item of itensCatalogo) mapa[item.tipo].add(item.categoria);
    return {
      PRODUTO: [...mapa.PRODUTO].sort(),
      MATERIA_PRIMA: [...mapa.MATERIA_PRIMA].sort(),
      SERVICO: [...mapa.SERVICO].sort(),
    };
  }, [itensCatalogo]);

  const aoCriarItem = (itemId: string) => {
    // O item novo entra com os mesmos campos de um pré-existente, então já pode
    // ser tratado como "selecionado" — só falta preencher preço/estoque, igual
    // qualquer outro item da lista.
    setSelecionados((atual) => new Set(atual).add(itemId));
    setMostrarNovoItem(false);
    setBusca("");
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800">
        <div className="flex flex-wrap gap-2">
          {ABAS.map(({ tipo, titulo, icone: Icone }) => (
            <button
              key={tipo}
              type="button"
              onClick={() => setAbaAtiva(tipo)}
              className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                abaAtiva === tipo
                  ? "border-teal-600 text-teal-700 dark:text-teal-400"
                  : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              }`}
            >
              <Icone className="h-4 w-4" />
              {titulo}
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 dark:bg-slate-800">
                {contagemPorAba[tipo]}
              </span>
            </button>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => setMostrarNovoItem((v) => !v)}
        >
          <PlusIcon className="h-4 w-4" />
          Adicionar {ROTULO_TIPO_SINGULAR[abaAtiva]}
        </Button>
      </div>

      {mostrarNovoItem && (
        <NovoItemForm
          tipo={abaAtiva}
          categoriasExistentes={categoriasPorTipo[abaAtiva]}
          onCriado={aoCriarItem}
          onCancelar={() => setMostrarNovoItem(false)}
        />
      )}

      <form action={formAction} className="flex flex-col gap-6">
      <div className="relative max-w-sm">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
          <SearchIcon className="h-4 w-4" />
        </span>
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar item ou categoria..."
          className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 focus:border-teal-500 focus:ring-4 focus:ring-teal-500/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
      </div>

      {ABAS.map(({ tipo }) => {
        // Importante: todo item da aba fica sempre montado no DOM (nunca
        // removido do array por causa da busca) — salvarCatalogo trata um
        // checkbox ausente do FormData como "desmarcar esse item", então
        // filtrar de verdade aqui desativaria em massa tudo que não bateu
        // com o termo buscado no momento de salvar. A busca só esconde
        // visualmente via `hidden`.
        const itensDaAba = itensCatalogo.filter((i) => i.tipo === tipo);
        const grupos = agruparPorCategoria(itensDaAba);
        const corresponde = (i: ItemCatalogo) =>
          !buscaNormalizada ||
          i.nome.toLowerCase().includes(buscaNormalizada) ||
          i.categoria.toLowerCase().includes(buscaNormalizada);
        const nenhumResultado =
          buscaNormalizada.length > 0 &&
          itensDaAba.every((i) => !corresponde(i));

        return (
          <div key={tipo} hidden={abaAtiva !== tipo} className="flex flex-col gap-4">
            {nenhumResultado && (
              <p className="text-sm text-slate-500">
                Nenhum item encontrado para &quot;{busca}&quot;.
              </p>
            )}
            {[...grupos.entries()].map(([categoria, itens]) => {
              const temSelecionado = itens.some((i) => selecionados.has(i.id));
              const categoriaTemResultado = itens.some(corresponde);
              // Fecha por padrão — só abre sozinha se já tem algo selecionado
              // aqui dentro (preserva o que já foi configurado) ou se a busca
              // ativa tem resultado nesta categoria (senão o resultado fica
              // escondido atrás de um clique extra).
              const aberta = temSelecionado || (buscaNormalizada.length > 0 && categoriaTemResultado);
              return (
                <details
                  key={categoria}
                  open={aberta}
                  hidden={buscaNormalizada.length > 0 && !categoriaTemResultado}
                  className="rounded-2xl border border-slate-200 bg-white px-5 dark:border-slate-800 dark:bg-slate-900"
                >
                  <summary className="cursor-pointer list-none py-4 text-sm font-semibold text-slate-900 marker:content-none dark:text-white">
                    {categoria}{" "}
                    <span className="font-normal text-slate-400">
                      ({itens.length})
                    </span>
                    {temSelecionado && (
                      <span className="ml-2 rounded-full bg-teal-50 px-2 py-0.5 text-xs font-normal text-teal-700 dark:bg-teal-950 dark:text-teal-300">
                        {itens.filter((i) => selecionados.has(i.id)).length} selecionado
                        {itens.filter((i) => selecionados.has(i.id)).length > 1 ? "s" : ""}
                      </span>
                    )}
                  </summary>
                  <div className="pb-2">
                    {itens.map((item) => (
                      <div key={item.id} hidden={buscaNormalizada.length > 0 && !corresponde(item)}>
                        <ItemLinha
                          item={item}
                          selecionado={selecionados.has(item.id)}
                          onToggle={toggle}
                          selecaoInicial={selecoes[item.id]}
                        />
                      </div>
                    ))}
                  </div>
                </details>
              );
            })}
          </div>
        );
      })}

      <div className="sticky bottom-4 flex items-center justify-between rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-lg shadow-slate-900/5 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        <p className="text-sm text-slate-500">
          {selecionados.size} itens selecionados no total
        </p>
        <div className="flex items-center gap-3">
          {state && (
            <span className={state.ok ? "text-sm text-emerald-600" : "text-sm text-rose-600"}>
              {state.mensagem}
            </span>
          )}
          <Button type="submit" loading={isPending}>
            {isPending ? "Salvando..." : "Salvar catálogo"}
          </Button>
        </div>
      </div>
      </form>
    </div>
  );
}
