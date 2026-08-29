"use client";

import { useActionState, useMemo, useState } from "react";
import { calcularPreco } from "@/lib/orcamento";
import { formatoMoeda } from "@/lib/moeda";
import { gerarChave } from "@/lib/chave-local";
import {
  converterParaCm,
  ROTULO_UNIDADE_DIMENSAO,
  type UnidadeDimensao,
} from "@/lib/unidade-dimensao";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { ReceiptIcon, RulerIcon, SparklesIcon } from "@/components/icons";
import { criarOrcamento, precificarItem, buscarCondicoesComerciaisCliente } from "./actions";
import {
  SeletorItemOrcamento,
  camposIniciais,
  type ItemVenda,
  type CamposItemOrcamento,
  type ItemAcabamentoDisponivel,
} from "./SeletorItemOrcamento";
import type { CamposEtiqueta } from "./CamposEtiquetaOrcamento";
import type { CamposPrecificacaoEtiqueta, PapelDisponivel } from "./CamposPrecificacaoEtiquetaOrcamento";

const OPCOES_TIPO_PEDIDO: [string, string][] = [
  ["MODELO_NOVO", "Modelo novo"],
  ["REPETICAO_SEM_ALTERACAO", "Repetição sem alteração"],
  ["REPETICAO_COM_ALTERACAO", "Repetição com alteração"],
];
const OPCOES_FRETE: [string, string][] = [
  ["SEM_FRETE", "Retirada no balcão / sem frete"],
  ["CIF_REMETENTE", "Por conta do emitente (CIF)"],
  ["FOB_DESTINATARIO", "Por conta do destinatário (FOB)"],
  ["TERCEIROS", "Por conta de terceiros"],
  ["PROPRIO_REMETENTE", "Transporte próprio do remetente"],
  ["PROPRIO_DESTINATARIO", "Transporte próprio do destinatário"],
];

type DadosGerais = {
  vendedor: string;
  tipoPedido: string;
  contatoNome: string;
  contatoEmail: string;
  condicoesPagamento: string;
  frete: string;
  transportadora: string;
  localEntrega: string;
  observacoes: string;
};

function dadosGeraisIniciais(): DadosGerais {
  return {
    vendedor: "",
    tipoPedido: "",
    contatoNome: "",
    contatoEmail: "",
    condicoesPagamento: "",
    frete: "",
    transportadora: "",
    localEntrega: "",
    observacoes: "",
  };
}

// Converte os campos de etiqueta (todos string, controlados por input/select)
// pro shape que etiquetaEntradaSchema (src/app/orcamento/actions.ts) espera
// — números/enum/null em vez de string vazia. A validação de verdade
// acontece no servidor (zod); isso aqui só evita mandar "" onde o schema
// espera number|null.
function etiquetaParaEntrada(etiqueta: CamposEtiqueta) {
  const numeroOuNulo = (v: string) => (v.trim() === "" ? null : Number(v));
  const textoOuNulo = (v: string) => (v.trim() === "" ? null : v.trim());
  const enumOuNulo = (v: string) => (v === "" ? null : v);
  return {
    materialSubstrato: enumOuNulo(etiqueta.materialSubstrato),
    materialSubstratoOutro: textoOuNulo(etiqueta.materialSubstratoOutro),
    tipoAdesivo: enumOuNulo(etiqueta.tipoAdesivo),
    tipoAdesivoOutro: textoOuNulo(etiqueta.tipoAdesivoOutro),
    superficieAplicacao: enumOuNulo(etiqueta.superficieAplicacao),
    superficieAplicacaoOutro: textoOuNulo(etiqueta.superficieAplicacaoOutro),
    formatoEtiqueta: textoOuNulo(etiqueta.formatoEtiqueta),
    coresRotulo: numeroOuNulo(etiqueta.coresRotulo),
    coresContraRotulo: numeroOuNulo(etiqueta.coresContraRotulo),
    embalagemQtdPorRolo: numeroOuNulo(etiqueta.embalagemQtdPorRolo),
    tubeteMedida: textoOuNulo(etiqueta.tubeteMedida),
    rotulagem: enumOuNulo(etiqueta.rotulagem),
    serrilha: enumOuNulo(etiqueta.serrilha),
    serrilhaOutro: textoOuNulo(etiqueta.serrilhaOutro),
    vernizRotuloTotal: etiqueta.vernizRotuloTotal,
    vernizRotuloReserva: etiqueta.vernizRotuloReserva,
    vernizRotuloTipo: enumOuNulo(etiqueta.vernizRotuloTipo),
    vernizRotuloTipoOutro: textoOuNulo(etiqueta.vernizRotuloTipoOutro),
    vernizContraRotuloTotal: etiqueta.vernizContraRotuloTotal,
    vernizContraRotuloReserva: etiqueta.vernizContraRotuloReserva,
    vernizContraRotuloTipo: enumOuNulo(etiqueta.vernizContraRotuloTipo),
    vernizContraRotuloTipoOutro: textoOuNulo(etiqueta.vernizContraRotuloTipoOutro),
    laminacaoRotulo: enumOuNulo(etiqueta.laminacaoRotulo),
    laminacaoRotuloOutro: textoOuNulo(etiqueta.laminacaoRotuloOutro),
    laminacaoContraRotulo: enumOuNulo(etiqueta.laminacaoContraRotulo),
    laminacaoContraRotuloOutro: textoOuNulo(etiqueta.laminacaoContraRotuloOutro),
    rebobinamento: numeroOuNulo(etiqueta.rebobinamento),
    hotStampings: etiqueta.hotStampings.map((h) => ({
      lado: h.lado,
      tipo: h.tipo,
      tipoOutro: textoOuNulo(h.tipoOutro),
      medida: textoOuNulo(h.medida),
      cor: textoOuNulo(h.cor),
    })),
  };
}

