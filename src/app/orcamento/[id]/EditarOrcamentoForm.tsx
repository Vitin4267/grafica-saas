"use client";

import { useActionState, useState } from "react";
import { useAoMudar } from "@/lib/hooks/useAoMudar";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { ConfirmarExclusao } from "@/components/ui/ConfirmarExclusao";
import { CampoAjuda } from "@/components/ui/CampoAjuda";
import { CamposEtiquetaOrcamento, type CamposEtiqueta } from "../CamposEtiquetaOrcamento";
import type { ItemAcabamentoDisponivel } from "../SeletorItemOrcamento";
import type { PapelDisponivel } from "../CamposPrecificacaoEtiquetaOrcamento";
import {
  converterDeCm,
  converterParaCm,
  passoInputDimensao,
  ROTULO_UNIDADE_DIMENSAO,
  type UnidadeDimensao,
} from "@/lib/unidade-dimensao";
import { editarOrcamento, removerItemOrcamento } from "./actions";

// O banco guarda dimensão sempre em centímetro; a unidade é só entrada e
// exibição. Aqui o campo visível fica na unidade em que o item FOI CRIADO
// (OrcamentoItem.unidadeDimensao) e um campo escondido leva o valor já
// convertido pra cm — assim a action editarOrcamento continua recebendo
// centímetro puro, como sempre recebeu, sem precisar saber de unidade.
// Diferente de SeletorItemOrcamento, aqui não há troca de unidade: o item
// já existe e reabrir a edição tem que mostrar o número que a pessoa
// digitou lá atrás, não um valor reinterpretado.
function paraExibicao(valorCm: string, unidade: UnidadeDimensao): string {
  if (!valorCm) return "";
  const numero = Number(valorCm);
  if (!Number.isFinite(numero)) return "";
  return String(converterDeCm(numero, unidade));
}

function paraCm(valorExibido: string, unidade: UnidadeDimensao): string {
  if (!valorExibido) return "";
  const numero = Number(valorExibido);
  if (!Number.isFinite(numero)) return "";
  return String(converterParaCm(numero, unidade));
}

