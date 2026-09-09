"use client";

import { useActionState, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { EnderecoFields, type ValoresEndereco } from "@/app/clientes/EnderecoFields";
import {
  ORDEM_CATEGORIA_FORNECEDOR,
  ROTULO_CATEGORIA_FORNECEDOR,
  ORDEM_CONDICAO_PAGAMENTO_FORNECEDOR,
  ROTULO_CONDICAO_PAGAMENTO_FORNECEDOR,
} from "@/lib/tipos-fornecedor";
import { editarFornecedor, alternarAtivoFornecedor } from "../actions";
import type { CategoriaFornecedor, CondicaoPagamentoFornecedor } from "@/generated/prisma/enums";

export function FornecedorForm({
  fornecedorId,
  nome,
  contato,
  ativo,
  documento,
  endereco,
  email,
  telefone,
  categoria,
  categoriaOutro,
  condicaoPagamentoPadrao,
  condicaoPagamentoPadraoOutro,
  prazoEntregaMedioDias,
  pedidoMinimoValor,
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
  // Achado A5 da Parte 3 (Compras) da auditoria de abrangência — cadastro
  // enriquecido, todos opcionais (ver comentário no model Fornecedor).
  email: string;
  telefone: string;
  categoria: CategoriaFornecedor | "";
  categoriaOutro: string;
  condicaoPagamentoPadrao: CondicaoPagamentoFornecedor | "";
  condicaoPagamentoPadraoOutro: string;
  prazoEntregaMedioDias: string;
  pedidoMinimoValor: string;
}) {
  const [state, formAction, isPending] = useActionState(editarFornecedor, null);
  const [estadoAtivo, alternarAction, alternandoPending] = useActionState(
    alternarAtivoFornecedor,
    null
  );
  const [categoriaAtual, setCategoriaAtual] = useState(categoria);
  const [condicaoAtual, setCondicaoAtual] = useState(condicaoPagamentoPadrao);

  return (
    <div className="flex flex-col gap-6">
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="fornecedorId" value={fornecedorId} />
        <Card className="flex flex-col gap-4 p-6">
          <Input label="Nome" name="nome" type="text" defaultValue={nome} required />
          <Input label="Contato (opcional)" name="contato" type="text" defaultValue={contato} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="E-mail (opcional)" name="email" type="email" defaultValue={email} />
            <Input label="Telefone (opcional)" name="telefone" type="text" defaultValue={telefone} />
          </div>
        </Card>

        <Card className="flex flex-col gap-4 p-6">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              Perfil de compra (opcional)
            </h2>
            <p className="text-xs text-slate-500">
              Categoria do que este fornecedor vende, condição de pagamento negociada, prazo
              de entrega médio e pedido mínimo — informativo, não gera nenhuma cobrança ou
              conta a pagar sozinho.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Select
              label="Categoria"
              name="categoria"
              value={categoriaAtual}
              onChange={(e) => setCategoriaAtual(e.target.value as CategoriaFornecedor | "")}
            >
              <option value="">Não classificado</option>
              {ORDEM_CATEGORIA_FORNECEDOR.map((valor) => (
                <option key={valor} value={valor}>
                  {ROTULO_CATEGORIA_FORNECEDOR[valor]}
                </option>
              ))}
            </Select>
            <Select
              label="Condição de pagamento padrão"
              name="condicaoPagamentoPadrao"
              value={condicaoAtual}
              onChange={(e) => setCondicaoAtual(e.target.value as CondicaoPagamentoFornecedor | "")}
            >
              <option value="">Não definida</option>
              {ORDEM_CONDICAO_PAGAMENTO_FORNECEDOR.map((valor) => (
                <option key={valor} value={valor}>
                  {ROTULO_CONDICAO_PAGAMENTO_FORNECEDOR[valor]}
                </option>
              ))}
            </Select>
          </div>
          {categoriaAtual === "OUTRO" && (
            <Input
              label="Descreva a categoria"
              name="categoriaOutro"
              type="text"
              defaultValue={categoriaOutro}
              required
            />
          )}
          {condicaoAtual === "OUTRO" && (
            <Input
              label="Descreva a condição de pagamento"
              name="condicaoPagamentoPadraoOutro"
              type="text"
              defaultValue={condicaoPagamentoPadraoOutro}
              required
            />
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Prazo de entrega médio, em dias"
              name="prazoEntregaMedioDias"
              type="number"
              min="0"
              step="1"
              defaultValue={prazoEntregaMedioDias}
              placeholder="opcional"
            />
            <Input
              label="Pedido mínimo, em R$"
              name="pedidoMinimoValor"
              type="number"
              min="0"
              step="0.01"
              defaultValue={pedidoMinimoValor}
              placeholder="opcional"
            />
          </div>
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
