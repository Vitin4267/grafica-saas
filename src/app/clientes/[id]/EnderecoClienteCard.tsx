"use client";

import { useActionState, useState } from "react";
import { useAoMudar } from "@/lib/hooks/useAoMudar";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import {
  criarEnderecoCliente,
  atualizarEnderecoCliente,
  desativarEnderecoCliente,
  reativarEnderecoCliente,
} from "../actions";
import { ORDEM_TIPO_ENDERECO_CLIENTE, ROTULO_TIPO_ENDERECO_CLIENTE } from "@/lib/enderecos-cliente";
import type { TipoEnderecoCliente } from "@/generated/prisma/enums";

export type EnderecoClienteView = {
  id: string;
  apelido: string;
  tipo: TipoEnderecoCliente;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  municipio: string | null;
  codigoIbge: string | null;
  uf: string | null;
  contatoNome: string | null;
  contatoTelefone: string | null;
  instrucoesEntrega: string | null;
  padrao: boolean;
  ativo: boolean;
};

type ValoresEndereco = {
  apelido: string;
  tipo: TipoEnderecoCliente;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  municipio: string;
  codigoIbge: string;
  uf: string;
  contatoNome: string;
  contatoTelefone: string;
  instrucoesEntrega: string;
  padrao: boolean;
};

const VALORES_VAZIOS: ValoresEndereco = {
  apelido: "",
  tipo: "ENTREGA",
  cep: "",
  logradouro: "",
  numero: "",
  complemento: "",
  bairro: "",
  municipio: "",
  codigoIbge: "",
  uf: "",
  contatoNome: "",
  contatoTelefone: "",
  instrucoesEntrega: "",
  padrao: false,
};

// Campos compartilhados entre "adicionar endereço" e "editar endereço" — só
// muda o `formAction` e os valores iniciais de quem chama. Mesmo padrão de
// CamposContato em ContatosClienteCard.tsx.
function CamposEndereco({ valoresIniciais }: { valoresIniciais: ValoresEndereco }) {
  const [tipo, setTipo] = useState<TipoEnderecoCliente>(valoresIniciais.tipo);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input label="Apelido" name="apelido" required defaultValue={valoresIniciais.apelido} placeholder="ex: Fábrica Extrema" />
        <Select label="Tipo" name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value as TipoEnderecoCliente)}>
          {ORDEM_TIPO_ENDERECO_CLIENTE.map((valor) => (
            <option key={valor} value={valor}>
              {ROTULO_TIPO_ENDERECO_CLIENTE[valor]}
            </option>
          ))}
        </Select>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input label="CEP" name="cep" defaultValue={valoresIniciais.cep} placeholder="00000-000" />
        <Input label="Logradouro" name="logradouro" defaultValue={valoresIniciais.logradouro} />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input label="Número" name="numero" defaultValue={valoresIniciais.numero} />
        <Input label="Complemento" name="complemento" defaultValue={valoresIniciais.complemento} placeholder="opcional" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input label="Bairro" name="bairro" defaultValue={valoresIniciais.bairro} />
        <Input label="Município" name="municipio" defaultValue={valoresIniciais.municipio} />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input label="UF" name="uf" defaultValue={valoresIniciais.uf} maxLength={2} placeholder="SP" />
        <Input
          label="Quem recebe"
          name="contatoNome"
          defaultValue={valoresIniciais.contatoNome}
          placeholder="ex: portaria, recebimento"
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input label="Telefone de quem recebe" name="contatoTelefone" defaultValue={valoresIniciais.contatoTelefone} />
      </div>
      <Input
        label="Instruções de entrega"
        name="instrucoesEntrega"
        defaultValue={valoresIniciais.instrucoesEntrega}
        placeholder="horário de recebimento, doca, agendamento, 'tocar interfone'..."
      />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="padrao"
          defaultChecked={valoresIniciais.padrao}
          className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
        />
        <span className="text-slate-700 dark:text-slate-200">Endereço padrão deste tipo</span>
      </label>
      <p className="text-xs text-slate-500">
        Marcar como padrão desmarca automaticamente o endereço padrão anterior do mesmo tipo (
        {ROTULO_TIPO_ENDERECO_CLIENTE[tipo]}) deste cliente.
      </p>
    </div>
  );
}

