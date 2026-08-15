"use client";

import { useActionState, useState } from "react";
import { useAoMudar } from "@/lib/hooks/useAoMudar";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { ConfirmarExclusao } from "@/components/ui/ConfirmarExclusao";
import { CamposEtiquetaOrcamento, type CamposEtiqueta } from "../CamposEtiquetaOrcamento";
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
  valoresIniciais,
  podeRemover,
  unidadeDimensao,
}: {
  orcamentoId: string;
  orcamentoItemId: string;
  itemNome: string;
  modeloCalculo: "SIMPLES" | "M2" | "OFFSET";
  // Unidade congelada na criação do item — nunca a padrão atual da gráfica,
  // pra trocar a configuração não mudar o que já foi orçado.
  unidadeDimensao: UnidadeDimensao;
  valoresIniciais: {
    quantidade: number;
    larguraCm: string;
    alturaCm: string;
    cores: string;
    acabamento: string;
    corFrente: string;
    corVerso: string;
    etiqueta: CamposEtiqueta;
  };
  podeRemover: boolean;
}) {
  const [state, formAction, isPending] = useActionState(editarOrcamento, null);
  const [estadoRemocao, acaoRemover, removendoPending] = useActionState(
    removerItemOrcamento,
    null
  );
  const usaMotorAvancado = modeloCalculo === "M2" || modeloCalculo === "OFFSET";
  const [largura, setLargura] = useState(() =>
    paraExibicao(valoresIniciais.larguraCm, unidadeDimensao)
  );
  const [altura, setAltura] = useState(() =>
    paraExibicao(valoresIniciais.alturaCm, unidadeDimensao)
  );
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

        {usaMotorAvancado && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label={`Largura (${ROTULO_UNIDADE_DIMENSAO[unidadeDimensao]})`}
              type="number"
              step={passoInputDimensao(unidadeDimensao)}
              required
              value={largura}
              onChange={(e) => setLargura(e.target.value)}
            />
            <Input
              label={`Altura (${ROTULO_UNIDADE_DIMENSAO[unidadeDimensao]})`}
              type="number"
              step={passoInputDimensao(unidadeDimensao)}
              required
              value={altura}
              onChange={(e) => setAltura(e.target.value)}
            />
            <input type="hidden" name="larguraCm" value={paraCm(largura, unidadeDimensao)} />
            <input type="hidden" name="alturaCm" value={paraCm(altura, unidadeDimensao)} />
          </div>
        )}

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

        <Input
          label="Cores"
          name="cores"
          defaultValue={valoresIniciais.cores}
          placeholder="ex: 4x0, 4x4"
        />
        <Input
          label="Acabamento"
          name="acabamento"
          defaultValue={valoresIniciais.acabamento}
          placeholder="ex: laminação fosca, corte reto"
        />

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
