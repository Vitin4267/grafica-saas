"use client";

import { useActionState, useState } from "react";
import { useAoMudar } from "@/lib/hooks/useAoMudar";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { ConfirmarExclusao } from "@/components/ui/ConfirmarExclusao";
import { UserIcon, MailIcon } from "@/components/icons";
import {
  atualizarCliente,
  excluirCliente,
  desativarCliente,
  reativarCliente,
  anonimizarCliente,
} from "../actions";
import { EnderecoFields } from "../EnderecoFields";
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
import type { OrigemCliente, SegmentoCliente, TipoPessoa, IndicadorInscricaoEstadual } from "@/generated/prisma/enums";

type ValoresCliente = {
  nome: string;
  email: string;
  telefone: string;
  documento: string;
  tipoPessoa: TipoPessoa | "";
  razaoSocial: string;
  nomeFantasia: string;
  inscricaoEstadual: string;
  indicadorInscricaoEstadual: IndicadorInscricaoEstadual | "";
  inscricaoMunicipal: string;
  enderecoCep: string;
  enderecoLogradouro: string;
  enderecoNumero: string;
  enderecoComplemento: string;
  enderecoBairro: string;
  enderecoMunicipio: string;
  enderecoCodigoIbge: string;
  enderecoUf: string;
  bloqueadoParaVenda: boolean;
  motivoBloqueio: string;
  // Achado A6 da Parte 4 — string vazia = sem limite configurado (mesmo
  // padrão de margemPadraoOverride abaixo: Decimal do Prisma não atravessa
  // a fronteira Server→Client).
  limiteCredito: string;
  prazoPagamentoPadraoDias: string;
  bloqueadoParaFaturamento: boolean;
  motivoBloqueioFaturamento: string;
  observacoes: string;
  preferenciasProducao: string;
  origem: OrigemCliente | "";
  origemOutro: string;
  segmento: SegmentoCliente | "";
  segmentoOutro: string;
  // string vazia = sem override — mesmo padrão de motivoBloqueio abaixo
  // (Decimal do Prisma não atravessa a fronteira Server→Client, e o valor
  // "cru" da coluna já é a fração 0-1 que o Input mostra direto).
  margemPadraoOverride: string;
  // Achado A8 — vendedor/responsável comercial do cliente. "" = não atribuído.
  vendedorId: string;
  // ISO string ou null — Date não atravessa a fronteira Server→Client
  // Component (mesmo padrão de FuncionarioDesativado em UsuariosLista.tsx).
  desativadoEm: string | null;
};

