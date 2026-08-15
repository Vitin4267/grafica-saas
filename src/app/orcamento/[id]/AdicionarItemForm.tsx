"use client";

import { useActionState, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { adicionarItemOrcamento } from "./actions";
import {
  SeletorItemOrcamento,
  camposIniciais,
  type ItemVenda,
  type CamposItemOrcamento,
  type ItemAcabamentoDisponivel,
} from "../SeletorItemOrcamento";
import type { UnidadeDimensao } from "@/lib/unidade-dimensao";

export function AdicionarItemForm({
  orcamentoId,
  itens,
  unidadePadrao,
  acabamentosDisponiveis,
}: {
  orcamentoId: string;
  itens: ItemVenda[];
  // Grafica.unidadePadraoDimensao — o formulário nasce nessa unidade (ver
  // camposIniciais em SeletorItemOrcamento.tsx).
  unidadePadrao: UnidadeDimensao;
  acabamentosDisponiveis: ItemAcabamentoDisponivel[];
}) {
  const [campos, setCampos] = useState<CamposItemOrcamento>(() =>
    camposIniciais(itens, unidadePadrao)
  );
  const [state, formAction, isPending] = useActionState(adicionarItemOrcamento, null);
  const [estadoAnterior, setEstadoAnterior] = useState(state);

  // Mesmo padrão de reset pós-sucesso do UsuarioForm — limpa os campos depois
  // que o item é adicionado, pra ficar pronto pro próximo.
  if (state !== estadoAnterior) {
    setEstadoAnterior(state);
    if (state?.ok) setCampos(camposIniciais(itens, unidadePadrao));
  }

  if (itens.length === 0) return null;

  return (
    <Card className="p-6">
      <h3 className="mb-4 text-sm font-semibold text-slate-900 dark:text-white">
        + Adicionar item
      </h3>
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="orcamentoId" value={orcamentoId} />
        <input type="hidden" name="itemGraficaId" value={campos.itemGraficaId} />
        <input type="hidden" name="quantidade" value={campos.quantidade} />
        <input type="hidden" name="largura" value={campos.largura} />
        <input type="hidden" name="altura" value={campos.altura} />
        <input type="hidden" name="unidadeDimensao" value={campos.unidadeDimensao} />
        <input type="hidden" name="corFrente" value={campos.corFrente} />
        <input type="hidden" name="corVerso" value={campos.corVerso} />
        <input type="hidden" name="cores" value={campos.cores} />
        <input type="hidden" name="acabamento" value={campos.acabamento} />
        {campos.acabamentoIds.map((id) => (
          <input key={id} type="hidden" name="acabamentoIds" value={id} />
        ))}
        <input type="hidden" name="materialSubstrato" value={campos.etiqueta.materialSubstrato} />
        <input type="hidden" name="materialSubstratoOutro" value={campos.etiqueta.materialSubstratoOutro} />
        <input type="hidden" name="tipoAdesivo" value={campos.etiqueta.tipoAdesivo} />
        <input type="hidden" name="tipoAdesivoOutro" value={campos.etiqueta.tipoAdesivoOutro} />
        <input type="hidden" name="superficieAplicacao" value={campos.etiqueta.superficieAplicacao} />
        <input
          type="hidden"
          name="superficieAplicacaoOutro"
          value={campos.etiqueta.superficieAplicacaoOutro}
        />
        <input type="hidden" name="formatoEtiqueta" value={campos.etiqueta.formatoEtiqueta} />
        <input type="hidden" name="coresRotulo" value={campos.etiqueta.coresRotulo} />
        <input type="hidden" name="coresContraRotulo" value={campos.etiqueta.coresContraRotulo} />
        <input type="hidden" name="embalagemQtdPorRolo" value={campos.etiqueta.embalagemQtdPorRolo} />
        <input type="hidden" name="tubeteMedida" value={campos.etiqueta.tubeteMedida} />
        <input type="hidden" name="rotulagem" value={campos.etiqueta.rotulagem} />
        <input type="hidden" name="serrilha" value={campos.etiqueta.serrilha} />
        <input type="hidden" name="serrilhaOutro" value={campos.etiqueta.serrilhaOutro} />
        <input type="hidden" name="vernizRotuloTotal" value={String(campos.etiqueta.vernizRotuloTotal)} />
        <input type="hidden" name="vernizRotuloReserva" value={String(campos.etiqueta.vernizRotuloReserva)} />
        <input type="hidden" name="vernizRotuloTipo" value={campos.etiqueta.vernizRotuloTipo} />
        <input type="hidden" name="vernizRotuloTipoOutro" value={campos.etiqueta.vernizRotuloTipoOutro} />
        <input
          type="hidden"
          name="vernizContraRotuloTotal"
          value={String(campos.etiqueta.vernizContraRotuloTotal)}
        />
        <input
          type="hidden"
          name="vernizContraRotuloReserva"
          value={String(campos.etiqueta.vernizContraRotuloReserva)}
        />
        <input type="hidden" name="vernizContraRotuloTipo" value={campos.etiqueta.vernizContraRotuloTipo} />
        <input
          type="hidden"
          name="vernizContraRotuloTipoOutro"
          value={campos.etiqueta.vernizContraRotuloTipoOutro}
        />
        <input type="hidden" name="laminacaoRotulo" value={campos.etiqueta.laminacaoRotulo} />
        <input type="hidden" name="laminacaoRotuloOutro" value={campos.etiqueta.laminacaoRotuloOutro} />
        <input type="hidden" name="laminacaoContraRotulo" value={campos.etiqueta.laminacaoContraRotulo} />
        <input
          type="hidden"
          name="laminacaoContraRotuloOutro"
          value={campos.etiqueta.laminacaoContraRotuloOutro}
        />
        <input type="hidden" name="rebobinamento" value={campos.etiqueta.rebobinamento} />
        <input
          type="hidden"
          name="hotStampingsJson"
          value={JSON.stringify(
            campos.etiqueta.hotStampings.map((h) => ({
              lado: h.lado,
              tipo: h.tipo,
              tipoOutro: h.tipoOutro || null,
              medida: h.medida || null,
              cor: h.cor || null,
            }))
          )}
        />

        <SeletorItemOrcamento
          itens={itens}
          acabamentosDisponiveis={acabamentosDisponiveis}
          valores={campos}
          onChange={setCampos}
        />

        {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}

        <Button type="submit" loading={isPending} className="self-start">
          {isPending ? "Adicionando..." : "Adicionar item"}
        </Button>
      </form>
    </Card>
  );
}
