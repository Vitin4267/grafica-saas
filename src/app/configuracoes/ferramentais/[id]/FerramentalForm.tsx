"use client";

import { useActionState, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import {
  ORDEM_TIPO_FERRAMENTAL,
  ROTULO_TIPO_FERRAMENTAL,
  ORDEM_PROPRIETARIO_FERRAMENTAL,
  ROTULO_PROPRIETARIO_FERRAMENTAL,
  ORDEM_STATUS_FERRAMENTAL,
  ROTULO_STATUS_FERRAMENTAL,
} from "@/lib/tipos-ferramental";
import { editarFerramental, desativarFerramental, reativarFerramental } from "../actions";
import type {
  TipoFerramental,
  ProprietarioFerramental,
  StatusFerramental,
} from "@/generated/prisma/enums";

type OpcaoSimples = { id: string; nome: string };

type ValoresFerramental = {
  codigo: string;
  tipo: TipoFerramental;
  tipoOutro: string | null;
  descricao: string | null;
  proprietario: ProprietarioFerramental;
  clienteId: string | null;
  itemGraficaId: string | null;
  localizacao: string | null;
  status: StatusFerramental;
  tiragensAcumuladas: number;
  desativadoEm: Date | null;
};

export function FerramentalForm({
  ferramentalId,
  valoresIniciais,
  clientes,
  itensGrafica,
}: {
  ferramentalId: string;
  valoresIniciais: ValoresFerramental;
  clientes: OpcaoSimples[];
  itensGrafica: OpcaoSimples[];
}) {
  const [state, formAction, isPending] = useActionState(editarFerramental, null);
  const [estadoDesativar, desativarAction, desativando] = useActionState(desativarFerramental, null);
  const [estadoReativar, reativarAction, reativando] = useActionState(reativarFerramental, null);
  const [tipo, setTipo] = useState<TipoFerramental>(valoresIniciais.tipo);
  const [proprietario, setProprietario] = useState<ProprietarioFerramental>(
    valoresIniciais.proprietario
  );

  const desativado = Boolean(valoresIniciais.desativadoEm);

  return (
    <div className="flex flex-col gap-6">
      <form action={formAction} className="flex flex-col gap-6">
        <input type="hidden" name="ferramentalId" value={ferramentalId} />

        <Card className="flex flex-col gap-4 p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Código"
              name="codigo"
              type="text"
              defaultValue={valoresIniciais.codigo}
              required
            />

            <Select
              label="Tipo"
              name="tipo"
              value={tipo}
              onChange={(e) => setTipo(e.target.value as TipoFerramental)}
            >
              {ORDEM_TIPO_FERRAMENTAL.map((valor) => (
                <option key={valor} value={valor}>
                  {ROTULO_TIPO_FERRAMENTAL[valor]}
                </option>
              ))}
            </Select>
          </div>

          {tipo === "OUTRO" && (
            <Input
              label="Descreva o tipo"
              name="tipoOutro"
              type="text"
              defaultValue={valoresIniciais.tipoOutro ?? ""}
              required
            />
          )}

          <Textarea
            label="Descrição (opcional)"
            name="descricao"
            defaultValue={valoresIniciais.descricao ?? ""}
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Select
              label="Proprietário"
              name="proprietario"
              value={proprietario}
              onChange={(e) => setProprietario(e.target.value as ProprietarioFerramental)}
            >
              {ORDEM_PROPRIETARIO_FERRAMENTAL.map((valor) => (
                <option key={valor} value={valor}>
                  {ROTULO_PROPRIETARIO_FERRAMENTAL[valor]}
                </option>
              ))}
            </Select>

            {proprietario === "CLIENTE" && (
              <Select
                label="Cliente dono"
                name="clienteId"
                defaultValue={valoresIniciais.clienteId ?? ""}
                required
              >
                <option value="" disabled>
                  Selecione...
                </option>
                {clientes.map((cliente) => (
                  <option key={cliente.id} value={cliente.id}>
                    {cliente.nome}
                  </option>
                ))}
              </Select>
            )}
          </div>

          <Select
            label="Item do catálogo (opcional)"
            name="itemGraficaId"
            defaultValue={valoresIniciais.itemGraficaId ?? ""}
            hint="O produto que esta ferramenta produz."
          >
            <option value="">Nenhum item específico</option>
            {itensGrafica.map((item) => (
              <option key={item.id} value={item.id}>
                {item.nome}
              </option>
            ))}
          </Select>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Localização (opcional)"
              name="localizacao"
              type="text"
              defaultValue={valoresIniciais.localizacao ?? ""}
            />

            <Select label="Status" name="status" defaultValue={valoresIniciais.status}>
              {ORDEM_STATUS_FERRAMENTAL.map((valor) => (
                <option key={valor} value={valor}>
                  {ROTULO_STATUS_FERRAMENTAL[valor]}
                </option>
              ))}
            </Select>
          </div>

          <Input
            label="Tiragens acumuladas"
            name="tiragensAcumuladas"
            type="number"
            step="1"
            min="0"
            defaultValue={valoresIniciais.tiragensAcumuladas}
            hint="Contador manual — atualize à mão a cada repetição produzida com esta ferramenta, se quiser acompanhar a vida útil."
          />
        </Card>

        {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}

        <Button type="submit" loading={isPending} className="self-start">
          {isPending ? "Salvando..." : "Salvar ferramental"}
        </Button>
      </form>

      <Card className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-slate-900 dark:text-white">
              {desativado ? "Ferramental desativado" : "Desativar ferramental"}
            </p>
            <p className="text-xs text-slate-500">
              {desativado
                ? "Não aparece mais nas listas de seleção — reative quando precisar."
                : "Some das listas de seleção, mas o histórico de orçamentos que já usaram este ferramental continua intacto."}
            </p>
            {estadoDesativar && !estadoDesativar.ok && (
              <p className="mt-1 text-xs text-rose-600">{estadoDesativar.mensagem}</p>
            )}
            {estadoReativar && !estadoReativar.ok && (
              <p className="mt-1 text-xs text-rose-600">{estadoReativar.mensagem}</p>
            )}
          </div>
          {desativado ? (
            <form action={reativarAction}>
              <input type="hidden" name="ferramentalId" value={ferramentalId} />
              <Button type="submit" variant="outline" loading={reativando} className="shrink-0">
                Reativar
              </Button>
            </form>
          ) : (
            <form action={desativarAction}>
              <input type="hidden" name="ferramentalId" value={ferramentalId} />
              <Button type="submit" variant="outline" loading={desativando} className="shrink-0 text-rose-600">
                Desativar
              </Button>
            </form>
          )}
        </div>
      </Card>
    </div>
  );
}
