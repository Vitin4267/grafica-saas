"use client";

import { useState } from "react";
import { Select } from "./Select";
import { Input } from "./Input";
import { OPCAO_OUTRO, type OpcaoCodigoFiscal } from "@/lib/nota-fiscal-tabelas";

// <Select> curado (CSOSN, CST-ICMS, modalidade de base de cálculo, situação
// tributária PIS/COFINS) com fallback "Outro" que troca pro texto livre —
// usado nos dois formulários de Dados fiscais (gráfica e filial, que
// espelham campo a campo). Sempre só UM input com o `name` pedido chega no
// FormData: o hidden quando a escolha é curada, o texto livre quando é
// "Outro" — nunca os dois ao mesmo tempo.
export function SelectCodigoFiscal({
  label,
  name,
  opcoes,
  valorInicial,
  hint,
}: {
  label: string;
  name: string;
  opcoes: OpcaoCodigoFiscal[];
  valorInicial: string;
  hint?: string;
}) {
  const curado = valorInicial !== "" && opcoes.some((o) => o.valor === valorInicial);
  const [selecao, setSelecao] = useState(curado ? valorInicial : valorInicial ? OPCAO_OUTRO : "");
  const [livre, setLivre] = useState(curado || !valorInicial ? "" : valorInicial);

  return (
    <div className="flex flex-col gap-1.5">
      <Select
        label={label}
        value={selecao}
        onChange={(e) => setSelecao(e.target.value)}
        hint={selecao === OPCAO_OUTRO ? undefined : hint}
      >
        <option value="">Selecione...</option>
        {opcoes.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.rotulo}
          </option>
        ))}
        <option value={OPCAO_OUTRO}>Outro (digitar código)</option>
      </Select>
      {selecao === OPCAO_OUTRO ? (
        <Input
          label={`${label} — código digitado`}
          name={name}
          value={livre}
          onChange={(e) => setLivre(e.target.value)}
          placeholder="Digite o código"
        />
      ) : (
        <input type="hidden" name={name} value={selecao} />
      )}
    </div>
  );
}
