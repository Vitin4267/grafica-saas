"use client";

import { useActionState, useState } from "react";
import { useAoMudar } from "@/lib/hooks/useAoMudar";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { editarDadosGeraisOrcamento } from "./actions";
import { ROTULO_FUNCAO_CONTATO_CLIENTE } from "@/lib/contatos-cliente";

const OPCOES_TIPO_PEDIDO: [string, string][] = [
  ["MODELO_NOVO", "Modelo novo"],
  ["REPETICAO_SEM_ALTERACAO", "Repetição sem alteração"],
  ["REPETICAO_COM_ALTERACAO", "Repetição com alteração"],
];
const OPCOES_FRETE: [string, string][] = [
  ["SEM_FRETE", "Retirada no balcão / sem frete"],
  ["CIF_REMETENTE", "Por conta do emitente (CIF)"],
  ["FOB_DESTINATARIO", "Por conta do destinatário (FOB)"],
  ["TERCEIROS", "Por conta de terceiros"],
  ["PROPRIO_REMETENTE", "Transporte próprio do remetente"],
  ["PROPRIO_DESTINATARIO", "Transporte próprio do destinatário"],
];
const ROTULO_TIPO_PEDIDO = Object.fromEntries(OPCOES_TIPO_PEDIDO);
const ROTULO_FRETE = Object.fromEntries(OPCOES_FRETE);

type DadosGerais = {
  vendedor: string | null;
  tipoPedido: string | null;
  contatoNome: string | null;
  contatoEmail: string | null;
  // Achado A4 da Parte 5 da auditoria de abrangência — id do ContatoCliente
  // escolhido no <select> abaixo, quando houver. Convive com
  // contatoNome/contatoEmail acima (snapshot em texto, o que de fato
  // aparece no PDF/link público) — ver comentário completo no schema.
  contatoClienteId: string | null;
  condicoesPagamento: string | null;
  frete: string | null;
  transportadora: string | null;
  localEntrega: string | null;
  observacoes: string | null;
};

type ContatoClienteOpcao = {
  id: string;
  nome: string;
  email: string | null;
  funcao: string;
  funcaoOutro: string | null;
};

