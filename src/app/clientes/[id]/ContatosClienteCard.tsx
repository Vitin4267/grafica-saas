"use client";

import { useActionState, useState } from "react";
import { useAoMudar } from "@/lib/hooks/useAoMudar";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import {
  criarContatoCliente,
  atualizarContatoCliente,
  desativarContatoCliente,
  reativarContatoCliente,
} from "../actions";
import { ORDEM_FUNCAO_CONTATO_CLIENTE, ROTULO_FUNCAO_CONTATO_CLIENTE } from "@/lib/contatos-cliente";
import type { FuncaoContatoCliente } from "@/generated/prisma/enums";

export type ContatoClienteView = {
  id: string;
  nome: string;
  cargo: string | null;
  departamento: string | null;
  email: string | null;
  telefone: string | null;
  whatsapp: string | null;
  funcao: FuncaoContatoCliente;
  funcaoOutro: string | null;
  principal: boolean;
  ativo: boolean;
};

type ValoresContato = {
  nome: string;
  cargo: string;
  departamento: string;
  email: string;
  telefone: string;
  whatsapp: string;
  funcao: FuncaoContatoCliente;
  funcaoOutro: string;
  principal: boolean;
};

const VALORES_VAZIOS: ValoresContato = {
  nome: "",
  cargo: "",
  departamento: "",
  email: "",
  telefone: "",
  whatsapp: "",
  funcao: "COMPRADOR",
  funcaoOutro: "",
  principal: false,
};

// Campos compartilhados entre "adicionar contato" e "editar contato" — só
// muda o `formAction` e os valores iniciais de quem chama.
function CamposContato({ valoresIniciais }: { valoresIniciais: ValoresContato }) {
  const [funcao, setFuncao] = useState<FuncaoContatoCliente>(valoresIniciais.funcao);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input label="Nome" name="nome" required defaultValue={valoresIniciais.nome} />
        <Input label="Cargo" name="cargo" defaultValue={valoresIniciais.cargo} placeholder="opcional" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input label="E-mail" name="email" type="email" defaultValue={valoresIniciais.email} />
        <Input label="Telefone" name="telefone" defaultValue={valoresIniciais.telefone} placeholder="(00) 00000-0000" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input
          label="WhatsApp"
          name="whatsapp"
          defaultValue={valoresIniciais.whatsapp}
          placeholder="se diferente do telefone"
        />
        <Input label="Departamento" name="departamento" defaultValue={valoresIniciais.departamento} placeholder="opcional" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Select
          label="Função"
          name="funcao"
          value={funcao}
          onChange={(e) => setFuncao(e.target.value as FuncaoContatoCliente)}
        >
          {ORDEM_FUNCAO_CONTATO_CLIENTE.map((valor) => (
            <option key={valor} value={valor}>
              {ROTULO_FUNCAO_CONTATO_CLIENTE[valor]}
            </option>
          ))}
        </Select>
        {funcao === "OUTRO" && (
          <Input
            label="Descreva a função"
            name="funcaoOutro"
            defaultValue={valoresIniciais.funcaoOutro}
            placeholder="ex: síndico, procurador..."
            required
          />
        )}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="principal"
          defaultChecked={valoresIniciais.principal}
          className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
        />
        <span className="text-slate-700 dark:text-slate-200">
          Contato principal deste cliente
        </span>
      </label>
      <p className="text-xs text-slate-500">
        Marcar como principal desmarca automaticamente o contato principal anterior deste cliente.
      </p>
    </div>
  );
}

