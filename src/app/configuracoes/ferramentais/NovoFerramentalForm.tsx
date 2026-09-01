"use client";

import { useActionState, useState } from "react";
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
import { criarFerramental } from "./actions";
import type { TipoFerramental, ProprietarioFerramental } from "@/generated/prisma/enums";

type OpcaoSimples = { id: string; nome: string };

export function NovoFerramentalForm({
  clientes,
  itensGrafica,
}: {
  clientes: OpcaoSimples[];
  itensGrafica: OpcaoSimples[];
}) {
  const [state, formAction, isPending] = useActionState(criarFerramental, null);
  const [tipo, setTipo] = useState<TipoFerramental>("FACA_CORTE_VINCO");
  const [proprietario, setProprietario] = useState<ProprietarioFerramental>("GRAFICA");

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input label="Código" name="codigo" type="text" placeholder="ex: FC-0042" required />

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
          placeholder="ex: molde de sacola personalizada"
          required
        />
      )}

      <Textarea
        label="Descrição (opcional)"
        name="descricao"
        placeholder="ex: faca de corte da caixa modelo X, 20x15x10cm"
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
          <Select label="Cliente dono" name="clienteId" defaultValue="" required>
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
        defaultValue=""
        hint="O produto que esta ferramenta produz — deixe em branco se não for específico de um item."
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
          placeholder="ex: prateleira 3, armário de clichês"
        />

        <Select label="Status" name="status" defaultValue="ATIVO">
          {ORDEM_STATUS_FERRAMENTAL.map((valor) => (
            <option key={valor} value={valor}>
              {ROTULO_STATUS_FERRAMENTAL[valor]}
            </option>
          ))}
        </Select>
      </div>

      {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}
      <Button type="submit" loading={isPending} className="self-start">
        {isPending ? "Criando..." : "+ Novo ferramental"}
      </Button>
    </form>
  );
}
