"use client";

import { memo, useActionState, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Alert } from "@/components/ui/Alert";
import { CampoAjuda } from "@/components/ui/CampoAjuda";
import { ROTULO_UNIDADE, rotuloUnidade } from "@/lib/unidade";
import { ORIGEM_MERCADORIA_VALORES, ROTULO_ORIGEM_MERCADORIA } from "@/lib/nota-fiscal-tabelas";
import { gerarChave } from "@/lib/chave-local";
import {
  AlertTriangleIcon,
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
  unidadeOutro: string | null;
};

type Selecao = {
  id: string;
  ativo: boolean;
  precoCompra: string;
  precoVenda: string;
  estoqueAtual: string;
  estoqueMinimo: string;
  perdaFixaPadrao: string;
  variantes: string[];
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
  value,
  onChange,
  prefixo,
}: {
  name: string;
  placeholder: React.ReactNode;
  defaultValue?: string;
  // Controlado (value+onChange) só é usado pelo campo de preço principal —
  // precisa disso pra "aplicar preço a todos" (CatalogoForm) conseguir
  // preencher o valor via estado em vez de mexer no DOM na mão. Os demais
  // campos (custo extra, estoque) continuam não controlados via defaultValue.
  value?: string;
  onChange?: (valor: string) => void;
  prefixo?: string;
}) {
  const controlado = value !== undefined;
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
          {...(controlado
            ? { value, onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange?.(e.target.value) }
            : { defaultValue })}
          className={`w-28 rounded-lg border border-slate-300 py-1.5 text-sm text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${
            prefixo ? "pl-7 pr-2" : "px-2"
          }`}
        />
      </div>
    </label>
  );
}

// Checkbox "marcar todos" de uma categoria — indeterminate (traço) quando só
// parte dos itens está selecionada, é um estado que só dá pra setar via DOM
// (não existe prop React pra isso), daí o ref+useEffect.
function CheckboxSelecionarTudo({
  todosSelecionados,
  algunsSelecionados,
  onToggle,
}: {
  todosSelecionados: boolean;
  algunsSelecionados: boolean;
  onToggle: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = algunsSelecionados && !todosSelecionados;
    }
  }, [algunsSelecionados, todosSelecionados]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={todosSelecionados}
      onChange={onToggle}
      // Um clique num controle dentro de <summary> ainda propaga pro
      // <summary>, que por padrão abre/fecha o <details> — sem isso, marcar
      // "todos" também fecharia o acordeão sem querer.
      onClick={(e) => e.stopPropagation()}
      aria-label="Marcar todos os itens desta categoria"
      className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
    />
  );
}

// Mini-form pra preencher o preço de todos os itens já marcados de uma
// categoria que ainda estão sem preço — só reduz digitação repetida, nunca
// sobrescreve o que já foi preenchido (ver aplicarPrecoLote em CatalogoForm).
function AplicarPrecoLote({ tipo, onAplicar }: { tipo: Tipo; onAplicar: (valor: string) => void }) {
  const [valor, setValor] = useState("");

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-teal-50/50 p-3 dark:bg-teal-950/20">
      <span className="text-xs text-slate-600 dark:text-slate-300">
        Aplicar preço de {tipo === "MATERIA_PRIMA" ? "compra" : "venda"} a todos os selecionados sem preço:
      </span>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-xs text-slate-400">
          R$
        </span>
        <input
          type="number"
          step="0.01"
          min="0"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          className="w-24 rounded-lg border border-slate-300 py-1.5 pl-7 pr-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
      </div>
      <Button
        type="button"
        variant="outline"
        className="!px-3 !py-1.5 text-xs"
        onClick={() => {
          if (valor) {
            onAplicar(valor);
            setValor("");
          }
        }}
      >
        Aplicar
      </Button>
    </div>
  );
}

type LinhaVarianteNova = {
  chave: string;
  rotulo: string;
  precoCompra: string;
  estoqueAtual: string;
  estoqueMinimo: string;
  perdaFixaPadrao: string;
};

