"use client";

import { useActionState, useState } from "react";
import { useAoMudar } from "@/lib/hooks/useAoMudar";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { ConfirmarExclusao } from "@/components/ui/ConfirmarExclusao";
import { CamposEtiquetaOrcamento, type CamposEtiqueta } from "../CamposEtiquetaOrcamento";
import { editarOrcamento, removerItemOrcamento } from "./actions";

export function EditarOrcamentoForm({
  orcamentoId,
  orcamentoItemId,
  itemNome,
  modeloCalculo,
  valoresIniciais,
  podeRemover,
}: {
  orcamentoId: string;
  orcamentoItemId: string;
  itemNome: string;
  modeloCalculo: "SIMPLES" | "M2" | "OFFSET";
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
  const [larguraCm, setLarguraCm] = useState(valoresIniciais.larguraCm);
  const [alturaCm, setAlturaCm] = useState(valoresIniciais.alturaCm);
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
              label="Largura (cm)"
              name="larguraCm"
              type="number"
              required
              value={larguraCm}
              onChange={(e) => setLarguraCm(e.target.value)}
            />
            <Input
              label="Altura (cm)"
              name="alturaCm"
              type="number"
              required
              value={alturaCm}
              onChange={(e) => setAlturaCm(e.target.value)}
            />
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
            <input type="hidden" name="superficieAplicacao" value={etiqueta.superficieAplicacao} />
            <input type="hidden" name="formatoEtiqueta" value={etiqueta.formatoEtiqueta} />
            <input type="hidden" name="coresRotulo" value={etiqueta.coresRotulo} />
            <input type="hidden" name="coresContraRotulo" value={etiqueta.coresContraRotulo} />
            <input type="hidden" name="embalagemQtdPorRolo" value={etiqueta.embalagemQtdPorRolo} />
            <input type="hidden" name="tubeteMedida" value={etiqueta.tubeteMedida} />
            <input type="hidden" name="rotulagem" value={etiqueta.rotulagem} />
            <input type="hidden" name="serrilha" value={etiqueta.serrilha} />
            <input type="hidden" name="vernizRotuloTotal" value={String(etiqueta.vernizRotuloTotal)} />
            <input type="hidden" name="vernizRotuloReserva" value={String(etiqueta.vernizRotuloReserva)} />
            <input type="hidden" name="vernizRotuloTipo" value={etiqueta.vernizRotuloTipo} />
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
            <input type="hidden" name="laminacaoRotulo" value={etiqueta.laminacaoRotulo} />
            <input type="hidden" name="laminacaoContraRotulo" value={etiqueta.laminacaoContraRotulo} />
            <input type="hidden" name="rebobinamento" value={etiqueta.rebobinamento} />
            <input
              type="hidden"
              name="hotStampingsJson"
              value={JSON.stringify(
                etiqueta.hotStampings.map((h) => ({
                  lado: h.lado,
                  tipo: h.tipo,
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
