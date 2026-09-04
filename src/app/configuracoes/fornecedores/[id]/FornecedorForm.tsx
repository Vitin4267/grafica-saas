"use client";

import { useActionState } from "react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { EnderecoFields, type ValoresEndereco } from "@/app/clientes/EnderecoFields";
import { editarFornecedor, alternarAtivoFornecedor } from "../actions";

export function FornecedorForm({
  fornecedorId,
  nome,
  contato,
  ativo,
  documento,
  endereco,
}: {
  fornecedorId: string;
  nome: string;
  contato: string;
  ativo: boolean;
  // Achado R3 da auditoria de abrangência (rodada 20, 2026-09-03) —
  // opcionais: só passam a ser exigidos na hora de EMITIR a NF-e de
  // remessa de terceirização (ver fornecedorProntoParaNfe em
  // src/lib/nota-fiscal.ts), nunca aqui no cadastro em si.
  documento: string;
  endereco: ValoresEndereco;
}) {
  const [state, formAction, isPending] = useActionState(editarFornecedor, null);
  const [estadoAtivo, alternarAction, alternandoPending] = useActionState(
    alternarAtivoFornecedor,
    null
  );

  return (
    <div className="flex flex-col gap-6">
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="fornecedorId" value={fornecedorId} />
        <Card className="flex flex-col gap-4 p-6">
          <Input label="Nome" name="nome" type="text" defaultValue={nome} required />
          <Input label="Contato (opcional)" name="contato" type="text" defaultValue={contato} />
        </Card>
        <Card className="flex flex-col gap-4 p-6">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              Dados fiscais (opcional)
            </h2>
            <p className="text-xs text-slate-500">
              Só precisa preencher se for emitir NF-e de remessa pra industrialização direto do
              sistema (Produção → Terceirização). Sem isso, a terceirização continua funcionando
              normalmente — só o botão de emissão automática fica indisponível.
            </p>
          </div>
          <Input label="CPF/CNPJ" name="documento" defaultValue={documento} placeholder="opcional" />
          <EnderecoFields valoresIniciais={endereco} />
        </Card>
        {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}
        <Button type="submit" loading={isPending} className="self-start">
          {isPending ? "Salvando..." : "Salvar"}
        </Button>
      </form>

      <Card className="flex items-center justify-between gap-4 p-5">
        <div>
          <p className="text-sm font-medium text-slate-900 dark:text-white">
            {ativo ? "Fornecedor ativo" : "Fornecedor inativo"}
          </p>
          <p className="text-xs text-slate-500">
            {ativo
              ? "Aparece pra seleção ao registrar uma entrada de compra, em Catálogo."
              : "Some da seleção ao registrar nova compra, mas compras já registradas com ele continuam no histórico. Nunca é excluído de verdade."}
          </p>
          {estadoAtivo && !estadoAtivo.ok && (
            <p className="mt-1 text-xs text-rose-600">{estadoAtivo.mensagem}</p>
          )}
        </div>
        <form action={alternarAction}>
          <input type="hidden" name="fornecedorId" value={fornecedorId} />
          <Button type="submit" variant="outline" loading={alternandoPending} className="shrink-0">
            {ativo ? "Desativar" : "Ativar"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