// Bloco de campos gerais do pedido — editável a qualquer status do
// orçamento (ver comentário em editarDadosGeraisOrcamento, actions.ts): não
// mexe em total nem no que o cliente já viu. Mesmo padrão de
// editar-no-lugar de TrocarClienteForm.tsx, só que mostrando um resumo
// (não só um botão) quando não está editando, já que aqui são vários campos.
export function EditarDadosGeraisOrcamentoForm({
  orcamentoId,
  dados,
  contatosCliente,
}: {
  orcamentoId: string;
  dados: DadosGerais;
  // Só contatos ATIVOS do cliente deste orçamento (ver page.tsx) — vazio pra
  // quem nunca cadastrou contato nenhum, e nesse caso o <select> nem aparece
  // (digitação livre continua idêntica a hoje).
  contatosCliente: ContatoClienteOpcao[];
}) {
  const [state, formAction, isPending] = useActionState(editarDadosGeraisOrcamento, null);
  const [editando, setEditando] = useState(false);
  // Controlados só porque o <select> de contato precisa escrever neles ao
  // escolher — o resto do form continua não-controlado (defaultValue), o
  // padrão de sempre. Inicializado uma vez a partir de `dados`, mesmo
  // precedente de `mostrarBloqueio` em ClienteEditForm.tsx.
  const [contatoNome, setContatoNome] = useState(dados.contatoNome ?? "");
  const [contatoEmail, setContatoEmail] = useState(dados.contatoEmail ?? "");
  const [contatoClienteId, setContatoClienteId] = useState(dados.contatoClienteId ?? "");

  function aoEscolherContato(id: string) {
    setContatoClienteId(id);
    const contato = contatosCliente.find((c) => c.id === id);
    if (contato) {
      setContatoNome(contato.nome);
      setContatoEmail(contato.email ?? "");
    }
  }

  // Fecha o modo de edição quando a action salva com sucesso: a própria
  // troca pra visão-resumo (com os valores novos, já que os campos abaixo
  // são não-controlados) é o sinal de sucesso. Em caso de erro, o form
  // continua aberto e o Alert de erro logo abaixo aparece normalmente.
  useAoMudar(state, (state) => {
    if (state?.ok) setEditando(false);
  });

  const linhas: [string, string][] = [
    dados.vendedor ? (["Vendedor", dados.vendedor] as [string, string]) : null,
    dados.tipoPedido ? (["Tipo de pedido", ROTULO_TIPO_PEDIDO[dados.tipoPedido] ?? dados.tipoPedido] as [string, string]) : null,
    dados.contatoNome ? (["Contato", dados.contatoNome] as [string, string]) : null,
    dados.contatoEmail ? (["E-mail de contato", dados.contatoEmail] as [string, string]) : null,
    dados.condicoesPagamento ? (["Condições de pagamento", dados.condicoesPagamento] as [string, string]) : null,
    dados.frete ? (["Frete", ROTULO_FRETE[dados.frete] ?? dados.frete] as [string, string]) : null,
    dados.transportadora ? (["Transportadora", dados.transportadora] as [string, string]) : null,
    dados.localEntrega ? (["Local de entrega", dados.localEntrega] as [string, string]) : null,
    dados.observacoes ? (["Observações internas", dados.observacoes] as [string, string]) : null,
  ].filter((l): l is [string, string] => l !== null);

  if (!editando) {
    return (
      <div className="flex flex-col gap-3">
        {linhas.length > 0 ? (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {linhas.map(([rotulo, valor]) => (
              <div key={rotulo}>
                <dt className="text-slate-500">{rotulo}</dt>
                <dd className="font-medium text-slate-800 dark:text-slate-100">{valor}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-slate-500">Nenhum dado geral preenchido ainda.</p>
        )}
        <button
          type="button"
          onClick={() => setEditando(true)}
          className="self-start text-xs font-medium text-teal-700 hover:underline dark:text-teal-400"
        >
          {linhas.length > 0 ? "Editar dados do pedido" : "+ adicionar vendedor, frete, condições de pagamento..."}
        </button>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="orcamentoId" value={orcamentoId} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input label="Vendedor" name="vendedor" defaultValue={dados.vendedor ?? ""} />
        <Select label="Tipo de pedido" name="tipoPedido" defaultValue={dados.tipoPedido ?? ""}>
          <option value="">não informado</option>
          {OPCOES_TIPO_PEDIDO.map(([v, rotulo]) => (
            <option key={v} value={v}>
              {rotulo}
            </option>
          ))}
        </Select>
        {contatosCliente.length > 0 && (
          <Select
            label="Contato"
            name="contatoClienteId"
            value={contatoClienteId}
            onChange={(e) => aoEscolherContato(e.target.value)}
            hint="Escolher preenche nome/e-mail abaixo — que continuam editáveis"
          >
            <option value="">digitar manualmente</option>
            {contatosCliente.map((contato) => (
              <option key={contato.id} value={contato.id}>
                {contato.nome} (
                {contato.funcao === "OUTRO"
                  ? contato.funcaoOutro || "Outro"
                  : ROTULO_FUNCAO_CONTATO_CLIENTE[contato.funcao as keyof typeof ROTULO_FUNCAO_CONTATO_CLIENTE] ?? contato.funcao}
                )
              </option>
            ))}
          </Select>
        )}
        <Input
          label="Contato do pedido"
          name="contatoNome"
          value={contatoNome}
          onChange={(e) => setContatoNome(e.target.value)}
          hint="Pessoa de contato deste pedido, se diferente do cadastro do cliente"
        />
        <Input
          label="E-mail de contato"
          name="contatoEmail"
          type="email"
          value={contatoEmail}
          onChange={(e) => setContatoEmail(e.target.value)}
        />
        <Input
          label="Condições de pagamento"
          name="condicoesPagamento"
          defaultValue={dados.condicoesPagamento ?? ""}
          placeholder="ex: 28/35ddl"
        />
        <Select label="Frete" name="frete" defaultValue={dados.frete ?? ""}>
          <option value="">não informado</option>
          {OPCOES_FRETE.map(([v, rotulo]) => (
            <option key={v} value={v}>
              {rotulo}
            </option>
          ))}
        </Select>
        <Input label="Transportadora" name="transportadora" defaultValue={dados.transportadora ?? ""} />
        <Input label="Local de entrega" name="localEntrega" defaultValue={dados.localEntrega ?? ""} />
      </div>
      <Textarea
        label="Observações internas"
        name="observacoes"
        defaultValue={dados.observacoes ?? ""}
        hint="Só aparece pra sua gráfica — nunca no PDF nem no link do cliente."
      />
      <div className="flex items-center gap-2">
        <Button type="submit" variant="outline" loading={isPending}>
          {isPending ? "Salvando..." : "Salvar"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setEditando(false)}>
          Cancelar
        </Button>
      </div>
      {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}
    </form>
  );
}