function AdicionarEnderecoForm({ clienteId, onFechar }: { clienteId: string; onFechar: () => void }) {
  const [state, formAction, isPending] = useActionState(criarEnderecoCliente, null);

  useAoMudar(state, (state) => {
    if (state?.ok) onFechar();
  });

  return (
    <form action={formAction} className="flex flex-col gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
      <input type="hidden" name="clienteId" value={clienteId} />
      <CamposEndereco valoresIniciais={VALORES_VAZIOS} />
      {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}
      <div className="flex items-center gap-2">
        <Button type="submit" variant="outline" loading={isPending}>
          {isPending ? "Adicionando..." : "Adicionar endereço"}
        </Button>
        <Button type="button" variant="ghost" onClick={onFechar}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

function EditarEnderecoForm({ endereco, onFechar }: { endereco: EnderecoClienteView; onFechar: () => void }) {
  const [state, formAction, isPending] = useActionState(atualizarEnderecoCliente, null);

  useAoMudar(state, (state) => {
    if (state?.ok) onFechar();
  });

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="enderecoId" value={endereco.id} />
      <CamposEndereco
        valoresIniciais={{
          apelido: endereco.apelido,
          tipo: endereco.tipo,
          cep: endereco.cep ?? "",
          logradouro: endereco.logradouro ?? "",
          numero: endereco.numero ?? "",
          complemento: endereco.complemento ?? "",
          bairro: endereco.bairro ?? "",
          municipio: endereco.municipio ?? "",
          codigoIbge: endereco.codigoIbge ?? "",
          uf: endereco.uf ?? "",
          contatoNome: endereco.contatoNome ?? "",
          contatoTelefone: endereco.contatoTelefone ?? "",
          instrucoesEntrega: endereco.instrucoesEntrega ?? "",
          padrao: endereco.padrao,
        }}
      />
      {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}
      <div className="flex items-center gap-2">
        <Button type="submit" variant="outline" loading={isPending}>
          {isPending ? "Salvando..." : "Salvar endereço"}
        </Button>
        <Button type="button" variant="ghost" onClick={onFechar}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

function LinhaEndereco({ endereco }: { endereco: EnderecoClienteView }) {
  const [editando, setEditando] = useState(false);
  const [estadoDesativar, desativarAction, desativando] = useActionState(desativarEnderecoCliente, null);
  const [estadoReativar, reativarAction, reativando] = useActionState(reativarEnderecoCliente, null);

  if (editando) {
    return (
      <div className="py-4">
        <EditarEnderecoForm endereco={endereco} onFechar={() => setEditando(false)} />
      </div>
    );
  }

  const linhaEndereco = [
    endereco.logradouro && endereco.numero ? `${endereco.logradouro}, ${endereco.numero}` : endereco.logradouro,
    endereco.bairro,
    endereco.municipio && endereco.uf ? `${endereco.municipio}/${endereco.uf}` : endereco.municipio,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex items-start justify-between gap-3 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium text-slate-800 dark:text-slate-100">{endereco.apelido}</p>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {ROTULO_TIPO_ENDERECO_CLIENTE[endereco.tipo]}
          </span>
          {endereco.padrao && (
            <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700 dark:bg-teal-900/30 dark:text-teal-400">
              Padrão
            </span>
          )}
          {!endereco.ativo && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              Desativado
            </span>
          )}
        </div>
        {linhaEndereco && <p className="mt-0.5 text-sm text-slate-500">{linhaEndereco}</p>}
        {endereco.contatoNome && (
          <p className="mt-0.5 text-xs text-slate-500">
            Recebe: {endereco.contatoNome}
            {endereco.contatoTelefone ? ` · ${endereco.contatoTelefone}` : ""}
          </p>
        )}
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
        {endereco.ativo ? (
          <form action={desativarAction}>
            <input type="hidden" name="enderecoId" value={endereco.id} />
            <button type="submit" disabled={desativando} className="font-medium text-slate-500 hover:underline">
              {desativando ? "Desativando..." : "Desativar"}
            </button>
          </form>
        ) : (
          <form action={reativarAction}>
            <input type="hidden" name="enderecoId" value={endereco.id} />
            <button type="submit" disabled={reativando} className="font-medium text-slate-500 hover:underline">
              {reativando ? "Reativando..." : "Reativar"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// Achado A5 da Parte 5 da auditoria de abrangência — gestão dos endereços
// adicionais de um cliente (comercial/cobrança/entrega), distintos do
// endereço fiscal único do cadastro (ClienteEditForm.tsx). Mesmo padrão
// visual de ContatosClienteCard.tsx (card standalone no detalhe do
// cliente), pra não competir por edição com os achados de tipo de
// pessoa/crédito/contatos já no mesmo arquivo.
export function EnderecoClienteCard({
  clienteId,
  enderecos,
  podeEditar,
}: {
  clienteId: string;
  enderecos: EnderecoClienteView[];
  podeEditar: boolean;
}) {
  const [adicionando, setAdicionando] = useState(false);

  return (
    <Card className="p-6">
      <div className="mb-1 flex items-center justify-between">
        <p className="text-sm font-medium text-slate-900 dark:text-white">Endereços</p>
        {podeEditar && !adicionando && (
          <button
            type="button"
            onClick={() => setAdicionando(true)}
            className="text-xs font-medium text-teal-700 hover:underline dark:text-teal-400"
          >
            + Adicionar endereço
          </button>
        )}
      </div>
      <p className="text-xs text-slate-500">
        Endereços adicionais deste cliente — quem paga a fatura e quem recebe a mercadoria podem ficar em lugares
        diferentes, e um mesmo cliente pode ter vários pontos de entrega. O endereço fiscal usado na nota fiscal fica
        no cadastro principal, acima.
      </p>

      {enderecos.length === 0 && !adicionando && (
        <p className="mt-4 text-sm text-slate-500">Nenhum endereço adicional cadastrado ainda.</p>
      )}

      {enderecos.length > 0 && (
        <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
          {enderecos.map((endereco) => (
            <LinhaEndereco key={endereco.id} endereco={endereco} />
          ))}
        </div>
      )}

      {podeEditar && adicionando && (
        <AdicionarEnderecoForm clienteId={clienteId} onFechar={() => setAdicionando(false)} />
      )}
    </Card>
  );
}
