"use client";

import { useActionState, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { CampoAjuda } from "@/components/ui/CampoAjuda";
import { formatoMoeda } from "@/lib/moeda";
import { formatoInstanteReal, formatoData } from "@/lib/data";
import { chaveComparativo } from "@/lib/comparativo-fornecedores";
import { contratosAplicaveis, type ContratoAtivoResumo } from "@/lib/contrato-fornecimento";
import { rotuloUnidadeCompra } from "@/lib/unidade-compra";
import { criarSolicitacaoCompra } from "../actions";
import { ORIGENS_SOLICITACAO_COMPRA, ROTULOS_ORIGEM_SOLICITACAO_COMPRA, type OrigemSolicitacaoCompra } from "@/lib/compras-status";
import {
  UNIDADES_COMPRA,
  ROTULO_UNIDADE_COMPRA,
  calcularQuantidadeEstoque,
  avisoMultiploCompra,
  type UnidadeCompra,
} from "@/lib/unidade-compra";

type Material = {
  id: string;
  nome: string;
  unidade: string;
  variantes: { id: string; rotulo: string }[];
  // Achado A6 da auditoria de abrangência (Parte 3/Compras) — configuração
  // padrão de unidade de compra deste item (ver ItemGrafica no schema).
  // String vazia = sem padrão configurado.
  unidadeCompraPadrao: string;
  unidadeCompraPadraoOutro: string;
  fatorConversaoCompraPadrao: string;
  loteMinimoCompra: string;
  multiploCompra: string;
};

// Versão serializada (datas em ISO) de LinhaComparativoFornecedor — ver
// comparativo-fornecedores.ts pra lógica de agrupamento/ordenação.
type LinhaComparativo = {
  fornecedorId: string;
  fornecedorNome: string;
  ultimoPreco: number;
  ultimaCompraEm: string;
  historico: { preco: number; data: string }[];
};

export function NovaSolicitacaoForm({
  materiais,
  fornecedores,
  itemGraficaIdInicial,
  varianteIdInicial,
  comparativoPorChave,
  pedidos,
  contratosAtivos,
}: {
  materiais: Material[];
  // Fornecedores ativos da gráfica — "Ainda não definido" é sempre válido
  // (a solicitação pode nascer em SOLICITADO/COTANDO sem fornecedor, ver
  // model SolicitacaoCompra no schema).
  fornecedores: { id: string; nome: string }[];
  itemGraficaIdInicial: string;
  varianteIdInicial: string;
  // Comparativo de preço por fornecedor de CADA matéria-prima/variante ativa
  // da gráfica, já calculado no servidor (ver page.tsx) — chaveado por
  // varianteId quando existe, senão itemGraficaId (mesma convenção de
  // chaveComparativo). Trocar a seleção no formulário só troca qual entrada
  // deste objeto é exibida, sem round-trip ao servidor.
  comparativoPorChave: Record<string, LinhaComparativo[]>;
  // Pedidos elegíveis pra origem=PEDIDO_ESPECIFICO (achado A3 da auditoria
  // de abrangência, Parte 3/Compras) — só aparece quando essa origem é
  // escolhida.
  pedidos: { id: string; clienteNome: string }[];
  // Contratos de fornecimento ATIVOS e dentro da vigência da gráfica inteira
  // (achado A9 da auditoria de abrangência, Parte 3/Compras) — filtrados no
  // client pra matéria-prima/variante escolhida (ver contratosAplicaveis),
  // sem round-trip ao servidor a cada troca de seleção.
  contratosAtivos: ContratoAtivoResumo[];
}) {
  const [state, formAction, pending] = useActionState(criarSolicitacaoCompra, null);
  const materialInicial = materiais.find((m) => m.id === (itemGraficaIdInicial || materiais[0]?.id)) ?? null;
  const [itemGraficaId, setItemGraficaId] = useState(itemGraficaIdInicial || materiais[0]?.id || "");
  const [varianteId, setVarianteId] = useState(varianteIdInicial);
  const [origem, setOrigem] = useState<OrigemSolicitacaoCompra>("REPOSICAO_ESTOQUE");
  // Achado A9 da auditoria de abrangência (Parte 3/Compras) — fornecedorId
  // precisa ser controlado (não só defaultValue) pra "usar este contrato"
  // poder selecioná-lo programaticamente junto com a origem. contratoFornecimentoId
  // vai num campo oculto, só preenchido depois de clicar "usar este contrato"
  // (nunca confia em origem=CONTRATO_PROGRAMADO sozinha no servidor).
  const [fornecedorId, setFornecedorId] = useState("");
  const [contratoFornecimentoId, setContratoFornecimentoId] = useState("");
  // Achado A6 da auditoria de abrangência (Parte 3/Compras): "" = compra
  // digitada direto na unidade de estoque (comportamento de hoje). Pré-
  // preenchido a partir de ItemGrafica.unidadeCompraPadrao/
  // fatorConversaoCompraPadrao do material inicial, e de novo toda vez que o
  // material selecionado muda (ver onChange do Select de matéria-prima).
  const [unidadeCompra, setUnidadeCompra] = useState(materialInicial?.unidadeCompraPadrao ?? "");
  const [quantidadeCompraTexto, setQuantidadeCompraTexto] = useState("");
  const [fatorConversaoCompraTexto, setFatorConversaoCompraTexto] = useState(
    materialInicial?.fatorConversaoCompraPadrao ?? ""
  );

  const materialSelecionado = materiais.find((m) => m.id === itemGraficaId) ?? null;

  // Achado A9 da auditoria de abrangência (Parte 3/Compras) — contratos de
  // fornecimento ativos que cobrem a matéria-prima/variante selecionada,
  // mais barato primeiro (ver contratosAplicaveis).
  const contratosParaSelecao = materialSelecionado
    ? contratosAplicaveis(contratosAtivos, materialSelecionado.id, varianteId || null)
    : [];

  // Preview da conversão (quantidadeCompra × fatorConversaoCompra =
  // quantidade em unidade de estoque) — a mesma fórmula usada no servidor
  // (calcularQuantidadeEstoque), só que aqui é exibição, nunca escondida do
  // comprador (ver achado A6). null enquanto faltar algum dos dois números.
  const quantidadeCompraNumero = Number(quantidadeCompraTexto);
  const fatorConversaoCompraNumero = Number(fatorConversaoCompraTexto);
  const quantidadeEstoquePreview =
    unidadeCompra &&
    quantidadeCompraTexto.trim() !== "" &&
    fatorConversaoCompraTexto.trim() !== "" &&
    Number.isFinite(quantidadeCompraNumero) &&
    Number.isFinite(fatorConversaoCompraNumero)
      ? calcularQuantidadeEstoque(quantidadeCompraNumero, fatorConversaoCompraNumero)
      : null;

  // Aviso NÃO BLOQUEANTE de lote/múltiplo — nunca impede o envio do
  // formulário, só avisa antes de enviar (ver avisoMultiploCompra).
  const rotuloUnidadeCompraAtual = unidadeCompra ? ROTULO_UNIDADE_COMPRA[unidadeCompra as UnidadeCompra] : "";
  const avisoLote =
    unidadeCompra && quantidadeCompraTexto.trim() !== "" && Number.isFinite(quantidadeCompraNumero) && materialSelecionado
      ? avisoMultiploCompra(
          quantidadeCompraNumero,
          materialSelecionado.multiploCompra ? Number(materialSelecionado.multiploCompra) : null,
          rotuloUnidadeCompraAtual
        )
      : null;

  // Enquanto a matéria-prima tem variante mas nenhuma foi escolhida ainda,
  // não faz sentido comparar preço (o preço é POR variante, ex: chapa 2mm ×
  // 5mm) — só mostra o comparativo quando a chave está totalmente resolvida.
  const aguardandoVariante = (materialSelecionado?.variantes.length ?? 0) > 0 && !varianteId;
  const comparativo =
    materialSelecionado && !aguardandoVariante
      ? (comparativoPorChave[chaveComparativo(materialSelecionado.id, varianteId || null)] ?? [])
      : [];

  return (
    <Card className="p-6">
      <form action={formAction} className="flex flex-col gap-4">
        <Select
          label="Matéria-prima"
          name="itemGraficaId"
          value={itemGraficaId}
          onChange={(e) => {
            const novoId = e.target.value;
            setItemGraficaId(novoId);
            setVarianteId("");
            const novoMaterial = materiais.find((m) => m.id === novoId);
            setUnidadeCompra(novoMaterial?.unidadeCompraPadrao ?? "");
            setFatorConversaoCompraTexto(novoMaterial?.fatorConversaoCompraPadrao ?? "");
            setQuantidadeCompraTexto("");
            setContratoFornecimentoId(""); // troca de item invalida o contrato escolhido antes
          }}
          required
        >
          {materiais.map((material) => (
            <option key={material.id} value={material.id}>
              {material.nome}
            </option>
          ))}
        </Select>

        <Select
          label={
            <>
              Origem da compra
              <CampoAjuda texto="Diz por que esta compra está sendo feita. Reposição de estoque é quando o nível do material ficou baixo, Pedido específico é quando a compra é pra atender um pedido de um cliente, e Contrato programado usa um contrato já negociado com o fornecedor. Ajuda a acompanhar de onde vêm as compras da gráfica ao longo do tempo." />
            </>
          }
          name="origem"
          value={origem}
          onChange={(e) => {
            const novaOrigem = e.target.value as OrigemSolicitacaoCompra;
            setOrigem(novaOrigem);
            // Escolher outra origem manualmente invalida o contrato marcado
            // por "usar este contrato" — nunca deixa um contratoFornecimentoId
            // órfão de uma origem que não é mais CONTRATO_PROGRAMADO.
            if (novaOrigem !== "CONTRATO_PROGRAMADO") setContratoFornecimentoId("");
          }}
        >
          {ORIGENS_SOLICITACAO_COMPRA.map((o) => (
            <option key={o} value={o}>
              {ROTULOS_ORIGEM_SOLICITACAO_COMPRA[o]}
            </option>
          ))}
        </Select>

        {origem === "PEDIDO_ESPECIFICO" &&
          (pedidos.length > 0 ? (
            <Select label="Pedido" name="pedidoId" defaultValue="" required>
              <option value="">Selecione...</option>
              {pedidos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.clienteNome} — {p.id.slice(-8)}
                </option>
              ))}
            </Select>
          ) : (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Nenhum pedido em andamento pra vincular esta compra.
            </p>
          ))}

        {origem === "OUTRO" && <Input label="Qual? (opcional)" name="origemOutro" type="text" maxLength={120} />}

        {materialSelecionado && materialSelecionado.variantes.length > 0 && (
          <Select
            label="Variante"
            name="varianteId"
            value={varianteId}
            onChange={(e) => {
              setVarianteId(e.target.value);
              setContratoFornecimentoId(""); // troca de variante invalida o contrato escolhido antes
            }}
            required
          >
            <option value="">Selecione...</option>
            {materialSelecionado.variantes.map((variante) => (
              <option key={variante.id} value={variante.id}>
                {variante.rotulo}
              </option>
            ))}
          </Select>
        )}

        <input type="hidden" name="contratoFornecimentoId" value={contratoFornecimentoId} />

        {materialSelecionado && !aguardandoVariante && contratosParaSelecao.length > 0 && (
          <ContratoAtivoCard
            contratos={contratosParaSelecao}
            contratoSelecionadoId={contratoFornecimentoId}
            onUsar={(contrato) => {
              setOrigem("CONTRATO_PROGRAMADO");
              setFornecedorId(contrato.fornecedorId);
              setContratoFornecimentoId(contrato.id);
            }}
          />
        )}

        {origem === "CONTRATO_PROGRAMADO" && !contratoFornecimentoId && (
          <Alert variant="warning">
            Selecione um contrato ativo acima pra usar esta origem — sem isso a solicitação não pode nascer
            aprovada automaticamente.
          </Alert>
        )}

        {materialSelecionado && !aguardandoVariante && (
          <ComparativoFornecedoresCard
            unidade={materialSelecionado.unidade}
            linhas={comparativo}
            aindaSemHistorico={comparativo.length === 0}
          />
        )}

        <div className="w-52">
          <Select
            label={
              <>
                Unidade de compra (opcional)
                <CampoAjuda texto="Use quando você compra este material numa unidade diferente da que usa no estoque — por exemplo, compra em rolo ou fardo, mas controla o estoque em metro ou unidade. Ao escolher, o sistema pede o fator de conversão e calcula sozinho quanto isso representa no estoque." />
              </>
            }
            name="unidadeCompra"
            value={unidadeCompra}
            onChange={(e) => setUnidadeCompra(e.target.value)}
          >
            <option value="">
              Direto na unidade de estoque{materialSelecionado?.unidade ? ` (${materialSelecionado.unidade})` : ""}
            </option>
            {UNIDADES_COMPRA.map((u) => (
              <option key={u} value={u}>
                {ROTULO_UNIDADE_COMPRA[u as UnidadeCompra]}
              </option>
            ))}
          </Select>
        </div>

        {unidadeCompra ? (
          <div className="flex flex-wrap items-end gap-3">
            {unidadeCompra === "OUTRO" && (
              <div className="w-40">
                <Input label="Qual? (opcional)" name="unidadeCompraOutro" type="text" maxLength={60} />
              </div>
            )}
            <div className="w-40">
              <Input
                label={`Quantidade (${rotuloUnidadeCompraAtual})`}
                name="quantidadeCompra"
                type="number"
                step="0.0001"
                min="0"
                value={quantidadeCompraTexto}
                onChange={(e) => setQuantidadeCompraTexto(e.target.value)}
                required
              />
            </div>
            <div className="w-56">
              <Input
                label={`1 ${rotuloUnidadeCompraAtual} = quantas ${materialSelecionado?.unidade || "unidade(s) de estoque"}?`}
                name="fatorConversaoCompra"
                type="number"
                step="0.0001"
                min="0"
                value={fatorConversaoCompraTexto}
                onChange={(e) => setFatorConversaoCompraTexto(e.target.value)}
                required
              />
            </div>
            <div className="w-44">
              <Input
                label={`Preço por ${rotuloUnidadeCompraAtual} (R$, opcional)`}
                name="precoUnitarioCompra"
                type="number"
                step="0.0001"
                min="0"
              />
            </div>
          </div>
        ) : (
          <div className="w-40">
            <Input
              label={`Quantidade${materialSelecionado?.unidade ? ` (${materialSelecionado.unidade})` : ""}`}
              name="quantidade"
              type="number"
              step="0.0001"
              min="0"
              required
            />
          </div>
        )}

        {quantidadeEstoquePreview !== null && (
          <p className="-mt-2 text-sm text-slate-500">
            = {quantidadeEstoquePreview} {materialSelecionado?.unidade || "unidade(s)"} em estoque
          </p>
        )}
        {avisoLote && <Alert variant="warning">{avisoLote}</Alert>}

        <div className="flex flex-wrap gap-3">
          <div className="w-44">
            <Input
              label="Valor estimado (R$, opcional)"
              name="valorEstimado"
              type="number"
              step="0.01"
              min="0"
            />
          </div>
          <div className="min-w-[200px] flex-1">
            <Select
              label="Fornecedor (opcional)"
              name="fornecedorId"
              value={fornecedorId}
              onChange={(e) => {
                setFornecedorId(e.target.value);
                setContratoFornecimentoId(""); // troca manual de fornecedor invalida o contrato escolhido antes
              }}
            >
              <option value="">Ainda não definido</option>
              {fornecedores.map((fornecedor) => (
                <option key={fornecedor.id} value={fornecedor.id}>
                  {fornecedor.nome}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <Textarea label="Observação (opcional)" name="observacao" maxLength={500} />

        {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}

        <Button type="submit" loading={pending} className="self-start">
          {pending ? "Criando..." : "Criar solicitação"}
        </Button>
      </form>
    </Card>
  );
}

// Contrato(s) de fornecimento ativo(s) e dentro da vigência que cobrem a
// matéria-prima/variante selecionada (achado A9 da auditoria de
// abrangência, Parte 3/Compras) — "usar este contrato" muda a origem pra
// CONTRATO_PROGRAMADO e pré-preenche fornecedor, deixando o servidor
// revalidar tudo de novo (nunca confia só no clique do client).
function ContratoAtivoCard({
  contratos,
  contratoSelecionadoId,
  onUsar,
}: {
  contratos: ContratoAtivoResumo[];
  contratoSelecionadoId: string;
  onUsar: (contrato: ContratoAtivoResumo) => void;
}) {
  return (
    <div className="rounded-xl border border-teal-200 bg-teal-50/50 dark:border-teal-900 dark:bg-teal-950/20">
      <p className="border-b border-teal-200 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-teal-700 dark:border-teal-900 dark:text-teal-400">
        Contrato de fornecimento ativo
      </p>
      <div className="divide-y divide-teal-100 dark:divide-teal-900/60">
        {contratos.map((contrato) => (
          <div key={contrato.id} className="flex items-center justify-between gap-4 px-4 py-3">
            <p className="text-sm text-slate-700 dark:text-slate-200">
              {contrato.fornecedorNome} — {formatoMoeda.format(contrato.precoUnitario)}/
              {rotuloUnidadeCompra(contrato.unidadeCompra, contrato.unidadeCompraOutro)} até{" "}
              {formatoData.format(new Date(contrato.vigenciaFim))}
            </p>
            <Button
              type="button"
              variant={contratoSelecionadoId === contrato.id ? "primary" : "outline"}
              onClick={() => onUsar(contrato)}
            >
              {contratoSelecionadoId === contrato.id ? "Selecionado" : "Usar este contrato"}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

// Comparativo de preço entre fornecedores que já venderam a matéria-prima/
// variante selecionada, do mais barato pro mais caro — ajuda a decidir com
// quem cotar ANTES de preencher fornecedor/quantidade abaixo. Dado vem
// pronto do servidor (ver comparativoPorChave), aqui é só formatação.
function ComparativoFornecedoresCard({
  unidade,
  linhas,
  aindaSemHistorico,
}: {
  unidade: string;
  linhas: LinhaComparativo[];
  aindaSemHistorico: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800">
      <p className="border-b border-slate-200 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800">
        Comparativo de fornecedores{unidade ? ` (preço por ${unidade})` : ""}
      </p>
      {aindaSemHistorico ? (
        <p className="px-4 py-4 text-sm text-slate-500">
          Nenhuma compra registrada ainda pra este item — o comparativo aparece assim que a primeira
          solicitação for recebida com fornecedor e valor pago.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Fornecedor</th>
                <th className="px-4 py-2 text-right">Último preço</th>
                <th className="px-4 py-2">Última compra</th>
                <th className="px-4 py-2">Histórico</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {linhas.map((linha, indice) => (
                <tr key={linha.fornecedorId}>
                  <td className="px-4 py-2 font-medium text-slate-900 dark:text-white">
                    {linha.fornecedorNome}
                    {indice === 0 && (
                      <span className="ml-2 rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700 dark:bg-teal-950/40 dark:text-teal-400">
                        mais barato
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right text-slate-600 dark:text-slate-300">
                    {formatoMoeda.format(linha.ultimoPreco)}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap text-slate-500">
                    {formatoInstanteReal.format(new Date(linha.ultimaCompraEm))}
                  </td>
                  <td className="px-4 py-2 text-slate-500">
                    {linha.historico.map((h) => formatoMoeda.format(h.preco)).join(" · ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
