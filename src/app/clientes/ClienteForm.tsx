"use client";

import { useActionState, useState } from "react";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { CampoAjuda } from "@/components/ui/CampoAjuda";
import { UserIcon, MailIcon } from "@/components/icons";
import { criarCliente } from "./actions";
import { EnderecoFields, ENDERECO_VAZIO } from "./EnderecoFields";
import {
  ORDEM_ORIGEM_CLIENTE,
  ROTULO_ORIGEM_CLIENTE,
  ORDEM_SEGMENTO_CLIENTE,
  ROTULO_SEGMENTO_CLIENTE,
  ORDEM_TIPO_PESSOA,
  ROTULO_TIPO_PESSOA,
  ORDEM_INDICADOR_INSCRICAO_ESTADUAL,
  ROTULO_INDICADOR_INSCRICAO_ESTADUAL,
} from "@/lib/tipos-cliente";
import type { OrigemCliente, SegmentoCliente, TipoPessoa } from "@/generated/prisma/enums";

export function ClienteForm({ vendedores }: { vendedores: { id: string; nome: string }[] }) {
  const [state, formAction, isPending] = useActionState(criarCliente, null);
  const [resetKey, setResetKey] = useState(0);
  const [estadoAnterior, setEstadoAnterior] = useState(state);
  const [origem, setOrigem] = useState<OrigemCliente | "">("");
  const [segmento, setSegmento] = useState<SegmentoCliente | "">("");
  const [tipoPessoa, setTipoPessoa] = useState<TipoPessoa | "">("");

  // Reseta o form (campos não-controlados) após um cadastro bem-sucedido,
  // seguindo o padrão de "ajustar estado durante a renderização" do React
  // (evita useEffect só para reagir a uma mudança de prop/state).
  if (state !== estadoAnterior) {
    setEstadoAnterior(state);
    if (state?.ok) {
      setResetKey((k) => k + 1);
      setOrigem("");
      setSegmento("");
      setTipoPessoa("");
    }
  }

  return (
    <form key={resetKey} action={formAction} className="flex flex-col gap-4">
      <Input label="Nome" name="nome" required icon={<UserIcon className="h-4 w-4" />} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input label="E-mail" name="email" type="email" icon={<MailIcon className="h-4 w-4" />} />
        <Input label="Telefone" name="telefone" placeholder="(00) 00000-0000" />
      </div>
      <Input label="CPF/CNPJ" name="documento" placeholder="opcional" />

      <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select
            label="Tipo de pessoa"
            name="tipoPessoa"
            value={tipoPessoa}
            onChange={(e) => setTipoPessoa(e.target.value as TipoPessoa | "")}
          >
            <option value="">Não informado</option>
            {ORDEM_TIPO_PESSOA.map((valor) => (
              <option key={valor} value={valor}>
                {ROTULO_TIPO_PESSOA[valor]}
              </option>
            ))}
          </Select>
        </div>
        {tipoPessoa === "JURIDICA" && (
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Razão social"
              name="razaoSocial"
              hint="Usada na nota fiscal em vez do nome — o nome fantasia não tem validade jurídica pra NF-e"
            />
            <Input label="Nome fantasia" name="nomeFantasia" />
            <Select
              label={
                <>
                  Indicador de Inscrição Estadual
                  <CampoAjuda texto="Diz pra Receita se o cliente paga ICMS. 'Contribuinte' exige a Inscrição Estadual preenchida abaixo; 'isento' e 'não contribuinte' não têm Inscrição Estadual — esse campo decide como a nota fiscal é emitida pra ele." />
                </>
              }
              name="indicadorInscricaoEstadual"
              defaultValue=""
            >
              <option value="">Não informado</option>
              {ORDEM_INDICADOR_INSCRICAO_ESTADUAL.map((valor) => (
                <option key={valor} value={valor}>
                  {ROTULO_INDICADOR_INSCRICAO_ESTADUAL[valor]}
                </option>
              ))}
            </Select>
            <Input
              label="Inscrição Estadual"
              name="inscricaoEstadual"
              placeholder="obrigatória se contribuinte de ICMS"
            />
            <Input label="Inscrição Municipal" name="inscricaoMunicipal" placeholder="opcional" />
          </div>
        )}
      </div>

      <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
        <p className="mb-3 text-sm font-medium text-slate-700 dark:text-slate-200">
          Endereço <span className="font-normal text-slate-400">(opcional — necessário só pra emitir nota fiscal)</span>
        </p>
        <EnderecoFields valoresIniciais={ENDERECO_VAZIO} />
      </div>

      <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select
            label="Origem do cliente"
            name="origem"
            value={origem}
            onChange={(e) => setOrigem(e.target.value as OrigemCliente | "")}
          >
            <option value="">Não informado</option>
            {ORDEM_ORIGEM_CLIENTE.map((valor) => (
              <option key={valor} value={valor}>
                {ROTULO_ORIGEM_CLIENTE[valor]}
              </option>
            ))}
          </Select>
          {origem === "OUTRO" && (
            <Input label="Descreva a origem" name="origemOutro" placeholder="ex: parceria com..." required />
          )}
        </div>
      </div>

      <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select
            label="Segmento"
            name="segmento"
            value={segmento}
            onChange={(e) => setSegmento(e.target.value as SegmentoCliente | "")}
          >
            <option value="">Não informado</option>
            {ORDEM_SEGMENTO_CLIENTE.map((valor) => (
              <option key={valor} value={valor}>
                {ROTULO_SEGMENTO_CLIENTE[valor]}
              </option>
            ))}
          </Select>
          {segmento === "OUTRO" && (
            <Input label="Descreva o segmento" name="segmentoOutro" placeholder="ex: cooperativa..." required />
          )}
          <Input
            label={
              <>
                Margem diferenciada (%)
                <CampoAjuda texto="Troca a margem de lucro padrão da gráfica só pra este cliente — use pra um cliente grande com margem negociada menor, ou um cliente de risco onde você quer cobrar uma margem maior. Em branco usa o padrão de Configurações." />
              </>
            }
            name="margemPadraoOverride"
            type="number"
            step="0.0001"
            min="0"
            placeholder="ex: 0.15"
            hint="Sobrescreve a margem padrão da gráfica só pra este cliente — em branco usa o padrão de Configurações"
          />
          <Select label="Vendedor responsável" name="vendedorId" defaultValue="">
            <option value="">Não atribuído</option>
            {vendedores.map((v) => (
              <option key={v.id} value={v.id}>
                {v.nome}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <Textarea
        label="Observações internas"
        name="observacoes"
        placeholder="Nota comercial visível só pra sua equipe"
        hint="Nunca aparece no PDF nem no link público do orçamento"
        maxLength={2000}
      />
      <Textarea
        label="Preferências de produção"
        name="preferenciasProducao"
        placeholder='Ex: "sempre mandar arte em RGB", "só recebe às terças"'
        hint="Aparece na Ordem de Produção"
        maxLength={2000}
      />

      {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}

      <Button type="submit" loading={isPending} className="self-start">
        {isPending ? "Salvando..." : "Cadastrar cliente"}
      </Button>
    </form>
  );
}