type Cliente = {
  id: string;
  nome: string;
};

type Filial = {
  id: string;
  nome: string;
};

type ItemCarrinho = {
  chave: string;
  itemGraficaId: string;
  nome: string;
  categoria: string;
  quantidade: number;
  // Valor DIGITADO na unidade `unidadeDimensao` abaixo — NÃO necessariamente
  // centímetro (mesma convenção de CamposItemOrcamento.largura/altura). O
  // servidor (precificarItem, criarOrcamento) converte pra cm de novo; isto
  // aqui só existe pra reexibir a medida do jeito que foi digitada.
  largura: number | null;
  altura: number | null;
  unidadeDimensao: CamposItemOrcamento["unidadeDimensao"];
  corFrente: number | null;
  corVerso: number | null;
  numeroCoresFlexo: number | null;
  numeroCliques: number | null;
  numeroSetups: number | null;
  horasEstimadas: number | null;
  custoAquisicaoUnitario: number | null;
  materialFornecidoPeloCliente: boolean;
  cores: string | null;
  acabamento: string | null;
  descricaoLivre: string | null;
  acabamentoIds: string[];
  precoUnitario: string;
  precoTotal: string;
  modeloCalculo:
    | "SIMPLES"
    | "M2"
    | "OFFSET"
    | "FLEXOGRAFIA"
    | "DIGITAL"
    | "SERIGRAFIA"
    | "SUBLIMACAO"
    | "ESTAMPAGEM_QUENTE"
    | "PERSONALIZACAO"
    | "REVENDA";
  etiqueta: CamposEtiqueta;
  precificacaoEtiqueta: CamposPrecificacaoEtiqueta;
};

