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
    | "REVENDA";
  // ConfiguracaoClicheEtiqueta presente pro produto deste item — só então
  // mostra o seletor de papel/cores/faca/frete.
  usaClicheEtiqueta: boolean;
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
    modeloCalculo === "REVENDA";
  // Diferente de usaMotorAvancado: só M2/OFFSET/FLEXOGRAFIA EXIGEM largura/
  // altura pro cálculo em si (nesting) — Digital, os 3 de setup-por-peça e
  // Revenda têm a dimensão opcional (ver design "dimensões opcionais" do
  // plano).
  const exigeDimensao = modeloCalculo === "M2" || modeloCalculo === "OFFSET" || modeloCalculo === "FLEXOGRAFIA";
  const usaModeloDigital = modeloCalculo === "DIGITAL";
  // Achado B7 — mesmo agrupamento de SeletorItemOrcamento.tsx (os 4
  // compartilham a mesma checkbox "material fornecido pelo cliente").
  const usaModeloSetupPorPeca =
    modeloCalculo === "SERIGRAFIA" ||
    modeloCalculo === "SUBLIMACAO" ||
    modeloCalculo === "ESTAMPAGEM_QUENTE" ||
    modeloCalculo === "PERSONALIZACAO";
  const mostraDimensao =
    exigeDimensao ||
    modeloCalculo === "DIGITAL" ||
    modeloCalculo === "SERIGRAFIA" ||
    modeloCalculo === "SUBLIMACAO" ||
    modeloCalculo === "ESTAMPAGEM_QUENTE" ||
    modeloCalculo === "PERSONALIZACAO" ||
    modeloCalculo === "REVENDA";
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

        {/* Achado F7 — profundidade/espessura do item vendido, sempre
            visíveis (independente de mostraDimensao: uma caixa pode ser
            vendida como SIMPLES também). */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label={`Profundidade (${ROTULO_UNIDADE_DIMENSAO[unidadeDimensao]})`}
            type="number"
            step={passoInputDimensao(unidadeDimensao)}
            placeholder="opcional"
            value={profundidade}
            onChange={(e) => setProfundidade(e.target.value)}
          />
          <Input
            label="Espessura (mm)"
            name="espessuraMm"
            type="number"
            step="0.01"
            placeholder="opcional — ex: chapa de corte a laser"
            value={espessuraMm}
            onChange={(e) => setEspessuraMm(e.target.value)}
          />
          <input type="hidden" name="profundidadeCm" value={paraCm(profundidade, unidadeDimensao)} />
        </div>

        {modeloCalculo === "OFFSET" && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Cores de frente"
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

        {modeloCalculo === "FLEXOGRAFIA" && (
          <Input
            label="Número de cores"
            name="numeroCoresFlexo"
            type="number"
            min={1}
            required
            defaultValue={valoresIniciais.numeroCoresFlexo}
          />
        )}

        {modeloCalculo === "DIGITAL" && (
          <Input
            label="Número de cliques"
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
            label="Número de setups"
            name="numeroSetups"
            type="number"
            min={1}
            required
            defaultValue={valoresIniciais.numeroSetups}
            hint="Quantas telas/matrizes/artes esta arte usa."
          />
        )}

        {(usaModeloDigital || usaModeloSetupPorPeca) && (
          <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              name="materialFornecidoPeloCliente"
              defaultChecked={valoresIniciais.materialFornecidoPeloCliente}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
            />
            <span>
              Material fornecido pelo cliente
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
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="Custo da faca (R$)"
                name="custoFaca"
                type="number"
                min={0}
                step="0.01"
                defaultValue={valoresIniciais.custoFaca}
                placeholder="opcional"
              />
              <Input
                label="Custo de frete (R$)"
                name="custoFrete"
                type="number"
                min={0}
                step="0.01"
                defaultValue={valoresIniciais.custoFrete}
                placeholder="opcional"
              />
            </div>
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

        {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}

        <Button type="submit" loading={isPending} className="self-start">
          {isPending ? "Salvando..." : "Salvar alterações"}
        </Button>
      </form>
    </Card>
  );
}