// Editor inline de variantes pra um item de matéria-prima que ainda NÃO foi
// salvo — permite cadastrar rótulo/preço/estoque de cada variante (ex:
// espessura de chapa) direto aqui, sem precisar salvar o catálogo antes e
// só depois abrir a tela de "Gerenciar variantes". Depois de salvo, a edição
// contínua (adicionar/remover variante já em uso por ficha técnica, etc.)
// continua acontecendo só em /catalogo/[itemGraficaId] (upsert cuidadoso,
// nunca apaga uma variante já referenciada) — este editor aqui só cobre a
// criação inicial, em lote, junto com o resto do catálogo.
function VariantesInlineEditor({
  itemId,
  linhas,
  onChange,
}: {
  itemId: string;
  linhas: LinhaVarianteNova[];
  onChange: (linhas: LinhaVarianteNova[]) => void;
}) {
  const atualizar = (
    chave: string,
    campo: "rotulo" | "precoCompra" | "estoqueAtual" | "estoqueMinimo" | "perdaFixaPadrao",
    valor: string
  ) => {
    onChange(linhas.map((l) => (l.chave === chave ? { ...l, [campo]: valor } : l)));
  };
  const remover = (chave: string) => onChange(linhas.filter((l) => l.chave !== chave));
  const adicionar = () =>
    onChange([
      ...linhas,
      {
        chave: gerarChave(),
        rotulo: "",
        precoCompra: "",
        estoqueAtual: "",
        estoqueMinimo: "",
        perdaFixaPadrao: "",
      },
    ]);

  return (
    <div className="flex w-full flex-col gap-2 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50">
      <input
        type="hidden"
        name={`variantesNovas_${itemId}`}
        value={JSON.stringify(
          linhas
            .filter((l) => l.rotulo && l.precoCompra)
            .map(({ rotulo, precoCompra, estoqueAtual, estoqueMinimo, perdaFixaPadrao }) => ({
              rotulo,
              precoCompra,
              estoqueAtual: estoqueAtual || undefined,
              estoqueMinimo: estoqueMinimo || undefined,
              perdaFixaPadrao: perdaFixaPadrao || undefined,
            }))
        )}
      />
      {linhas.map((linha) => (
        <div key={linha.chave} className="flex flex-wrap items-end gap-2">
          <input
            type="text"
            value={linha.rotulo}
            onChange={(e) => atualizar(linha.chave, "rotulo", e.target.value)}
            placeholder="ex: 3mm"
            className="w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
          <CampoNumero
            name={`__preco_${linha.chave}`}
            placeholder="Preço de compra"
            value={linha.precoCompra}
            onChange={(v) => atualizar(linha.chave, "precoCompra", v)}
            prefixo="R$"
          />
          <CampoNumero
            name={`__estoqueAtual_${linha.chave}`}
            placeholder="Estoque atual"
            value={linha.estoqueAtual}
            onChange={(v) => atualizar(linha.chave, "estoqueAtual", v)}
          />
          <CampoNumero
            name={`__estoqueMinimo_${linha.chave}`}
            placeholder="Estoque mínimo"
            value={linha.estoqueMinimo}
            onChange={(v) => atualizar(linha.chave, "estoqueMinimo", v)}
          />
          <CampoNumero
            name={`__perdaFixaPadrao_${linha.chave}`}
            placeholder={
              <>
                Perda fixa de calibragem
                <CampoAjuda texto="Quanto desta variante se perde toda vez que a máquina é calibrada pra começar a imprimir — um valor FIXO que não muda com a quantidade do pedido. Deixe em branco se não quiser controlar essa perda automaticamente no estoque." />
              </>
            }
            value={linha.perdaFixaPadrao}
            onChange={(v) => atualizar(linha.chave, "perdaFixaPadrao", v)}
          />
          <button
            type="button"
            onClick={() => remover(linha.chave)}
            className="rounded-lg px-2 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50"
          >
            Remover
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={adicionar}
        className="self-start text-xs font-medium text-teal-700 hover:underline dark:text-teal-400"
      >
        + Adicionar variante
      </button>
    </div>
  );
}

// memo() só ajuda de verdade porque onToggle/onMudarPreco são estáveis
// (useCallback com deps vazias, ver componente pai) — sem isso, toda
// digitação na busca recriaria as duas funções e invalidaria o memo de
// qualquer forma. Item recebe o id e chama onMudarPreco(item.id, valor)
// aqui dentro, em vez do pai currying uma closure nova por item a cada
// render (isso sim quebraria o memo, mesmo com useCallback no pai).
const ItemLinha = memo(function ItemLinha({
  item,
  selecionado,
  onToggle,
  selecaoInicial,
  valorPreco,
  onMudarPreco,
  temPendencia,
  temPrecoDesatualizado,
}: {
  item: ItemCatalogo;
  selecionado: boolean;
  onToggle: (id: string) => void;
  selecaoInicial?: Selecao;
  valorPreco: string;
  onMudarPreco: (id: string, valor: string) => void;
  temPendencia: boolean;
  temPrecoDesatualizado: boolean;
}) {
  // Matéria-prima com variantes (ex: espessura de chapa) não usa mais preço/
  // estoque no nível do item — isso mora nas variantes, geridas numa tela
  // própria. "Papéis" é tratado à parte (gramatura, não variante genérica).
  const temVariantes =
    item.tipo === "MATERIA_PRIMA" &&
    item.categoria !== "Papéis" &&
    (selecaoInicial?.variantes.length ?? 0) > 0;

  // Matéria-prima já mostra precoCompra como campo essencial (fora do "+ mais
  // detalhes"), então só estoque conta como detalhe extra pra decidir se
  // começa expandido; produto/serviço conta o custo também.
  const temDetalhesPreenchidos = Boolean(
    item.tipo === "MATERIA_PRIMA"
      ? selecaoInicial?.estoqueAtual || selecaoInicial?.estoqueMinimo
      : selecaoInicial?.precoCompra
  );
  const [expandido, setExpandido] = useState(temDetalhesPreenchidos);

  // Item ainda não salvo (sem selecaoInicial.id) pode cadastrar variantes
  // (ex: espessura) direto aqui, sem precisar salvar o catálogo primeiro pra
  // só depois abrir "Gerenciar variantes" — tudo vai junto no mesmo salvar.
  const podeVariarInline =
    item.tipo === "MATERIA_PRIMA" && item.categoria !== "Papéis" && !selecaoInicial?.id;
  const [usarVariantesNovas, setUsarVariantesNovas] = useState(false);
  const [variantesNovas, setVariantesNovas] = useState<LinhaVarianteNova[]>(() => [
    {
      chave: gerarChave(),
      rotulo: "",
      precoCompra: "",
      estoqueAtual: "",
      estoqueMinimo: "",
      perdaFixaPadrao: "",
    },
  ]);

  const mudarPreco = (valor: string) => onMudarPreco(item.id, valor);

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
            {rotuloUnidade(item.unidade, item.unidadeOutro)}
          </span>
        )}
        {temPendencia && (
          <span
            title="Configuração incompleta — este produto ainda não pode ser usado num orçamento"
            className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300"
          >
            <AlertTriangleIcon className="h-3 w-3" />
            Pendência
          </span>
        )}
        {temPrecoDesatualizado && (
          <span
            title="O preço de compra desta matéria-prima não muda há um bom tempo — vale conferir se ainda reflete o mercado (ajuste o limiar em Configurações)"
            className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300"
          >
            <AlertTriangleIcon className="h-3 w-3" />
            Preço desatualizado
          </span>
        )}
      </label>

      {selecionado && (
        <div className="flex flex-1 flex-wrap items-center gap-3 pl-7 sm:pl-0">
          {(item.tipo === "PRODUTO" || item.tipo === "SERVICO") && (
            <CampoNumero
              name={`venda_${item.id}`}
              placeholder="Preço de venda"
              value={valorPreco}
              onChange={mudarPreco}
              prefixo="R$"
            />
          )}

          {item.tipo === "MATERIA_PRIMA" && usarVariantesNovas ? (
            <div className="flex w-full flex-col gap-2">
              <VariantesInlineEditor
                itemId={item.id}
                linhas={variantesNovas}
                onChange={setVariantesNovas}
              />
              <button
                type="button"
                onClick={() => setUsarVariantesNovas(false)}
                className="self-start text-xs font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              >
                ← Usar preço único em vez de variantes
              </button>
            </div>
          ) : (
            <>
              {item.tipo === "MATERIA_PRIMA" && !temVariantes && (
                <CampoNumero
                  name={`compra_${item.id}`}
                  placeholder="Preço de compra"
                  value={valorPreco}
                  onChange={mudarPreco}
                  prefixo="R$"
                />
              )}
              {podeVariarInline && (
                <button
                  type="button"
                  onClick={() => setUsarVariantesNovas(true)}
                  className="self-center text-xs font-medium text-teal-700 hover:underline dark:text-teal-400"
                >
                  ou cadastre por variante (ex: espessura) →
                </button>
              )}
              {temVariantes && (
                <span className="text-xs text-slate-500">
                  {selecaoInicial!.variantes.length} variante
                  {selecaoInicial!.variantes.length > 1 ? "s" : ""} (
                  {selecaoInicial!.variantes.join(", ")})
                </span>
              )}

              {expandido || temVariantes ? (
                <>
                  {(item.tipo === "PRODUTO" || item.tipo === "SERVICO") && (
                    <CampoNumero
                      name={`compra_${item.id}`}
                      placeholder="Custo (opcional)"
                      defaultValue={selecaoInicial?.precoCompra}
                      prefixo="R$"
                    />
                  )}
                  {item.tipo === "MATERIA_PRIMA" && !temVariantes && (
                    <>
                      {/* Valor de estoqueAtual que a TELA leu quando carregou —
                          viaja junto pra a action conseguir comparar (compare-and-
                          -swap) antes de sobrescrever: se uma baixa de produção
                          mudou o estoque enquanto esta aba ficava aberta, esse
                          valor aqui não bate mais com o banco no momento de
                          salvar, e a action pula esse campo específico em vez de
                          apagar a baixa que aconteceu no meio-tempo. */}
                      <input
                        type="hidden"
                        name={`estoqueAtualOriginal_${item.id}`}
                        value={selecaoInicial?.estoqueAtual ?? ""}
                      />
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
                      <CampoNumero
                        name={`perdaFixaPadrao_${item.id}`}
                        placeholder={
                          <>
                            Perda fixa de calibragem
                            <CampoAjuda texto="Quanto desse material é perdido toda vez que a máquina é calibrada pra começar a imprimir — um valor FIXO que não muda com a quantidade do pedido. Deixe em branco se não quiser controlar essa perda automaticamente no estoque." />
                          </>
                        }
                        defaultValue={selecaoInicial?.perdaFixaPadrao}
                      />
                    </>
                  )}
                  {selecaoInicial?.id ? (
                    <Link
                      href={`/catalogo/${selecaoInicial.id}`}
                      className="flex items-center gap-1.5 self-center text-xs font-medium text-teal-700 hover:underline dark:text-teal-400"
                    >
                      <SlidersIcon className="h-3.5 w-3.5" />
                      {item.tipo === "MATERIA_PRIMA"
                        ? item.categoria === "Papéis"
                          ? "Gramaturas e preço/kg"
                          : "Gerenciar variantes"
                        : "Configuração avançada"}
                    </Link>
                  ) : !podeVariarInline ? (
                    <span className="self-center text-xs text-slate-400">
                      Salve o catálogo para configurar em detalhe
                    </span>
                  ) : null}
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
            </>
          )}
        </div>
      )}
    </div>
  );
});

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
  // Controlado só pra decidir se mostra o campo de texto livre — o valor em
  // si continua indo pro FormData normalmente via o próprio <select name>.
  const [unidade, setUnidade] = useState("UNIDADE");

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
          <>
            <Select
              label="Unidade de medida"
              name="unidade"
              value={unidade}
              onChange={(e) => setUnidade(e.target.value)}
              hint="Base usada para comprar/cobrar esse item — igual aos itens já existentes."
            >
              {Object.entries(ROTULO_UNIDADE).map(([valor, rotulo]) => (
                <option key={valor} value={valor}>
                  {rotulo}
                </option>
              ))}
            </Select>
            {unidade === "OUTRO" && (
              <Input
                label="Qual unidade?"
                name="unidadeOutro"
                placeholder="ex: resma, galão, fardo"
                maxLength={40}
                required
              />
            )}
          </>
        )}

        {tipo === "PRODUTO" && (
          <>
            <Input
              label="NCM (opcional)"
              name="ncm"
              placeholder="ex: 49111090"
              hint="Classificação fiscal — só necessária se for emitir nota fiscal desse produto depois."
            />
            <Select
              label={
                <>
                  Origem da mercadoria
                  <CampoAjuda texto="De onde vem o material — nacional ou importado. Só necessária se for emitir nota fiscal desse produto depois; dá pra deixar Nacional e ajustar mais tarde na página do produto." />
                </>
              }
              name="origemMercadoria"
              defaultValue="NACIONAL_0"
            >
              {ORIGEM_MERCADORIA_VALORES.map((valor) => (
                <option key={valor} value={valor}>
                  {ROTULO_ORIGEM_MERCADORIA[valor]}
                </option>
              ))}
            </Select>
          </>
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
  itemGraficaIdsComPendencia,
  itemGraficaIdsComPrecoDesatualizado,
}: {
  itensCatalogo: ItemCatalogo[];
  selecoes: Record<string, Selecao>;
  itemGraficaIdsComPendencia: string[];
  // Ids de ItemGrafica (Selecao.id, não ItemCatalogo.id — ver
  // listarInsumosComPrecoDesatualizado) — achado A1-Parte6 da auditoria de
  // abrangência (2026-08-24).
  itemGraficaIdsComPrecoDesatualizado: string[];
}) {
  const idsComPendencia = useMemo(
    () => new Set(itemGraficaIdsComPendencia),
    [itemGraficaIdsComPendencia]
  );
  const idsComPrecoDesatualizado = useMemo(
    () => new Set(itemGraficaIdsComPrecoDesatualizado),
    [itemGraficaIdsComPrecoDesatualizado]
  );
  const [abaAtiva, setAbaAtiva] = useState<Tipo>("PRODUTO");
  const [busca, setBusca] = useState("");
  const [mostrarNovoItem, setMostrarNovoItem] = useState(false);
  const [selecionados, setSelecionados] = useState<Set<string>>(
    () => new Set(Object.entries(selecoes).filter(([, s]) => s.ativo).map(([id]) => id))
  );
  // Campo de preço principal (venda pra PRODUTO/SERVICO, compra pra
  // MATERIA_PRIMA) controlado — é o que "aplicar a todos" preenche em lote.
  // Os demais campos (custo extra, estoque) continuam não controlados.
  const [precosPrincipais, setPrecosPrincipais] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      itensCatalogo.map((item) => [
        item.id,
        item.tipo === "MATERIA_PRIMA"
          ? (selecoes[item.id]?.precoCompra ?? "")
          : (selecoes[item.id]?.precoVenda ?? ""),
      ])
    )
  );
  const [state, formAction, isPending] = useActionState(salvarCatalogo, null);

  // useCallback (deps vazias) — as duas só usam a forma funcional do
  // setState, então não fecham sobre nenhum valor que mude entre renders.
  // Referência estável é o que permite o memo() de ItemLinha funcionar de
  // verdade (ver comentário lá).
  const toggle = useCallback((id: string) => {
    setSelecionados((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }, []);

  const definirPreco = useCallback((id: string, valor: string) => {
    setPrecosPrincipais((atual) => ({ ...atual, [id]: valor }));
  }, []);

  // "Marcar todos" de uma categoria: se já está tudo marcado, desmarca tudo;
  // senão (nada ou só parte), marca tudo — mesmo comportamento de qualquer
  // checkbox "selecionar tudo".
  const alternarCategoria = (itensDaCategoria: ItemCatalogo[]) => {
    const ids = itensDaCategoria.map((i) => i.id);
    const todosSelecionados = ids.every((id) => selecionados.has(id));
    setSelecionados((atual) => {
      const novo = new Set(atual);
      for (const id of ids) {
        if (todosSelecionados) novo.delete(id);
        else novo.add(id);
      }
      return novo;
    });
  };

  // "Marcar todos" da aba inteira, respeitando o filtro de busca ativo — só
  // afeta o que está visível no momento.
  const alternarTodosVisiveis = (itensVisiveis: ItemCatalogo[]) => {
    const ids = itensVisiveis.map((i) => i.id);
    const todosSelecionados = ids.length > 0 && ids.every((id) => selecionados.has(id));
    setSelecionados((atual) => {
      const novo = new Set(atual);
      for (const id of ids) {
        if (todosSelecionados) novo.delete(id);
        else novo.add(id);
      }
      return novo;
    });
  };

  // Preenche o preço só nos itens selecionados da categoria que AINDA estão
  // vazios — nunca sobrescreve o que a pessoa já digitou individualmente.
  const aplicarPrecoLote = (itensDaCategoria: ItemCatalogo[], valor: string) => {
    setPrecosPrincipais((atual) => {
      const novo = { ...atual };
      for (const item of itensDaCategoria) {
        if (selecionados.has(item.id) && !novo[item.id]) {
          novo[item.id] = valor;
        }
      }
      return novo;
    });
  };

  // O input em si fica preso em `busca` (digitação sempre instantânea);
  // só o que depende do filtro (buscaNormalizada pra baixo — recalcula
  // "corresponde" pra cada item do catálogo inteiro a cada tecla) usa o
  // valor adiado, pra não travar a digitação num catálogo grande.
  const buscaAdiada = useDeferredValue(busca);
  const buscaNormalizada = buscaAdiada.trim().toLowerCase();

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

  // Itens da aba ativa que passam no filtro de busca — usado pelo botão
  // "Marcar todos" perto da busca, que só deve afetar o que está visível.
  const itensVisiveisAbaAtiva = useMemo(() => {
    return itensCatalogo.filter(
      (i) =>
        i.tipo === abaAtiva &&
        (!buscaNormalizada ||
          i.nome.toLowerCase().includes(buscaNormalizada) ||
          i.categoria.toLowerCase().includes(buscaNormalizada))
    );
  }, [itensCatalogo, abaAtiva, buscaNormalizada]);

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
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1">
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
        <Button
          type="button"
          variant="outline"
          onClick={() => alternarTodosVisiveis(itensVisiveisAbaAtiva)}
        >
          {itensVisiveisAbaAtiva.length > 0 &&
          itensVisiveisAbaAtiva.every((i) => selecionados.has(i.id))
            ? "Desmarcar todos"
            : "Marcar todos"}
        </Button>
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
                  <summary className="flex cursor-pointer list-none items-center gap-3 py-4 text-sm font-semibold text-slate-900 marker:content-none dark:text-white">
                    <CheckboxSelecionarTudo
                      todosSelecionados={itens.every((i) => selecionados.has(i.id))}
                      algunsSelecionados={itens.some((i) => selecionados.has(i.id))}
                      onToggle={() => alternarCategoria(itens)}
                    />
                    <span>
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
                    </span>
                  </summary>
                  <div className="pb-2">
                    {temSelecionado && (
                      <AplicarPrecoLote
                        tipo={tipo}
                        onAplicar={(valor) => aplicarPrecoLote(itens, valor)}
                      />
                    )}
                    {itens.map((item) => (
                      <div key={item.id} hidden={buscaNormalizada.length > 0 && !corresponde(item)}>
                        <ItemLinha
                          item={item}
                          selecionado={selecionados.has(item.id)}
                          onToggle={toggle}
                          selecaoInicial={selecoes[item.id]}
                          valorPreco={precosPrincipais[item.id] ?? ""}
                          onMudarPreco={definirPreco}
                          temPendencia={Boolean(
                            selecoes[item.id]?.id && idsComPendencia.has(selecoes[item.id].id)
                          )}
                          temPrecoDesatualizado={Boolean(
                            selecoes[item.id]?.id && idsComPrecoDesatualizado.has(selecoes[item.id].id)
                          )}
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