function AdicionarContatoForm({ clienteId, onFechar }: { clienteId: string; onFechar: () => void }) {
  const [state, formAction, isPending] = useActionState(criarContatoCliente, null);

  useAoMudar(state, (state) => {
    if (state?.ok) onFechar();
  });

  return (
    <form action={formAction} className="flex flex-col gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
      <input type="hidden" name="clienteId" value={clienteId} />
      <CamposContato valoresIniciais={VALORES_VAZIOS} />
      {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}
      <div className="flex items-center gap-2">
        <Button type="submit" variant="outline" loading={isPending}>
          {isPending ? "Adicionando..." : "Adicionar contato"}
        </Button>
        <Button type="button" variant="ghost" onClick={onFechar}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

function EditarContatoForm({ contato, onFechar }: { contato: ContatoClienteView; onFechar: () => void }) {
  const [state, formAction, isPending] = useActionState(atualizarContatoCliente, null);

  useAoMudar(state, (state) => {
    if (state?.ok) onFechar();
  });

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="contatoId" value={contato.id} />
      <CamposContato
        valoresIniciais={{
          nome: contato.nome,
          cargo: contato.cargo ?? "",
          departamento: contato.departamento ?? "",
          email: contato.email ?? "",
          telefone: contato.telefone ?? "",
          whatsapp: contato.whatsapp ?? "",
          funcao: contato.funcao,
          funcaoOutro: contato.funcaoOutro ?? "",
          principal: contato.principal,
        }}
      />
      {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}
      <div className="flex items-center gap-2">
        <Button type="submit" variant="outline" loading={isPending}>
          {isPending ? "Salvando..." : "Salvar contato"}
        </Button>
        <Button type="button" variant="ghost" onClick={onFechar}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

function LinhaContato({ contato }: { contato: ContatoClienteView }) {
  const [editando, setEditando] = useState(false);
  const [estadoDesativar, desativarAction, desativando] = useActionState(desativarContatoCliente, null);
  const [estadoReativar, reativarAction, reativando] = useActionState(reativarContatoCliente, null);

  if (editando) {
    return (
      <div className="py-4">
        <EditarContatoForm contato={contato} onFechar={() => setEditando(false)} />
      </div>
    );
  }

  const linhaContato = [contato.cargo, contato.email, contato.telefone].filter(Boolean).join(" · ");

  return (
    <div className="flex items-start justify-between gap-3 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium text-slate-800 dark:text-slate-100">{contato.nome}</p>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {contato.funcao === "OUTRO" ? contato.funcaoOutro || "Outro" : ROTULO_FUNCAO_CONTATO_CLIENTE[contato.funcao]}
          </span>
          {contato.principal && (
            <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700 dark:bg-teal-900/30 dark:text-teal-400">
              Principal
            </span>
          )}
          {!contato.ativo && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              Desativado
            </span>
          )}
        </div>
        {linhaContato && <p className="mt-0.5 text-sm text-slate-500">{linhaContato}</p>}
        {estadoDesativar && !estadoDesativar.ok && (
          <p className="mt-1 text-xs text-rose-600">{estadoDesativar.mensagem}</p>
        )}
        {estadoReativar && !estadoReativar.ok && (
          <p className="mt-1 text-xs text-rose-600">{estadoReativar.mensagem}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3 text-xs">
        <button
          type="button"
          onClick={() => setEditando(true)}
          className="font-medium text-teal-700 hover:underline dark:text-teal-400"
        >
          Editar
        </button>
        {contato.ativo ? (
          <form action={desativarAction}>
            <input type="hidden" name="contatoId" value={contato.id} />
            <button type="submit" disabled={desativando} className="font-medium text-slate-500 hover:underline">
              {desativando ? "Desativando..." : "Desativar"}
            </button>
          </form>
        ) : (
          <form action={reativarAction}>
            <input type="hidden" name="contatoId" value={contato.id} />
            <button type="submit" disabled={reativando} className="font-medium text-slate-500 hover:underline">
              {reativando ? "Reativando..." : "Reativar"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// Achado A4 da Parte 5 da auditoria de abrangência — gestão dos contatos de
// um cliente Pessoa Jurídica (comprador, financeiro, aprovação de arte,
// recebimento...), distintos do e-mail/telefone único do cadastro. Mesmo
// padrão visual de seção-dentro-de-Card de ClienteEditForm.tsx, mas em
// componente próprio pra não competir por edição no mesmo arquivo que os
// achados de tipo de pessoa/crédito do cliente.
export function ContatosClienteCard({
  clienteId,
  contatos,
  podeEditar,
}: {
  clienteId: string;
  contatos: ContatoClienteView[];
  podeEditar: boolean;
}) {
  const [adicionando, setAdicionando] = useState(false);

  return (
    <Card className="p-6">
      <div className="mb-1 flex items-center justify-between">
        <p className="text-sm font-medium text-slate-900 dark:text-white">Contatos</p>
        {podeEditar && !adicionando && (
          <button
            type="button"
            onClick={() => setAdicionando(true)}
            className="text-xs font-medium text-teal-700 hover:underline dark:text-teal-400"
          >
            + Adicionar contato
          </button>
        )}
      </div>
      <p className="text-xs text-slate-500">
        Pessoas de contato desta empresa — quem compra, quem aprova arte, quem está no financeiro e quem recebe a
        entrega podem ser pessoas diferentes.
      </p>

      {contatos.length === 0 && !adicionando && (
        <p className="mt-4 text-sm text-slate-500">Nenhum contato cadastrado ainda.</p>
      )}

      {contatos.length > 0 && (
        <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
          {contatos.map((contato) => (
            <LinhaContato key={contato.id} contato={contato} />
          ))}
        </div>
      )}

      {podeEditar && adicionando && (
        <AdicionarContatoForm clienteId={clienteId} onFechar={() => setAdicionando(false)} />
      )}
    </Card>
  );
}