export function CalculadoraForm({
  itens,
  acabamentosDisponiveis,
  papeisDisponiveis,
  clientes,
  filiais,
  unidadePadrao,
}: {
  itens: ItemVenda[];
  acabamentosDisponiveis: ItemAcabamentoDisponivel[];
  papeisDisponiveis: PapelDisponivel[];
  clientes: Cliente[];
  filiais: Filial[];
  // Grafica.unidadePadraoDimensao — o formulário de item nasce nessa unidade
  // (mesmo contrato de AdicionarItemForm.tsx). Sem isto o seletor sempre
  // começaria em cm e a configuração da gráfica não valeria de nada
  // justamente no fluxo principal de montar orçamento.
  unidadePadrao: UnidadeDimensao;
}) {
  const [clienteId, setClienteId] = useState("");
  const [filialId, setFilialId] = useState("");
  const [campos, setCampos] = useState<CamposItemOrcamento>(() =>
    camposIniciais(itens, unidadePadrao)
  );
  const [itensCarrinho, setItensCarrinho] = useState<ItemCarrinho[]>([]);
  const [adicionando, setAdicionando] = useState(false);
  const [erroAdicionar, setErroAdicionar] = useState<string | null>(null);
  const [dadosGerais, setDadosGerais] = useState<DadosGerais>(dadosGeraisIniciais);
  const [mostrarDadosGerais, setMostrarDadosGerais] = useState(false);
  const [state, formAction, isPending] = useActionState(criarOrcamento, null);

  const setDadoGeral = (campo: keyof DadosGerais) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setDadosGerais((atual) => ({ ...atual, [campo]: e.target.value }));

  // Achado A6 da Parte 5 da auditoria de abrangência — ao selecionar um
  // cliente, busca (via RPC escopada, ver buscarCondicoesComerciaisCliente)
  // a condição de pagamento sugerida a partir do cadastro dele
  // (prazoPagamentoPadraoDias/formaPagamentoPreferida) e pré-preenche o
  // campo abaixo. Checa "está vazio" só quando a resposta chega (não antes)
  // pra nunca sobrescrever o que o vendedor já tiver digitado nesse meio
  // tempo — é só um atalho de preenchimento, nunca autoritativo.
  function selecionarCliente(novoClienteId: string) {
    setClienteId(novoClienteId);
    if (!novoClienteId) return;
    buscarCondicoesComerciaisCliente(novoClienteId).then((sugestao) => {
      if (!sugestao.condicoesPagamento) return;
      setDadosGerais((atual) =>
        atual.condicoesPagamento.trim() === ""
          ? { ...atual, condicoesPagamento: sugestao.condicoesPagamento! }
          : atual
      );
    });
  }

  const itemSelecionado = itens.find((i) => i.id === campos.itemGraficaId);
  const usaMotorAvancado =
    itemSelecionado?.modeloCalculo === "M2" ||
    itemSelecionado?.modeloCalculo === "OFFSET" ||
    itemSelecionado?.modeloCalculo === "FLEXOGRAFIA" ||
    itemSelecionado?.modeloCalculo === "DIGITAL" ||
    itemSelecionado?.modeloCalculo === "SERIGRAFIA" ||
    itemSelecionado?.modeloCalculo === "SUBLIMACAO" ||
    itemSelecionado?.modeloCalculo === "ESTAMPAGEM_QUENTE" ||
    itemSelecionado?.modeloCalculo === "PERSONALIZACAO" ||
    // Revenda/terceirização (achado A12) — sem nesting, mas SEMPRE motor
    // avançado: custoBase precisa passar por comporPreco (overhead/margem/
    // piso), nunca o preview client-side de SIMPLES abaixo.
    itemSelecionado?.modeloCalculo === "REVENDA";

  // Prévia instantânea, sem round-trip, só pra itens SIMPLES (matemática pura,
  // igual a src/lib/orcamento.ts). M2/Offset só têm preço real depois de
  // "Adicionar item" — o motor avançado (bobina/folha) só roda no servidor.
  const previewSimples = useMemo(() => {
    if (!itemSelecionado || usaMotorAvancado) return null;
    const quantidade = Number(campos.quantidade);
    // calcularPreco (src/lib/orcamento.ts) só entende centímetro — converte
    // aqui o valor digitado (que pode estar em mm/cm/m) antes de chamar.
    return calcularPreco({
      precoBase: Number(itemSelecionado.precoVenda),
      quantidade: quantidade || 0,
      larguraCm: campos.largura
        ? converterParaCm(Number(campos.largura), campos.unidadeDimensao)
        : null,
      alturaCm: campos.altura
        ? converterParaCm(Number(campos.altura), campos.unidadeDimensao)
        : null,
    });
  }, [
    itemSelecionado,
    usaMotorAvancado,
    campos.quantidade,
    campos.largura,
    campos.altura,
    campos.unidadeDimensao,
  ]);

  const totalCarrinho = itensCarrinho.reduce((soma, i) => soma + Number(i.precoTotal), 0);

  async function adicionarAoCarrinho() {
    setErroAdicionar(null);
    const quantidade = Number(campos.quantidade);
    if (!campos.itemGraficaId || !quantidade || quantidade <= 0) {
      setErroAdicionar("Escolha um produto e uma quantidade válida.");
      return;
    }

    // Valor DIGITADO, na unidade escolhida — NUNCA cm direto. precificarItem
    // converte pra cm no servidor (nunca confia no que vier do cliente).
    const largura = campos.largura ? Number(campos.largura) : null;
    const altura = campos.altura ? Number(campos.altura) : null;
    const corFrente = campos.corFrente !== "" ? Number(campos.corFrente) : null;
    const corVerso = campos.corVerso !== "" ? Number(campos.corVerso) : null;
    const numeroCoresFlexo =
      campos.numeroCoresFlexo !== "" ? Number(campos.numeroCoresFlexo) : null;
    const numeroCliques = campos.numeroCliques !== "" ? Number(campos.numeroCliques) : null;
    const numeroSetups = campos.numeroSetups !== "" ? Number(campos.numeroSetups) : null;
    const horasEstimadas = campos.horasEstimadas !== "" ? Number(campos.horasEstimadas) : null;
    const custoAquisicaoUnitario =
      campos.custoAquisicaoUnitario !== "" ? Number(campos.custoAquisicaoUnitario) : null;
    const materialFornecidoPeloCliente = campos.materialFornecidoPeloCliente;
    const papelId = campos.precificacaoEtiqueta.papelId || null;
    const quantidadeCores =
      campos.precificacaoEtiqueta.quantidadeCores !== ""
        ? Number(campos.precificacaoEtiqueta.quantidadeCores)
        : null;
    const custoFaca =
      campos.precificacaoEtiqueta.custoFaca !== ""
        ? Number(campos.precificacaoEtiqueta.custoFaca)
        : null;
    const custoFrete =
      campos.precificacaoEtiqueta.custoFrete !== ""
        ? Number(campos.precificacaoEtiqueta.custoFrete)
        : null;

    setAdicionando(true);
    const resultado = await precificarItem({
      itemGraficaId: campos.itemGraficaId,
      quantidade,
      largura,
      altura,
      unidadeDimensao: campos.unidadeDimensao,
      corFrente,
      corVerso,
      numeroCoresFlexo,
      numeroCliques,
      numeroSetups,
      horasEstimadas,
      acabamentoIds: campos.acabamentoIds,
      papelId,
      quantidadeCores,
      custoFaca,
      custoFrete,
      custoAquisicaoUnitario,
      materialFornecidoPeloCliente,
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
        largura,
        altura,
        unidadeDimensao: campos.unidadeDimensao,
        corFrente,
        corVerso,
        numeroCoresFlexo,
        numeroCliques,
        numeroSetups,
        horasEstimadas,
        custoAquisicaoUnitario,
        materialFornecidoPeloCliente,
        cores: campos.cores.trim() || null,
        acabamento: campos.acabamento.trim() || null,
        descricaoLivre: campos.descricaoLivre.trim() || null,
        acabamentoIds: campos.acabamentoIds,
        precoUnitario: resultado.precoUnitario,
        precoTotal: resultado.precoTotal,
        modeloCalculo: resultado.modeloCalculo,
        etiqueta: campos.etiqueta,
        precificacaoEtiqueta: campos.precificacaoEtiqueta,
      },
    ]);
    setCampos(camposIniciais(itens, unidadePadrao));
  }

  function removerDoCarrinho(chave: string) {
    setItensCarrinho((atual) => atual.filter((i) => i.chave !== chave));
  }

  const itensJson = JSON.stringify(
    itensCarrinho.map((i) => ({
      itemGraficaId: i.itemGraficaId,
      quantidade: i.quantidade,
      largura: i.largura,
      altura: i.altura,
      unidadeDimensao: i.unidadeDimensao,
      corFrente: i.corFrente,
      corVerso: i.corVerso,
      numeroCoresFlexo: i.numeroCoresFlexo,
      numeroCliques: i.numeroCliques,
      numeroSetups: i.numeroSetups,
      horasEstimadas: i.horasEstimadas,
      custoAquisicaoUnitario: i.custoAquisicaoUnitario,
      materialFornecidoPeloCliente: i.materialFornecidoPeloCliente,
      cores: i.cores,
      acabamento: i.acabamento,
      descricaoLivre: i.descricaoLivre,
      acabamentoIds: i.acabamentoIds,
      etiqueta: etiquetaParaEntrada(i.etiqueta),
      papelId: i.precificacaoEtiqueta.papelId || null,
      quantidadeCores:
        i.precificacaoEtiqueta.quantidadeCores !== ""
          ? Number(i.precificacaoEtiqueta.quantidadeCores)
          : null,
      custoFaca:
        i.precificacaoEtiqueta.custoFaca !== "" ? Number(i.precificacaoEtiqueta.custoFaca) : null,
      custoFrete:
        i.precificacaoEtiqueta.custoFrete !== ""
          ? Number(i.precificacaoEtiqueta.custoFrete)
          : null,
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
            onChange={(e) => selecionarCliente(e.target.value)}
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

          {filiais.length > 0 && (
            <Select
              label="Filial"
              value={filialId}
              onChange={(e) => setFilialId(e.target.value)}
            >
              <option value="">Sem filial específica</option>
              {filiais.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome}
                </option>
              ))}
            </Select>
          )}

          {!mostrarDadosGerais ? (
            <button
              type="button"
              onClick={() => setMostrarDadosGerais(true)}
              className="self-start text-xs font-medium text-teal-700 hover:underline dark:text-teal-400"
            >
              + vendedor, frete, condições de pagamento e mais
            </button>
          ) : (
            <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-800/30">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input label="Vendedor" value={dadosGerais.vendedor} onChange={setDadoGeral("vendedor")} />
                <Select label="Tipo de pedido" value={dadosGerais.tipoPedido} onChange={setDadoGeral("tipoPedido")}>
                  <option value="">não informado</option>
                  {OPCOES_TIPO_PEDIDO.map(([v, rotulo]) => (
                    <option key={v} value={v}>
                      {rotulo}
                    </option>
                  ))}
                </Select>
                <Input
                  label="Contato do pedido"
                  value={dadosGerais.contatoNome}
                  onChange={setDadoGeral("contatoNome")}
                  hint="Pessoa de contato deste pedido, se diferente do cadastro do cliente"
                />
                <Input
                  label="E-mail de contato"
                  type="email"
                  value={dadosGerais.contatoEmail}
                  onChange={setDadoGeral("contatoEmail")}
                />
                <Input
                  label="Condições de pagamento"
                  value={dadosGerais.condicoesPagamento}
                  onChange={setDadoGeral("condicoesPagamento")}
                  placeholder="ex: 28/35ddl"
                />
                <Select label="Frete" value={dadosGerais.frete} onChange={setDadoGeral("frete")}>
                  <option value="">não informado</option>
                  {OPCOES_FRETE.map(([v, rotulo]) => (
                    <option key={v} value={v}>
                      {rotulo}
                    </option>
                  ))}
                </Select>
                <Input
                  label="Transportadora"
                  value={dadosGerais.transportadora}
                  onChange={setDadoGeral("transportadora")}
                />
                <Input
                  label="Local de entrega"
                  value={dadosGerais.localEntrega}
                  onChange={setDadoGeral("localEntrega")}
                />
              </div>
              <Textarea
                label="Observações internas"
                value={dadosGerais.observacoes}
                onChange={setDadoGeral("observacoes")}
                hint="Só aparece pra sua gráfica — nunca no PDF nem no link do cliente."
              />
            </div>
          )}

          <div className="border-t border-slate-100 pt-5 dark:border-slate-800">
            <SeletorItemOrcamento
              itens={itens}
              acabamentosDisponiveis={acabamentosDisponiveis}
              papeisDisponiveis={papeisDisponiveis}
              valores={campos}
              onChange={setCampos}
            />

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
                        {item.largura && item.altura
                          ? ` · ${item.largura} × ${item.altura} ${ROTULO_UNIDADE_DIMENSAO[item.unidadeDimensao]}`
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
            <input type="hidden" name="filialId" value={filialId} />
            <input type="hidden" name="itensJson" value={itensJson} />
            <input type="hidden" name="vendedor" value={dadosGerais.vendedor} />
            <input type="hidden" name="tipoPedido" value={dadosGerais.tipoPedido} />
            <input type="hidden" name="contatoNome" value={dadosGerais.contatoNome} />
            <input type="hidden" name="contatoEmail" value={dadosGerais.contatoEmail} />
            <input type="hidden" name="condicoesPagamento" value={dadosGerais.condicoesPagamento} />
            <input type="hidden" name="frete" value={dadosGerais.frete} />
            <input type="hidden" name="transportadora" value={dadosGerais.transportadora} />
            <input type="hidden" name="localEntrega" value={dadosGerais.localEntrega} />
            <input type="hidden" name="observacoes" value={dadosGerais.observacoes} />

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
