"use client";

import { useActionState } from "react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { salvarDadosFiscais } from "./actions";

type ValoresFiscais = {
  ambiente: "homologacao" | "producao";
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string;
  inscricaoEstadual: string;
  regimeTributario: string;
  enderecoCep: string;
  enderecoLogradouro: string;
  enderecoNumero: string;
  enderecoBairro: string;
  enderecoMunicipio: string;
  enderecoUf: string;
  naturezaOperacaoPadrao: string;
  cfopPadrao: string;
  csosnPadrao: string;
};

export function DadosFiscaisForm({
  valoresIniciais,
  tokenMascarado,
}: {
  valoresIniciais: ValoresFiscais;
  tokenMascarado: string | null;
}) {
  const [state, formAction, isPending] = useActionState(salvarDadosFiscais, null);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <Card className="flex flex-col gap-4 p-6">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">
          Conta na Focus NFe
        </h2>
        <Select
          label="Ambiente"
          name="ambiente"
          defaultValue={valoresIniciais.ambiente}
          hint="Comece em Homologação pra testar sem gerar nota com valor fiscal real. Só troque pra Produção quando tiver certeza."
        >
          <option value="homologacao">Homologação (testes)</option>
          <option value="producao">Produção (notas reais)</option>
        </Select>
        <Input
          label="Token da API"
          name="focusNfeToken"
          type="password"
          placeholder={tokenMascarado ? `Salvo: ${tokenMascarado} — deixe em branco pra manter` : "Cole aqui o token da sua conta Focus NFe"}
          hint="Nunca reexibimos o token salvo por segurança — só os últimos 4 caracteres."
        />
      </Card>

      <Card className="flex flex-col gap-4 p-6">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">
          Identificação da empresa (emitente)
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="CNPJ" name="cnpj" type="text" defaultValue={valoresIniciais.cnpj} placeholder="00.000.000/0000-00" />
          <Input
            label="Inscrição Estadual"
            name="inscricaoEstadual"
            type="text"
            defaultValue={valoresIniciais.inscricaoEstadual}
          />
          <Input
            label="Razão social"
            name="razaoSocial"
            type="text"
            defaultValue={valoresIniciais.razaoSocial}
          />
          <Input
            label="Nome fantasia"
            name="nomeFantasia"
            type="text"
            defaultValue={valoresIniciais.nomeFantasia}
          />
          <Input
            label="Regime tributário"
            name="regimeTributario"
            type="text"
            defaultValue={valoresIniciais.regimeTributario}
            placeholder="ex: Simples Nacional"
            hint="Informativo — ajuda a orientar o CSOSN padrão abaixo."
          />
        </div>
      </Card>

      <Card className="flex flex-col gap-4 p-6">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">
          Endereço da empresa
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="CEP" name="enderecoCep" type="text" defaultValue={valoresIniciais.enderecoCep} />
          <Input
            label="UF"
            name="enderecoUf"
            type="text"
            maxLength={2}
            defaultValue={valoresIniciais.enderecoUf}
          />
          <Input
            label="Logradouro"
            name="enderecoLogradouro"
            type="text"
            defaultValue={valoresIniciais.enderecoLogradouro}
          />
          <Input
            label="Número"
            name="enderecoNumero"
            type="text"
            defaultValue={valoresIniciais.enderecoNumero}
          />
          <Input
            label="Bairro"
            name="enderecoBairro"
            type="text"
            defaultValue={valoresIniciais.enderecoBairro}
          />
          <Input
            label="Município"
            name="enderecoMunicipio"
            type="text"
            defaultValue={valoresIniciais.enderecoMunicipio}
          />
        </div>
      </Card>

      <Card className="flex flex-col gap-4 p-6">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">
          Defaults fiscais da nota
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Natureza da operação"
            name="naturezaOperacaoPadrao"
            type="text"
            defaultValue={valoresIniciais.naturezaOperacaoPadrao}
          />
          <Input
            label="CFOP padrão"
            name="cfopPadrao"
            type="text"
            defaultValue={valoresIniciais.cfopPadrao}
            hint="5102 = venda dentro do estado (mais comum)."
          />
          <Input
            label="CSOSN/CST padrão"
            name="csosnPadrao"
            type="text"
            defaultValue={valoresIniciais.csosnPadrao}
            hint="102 = Simples Nacional, sem permissão de crédito (mais comum)."
          />
        </div>
      </Card>

      {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}

      <Button type="submit" loading={isPending} className="self-start">
        {isPending ? "Salvando..." : "Salvar dados fiscais"}
      </Button>
    </form>
  );
}
