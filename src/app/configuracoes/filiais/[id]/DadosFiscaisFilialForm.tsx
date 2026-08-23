"use client";

import { useActionState, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { SelectCodigoFiscal } from "@/components/ui/SelectCodigoFiscal";
import {
  CSOSN_OPCOES,
  CST_ICMS_OPCOES,
  ICMS_MODALIDADE_BASE_CALCULO_OPCOES,
  PIS_COFINS_SITUACAO_TRIBUTARIA_OPCOES,
} from "@/lib/nota-fiscal-tabelas";
import { salvarDadosFiscaisFilial } from "../actions";

type RegimeTributario = "SIMPLES_NACIONAL" | "LUCRO_PRESUMIDO" | "LUCRO_REAL";

type ValoresFiscaisFilial = {
  ambiente: "homologacao" | "producao";
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string;
  inscricaoEstadual: string;
  regimeTributario: RegimeTributario;
  enderecoCep: string;
  enderecoLogradouro: string;
  enderecoNumero: string;
  enderecoBairro: string;
  enderecoMunicipio: string;
  enderecoUf: string;
  naturezaOperacaoPadrao: string;
  cfopPadrao: string;
  csosnPadrao: string;
  cstIcmsPadrao: string;
  icmsAliquotaPadrao: string;
  icmsModalidadeBaseCalculoPadrao: string;
  pisCofinsSituacaoTributariaPadrao: string;
};

// Mantém formato 00000-000 enquanto digita — nunca converte pra number (CEP
// começa com 0 em várias regiões do país, "01310-100" viraria 1310100).
function formatarCep(valor: string): string {
  const digitos = valor.replace(/\D/g, "").slice(0, 8);
  if (digitos.length <= 5) return digitos;
  return `${digitos.slice(0, 5)}-${digitos.slice(5)}`;
}

export function DadosFiscaisFilialForm({
  filialId,
  valoresIniciais,
  tokenMascarado,
}: {
  filialId: string;
  valoresIniciais: ValoresFiscaisFilial;
  tokenMascarado: string | null;
}) {
  const [state, formAction, isPending] = useActionState(salvarDadosFiscaisFilial, null);
  const [cep, setCep] = useState(valoresIniciais.enderecoCep);
  const [regimeTributario, setRegimeTributario] = useState<RegimeTributario>(
    valoresIniciais.regimeTributario
  );

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="filialId" value={filialId} />

      <Card className="flex flex-col gap-2 border-teal-200 bg-teal-50/50 p-4 dark:border-teal-900 dark:bg-teal-950/20">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Opcional — só preencha se esta filial emite nota fiscal com CNPJ
          próprio, diferente da matriz. Deixe em branco pra continuar usando
          os dados fiscais da gráfica (Configurações → Dados fiscais) pra
          esta filial.
        </p>
      </Card>

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
          placeholder={tokenMascarado ? `Salvo: ${tokenMascarado} — deixe em branco pra manter` : "Cole aqui o token da conta Focus NFe desta filial"}
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
          <Select
            label="Regime tributário"
            name="regimeTributario"
            value={regimeTributario}
            onChange={(e) => setRegimeTributario(e.target.value as RegimeTributario)}
            hint="Decide como a nota fiscal é montada: Simples Nacional usa CSOSN; Lucro Presumido/Real usam CST-ICMS + alíquota."
          >
            <option value="SIMPLES_NACIONAL">Simples Nacional</option>
            <option value="LUCRO_PRESUMIDO">Lucro Presumido</option>
            <option value="LUCRO_REAL">Lucro Real</option>
          </Select>
        </div>
      </Card>

      <Card className="flex flex-col gap-4 p-6">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">
          Endereço da filial
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="CEP"
            name="enderecoCep"
            type="text"
            value={cep}
            onChange={(e) => setCep(formatarCep(e.target.value))}
            placeholder="00000-000"
            inputMode="numeric"
            maxLength={9}
            // Desligado de propósito: o navegador às vezes "adivinha" errado
            // e enfia o nome da rua salva aqui dentro.
            autoComplete="off"
          />
          <Input
            label="UF"
            name="enderecoUf"
            type="text"
            maxLength={2}
            defaultValue={valoresIniciais.enderecoUf}
            autoComplete="off"
          />
          <Input
            label="Logradouro"
            name="enderecoLogradouro"
            type="text"
            defaultValue={valoresIniciais.enderecoLogradouro}
            autoComplete="off"
          />
          <Input
            label="Número"
            name="enderecoNumero"
            type="text"
            defaultValue={valoresIniciais.enderecoNumero}
            autoComplete="off"
          />
          <Input
            label="Bairro"
            name="enderecoBairro"
            type="text"
            defaultValue={valoresIniciais.enderecoBairro}
            autoComplete="off"
          />
          <Input
            label="Município"
            name="enderecoMunicipio"
            type="text"
            defaultValue={valoresIniciais.enderecoMunicipio}
            autoComplete="off"
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
          {regimeTributario === "SIMPLES_NACIONAL" ? (
            <SelectCodigoFiscal
              label="CSOSN padrão"
              name="csosnPadrao"
              opcoes={CSOSN_OPCOES}
              valorInicial={valoresIniciais.csosnPadrao}
              hint="102 = tributada sem permissão de crédito (mais comum)."
            />
          ) : (
            <input type="hidden" name="csosnPadrao" value={valoresIniciais.csosnPadrao} />
          )}
        </div>
      </Card>

      {regimeTributario !== "SIMPLES_NACIONAL" && (
        <Card className="flex flex-col gap-4 p-6">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Campos fiscais do Regime Normal
          </h2>
          <p className="-mt-2 text-sm text-slate-500">
            Obrigatórios pra emitir nota fiscal fora do Simples Nacional —
            sem eles a Focus NFe/SEFAZ rejeita a nota.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectCodigoFiscal
              label="CST-ICMS padrão"
              name="cstIcmsPadrao"
              opcoes={CST_ICMS_OPCOES}
              valorInicial={valoresIniciais.cstIcmsPadrao}
              hint="00 = tributada integralmente (mais comum)."
            />
            <Input
              label="Alíquota de ICMS padrão (%)"
              name="icmsAliquotaPadrao"
              type="number"
              step="0.01"
              min="0"
              max="100"
              defaultValue={valoresIniciais.icmsAliquotaPadrao}
              placeholder="ex: 18"
              hint="Percentual — digite 18 para 18%, não 0,18."
            />
            <SelectCodigoFiscal
              label="Modalidade de base de cálculo do ICMS"
              name="icmsModalidadeBaseCalculoPadrao"
              opcoes={ICMS_MODALIDADE_BASE_CALCULO_OPCOES}
              valorInicial={valoresIniciais.icmsModalidadeBaseCalculoPadrao}
              hint="3 = valor da operação (mais comum)."
            />
            <SelectCodigoFiscal
              label="Situação tributária de PIS/COFINS padrão"
              name="pisCofinsSituacaoTributariaPadrao"
              opcoes={PIS_COFINS_SITUACAO_TRIBUTARIA_OPCOES}
              valorInicial={valoresIniciais.pisCofinsSituacaoTributariaPadrao}
              hint="Mesmo código usado pra PIS e pra COFINS."
            />
          </div>
        </Card>
      )}

      {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}

      <Button type="submit" loading={isPending} className="self-start">
        {isPending ? "Salvando..." : "Salvar dados fiscais da filial"}
      </Button>
    </form>
  );
}
