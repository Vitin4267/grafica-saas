"use client";

import { useActionState, useEffect, useState } from "react";
import { formatoMoeda } from "@/lib/moeda";
import { gerarChave } from "@/lib/chave-local";
import type { UnidadeDimensao } from "@/lib/unidade-dimensao";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { adicionarOpcaoOrcamento } from "./opcoes.actions";
import { precificarItem } from "../actions";
import {
  SeletorItemOrcamento,
  camposIniciais,
  type ItemVenda,
  type CamposItemOrcamento,
  type ItemAcabamentoDisponivel,
} from "../SeletorItemOrcamento";
import type { CamposEtiqueta } from "../CamposEtiquetaOrcamento";
import type { PapelDisponivel } from "../CamposPrecificacaoEtiquetaOrcamento";

// Mesma conversão de CalculadoraForm.tsx (etiquetaParaEntrada) — duplicada de
// propósito (é um mapeamento puro de ~25 campos client→JSON, não vale a pena
// extrair só pra economizar isto aqui) em vez de importada, já que
// CalculadoraForm não exporta a função.
function etiquetaParaEntrada(etiqueta: CamposEtiqueta) {
  const numeroOuNulo = (v: string) => (v.trim() === "" ? null : Number(v));
  const textoOuNulo = (v: string) => (v.trim() === "" ? null : v.trim());
  const enumOuNulo = (v: string) => (v === "" ? null : v);
  return {
    materialSubstrato: enumOuNulo(etiqueta.materialSubstrato),
    materialSubstratoOutro: textoOuNulo(etiqueta.materialSubstratoOutro),
    tipoAdesivo: enumOuNulo(etiqueta.tipoAdesivo),
    tipoAdesivoOutro: textoOuNulo(etiqueta.tipoAdesivoOutro),
    durabilidadeAdesivo: textoOuNulo(etiqueta.durabilidadeAdesivo),
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

type ItemCarrinho = {
  chave: string;
  itemGraficaId: string;
  nome: string;
  quantidade: number;
  largura: number | null;
  altura: number | null;
  // Achado F7 — nunca passam por precificarItem (motor de preço), só
  // gravados direto no envio final.
  profundidade: number | null;
  espessuraMm: number | null;
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
  etiqueta: CamposEtiqueta;
  precificacaoEtiqueta: CamposItemOrcamento["precificacaoEtiqueta"];
};

// "Opção B/C" — monta um carrinho de itens do zero (igual à criação de um
// orçamento novo, ver CalculadoraForm.tsx) e manda tudo de uma vez pra
// adicionarOpcaoOrcamento. Sem cliente/filial/dados gerais aqui: isso já
// pertence ao orçamento-pai, uma opção alternativa é só "outro conjunto de
// itens com outro total".
export function AdicionarOpcaoForm({
  orcamentoId,
  itens,
  acabamentosDisponiveis,
  papeisDisponiveis,
  unidadePadrao,
  sugestaoNome,
  aoCancelar,
}: {
  orcamentoId: string;
  itens: ItemVenda[];
  acabamentosDisponiveis: ItemAcabamentoDisponivel[];
  papeisDisponiveis: PapelDisponivel[];
  unidadePadrao: UnidadeDimensao;
  // "Opção B" na primeira alternativa, "Opção C" na segunda — só um chute
  // inicial editável, nunca imposto (ver NOME_OPCAO_MAX em opcoes.actions.ts).
  sugestaoNome: string;
  aoCancelar: () => void;
}) {
  const [nome, setNome] = useState(sugestaoNome);
  const [campos, setCampos] = useState<CamposItemOrcamento>(() => camposIniciais(itens, unidadePadrao));
  const [itensCarrinho, setItensCarrinho] = useState<ItemCarrinho[]>([]);
  const [adicionando, setAdicionando] = useState(false);
  const [erroAdicionar, setErroAdicionar] = useState<string | null>(null);
  const [state, formAction, isPending] = useActionState(adicionarOpcaoOrcamento, null);

  // Sucesso fecha o form (revalidatePath já traz a opção nova na lista do
  // pai) — sem isso, o formulário continuava aberto e vazio depois de salvar,
  // parecendo que nada aconteceu. useEffect de propósito aqui (não
  // useAoMudar): aoCancelar muda o estado do componente PAI (OpcoesOrcamento),
  // não deste componente — chamar isso durante a renderização (o que
  // useAoMudar faz) violava a regra do React de nunca atualizar um
  // componente diferente enquanto outro está renderizando.
  useEffect(() => {
    if (state?.ok) aoCancelar();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só reage à MUDANÇA de state (sucesso), aoCancelar não deve disparar o efeito de novo
  }, [state]);

  const totalCarrinho = itensCarrinho.reduce((soma, i) => soma + Number(i.precoTotal), 0);

  async function adicionarAoCarrinho() {
    setErroAdicionar(null);
    const quantidade = Number(campos.quantidade);
    if (!campos.itemGraficaId || !quantidade || quantidade <= 0) {
      setErroAdicionar("Escolha um produto e uma quantidade válida.");
      return;
    }

    const largura = campos.largura ? Number(campos.largura) : null;
    const altura = campos.altura ? Number(campos.altura) : null;
    // Achado F7 — nunca vai pro motor de preço (precificarItem abaixo não
    // recebe estes campos), só entra no carrinho pra gravação direta.
    const profundidade = campos.profundidade ? Number(campos.profundidade) : null;
    const espessuraMm = campos.espessuraMm ? Number(campos.espessuraMm) : null;
    const corFrente = campos.corFrente !== "" ? Number(campos.corFrente) : null;
    const corVerso = campos.corVerso !== "" ? Number(campos.corVerso) : null;
    const numeroCoresFlexo = campos.numeroCoresFlexo !== "" ? Number(campos.numeroCoresFlexo) : null;
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
      campos.precificacaoEtiqueta.custoFaca !== "" ? Number(campos.precificacaoEtiqueta.custoFaca) : null;
    const custoFrete =
      campos.precificacaoEtiqueta.custoFrete !== "" ? Number(campos.precificacaoEtiqueta.custoFrete) : null;

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
        quantidade,
        largura,
        altura,
        profundidade,
        espessuraMm,
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
      profundidade: i.profundidade,
      espessuraMm: i.espessuraMm,
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
        i.precificacaoEtiqueta.quantidadeCores !== "" ? Number(i.precificacaoEtiqueta.quantidadeCores) : null,
      custoFaca: i.precificacaoEtiqueta.custoFaca !== "" ? Number(i.precificacaoEtiqueta.custoFaca) : null,
      custoFrete: i.precificacaoEtiqueta.custoFrete !== "" ? Number(i.precificacaoEtiqueta.custoFrete) : null,
    }))
  );

  return (
    <Card className="p-6">
      <h3 className="mb-4 text-sm font-semibold text-slate-900 dark:text-white">
        Nova opção alternativa
      </h3>
      <div className="flex flex-col gap-4">
        <Input
          label="Nome da opção"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder='ex: "Opção B", "Pacote Premium"'
          maxLength={60}
        />

        <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
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
            {adicionando ? "Calculando..." : "+ Adicionar item a esta opção"}
          </Button>
        </div>

        {itensCarrinho.length > 0 && (
          <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
            <div className="flex flex-col divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
              {itensCarrinho.map((item) => (
                <div key={item.chave} className="flex items-center justify-between gap-3 p-3">
                  <div>
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{item.nome}</p>
                    <p className="text-xs text-slate-500">Qtd: {item.quantidade}</p>
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
              <p className="text-sm font-medium text-teal-700 dark:text-teal-400">Total da opção</p>
              <p className="text-xl font-bold text-teal-800 dark:text-teal-300">
                {formatoMoeda.format(totalCarrinho)}
              </p>
            </div>
          </div>
        )}

        <form action={formAction} className="flex flex-col gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
          <input type="hidden" name="orcamentoId" value={orcamentoId} />
          <input type="hidden" name="nome" value={nome} />
          <input type="hidden" name="itensJson" value={itensJson} />

          {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}

          <div className="flex gap-3">
            <Button
              type="submit"
              loading={isPending}
              disabled={itensCarrinho.length === 0 || !nome.trim()}
            >
              Salvar opção
            </Button>
            <Button type="button" variant="ghost" onClick={aoCancelar}>
              Cancelar
            </Button>
          </div>
        </form>
      </div>
    </Card>
  );
}
