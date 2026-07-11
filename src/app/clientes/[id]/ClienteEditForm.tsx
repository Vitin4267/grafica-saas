"use client";

import { useActionState, useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { ConfirmarExclusao } from "@/components/ui/ConfirmarExclusao";
import { UserIcon, MailIcon } from "@/components/icons";
import { atualizarCliente, excluirCliente } from "../actions";
import { EnderecoFields } from "../EnderecoFields";

type ValoresCliente = {
  nome: string;
  email: string;
  telefone: string;
  documento: string;
  enderecoCep: string;
  enderecoLogradouro: string;
  enderecoNumero: string;
  enderecoComplemento: string;
  enderecoBairro: string;
  enderecoMunicipio: string;
  enderecoCodigoIbge: string;
  enderecoUf: string;
};

export function ClienteEditForm({
  clienteId,
  valoresIniciais,
  podeEditar,
}: {
  clienteId: string;
  valoresIniciais: ValoresCliente;
  podeEditar: boolean;
}) {
  const [state, formAction, isPending] = useActionState(atualizarCliente, null);
  const [estadoExclusao, excluirAction, excluindo] = useActionState(excluirCliente, null);
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);

  useEffect(() => {
    if (estadoExclusao && !estadoExclusao.ok) setConfirmandoExclusao(false);
  }, [estadoExclusao]);

  if (!podeEditar) {
    return (
      <Card className="flex flex-col gap-2 p-6 text-sm">
        <p className="text-slate-700 dark:text-slate-200">
          {[valoresIniciais.email, valoresIniciais.telefone].filter(Boolean).join(" · ") || "—"}
        </p>
        <p className="text-slate-500">CPF/CNPJ: {valoresIniciais.documento || "—"}</p>
        <p className="mt-2 text-xs text-slate-400">Você tem acesso só de visualização a esta tela.</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-6">
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="clienteId" value={clienteId} />
        <Input
          label="Nome"
          name="nome"
          required
          defaultValue={valoresIniciais.nome}
          icon={<UserIcon className="h-4 w-4" />}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="E-mail"
            name="email"
            type="email"
            defaultValue={valoresIniciais.email}
            icon={<MailIcon className="h-4 w-4" />}
          />
          <Input
            label="Telefone"
            name="telefone"
            defaultValue={valoresIniciais.telefone}
            placeholder="(00) 00000-0000"
          />
        </div>
        <Input label="CPF/CNPJ" name="documento" defaultValue={valoresIniciais.documento} placeholder="opcional" />

        <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
          <p className="mb-3 text-sm font-medium text-slate-700 dark:text-slate-200">
            Endereço <span className="font-normal text-slate-400">(necessário pra emitir nota fiscal)</span>
          </p>
          <EnderecoFields
            valoresIniciais={{
              cep: valoresIniciais.enderecoCep,
              logradouro: valoresIniciais.enderecoLogradouro,
              numero: valoresIniciais.enderecoNumero,
              complemento: valoresIniciais.enderecoComplemento,
              bairro: valoresIniciais.enderecoBairro,
              municipio: valoresIniciais.enderecoMunicipio,
              uf: valoresIniciais.enderecoUf,
              codigoIbge: valoresIniciais.enderecoCodigoIbge,
            }}
          />
        </div>

        {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}

        <Button type="submit" loading={isPending} className="self-start">
          {isPending ? "Salvando..." : "Salvar cliente"}
        </Button>
      </form>
    </Card>

      <Card className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-900 dark:text-white">Excluir cliente</p>
            <p className="text-xs text-slate-500">
              Remove os dados pessoais deste cliente. Só é possível se ele não tiver orçamentos
              vinculados.
            </p>
            {estadoExclusao && !estadoExclusao.ok && (
              <p className="mt-1 text-xs text-rose-600">{estadoExclusao.mensagem}</p>
            )}
          </div>
          {!confirmandoExclusao && (
            <Button
              type="button"
              variant="outline"
              className="shrink-0 text-rose-600"
              onClick={() => setConfirmandoExclusao(true)}
            >
              Excluir
            </Button>
          )}
        </div>
        {confirmandoExclusao && (
          <ConfirmarExclusao
            pergunta={`Tem certeza que quer excluir "${valoresIniciais.nome}"? Essa ação não pode ser desfeita.`}
            onCancelar={() => setConfirmandoExclusao(false)}
            formAction={excluirAction}
            campos={{ clienteId }}
            rotuloBotao="Excluir cliente"
            pendente={excluindo}
          />
        )}
      </Card>
    </div>
  );
}