export function EditarOrcamentoForm({
  orcamentoId,
  orcamentoItemId,
  itemNome,
  modeloCalculo,
  usaClicheEtiqueta,
  simplesCobraPorArea,
  valoresIniciais,
  podeRemover,
  unidadeDimensao,
  acabamentosDisponiveis,
  papeisDisponiveis,
}: {
  orcamentoId: string;
  orcamentoItemId: string;
  itemNome: string;
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
    | "REVENDA"
    | "BORDADO"
    | "TEMPO_MAQUINA";
  // ConfiguracaoClicheEtiqueta presente pro produto deste item — só então
  // mostra o seletor de papel/cores/faca/frete.
  usaClicheEtiqueta: boolean;
  // Achado N1 — só relevante quando modeloCalculo=SIMPLES: decide se largura/
  // altura aparecem pra edição (ver mostraDimensao abaixo e
  // ItemGrafica.simplesCobraPorArea no schema).
  simplesCobraPorArea: boolean;
  // Unidade congelada na criação do item — nunca a padrão atual da gráfica,
  // pra trocar a configuração não mudar o que já foi orçado.
  unidadeDimensao: UnidadeDimensao;
  valoresIniciais: {
    quantidade: number;
    larguraCm: string;
    alturaCm: string;
    // Achado F7 — terceira dimensão/espessura do item VENDIDO. Sempre
    // visíveis (não gateadas por mostraDimensao) — uma caixa pode ser vendida
    // como SIMPLES também.
    profundidadeCm: string;
    espessuraMm: string;
    cores: string;
    acabamento: string;
    // Achado B6 — sobrepõe o nome do catálogo no PDF/link público quando
    // preenchido (ver src/lib/pdf/mapear-dados.ts). Disponível pra QUALQUER
    // modeloCalculo, ao contrário de `acabamento` acima.
    descricaoLivre: string;
    acabamentoIds: string[];
    corFrente: string;
    corVerso: string;
    numeroCoresFlexo: string;
    numeroCliques: string;
    numeroSetups: string;
    prazoEstimadoDias: string;
    numeroPontos: string;
    tempoEstimadoMin: string;
    metrosCorte: string;
    horasEstimadas: string;
    custoAquisicaoUnitario: string;
    materialFornecidoPeloCliente: boolean;
    etiqueta: CamposEtiqueta;
    papelId: string;
    quantidadeCores: string;
    custoFaca: string;
    custoFrete: string;
  };
  podeRemover: boolean;
  acabamentosDisponiveis: ItemAcabamentoDisponivel[];
  papeisDisponiveis: PapelDisponivel[];
}) {
  const [state, formAction, isPending] = useActionState(editarOrcamento, null);
  const [estadoRemocao, acaoRemover, removendoPending] = useActionState(
    removerItemOrcamento,
    null
  );
  // Inclui FLEXOGRAFIA aqui (gap pré-existente corrigido junto: faltava na
  // versão anterior desta constante, mas SeletorItemOrcamento.tsx — usado no
  // fluxo de CRIAÇÃO — já tratava Flexografia como motor avançado; a edição
  // devia se comportar igual à criação) + os 4 modelos novos da Feature A
  // (Digital e os 3 de setup-por-peça também usam acabamentoIds via checkbox,
  // não o campo de texto livre).
  // Revenda/terceirização (achado A12) — sem nesting como Digital/setup-por-
  // peça, mas SEMPRE motor avançado: custoBase precisa passar por
  // comporPreco (overhead/margem/piso), nunca o campo de texto livre.
  const usaMotorAvancado =
    modeloCalculo === "M2" ||
    modeloCalculo === "OFFSET" ||
    modeloCalculo === "FLEXOGRAFIA" ||
    modeloCalculo === "DIGITAL" ||
    modeloCalculo === "SERIGRAFIA" ||
    modeloCalculo === "SUBLIMACAO" ||
    modeloCalculo === "ESTAMPAGEM_QUENTE" ||
    modeloCalculo === "PERSONALIZACAO" ||
    modeloCalculo === "REVENDA" ||
    modeloCalculo === "BORDADO" ||
    modeloCalculo === "TEMPO_MAQUINA";
  // Diferente de usaMotorAvancado: M2/OFFSET/FLEXOGRAFIA/DIGITAL (achado N4:
  // agora faz imposição igual ao Offset) EXIGEM largura/altura pro cálculo em
  // si (nesting) — os 3 de setup-por-peça, Revenda, Bordado e Tempo de
  // máquina têm a dimensão opcional (ver design "dimensões opcionais" do
  // plano).
  const exigeDimensao =
    modeloCalculo === "M2" ||
    modeloCalculo === "OFFSET" ||
    modeloCalculo === "FLEXOGRAFIA" ||
    modeloCalculo === "DIGITAL";
  const usaModeloDigital = modeloCalculo === "DIGITAL";
  // Achado B7 — mesmo agrupamento de SeletorItemOrcamento.tsx (os 5
  // compartilham a mesma checkbox "material fornecido pelo cliente").
  const usaModeloSetupPorPeca =
    modeloCalculo === "SERIGRAFIA" ||
    modeloCalculo === "SUBLIMACAO" ||
    modeloCalculo === "ESTAMPAGEM_QUENTE" ||
    modeloCalculo === "PERSONALIZACAO";
  const usaModeloBordado = modeloCalculo === "BORDADO";
  const usaModeloTempoMaquina = modeloCalculo === "TEMPO_MAQUINA";
  // Achado N1 — SIMPLES só mostra largura/altura quando o PRODUTO está
  // marcado como "cobra por área" (simplesCobraPorArea); sem a flag,
  // preencher dimensão não muda mais o preço (sempre por peça).
  const mostraDimensao =
    // DIGITAL não entra mais aqui separado — exigeDimensao já cobre (achado N4).
    exigeDimensao ||
    modeloCalculo === "SERIGRAFIA" ||
    modeloCalculo === "SUBLIMACAO" ||
    modeloCalculo === "ESTAMPAGEM_QUENTE" ||
    modeloCalculo === "PERSONALIZACAO" ||
    modeloCalculo === "REVENDA" ||
    modeloCalculo === "BORDADO" ||
    modeloCalculo === "TEMPO_MAQUINA" ||
    (modeloCalculo === "SIMPLES" && simplesCobraPorArea);
  // Mesmo agrupamento visual de SeletorItemOrcamento.tsx (fluxo de criação)
  // — o formulário de edição tem exatamente os mesmos campos duplicados, e a
  // tarefa pede a mesma estrutura nos dois pra não confundir o usuário.
  const mostrarGrupoCorPreparo =
    modeloCalculo === "OFFSET" ||
    modeloCalculo === "FLEXOGRAFIA" ||
    usaModeloDigital ||
    usaModeloSetupPorPeca ||
    modeloCalculo === "REVENDA" ||
    usaModeloBordado ||
    usaModeloTempoMaquina;
  const [largura, setLargura] = useState(() =>
    paraExibicao(valoresIniciais.larguraCm, unidadeDimensao)
  );
  const [altura, setAltura] = useState(() =>
    paraExibicao(valoresIniciais.alturaCm, unidadeDimensao)
  );
  // Achado F7 — profundidade segue a mesma conversão de unidade de largura/
  // altura acima; espessuraMm é sempre em mm, sem conversão (chapa é vendida
  // em mm no Brasil).
  const [profundidade, setProfundidade] = useState(() =>
    paraExibicao(valoresIniciais.profundidadeCm, unidadeDimensao)
  );
  const [espessuraMm, setEspessuraMm] = useState(valoresIniciais.espessuraMm);
  const [etiqueta, setEtiqueta] = useState<CamposEtiqueta>(valoresIniciais.etiqueta);
  const [confirmandoRemocao, setConfirmandoRemocao] = useState(false);

  useAoMudar(estadoRemocao, (estadoRemocao) => {
    if (estadoRemocao && !estadoRemocao.ok) setConfirmandoRemocao(false);
  });

  return (
    <Card className="mb-4 p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          Produto:{" "}
          <span className="font-medium text-slate-800 dark:text-slate-200">{itemNome}</span>{" "}
          <span className="text-xs">(não pode ser trocado — remova e adicione outro)</span>
        </p>
        {podeRemover && !confirmandoRemocao && (
          <button
            type="button"
            onClick={() => setConfirmandoRemocao(true)}
            className="shrink-0 text-xs font-medium text-rose-600 hover:underline"
          >
            Remover item
          </button>
        )}
      </div>

      {confirmandoRemocao && (
        <div className="mb-4">
          <ConfirmarExclusao
            pergunta={`Remover "${itemNome}" deste orçamento? Essa ação não pode ser desfeita.`}
            onCancelar={() => setConfirmandoRemocao(false)}
            formAction={acaoRemover}
            campos={{ orcamentoItemId }}
            rotuloBotao="Remover item"
            pendente={removendoPending}
          />
        </div>
      )}

      {estadoRemocao && !estadoRemocao.ok && (
        <div className="mb-4">
          <Alert variant="error">{estadoRemocao.mensagem}</Alert>
        </div>
      )}

      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="orcamentoId" value={orcamentoId} />
        <input type="hidden" name="orcamentoItemId" value={orcamentoItemId} />

        <Input
          label="Quantidade"
          name="quantidade"
          type="number"
          min={1}
          required
          defaultValue={valoresIniciais.quantidade}
        />

        {mostraDimensao && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label={`Largura (${ROTULO_UNIDADE_DIMENSAO[unidadeDimensao]})`}
              type="number"
              step={passoInputDimensao(unidadeDimensao)}
              required={exigeDimensao}
              placeholder={exigeDimensao ? undefined : "opcional"}
              value={largura}
              onChange={(e) => setLargura(e.target.value)}
            />
            <Input
              label={`Altura (${ROTULO_UNIDADE_DIMENSAO[unidadeDimensao]})`}
              type="number"
              step={passoInputDimensao(unidadeDimensao)}
              required={exigeDimensao}
              placeholder={exigeDimensao ? undefined : "opcional"}
              value={altura}
              onChange={(e) => setAltura(e.target.value)}
            />
            <input type="hidden" name="larguraCm" value={paraCm(largura, unidadeDimensao)} />
            <input type="hidden" name="alturaCm" value={paraCm(altura, unidadeDimensao)} />
          </div>
        )}

        {/* Campo escondido de profundidade (F7) — o input visível ficou no
            grupo "Mais opções" no fim do formulário (junto de espessura),
            mas o hidden precisa continuar aqui dentro do <form> como
            qualquer outro. */}
        <input type="hidden" name="profundidadeCm" value={paraCm(profundidade, unidadeDimensao)} />

        {mostrarGrupoCorPreparo && (
          <details open className="group rounded-xl border border-slate-300 dark:border-slate-700">
            <summary className="flex cursor-pointer list-none items-center px-4 py-2.5 text-sm font-medium text-slate-700 marker:content-none dark:text-slate-200">
              Cor e preparo de máquina
            </summary>
            <div className="flex flex-col gap-4 border-t border-slate-100 px-4 py-4 dark:border-slate-800">
              {modeloCalculo === "OFFSET" && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Input
                    label={
                      <>
                        Cores de frente
                        <CampoAjuda texto="Quantas cores de tinta são usadas na frente e no verso da peça (ex: 4x4 = 4 cores nos dois lados, 4x0 = colorido só na frente, preto e branco no verso). Cada cor extra é uma chapa a mais na máquina, então aumenta o custo." />
                      </>
                    }
                    name="corFrente"
                    type="number"
                    min={1}
                    required
                    defaultValue={valoresIniciais.corFrente}
                  />
                  <Input
                    label="Cores de verso"
                    name="corVerso"
                    type="number"
                    min={0}
                    defaultValue={valoresIniciais.corVerso}
                  />
                </div>
              )}

              {/* Achado N10 da auditoria de abrangência — custo de
                  ferramental (faca de corte-e-vinco) R$ livre, opcional, por
                  item — mesmo campo/name "custoFaca" que o bloco de
                  precificação de etiqueta usa mais abaixo (usaClicheEtiqueta
                  é exclusivo de M2, nunca renderiza ao mesmo tempo que este
                  bloco de OFFSET, então não há dois inputs com o mesmo name
                  no ar). O motor de preço já lê esse valor pra qualquer
                  modelo (ver precificar.ts); só faltava o campo aqui. */}
              {modeloCalculo === "OFFSET" && (
                <Input
                  label={
                    <>
                      Custo de ferramental (R$)
                      <CampoAjuda texto="Custo da faca de corte e vinco (o molde usado pra recortar/vincar embalagem, caixa, cartão). É um ferramental que se paga uma vez só, mas normalmente é cobrado dentro do primeiro pedido que usa esse formato." />
                    </>
                  }
                  name="custoFaca"
                  type="number"
                  min={0}
                  step="0.01"
                  defaultValue={valoresIniciais.custoFaca}
                  placeholder="opcional"
                />
              )}

              {modeloCalculo === "FLEXOGRAFIA" && (
                <Input
                  label={
                    <>
                      Número de cores
                      <CampoAjuda texto="Na flexografia, cada cor sai numa estação separada da máquina (geralmente cores especiais/Pantone, não CMYK como no digital ou offset). Informe o total de cores usadas na arte — cada cor a mais aumenta o custo de preparação." />
                    </>
                  }
                  name="numeroCoresFlexo"
                  type="number"
                  min={1}
                  required
                  defaultValue={valoresIniciais.numeroCoresFlexo}
                />
              )}

              {modeloCalculo === "DIGITAL" && (
                <Input
                  label={
                    <>
                      Número de cliques
                      <CampoAjuda texto="Em impressão digital, cada passada da máquina pra imprimir uma peça é chamada de 'clique' — é assim que o custo do equipamento é cobrado. Normalmente é 1 clique por peça; só mude se seu equipamento contar diferente (ex: frente e verso separados)." />
                    </>
                  }
                  name="numeroCliques"
                  type="number"
                  min={1}
                  defaultValue={valoresIniciais.numeroCliques}
                  placeholder="opcional — padrão 1 por peça"
                  hint="Deixe em branco pra usar 1 clique por peça (padrão)."
                />
              )}

              {(modeloCalculo === "SERIGRAFIA" ||
                modeloCalculo === "SUBLIMACAO" ||
                modeloCalculo === "ESTAMPAGEM_QUENTE" ||
                modeloCalculo === "PERSONALIZACAO") && (
                <Input
                  label={
                    <>
                      Número de setups
                      <CampoAjuda texto="Setup é o tempo de preparar a máquina pra rodar esta arte — trocar tela, matriz ou ajustar a cor. Cada arte diferente neste item conta como 1 setup, e isso entra no custo porque a máquina fica parada preparando, não produzindo." />
                    </>
                  }
                  name="numeroSetups"
                  type="number"
                  min={1}
                  required
                  defaultValue={valoresIniciais.numeroSetups}
                  hint="Quantas telas/matrizes/artes esta arte usa."
                />
              )}

              {usaModeloBordado && (
                <Input
                  label={
                    <>
                      Número de pontos da arte
                      <CampoAjuda texto="Quantos pontos a máquina de bordado vai dar pra fazer esta arte — quanto maior a arte (logo pequeno vs. bordado grande de costas), mais pontos, mais tempo de máquina e mais linha gasta. Costuma vir do programa de digitalização da arte." />
                    </>
                  }
                  name="numeroPontos"
                  type="number"
                  min={1}
                  required
                  defaultValue={valoresIniciais.numeroPontos}
                  hint="Ex: um logo pequeno tem ~3.000 pontos; um bordado grande de costas pode passar de 15.000."
                />
              )}

              {usaModeloTempoMaquina && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Input
                    label={
                      <>
                        Tempo estimado de máquina (min)
                        <CampoAjuda texto="Quanto tempo a máquina fica rodando pra produzir este item inteiro (todas as peças da quantidade), em minutos. Preencha este campo, os metros de corte ao lado, ou os dois — a máquina cobra pelo que estiver preenchido." />
                      </>
                    }
                    name="tempoEstimadoMin"
                    type="number"
                    min={0.01}
                    step="0.01"
                    defaultValue={valoresIniciais.tempoEstimadoMin}
                    placeholder="opcional"
                  />
                  <Input
                    label={
                      <>
                        Metros de corte
                        <CampoAjuda texto="Total de metros lineares que a faca/laser vai cortar pra produzir este item inteiro — só preencha se a máquina escolhida cobra por metro de corte." />
                      </>
                    }
                    name="metrosCorte"
                    type="number"
                    min={0.01}
                    step="0.01"
                    defaultValue={valoresIniciais.metrosCorte}
                    placeholder="opcional"
                  />
                </div>
              )}

              {(usaModeloDigital || usaModeloSetupPorPeca || usaModeloBordado) && (
                <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
                  <input
                    type="checkbox"
                    name="materialFornecidoPeloCliente"
                    defaultChecked={valoresIniciais.materialFornecidoPeloCliente}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                  />
                  <span>
                    <span className="inline-flex items-center gap-1.5">
                      Material fornecido pelo cliente
                      <CampoAjuda texto="Marque quando o CLIENTE já traz a peça em branco (camiseta, caneca, brinde) pronta pra aplicar a estampa ou gravação. Nesse caso a gráfica cobra só o serviço de aplicação, sem cobrar o custo da peça em si." />
                    </span>
                    <span className="block text-xs font-normal text-slate-500">
                      A gráfica não cobra o custo da peça em branco — só a aplicação.
                    </span>
                  </span>
                </label>
              )}

              {modeloCalculo === "REVENDA" && (
                <Input
                  label="Custo de aquisição (R$)"
                  name="custoAquisicaoUnitario"
                  type="number"
                  min={0}
                  step="0.01"
                  defaultValue={valoresIniciais.custoAquisicaoUnitario}
                  placeholder="opcional"
                  hint="Deixe em branco pra usar o custo de compra cadastrado no catálogo."
                />
              )}
            </div>
          </details>
        )}

        <Input
          label="Cores"
          name="cores"
          defaultValue={valoresIniciais.cores}
          placeholder="ex: 4x0, 4x4"
        />

        <Textarea
          label="Descrição específica (opcional)"
          name="descricaoLivre"
          defaultValue={valoresIniciais.descricaoLivre}
          maxLength={500}
          rows={2}
          placeholder='ex: "Banner 3×1m lona 440g com bastão e corda"'
          hint="Sobrepõe o nome do catálogo no PDF e no link público — deixe em branco pra mostrar o nome padrão."
        />

        {usaMotorAvancado ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Acabamentos</span>
            {acabamentosDisponiveis.length === 0 ? (
              <span className="text-xs text-slate-500">
                Nenhum serviço de acabamento configurado ainda — cadastre em Catálogo.
              </span>
            ) : (
              <>
                <div className="flex flex-col gap-1.5 rounded-xl border border-slate-300 p-3 dark:border-slate-700">
                  {acabamentosDisponiveis.map((a) => (
                    <label
                      key={a.id}
                      className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200"
                    >
                      <input
                        type="checkbox"
                        name="acabamentoIds"
                        value={a.id}
                        defaultChecked={valoresIniciais.acabamentoIds.includes(a.id)}
                        className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                      />
                      {a.nome}
                    </label>
                  ))}
                </div>
                <span className="text-xs text-slate-500">
                  Opcional — soma o custo configurado no catálogo ao preço deste item.
                </span>
              </>
            )}
          </div>
        ) : (
          <Input
            label="Acabamento"
            name="acabamento"
            defaultValue={valoresIniciais.acabamento}
            placeholder="ex: laminação fosca, corte reto"
          />
        )}

        {usaMotorAvancado && (
          <Input
            label="Horas estimadas"
            name="horasEstimadas"
            type="number"
            min={0.01}
            step="0.25"
            defaultValue={valoresIniciais.horasEstimadas}
            placeholder="opcional"
            hint="Só necessário se um dos acabamentos acima cobra por hora (ex: instalação, criação de arte)."
          />
        )}

        <Input
          label={
            <>
              Prazo estimado de entrega (dias)
              <CampoAjuda texto="Número de dias estimado para entregar este item específico. O vendedor pode colocar prazos diferentes para cada item no mesmo orçamento (ex: camiseta em 2 dias, brinde em 10 dias), e o cabeçalho do orçamento mostra automaticamente o prazo mais longo. Deixe em branco se não tiver informação." />
            </>
          }
          name="prazoEstimadoDias"
          type="number"
          min={1}
          defaultValue={valoresIniciais.prazoEstimadoDias}
          placeholder="opcional"
          hint="Prazo específico deste item — o cabeçalho reflete o máximo automaticamente."
        />

        {usaClicheEtiqueta && (
          <div className="flex flex-col gap-4 rounded-xl border border-slate-300 p-4 dark:border-slate-700">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Precificação de etiqueta
            </p>
            {papeisDisponiveis.length === 0 ? (
              <span className="text-xs text-slate-500">
                Nenhuma matéria-prima de papel cadastrada ainda — cadastre em Catálogo.
              </span>
            ) : (
              <Select
                label="Papel"
                name="papelId"
                defaultValue={valoresIniciais.papelId}
                required
              >
                <option value="" disabled>
                  Selecione o papel
                </option>
                {papeisDisponiveis.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                    {p.precoCompra ? ` — R$ ${p.precoCompra}/m²` : ""}
                  </option>
                ))}
              </Select>
            )}
            <Input
              label="Quantidade de cores (clichês)"
              name="quantidadeCores"
              type="number"
              min={1}
              required
              defaultValue={valoresIniciais.quantidadeCores}
              hint="Um clichê por cor da arte — custo fixo, não muda com a tiragem."
            />
            {/* Custo de faca/frete: R$ livres, opcionais, raramente
                preenchidos — diferente de papel/quantidade de cores acima
                (que entram na conta de preço e costumam ser necessários),
                por isso ficam escondidos atrás de um "Mais opções" fechado
                por padrão (mesmo agrupamento de
                CamposPrecificacaoEtiquetaOrcamento.tsx). */}
            <details className="group rounded-xl border border-slate-200 dark:border-slate-800">
              <summary className="flex cursor-pointer list-none items-center px-3 py-2 text-xs font-medium text-slate-500 marker:content-none dark:text-slate-400">
                Mais opções
              </summary>
              <div className="grid grid-cols-1 gap-4 border-t border-slate-100 p-3 dark:border-slate-800 sm:grid-cols-2">
                <Input
                  label={
                    <>
                      Custo da faca (R$)
                      <CampoAjuda texto="Custo da faca de corte (o molde/clichê usado pra recortar o formato da etiqueta). É um ferramental que se paga uma vez só, mas normalmente é cobrado dentro do primeiro pedido que usa esse formato." />
                    </>
                  }
                  name="custoFaca"
                  type="number"
                  min={0}
                  step="0.01"
                  defaultValue={valoresIniciais.custoFaca}
                  placeholder="opcional"
                />
                <Input
                  label={
                    <>
                      Custo de frete (R$)
                      <CampoAjuda texto="Frete específico pra trazer o material ou a faca desta etiqueta — não é o frete de entrega do pedido pronto pro cliente (esse fica nos dados gerais do orçamento, em 'Frete')." />
                    </>
                  }
                  name="custoFrete"
                  type="number"
                  min={0}
                  step="0.01"
                  defaultValue={valoresIniciais.custoFrete}
                  placeholder="opcional"
                />
              </div>
            </details>
          </div>
        )}

        {usaModeloDigital && (
          <div className="flex flex-col gap-4 rounded-xl border border-slate-300 p-4 dark:border-slate-700">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Papel/substrato deste orçamento
            </p>
            {papeisDisponiveis.length === 0 ? (
              <span className="text-xs text-slate-500">
                Nenhuma matéria-prima de papel cadastrada ainda — cadastre em Catálogo. O papel precisa
                ter pelo menos um formato de folha cadastrado (aba &quot;Formatos de folha&quot; do
                papel) pra calcular quantas peças cabem por folha.
              </span>
            ) : (
              <Select label="Papel" name="papelId" defaultValue={valoresIniciais.papelId} required>
                <option value="" disabled>
                  Selecione o papel
                </option>
                {papeisDisponiveis.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                    {p.precoCompra ? ` — R$ ${p.precoCompra}/folha` : ""}
                  </option>
                ))}
              </Select>
            )}
          </div>
        )}

        {modeloCalculo === "M2" && (
          <>
            <CamposEtiquetaOrcamento valores={etiqueta} onChange={setEtiqueta} />
            <input type="hidden" name="materialSubstrato" value={etiqueta.materialSubstrato} />
            <input type="hidden" name="materialSubstratoOutro" value={etiqueta.materialSubstratoOutro} />
            <input type="hidden" name="tipoAdesivo" value={etiqueta.tipoAdesivo} />
            <input type="hidden" name="tipoAdesivoOutro" value={etiqueta.tipoAdesivoOutro} />
            <input type="hidden" name="superficieAplicacao" value={etiqueta.superficieAplicacao} />
            <input
              type="hidden"
              name="superficieAplicacaoOutro"
              value={etiqueta.superficieAplicacaoOutro}
            />
            <input type="hidden" name="formatoEtiqueta" value={etiqueta.formatoEtiqueta} />
            <input type="hidden" name="coresRotulo" value={etiqueta.coresRotulo} />
            <input type="hidden" name="coresContraRotulo" value={etiqueta.coresContraRotulo} />
            <input type="hidden" name="embalagemQtdPorRolo" value={etiqueta.embalagemQtdPorRolo} />
            <input type="hidden" name="tubeteMedida" value={etiqueta.tubeteMedida} />
            <input type="hidden" name="rotulagem" value={etiqueta.rotulagem} />
            <input type="hidden" name="serrilha" value={etiqueta.serrilha} />
            <input type="hidden" name="serrilhaOutro" value={etiqueta.serrilhaOutro} />
            <input type="hidden" name="vernizRotuloTotal" value={String(etiqueta.vernizRotuloTotal)} />
            <input type="hidden" name="vernizRotuloReserva" value={String(etiqueta.vernizRotuloReserva)} />
            <input type="hidden" name="vernizRotuloTipo" value={etiqueta.vernizRotuloTipo} />
            <input type="hidden" name="vernizRotuloTipoOutro" value={etiqueta.vernizRotuloTipoOutro} />
            <input
              type="hidden"
              name="vernizContraRotuloTotal"
              value={String(etiqueta.vernizContraRotuloTotal)}
            />
            <input
              type="hidden"
              name="vernizContraRotuloReserva"
              value={String(etiqueta.vernizContraRotuloReserva)}
            />
            <input type="hidden" name="vernizContraRotuloTipo" value={etiqueta.vernizContraRotuloTipo} />
            <input
              type="hidden"
              name="vernizContraRotuloTipoOutro"
              value={etiqueta.vernizContraRotuloTipoOutro}
            />
            <input type="hidden" name="laminacaoRotulo" value={etiqueta.laminacaoRotulo} />
            <input type="hidden" name="laminacaoRotuloOutro" value={etiqueta.laminacaoRotuloOutro} />
            <input type="hidden" name="laminacaoContraRotulo" value={etiqueta.laminacaoContraRotulo} />
            <input
              type="hidden"
              name="laminacaoContraRotuloOutro"
              value={etiqueta.laminacaoContraRotuloOutro}
            />
            <input type="hidden" name="rebobinamento" value={etiqueta.rebobinamento} />
            <input
              type="hidden"
              name="hotStampingsJson"
              value={JSON.stringify(
                etiqueta.hotStampings.map((h) => ({
                  lado: h.lado,
                  tipo: h.tipo,
                  tipoOutro: h.tipoOutro || null,
                  tipoEfeitoHotStamping: h.tipoEfeitoHotStamping || null,
                  medida: h.medida || null,
                  cor: h.cor || null,
                }))
              )}
            />
          </>
        )}

        {/* Achado F7 — profundidade/espessura do item vendido, sempre
            disponíveis (independente de mostraDimensao: uma caixa pode ser
            vendida como SIMPLES também). Raramente preenchidas, por isso
            ficam num grupo fechado por padrão em vez de sempre visíveis
            (mesmo agrupamento de SeletorItemOrcamento.tsx). O hidden
            profundidadeCm que carrega o valor convertido pro submit já está
            mais acima, junto do restante do <form>. */}
        <details className="group rounded-xl border border-slate-300 dark:border-slate-700">
          <summary className="flex cursor-pointer list-none items-center px-4 py-2.5 text-sm font-medium text-slate-700 marker:content-none dark:text-slate-200">
            Mais opções
          </summary>
          <div className="grid grid-cols-1 gap-4 border-t border-slate-100 px-4 py-4 dark:border-slate-800 sm:grid-cols-2">
            <Input
              label={
                <>
                  {`Profundidade (${ROTULO_UNIDADE_DIMENSAO[unidadeDimensao]})`}
                  <CampoAjuda texto="Terceira dimensão do produto, além de largura e altura — usada pra descrever caixas, embalagens, acrílico ou objetos com volume. É só informativo (não entra na conta do preço); deixe em branco se não se aplica." />
                </>
              }
              type="number"
              step={passoInputDimensao(unidadeDimensao)}
              placeholder="opcional"
              value={profundidade}
              onChange={(e) => setProfundidade(e.target.value)}
            />
            <Input
              label={
                <>
                  Espessura (mm)
                  <CampoAjuda texto="Espessura de chapas, placas ou materiais rígidos, sempre em milímetro (ex: acrílico, MDF, chapa de corte a laser). É só informativo (não entra na conta do preço); deixe em branco se não se aplica." />
                </>
              }
              name="espessuraMm"
              type="number"
              step="0.01"
              placeholder="opcional — ex: chapa de corte a laser"
              value={espessuraMm}
              onChange={(e) => setEspessuraMm(e.target.value)}
            />
          </div>
        </details>

        {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}

        <Button type="submit" loading={isPending} className="self-start">
          {isPending ? "Salvando..." : "Salvar alterações"}
        </Button>
      </form>
    </Card>
  );
}