export function ClienteEditForm({
  clienteId,
  valoresIniciais,
  podeEditar,
  vendedores,
}: {
  clienteId: string;
  valoresIniciais: ValoresCliente;
  podeEditar: boolean;
  vendedores: { id: string; nome: string }[];
}) {
  const [state, formAction, isPending] = useActionState(atualizarCliente, null);
  const [estadoExclusao, excluirAction, excluindo] = useActionState(excluirCliente, null);
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);
  const [estadoDesativar, desativarAction, desativando] = useActionState(desativarCliente, null);
  const [estadoReativar, reativarAction, reativando] = useActionState(reativarCliente, null);
  const [estadoAnonimizar, anonimizarAction, anonimizando] = useActionState(anonimizarCliente, null);
  const [confirmandoDesativacao, setConfirmandoDesativacao] = useState(false);
  const [confirmandoAnonimizacao, setConfirmandoAnonimizacao] = useState(false);
  const [mostrarBloqueio, setMostrarBloqueio] = useState(valoresIniciais.bloqueadoParaVenda);
  const [mostrarBloqueioFaturamento, setMostrarBloqueioFaturamento] = useState(
    valoresIniciais.bloqueadoParaFaturamento
  );
  const [origem, setOrigem] = useState<OrigemCliente | "">(valoresIniciais.origem);
  const [segmento, setSegmento] = useState<SegmentoCliente | "">(valoresIniciais.segmento);
  const [tipoPessoa, setTipoPessoa] = useState<TipoPessoa | "">(valoresIniciais.tipoPessoa);

  useAoMudar(estadoExclusao, (estadoExclusao) => {
    if (estadoExclusao && !estadoExclusao.ok) setConfirmandoExclusao(false);
  });
  useAoMudar(estadoDesativar, (estado) => {
    if (estado && !estado.ok) setConfirmandoDesativacao(false);
  });
  useAoMudar(estadoAnonimizar, (estado) => {
    if (estado && !estado.ok) setConfirmandoAnonimizacao(false);
  });

  const desativado = Boolean(valoresIniciais.desativadoEm);

  if (!podeEditar) {
    return (
      <Card className="flex flex-col gap-2 p-6 text-sm">
        {desativado && (
          <span className="mb-1 w-fit rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            Desativado
          </span>
        )}
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
        {desativado && (
          <span className="w-fit rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            Desativado
            {valoresIniciais.desativadoEm &&
              ` em ${new Date(valoresIniciais.desativadoEm).toLocaleDateString("pt-BR")}`}
          </span>
        )}
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
                defaultValue={valoresIniciais.razaoSocial}
                hint="Usada na nota fiscal em vez do nome — o nome fantasia não tem validade jurídica pra NF-e"
              />
              <Input label="Nome fantasia" name="nomeFantasia" defaultValue={valoresIniciais.nomeFantasia} />
              <Select
                label="Indicador de Inscrição Estadual"
                name="indicadorInscricaoEstadual"
                defaultValue={valoresIniciais.indicadorInscricaoEstadual}
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
                defaultValue={valoresIniciais.inscricaoEstadual}
                placeholder="obrigatória se contribuinte de ICMS"
              />
              <Input
                label="Inscrição Municipal"
                name="inscricaoMunicipal"
                defaultValue={valoresIniciais.inscricaoMunicipal}
                placeholder="opcional"
              />
            </div>
          )}
        </div>

        <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="bloqueadoParaVenda"
              defaultChecked={valoresIniciais.bloqueadoParaVenda}
              onChange={(e) => setMostrarBloqueio(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
            />
            <span>
              <span className="block font-medium text-slate-700 dark:text-slate-200">
                Bloqueado para venda a prazo
              </span>
              <span className="block text-xs text-slate-500">
                Cliente continua sendo atendido, mas quem aprovar um orçamento pra ele vê um aviso
                (não impede a aprovação).
              </span>
            </span>
          </label>
          {mostrarBloqueio && (
            <Textarea
              label="Motivo do bloqueio"
              name="motivoBloqueio"
              defaultValue={valoresIniciais.motivoBloqueio}
              placeholder="Ex: inadimplente desde 10/2026"
              rows={2}
              className="mt-3"
              maxLength={300}
            />
          )}
        </div>

        <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
          <p className="mb-3 text-sm font-medium text-slate-700 dark:text-slate-200">Crédito</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Limite de crédito (R$)"
              name="limiteCredito"
              type="number"
              step="0.01"
              min="0"
              defaultValue={valoresIniciais.limiteCredito}
              placeholder="em branco = sem limite"
              hint="Soma das contas a receber pendentes do cliente + orçamento sendo aprovado — se ultrapassar, quem aprovar vê um aviso (ou a aprovação é recusada, se ligado em Configurações)"
            />
            <Input
              label="Prazo de pagamento padrão (dias)"
              name="prazoPagamentoPadraoDias"
              type="number"
              step="1"
              min="0"
              defaultValue={valoresIniciais.prazoPagamentoPadraoDias}
              placeholder="ex: 30"
            />
          </div>
          <label className="mt-4 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="bloqueadoParaFaturamento"
              defaultChecked={valoresIniciais.bloqueadoParaFaturamento}
              onChange={(e) => setMostrarBloqueioFaturamento(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
            />
            <span>
              <span className="block font-medium text-slate-700 dark:text-slate-200">
                Bloqueado para faturamento
              </span>
              <span className="block text-xs text-slate-500">
                Trava comercial ligada a crédito/cobrança — quem aprovar um orçamento pra ele vê um
                aviso (não impede a aprovação). Diferente de &quot;bloqueado para venda&quot; acima:
                use os dois, um, ou nenhum, sem conflito.
              </span>
            </span>
          </label>
          {mostrarBloqueioFaturamento && (
            <Textarea
              label="Motivo do bloqueio de faturamento"
              name="motivoBloqueioFaturamento"
              defaultValue={valoresIniciais.motivoBloqueioFaturamento}
              placeholder="Ex: fatura de julho em atraso"
              rows={2}
              className="mt-3"
              maxLength={300}
            />
          )}
        </div>

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
              <Input
                label="Descreva a origem"
                name="origemOutro"
                defaultValue={valoresIniciais.origemOutro}
                placeholder="ex: parceria com..."
                required
              />
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
              <Input
                label="Descreva o segmento"
                name="segmentoOutro"
                defaultValue={valoresIniciais.segmentoOutro}
                placeholder="ex: cooperativa..."
                required
              />
            )}
            <Input
              label="Margem diferenciada (%)"
              name="margemPadraoOverride"
              type="number"
              step="0.0001"
              min="0"
              defaultValue={valoresIniciais.margemPadraoOverride}
              placeholder="ex: 0.15"
              hint="Sobrescreve a margem padrão da gráfica só pra este cliente — em branco usa o padrão de Configurações"
            />
            <Select label="Vendedor responsável" name="vendedorId" defaultValue={valoresIniciais.vendedorId}>
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
          defaultValue={valoresIniciais.observacoes}
          placeholder="Nota comercial visível só pra sua equipe"
          hint="Nunca aparece no PDF nem no link público do orçamento"
          maxLength={2000}
        />
        <Textarea
          label="Preferências de produção"
          name="preferenciasProducao"
          defaultValue={valoresIniciais.preferenciasProducao}
          placeholder='Ex: "sempre mandar arte em RGB", "só recebe às terças"'
          hint="Aparece na Ordem de Produção"
          maxLength={2000}
        />

        {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}

        <Button type="submit" loading={isPending} className="self-start">
          {isPending ? "Salvando..." : "Salvar cliente"}
        </Button>
      </form>
    </Card>

      <Card className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-900 dark:text-white">
              {desativado ? "Reativar cliente" : "Desativar cliente"}
            </p>
            <p className="text-xs text-slate-500">
              {desativado
                ? "Volta a aparecer nas listas e nos dropdowns de orçamento, produção e relatórios."
                : "Some das listas e dos dropdowns de seleção. O histórico (orçamentos, notas fiscais) continua intacto, e dá pra reativar depois."}
            </p>
            {estadoDesativar && !estadoDesativar.ok && (
              <p className="mt-1 text-xs text-rose-600">{estadoDesativar.mensagem}</p>
            )}
            {estadoReativar && !estadoReativar.ok && (
              <p className="mt-1 text-xs text-rose-600">{estadoReativar.mensagem}</p>
            )}
          </div>
          {desativado ? (
            <form action={reativarAction}>
              <input type="hidden" name="clienteId" value={clienteId} />
              <Button type="submit" variant="outline" loading={reativando} className="shrink-0">
                Reativar
              </Button>
            </form>
          ) : (
            !confirmandoDesativacao && (
              <Button
                type="button"
                variant="outline"
                className="shrink-0"
                onClick={() => setConfirmandoDesativacao(true)}
              >
                Desativar
              </Button>
            )
          )}
        </div>
        {!desativado && confirmandoDesativacao && (
          <ConfirmarExclusao
            pergunta={`Desativar "${valoresIniciais.nome}"? Ele some das listas, mas o histórico continua intacto e dá pra reativar depois.`}
            onCancelar={() => setConfirmandoDesativacao(false)}
            formAction={desativarAction}
            campos={{ clienteId }}
            rotuloBotao="Desativar"
            pendente={desativando}
          />
        )}
      </Card>

      <Card className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-900 dark:text-white">Excluir cliente</p>
            <p className="text-xs text-slate-500">
              Apaga o cadastro por completo. Só é possível se ele não tiver orçamentos vinculados —
              se tiver, use &quot;Desativar&quot; acima ou &quot;Anonimizar dados&quot; abaixo.
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

      <Card className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-900 dark:text-white">
              Anonimizar dados pessoais (LGPD)
            </p>
            <p className="text-xs text-slate-500">
              Apaga nome, documento, e-mail, telefone e endereço deste cliente — pra atender um
              pedido de exclusão de dado pessoal. Orçamentos e notas fiscais vinculados são
              preservados (obrigação fiscal de retenção). Essa ação não pode ser desfeita.
            </p>
            {estadoAnonimizar && !estadoAnonimizar.ok && (
              <p className="mt-1 text-xs text-rose-600">{estadoAnonimizar.mensagem}</p>
            )}
            {estadoAnonimizar && estadoAnonimizar.ok && (
              <p className="mt-1 text-xs text-emerald-600">{estadoAnonimizar.mensagem}</p>
            )}
          </div>
          {!confirmandoAnonimizacao && (
            <Button
              type="button"
              variant="outline"
              className="shrink-0 text-rose-600"
              onClick={() => setConfirmandoAnonimizacao(true)}
            >
              Anonimizar
            </Button>
          )}
        </div>
        {confirmandoAnonimizacao && (
          <ConfirmarExclusao
            pergunta={`Anonimizar os dados pessoais de "${valoresIniciais.nome}"? Não pode ser desfeito. Orçamentos e notas fiscais continuam intactos.`}
            onCancelar={() => setConfirmandoAnonimizacao(false)}
            formAction={anonimizarAction}
            campos={{ clienteId }}
            rotuloBotao="Anonimizar dados"
            pendente={anonimizando}
          />
        )}
      </Card>
    </div>
  );
}
