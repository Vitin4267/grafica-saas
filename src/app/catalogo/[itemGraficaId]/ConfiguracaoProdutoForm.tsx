"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { CampoAjuda } from "@/components/ui/CampoAjuda";
import { gerarChave } from "@/lib/chave-local";
import { ROTULO_UNIDADE } from "@/lib/unidade";
import { salvarModeloProduto } from "./actions";

type ModeloCalculo =
  | "SIMPLES"
  | "M2"
  | "OFFSET"
  | "FLEXOGRAFIA"
  | "DIGITAL"
  | "SERIGRAFIA"
  | "SUBLIMACAO"
  | "ESTAMPAGEM_QUENTE"
  | "PERSONALIZACAO"
  | "REVENDA"
  | "BORDADO"
  | "TEMPO_MAQUINA"
  | "DTF";

// Mesmo conjunto de unidadeContagemSchema em actions.ts — sem OUTRO (sem
// campo de texto livre pra essa, ficaria só "outro" na exibição de preço).
const OPCOES_UNIDADE_CONTAGEM = [
  "MILHEIRO",
  "CENTO",
  "PACOTE",
  "ROLO",
  "UNIDADE",
  "FOLHA",
  "METRO_QUADRADO",
  "METRO_LINEAR",
  "LITRO",
  "KG",
  "HORA",
] as const;

type BobinaLinha = { chave: string; larguraNominal: string; refile: string };
type FormatoLinha = {
  chave: string;
  nome: string;
  larguraFolha: string;
  alturaFolha: string;
};

function CampoLinha({
  value,
  onChange,
  placeholder,
  step = "0.001",
}: {
  value: string;
  onChange: (valor: string) => void;
  placeholder: string;
  step?: string;
}) {
  return (
    <input
      type="number"
      step={step}
      min="0"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
    />
  );
}

function BobinasEditor({
  itens,
  onChange,
}: {
  itens: BobinaLinha[];
  onChange: (itens: BobinaLinha[]) => void;
}) {
  const atualizar = (chave: string, campo: "larguraNominal" | "refile", valor: string) => {
    onChange(itens.map((b) => (b.chave === chave ? { ...b, [campo]: valor } : b)));
  };
  const remover = (chave: string) => onChange(itens.filter((b) => b.chave !== chave));
  const adicionar = () =>
    onChange([...itens, { chave: gerarChave(), larguraNominal: "", refile: "0.02" }]);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
        Bobinas disponíveis (largura nominal e refile em metros)
      </p>
      {itens.length === 0 && (
        <p className="text-sm text-slate-500">Nenhuma bobina cadastrada ainda.</p>
      )}
      {itens.map((bobina) => (
        <div key={bobina.chave} className="flex items-end gap-3">
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-xs text-slate-500">Largura nominal (m)</span>
            <CampoLinha
              value={bobina.larguraNominal}
              onChange={(v) => atualizar(bobina.chave, "larguraNominal", v)}
              placeholder="ex: 1.00"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className="inline-flex items-center gap-1 text-xs text-slate-500">
              Refile por lado (m)
              <CampoAjuda texto="Quanto de bobina é cortado e descartado em cada lado por imperfeição de fabricação ou de impressão — reduz a largura útil real que sobra pra imprimir. Ex: bobina de 1,60m com refile de 0,02m por lado deixa 1,56m aproveitáveis." />
            </span>
            <CampoLinha
              value={bobina.refile}
              onChange={(v) => atualizar(bobina.chave, "refile", v)}
              placeholder="ex: 0.02"
            />
          </label>
          <button
            type="button"
            onClick={() => remover(bobina.chave)}
            className="rounded-lg px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50"
          >
            Remover
          </button>
        </div>
      ))}
      <Button type="button" variant="outline" onClick={adicionar} className="self-start">
        + Adicionar bobina
      </Button>
    </div>
  );
}

function FormatosFolhaEditor({
  itens,
  onChange,
}: {
  itens: FormatoLinha[];
  onChange: (itens: FormatoLinha[]) => void;
}) {
  const atualizar = (
    chave: string,
    campo: "nome" | "larguraFolha" | "alturaFolha",
    valor: string
  ) => {
    onChange(itens.map((f) => (f.chave === chave ? { ...f, [campo]: valor } : f)));
  };
  const remover = (chave: string) => onChange(itens.filter((f) => f.chave !== chave));
  const adicionar = () =>
    onChange([
      ...itens,
      { chave: gerarChave(), nome: "", larguraFolha: "", alturaFolha: "" },
    ]);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
        Formatos de folha (largura e altura em metros)
      </p>
      {itens.length === 0 && (
        <p className="text-sm text-slate-500">Nenhum formato cadastrado ainda.</p>
      )}
      {itens.map((formato) => (
        <div key={formato.chave} className="flex items-end gap-3">
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-xs text-slate-500">Nome</span>
            <input
              type="text"
              value={formato.nome}
              onChange={(e) => atualizar(formato.chave, "nome", e.target.value)}
              placeholder="ex: Fechada 66x96"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </label>
          <label className="flex w-28 flex-col gap-1">
            <span className="text-xs text-slate-500">Largura (m)</span>
            <CampoLinha
              value={formato.larguraFolha}
              onChange={(v) => atualizar(formato.chave, "larguraFolha", v)}
              placeholder="0.66"
            />
          </label>
          <label className="flex w-28 flex-col gap-1">
            <span className="text-xs text-slate-500">Altura (m)</span>
            <CampoLinha
              value={formato.alturaFolha}
              onChange={(v) => atualizar(formato.chave, "alturaFolha", v)}
              placeholder="0.96"
            />
          </label>
          <button
            type="button"
            onClick={() => remover(formato.chave)}
            className="rounded-lg px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50"
          >
            Remover
          </button>
        </div>
      ))}
      <Button type="button" variant="outline" onClick={adicionar} className="self-start">
        + Adicionar formato
      </Button>
    </div>
  );
}

export function ConfiguracaoProdutoForm({
  itemGraficaId,
  modeloCalculo: modeloCalculoInicial,
  simplesCobraPorArea: simplesCobraPorAreaInicial,
  viraFolha: viraFolhaInicial,
  custoImpressaoM2: custoImpressaoM2Inicial,
  areaMinimaFaturavel: areaMinimaFaturavelInicial,
  custoSubstratoPorPeca: custoSubstratoPorPecaInicial,
  custoPrensagemPorPeca: custoPrensagemPorPecaInicial,
  gramaturaGm2: gramaturaGm2Inicial,
  papelId: papelIdInicial,
  papeis,
  prensaId: prensaIdInicial,
  prensas,
  bobinas: bobinasIniciais,
  formatosFolha: formatosIniciais,
  unidadeContagem: unidadeContagemInicial,
  fatorConversao: fatorConversaoInicial,
  maquinaFlexografiaId: maquinaFlexografiaIdInicial,
  maquinasFlexografia,
  custoClichePorCm2Flexo: custoClichePorCm2FlexoInicial,
  impressoraDigitalId: impressoraDigitalIdInicial,
  impressorasDigitais,
  maquinaSetupPorPecaId: maquinaSetupPorPecaIdInicial,
  maquinasSetupPorPeca,
  maquinaBordadoId: maquinaBordadoIdInicial,
  maquinasBordado,
  maquinaTempoId: maquinaTempoIdInicial,
  maquinasTempo,
}: {
  itemGraficaId: string;
  modeloCalculo: ModeloCalculo;
  // Achado N1 — só relevante quando modeloCalculo=SIMPLES: liga o cálculo
  // por m² (largura×altura) neste produto quando as dimensões forem
  // preenchidas num orçamento. false = sempre por peça (comportamento
  // padrão de todo produto, ver ItemGrafica.simplesCobraPorArea no schema).
  simplesCobraPorArea: boolean;
  viraFolha: boolean;
  custoImpressaoM2: string;
  areaMinimaFaturavel: string;
  // Achado A5 — só relevantes/exibidos quando modeloCalculo=DTF (camiseta/
  // substrato que recebe o transfer e a prensa térmica), ver bloco DTF
  // abaixo.
  custoSubstratoPorPeca: string;
  custoPrensagemPorPeca: string;
  gramaturaGm2: string;
  papelId: string;
  papeis: { id: string; nome: string; gramaturas: number[] }[];
  prensaId: string;
  prensas: { id: string; nome: string; emManutencao: boolean }[];
  bobinas: { larguraNominal: string; refile: string }[];
  formatosFolha: { nome: string; larguraFolha: string; alturaFolha: string }[];
  // Unidade em que a gráfica VENDE este produto (ex: rótulo por milheiro) —
  // só exibição, nunca muda o motor de preço. Vazio = comportamento atual.
  unidadeContagem: string;
  fatorConversao: string;
  maquinaFlexografiaId: string;
  maquinasFlexografia: { id: string; nome: string; emManutencao: boolean }[];
  custoClichePorCm2Flexo: string;
  impressoraDigitalId: string;
  impressorasDigitais: { id: string; nome: string; emManutencao: boolean }[];
  maquinaSetupPorPecaId: string;
  // Já vem filtrada por tipoProcesso relevante — a página server-side monta
  // listas (uma por processo) e passa só a do modeloCalculo atual seria
  // redundante já que o form troca de modelo no client; em vez disso recebe
  // todas juntas com o próprio tipoProcesso, e o form filtra localmente pelo
  // modeloCalculo selecionado agora.
  maquinasSetupPorPeca: {
    id: string;
    nome: string;
    emManutencao: boolean;
    tipoProcesso:
      | "SERIGRAFIA"
      | "SUBLIMACAO"
      | "ESTAMPAGEM_QUENTE"
      | "TAMPOGRAFIA"
      | "GRAVACAO_LASER"
      | "DTG"
      | "TRANSFER"
      | "OUTRO";
  }[];
  maquinaBordadoId: string;
  maquinasBordado: { id: string; nome: string; emManutencao: boolean }[];
  maquinaTempoId: string;
  maquinasTempo: { id: string; nome: string; emManutencao: boolean }[];
}) {
  const [modeloCalculo, setModeloCalculo] = useState<ModeloCalculo>(modeloCalculoInicial);
  const [simplesCobraPorArea, setSimplesCobraPorArea] = useState(simplesCobraPorAreaInicial);
  const [bobinas, setBobinas] = useState<BobinaLinha[]>(() =>
    bobinasIniciais.map((b) => ({ chave: gerarChave(), ...b }))
  );
  const [formatos, setFormatos] = useState<FormatoLinha[]>(() =>
    formatosIniciais.map((f) => ({ chave: gerarChave(), ...f }))
  );
  const [papelId, setPapelId] = useState(papelIdInicial);
  const [prensaId, setPrensaId] = useState(prensaIdInicial);
  const [maquinaFlexografiaId, setMaquinaFlexografiaId] = useState(maquinaFlexografiaIdInicial);
  const [impressoraDigitalId, setImpressoraDigitalId] = useState(impressoraDigitalIdInicial);
  const [maquinaSetupPorPecaId, setMaquinaSetupPorPecaId] = useState(maquinaSetupPorPecaIdInicial);
  const [maquinaBordadoId, setMaquinaBordadoId] = useState(maquinaBordadoIdInicial);
  const [maquinaTempoId, setMaquinaTempoId] = useState(maquinaTempoIdInicial);
  const [state, formAction, isPending] = useActionState(salvarModeloProduto, null);
  const [mostrarAvancadoM2, setMostrarAvancadoM2] = useState(
    Boolean(areaMinimaFaturavelInicial)
  );

  // Avisa (não bloqueia) quando a prensa/máquina escolhida está com uma
  // parada em andamento AGORA — o produto continua salvável, é só um alerta
  // pra quem está configurando não ser pego de surpresa depois. Cadastro
  // desatualizado é comum o bastante (ver comentário na Server Action de
  // manutenção) pra bloquear ser mais frustrante que ajudar.
  const prensaEmManutencao = useMemo(
    () => prensas.find((p) => p.id === prensaId)?.emManutencao ?? false,
    [prensas, prensaId]
  );
  const maquinaEmManutencao = useMemo(
    () => maquinasFlexografia.find((m) => m.id === maquinaFlexografiaId)?.emManutencao ?? false,
    [maquinasFlexografia, maquinaFlexografiaId]
  );
  const impressoraEmManutencao = useMemo(
    () => impressorasDigitais.find((i) => i.id === impressoraDigitalId)?.emManutencao ?? false,
    [impressorasDigitais, impressoraDigitalId]
  );
  // SERIGRAFIA/SUBLIMACAO/ESTAMPAGEM_QUENTE usam o MESMO nome do ModeloCalculo
  // correspondente (ver comentário em actions.ts) — filtra a lista completa
  // pelo modelo selecionado agora. PERSONALIZACAO (achado A3 da auditoria de
  // abrangência) não tem processo homônimo: aceita qualquer máquina cujo
  // tipoProcesso NÃO seja um dos 3 já mapeados 1:1 (ou seja, TAMPOGRAFIA/
  // GRAVACAO_LASER/DTG/TRANSFER/OUTRO).
  const maquinasSetupPorPecaFiltradas = useMemo(
    () =>
      maquinasSetupPorPeca.filter((m) =>
        modeloCalculo === "PERSONALIZACAO"
          ? m.tipoProcesso !== "SERIGRAFIA" &&
            m.tipoProcesso !== "SUBLIMACAO" &&
            m.tipoProcesso !== "ESTAMPAGEM_QUENTE"
          : m.tipoProcesso === modeloCalculo
      ),
    [maquinasSetupPorPeca, modeloCalculo]
  );
  const maquinaSetupPorPecaEmManutencao = useMemo(
    () => maquinasSetupPorPeca.find((m) => m.id === maquinaSetupPorPecaId)?.emManutencao ?? false,
    [maquinasSetupPorPeca, maquinaSetupPorPecaId]
  );
  const maquinaBordadoEmManutencao = useMemo(
    () => maquinasBordado.find((m) => m.id === maquinaBordadoId)?.emManutencao ?? false,
    [maquinasBordado, maquinaBordadoId]
  );
  const maquinaTempoEmManutencao = useMemo(
    () => maquinasTempo.find((m) => m.id === maquinaTempoId)?.emManutencao ?? false,
    [maquinasTempo, maquinaTempoId]
  );

  const gramaturasDoPapel = papeis.find((p) => p.id === papelId)?.gramaturas ?? [];

  const temBobinasOrfas =
    modeloCalculo !== "M2" &&
    modeloCalculo !== "FLEXOGRAFIA" &&
    modeloCalculo !== "DTF" &&
    bobinas.length > 0;
  const temFormatosOrfaos = modeloCalculo !== "OFFSET" && formatos.length > 0;

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="itemGraficaId" value={itemGraficaId} />
      <input
        type="hidden"
        name="bobinasJson"
        value={JSON.stringify(
          bobinas.map(({ larguraNominal, refile }) => ({ larguraNominal, refile }))
        )}
      />
      <input
        type="hidden"
        name="formatosFolhaJson"
        value={JSON.stringify(
          formatos.map(({ nome, larguraFolha, alturaFolha }) => ({
            nome,
            larguraFolha,
            alturaFolha,
          }))
        )}
      />

      <Card className="flex flex-col gap-5 p-6">
        <Select
          label={
            <>
              Modelo de cálculo
              <CampoAjuda texto="Define como a máquina realmente produz este item e como o preço é calculado. M2 e Flexografia imprimem em bobina (rolo contínuo) com aproveitamento de largura; Offset imprime em folha, com custo de chapa por tiragem; Digital cobra por clique da impressora, sem aproveitamento de bobina ou folha; Serigrafia, Sublimação, Estampagem a quente e Personalização cobram um setup fixo (tela, matriz ou arte) mais um valor por peça; Bordado cobra pelo número de pontos da arte de cada pedido; Tempo de máquina cobra pelo tempo de uso e/ou pelos metros cortados (corte a laser, router, plotter); Simples é preço fixo direto, sem cálculo de máquina; Revenda é para produto comprado pronto de outro fornecedor." />
            </>
          }
          name="modeloCalculo"
          value={modeloCalculo}
          onChange={(e) => setModeloCalculo(e.target.value as ModeloCalculo)}
          hint="Simples usa o preço de venda direto. M2 e Offset acionam o motor avançado de precificação."
        >
          <option value="SIMPLES">Simples (preço direto)</option>
          <option value="M2">M2 — grande formato em bobina</option>
          <option value="DTF">DTF — transfer têxtil (filme em bobina)</option>
          <option value="OFFSET">Offset — impressão em folha</option>
          <option value="FLEXOGRAFIA">Flexografia — impressão em bobina</option>
          <option value="DIGITAL">Digital — impressão pequeno formato</option>
          <option value="SERIGRAFIA">Serigrafia</option>
          <option value="SUBLIMACAO">Sublimação</option>
          <option value="ESTAMPAGEM_QUENTE">Estampagem a quente (hot stamping)</option>
          <option value="PERSONALIZACAO">Personalização (tampografia, laser, DTG, transfer)</option>
          <option value="BORDADO">Bordado</option>
          <option value="TEMPO_MAQUINA">Tempo de máquina (corte a laser, router, plotter)</option>
          <option value="REVENDA">Revenda / terceirização</option>
        </Select>

        {modeloCalculo === "SIMPLES" && (
          <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
            <input type="hidden" name="simplesCobraPorArea" value={simplesCobraPorArea ? "on" : ""} />
            <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={simplesCobraPorArea}
                onChange={(e) => setSimplesCobraPorArea(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
              />
              <span>
                <span className="inline-flex items-center gap-1.5">
                  Cobra por área (m²) quando largura/altura são preenchidas
                  <CampoAjuda texto="Deixe desmarcado pra produtos de preço fixo por peça (camiseta, cartão de visita) — largura/altura, se preenchidas no orçamento, ficam só descritivas e não mudam o preço. Marque só se este produto realmente é vendido por tamanho (ex: rótulo, adesivo, banner sem motor avançado): o preço passa a ser preço-base × largura(m) × altura(m)." />
                </span>
                <span className="block text-xs font-normal text-slate-500">
                  Desmarcado (padrão): preço fixo por peça, mesmo com largura/altura preenchidas no orçamento.
                </span>
              </span>
            </label>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2 dark:border-slate-800">
          <Select
            label={
              <>
                Vender por (opcional)
                <CampoAjuda texto="Deixa o preço aparecer numa unidade diferente da usada no cálculo interno, sem mudar o valor calculado — por exemplo, calcular por unidade mas exibir o preço por milheiro no orçamento e no PDF." />
              </>
            }
            name="unidadeContagem"
            defaultValue={unidadeContagemInicial}
            hint="Só muda como o preço é MOSTRADO — o cálculo continua igual."
          >
            <option value="">Não usar unidade alternativa</option>
            {OPCOES_UNIDADE_CONTAGEM.map((u) => (
              <option key={u} value={u}>
                {ROTULO_UNIDADE[u]}
              </option>
            ))}
          </Select>
          <Input
            label="Quantas unidades base = 1 dessas"
            name="fatorConversao"
            type="number"
            step="1"
            min="1"
            defaultValue={fatorConversaoInicial}
            placeholder="ex: 1000 para milheiro"
          />
        </div>

        {(modeloCalculo === "M2" || modeloCalculo === "DTF") && (
          <div className="flex flex-col gap-4 border-t border-slate-100 pt-4 dark:border-slate-800">
            {temBobinasOrfas === false && bobinas.length === 0 && (
              <Alert variant="error">
                {modeloCalculo === "DTF"
                  ? "Adicione ao menos uma bobina (do filme DTF) para habilitar o cálculo DTF."
                  : "Adicione ao menos uma bobina para habilitar o cálculo M2."}
              </Alert>
            )}
            {modeloCalculo === "DTF" && (
              <p className="text-xs text-slate-500">
                DTF usa o mesmo motor de nesting em bobina do M2 (múltiplas artes
                &quot;gangadas&quot; no mesmo metro de filme) — sem tela/matriz por arte.
                Informe abaixo o custo do filme (bobina), o custo de impressão por m²
                e os dois custos por peça do processo têxtil.
              </p>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label={
                  modeloCalculo === "DTF" ? "Custo de impressão (tinta) por m²" : "Custo de impressão por m²"
                }
                name="custoImpressaoM2"
                type="number"
                step="0.0001"
                min="0"
                defaultValue={custoImpressaoM2Inicial}
              />
              {/* Mantido montado (só oculto via CSS) mesmo quando recolhido,
                  pra não perder o valor no submit — mesmo padrão dos blocos
                  M2/OFFSET que ficam sempre no DOM ao trocar o modelo acima. */}
              <div className={mostrarAvancadoM2 ? "contents" : "hidden"}>
                <Input
                  label="Área mínima faturável (m²)"
                  name="areaMinimaFaturavel"
                  type="number"
                  step="0.0001"
                  min="0"
                  defaultValue={areaMinimaFaturavelInicial}
                  hint="Piso por PEÇA: peça menor que essa área é cobrada como se tivesse essa área (ex: mínimo de 1m² por adesivo recortado). Independente do pedido mínimo em R$ de Configurações, que é um piso do orçamento inteiro."
                />
              </div>
            </div>
            {/* Achado A5 — os dois campos novos do DTF: custo por PEÇA (não
                por m²) do substrato e da prensagem. Mantidos no DOM mesmo
                quando o modelo não é DTF (só ocultos via CSS), mesmo padrão
                de mostrarAvancadoM2 acima, pra não perder o valor no submit
                se a gráfica for e voltar entre modelos antes de salvar. */}
            <div className={modeloCalculo === "DTF" ? "grid grid-cols-1 gap-4 sm:grid-cols-2" : "hidden"}>
              <Input
                label="Custo do substrato por peça (camiseta em branco)"
                name="custoSubstratoPorPeca"
                type="number"
                step="0.0001"
                min="0"
                defaultValue={custoSubstratoPorPecaInicial}
                hint="A peça (camiseta, boné, etc.) que recebe o transfer — custo fixo por unidade, somado ao custo do filme."
              />
              <Input
                label="Custo de prensagem por peça"
                name="custoPrensagemPorPeca"
                type="number"
                step="0.0001"
                min="0"
                defaultValue={custoPrensagemPorPecaInicial}
                hint="O custo da prensa térmica (energia, tempo, mão de obra) por peça aplicada."
              />
            </div>
            {!mostrarAvancadoM2 && (
              <button
                type="button"
                onClick={() => setMostrarAvancadoM2(true)}
                className="self-start text-xs font-medium text-teal-700 hover:underline dark:text-teal-400"
              >
                + mais opções avançadas
              </button>
            )}
            <BobinasEditor itens={bobinas} onChange={setBobinas} />
          </div>
        )}

        {modeloCalculo === "OFFSET" && (
          <div className="flex flex-col gap-4 border-t border-slate-100 pt-4 dark:border-slate-800">
            {prensas.length === 0 ? (
              <Alert variant="error">
                Nenhuma prensa cadastrada ainda. Cadastre uma em{" "}
                <Link href="/configuracoes/prensas" className="underline">
                  Configurações → Prensas
                </Link>{" "}
                antes de usar o modelo Offset.
              </Alert>
            ) : (
              <>
                <Select
                  label="Prensa"
                  name="prensaId"
                  value={prensaId}
                  onChange={(e) => setPrensaId(e.target.value)}
                  hint="Define o custo de máquina, chapas e rodagem usados no cálculo deste produto."
                >
                  <option value="">Selecione uma prensa</option>
                  {prensas.map((prensa) => (
                    <option key={prensa.id} value={prensa.id}>
                      {prensa.nome}
                      {prensa.emManutencao ? " (em manutenção)" : ""}
                    </option>
                  ))}
                </Select>
                {prensaEmManutencao && (
                  <Alert variant="warning">
                    Esta prensa está com uma parada em andamento agora. Você ainda pode
                    salvar o produto assim configurado, mas confira em{" "}
                    <Link href="/configuracoes/maquinas/manutencao" className="underline">
                      Configurações → Máquinas → Manutenção
                    </Link>{" "}
                    antes de produzir.
                  </Alert>
                )}
              </>
            )}
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="viraFolha"
                defaultChecked={viraFolhaInicial}
                className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
              />
              <span className="text-sm text-slate-700 dark:text-slate-200">
                Vira-folha (work-and-turn) — reduz chapas quando o número de peças por
                folha é par
              </span>
            </label>
            {papeis.length === 0 ? (
              <Alert variant="error">
                Nenhum papel cadastrado ainda. Cadastre uma matéria-prima do tipo papel em{" "}
                <Link href="/catalogo" className="underline">
                  Catálogo
                </Link>{" "}
                e defina suas gramaturas antes de usar o modelo Offset.
              </Alert>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Select
                  label="Papel"
                  name="papelId"
                  value={papelId}
                  onChange={(e) => setPapelId(e.target.value)}
                  hint="O preço por kg vem da tabela de gramaturas deste papel — configure em Catálogo."
                >
                  <option value="">Selecione um papel</option>
                  {papeis.map((papel) => (
                    <option key={papel.id} value={papel.id}>
                      {papel.nome}
                    </option>
                  ))}
                </Select>
                <div>
                  <Input
                    label="Gramatura (g/m²)"
                    name="gramaturaGm2"
                    type="number"
                    step="1"
                    min="30"
                    max="500"
                    list="gramaturas-do-papel"
                    defaultValue={gramaturaGm2Inicial}
                    hint={
                      gramaturasDoPapel.length > 0
                        ? "Se digitar uma gramatura fora da lista do papel, usamos o preço da mais próxima."
                        : undefined
                    }
                  />
                  <datalist id="gramaturas-do-papel">
                    {gramaturasDoPapel.map((g) => (
                      <option key={g} value={g} />
                    ))}
                  </datalist>
                </div>
              </div>
            )}
            {formatos.length === 0 && (
              <Alert variant="error">
                Adicione ao menos um formato de folha para habilitar o cálculo Offset.
              </Alert>
            )}
            <FormatosFolhaEditor itens={formatos} onChange={setFormatos} />
          </div>
        )}

        {modeloCalculo === "FLEXOGRAFIA" && (
          <div className="flex flex-col gap-4 border-t border-slate-100 pt-4 dark:border-slate-800">
            {maquinasFlexografia.length === 0 ? (
              <Alert variant="error">
                Nenhuma máquina cadastrada ainda. Cadastre uma em{" "}
                <Link href="/configuracoes/maquinas" className="underline">
                  Configurações → Máquinas
                </Link>{" "}
                antes de usar o modelo Flexografia.
              </Alert>
            ) : (
              <>
                <Select
                  label="Máquina"
                  name="maquinaFlexografiaId"
                  value={maquinaFlexografiaId}
                  onChange={(e) => setMaquinaFlexografiaId(e.target.value)}
                  hint="Define o custo de máquina, acerto e rodagem usados no cálculo deste produto."
                >
                  <option value="">Selecione uma máquina</option>
                  {maquinasFlexografia.map((maquina) => (
                    <option key={maquina.id} value={maquina.id}>
                      {maquina.nome}
                      {maquina.emManutencao ? " (em manutenção)" : ""}
                    </option>
                  ))}
                </Select>
                {maquinaEmManutencao && (
                  <Alert variant="warning">
                    Esta máquina está com uma parada em andamento agora. Você ainda pode
                    salvar o produto assim configurado, mas confira em{" "}
                    <Link href="/configuracoes/maquinas/manutencao" className="underline">
                      Configurações → Máquinas → Manutenção
                    </Link>{" "}
                    antes de produzir.
                  </Alert>
                )}
              </>
            )}
            <Input
              label="Custo do clichê por cm² (R$)"
              name="custoClichePorCm2Flexo"
              type="number"
              step="0.0001"
              min="0"
              required
              defaultValue={custoClichePorCm2FlexoInicial}
              hint="Multiplicado pela área do clichê e pelo nº de cores — mesma lógica de uma chapa offset, só que por área."
            />
            {bobinas.length === 0 && (
              <Alert variant="error">
                Adicione ao menos uma bobina para habilitar o cálculo Flexografia.
              </Alert>
            )}
            <BobinasEditor itens={bobinas} onChange={setBobinas} />
          </div>
        )}

        {modeloCalculo === "DIGITAL" && (
          <div className="flex flex-col gap-4 border-t border-slate-100 pt-4 dark:border-slate-800">
            {impressorasDigitais.length === 0 ? (
              <Alert variant="error">
                Nenhuma impressora digital cadastrada ainda. Cadastre uma em{" "}
                <Link href="/configuracoes/maquinas" className="underline">
                  Configurações → Máquinas
                </Link>{" "}
                antes de usar o modelo Digital.
              </Alert>
            ) : (
              <>
                <Select
                  label="Impressora digital"
                  name="impressoraDigitalId"
                  value={impressoraDigitalId}
                  onChange={(e) => setImpressoraDigitalId(e.target.value)}
                  hint="Define o custo por clique usado no cálculo deste produto."
                >
                  <option value="">Selecione uma impressora</option>
                  {impressorasDigitais.map((impressora) => (
                    <option key={impressora.id} value={impressora.id}>
                      {impressora.nome}
                      {impressora.emManutencao ? " (em manutenção)" : ""}
                    </option>
                  ))}
                </Select>
                {impressoraEmManutencao && (
                  <Alert variant="warning">
                    Esta impressora está com uma parada em andamento agora. Você ainda pode
                    salvar o produto assim configurado, mas confira em{" "}
                    <Link href="/configuracoes/maquinas/manutencao" className="underline">
                      Configurações → Máquinas → Manutenção
                    </Link>{" "}
                    antes de produzir.
                  </Alert>
                )}
              </>
            )}
            <p className="text-xs text-slate-500">
              Sem nesting — o custo é direto por peça (clique da impressora + custo do
              substrato, que vem do preço de compra deste item). Largura/altura ficam
              opcionais no orçamento.
            </p>
          </div>
        )}

        {(modeloCalculo === "SERIGRAFIA" ||
          modeloCalculo === "SUBLIMACAO" ||
          modeloCalculo === "ESTAMPAGEM_QUENTE" ||
          modeloCalculo === "PERSONALIZACAO") && (
          <div className="flex flex-col gap-4 border-t border-slate-100 pt-4 dark:border-slate-800">
            {maquinasSetupPorPecaFiltradas.length === 0 ? (
              <Alert variant="error">
                Nenhuma máquina cadastrada ainda para este processo. Cadastre uma em{" "}
                <Link href="/configuracoes/maquinas" className="underline">
                  Configurações → Máquinas
                </Link>{" "}
                antes de usar este modelo.
              </Alert>
            ) : (
              <>
                <Select
                  label="Máquina"
                  name="maquinaSetupPorPecaId"
                  value={maquinaSetupPorPecaId}
                  onChange={(e) => setMaquinaSetupPorPecaId(e.target.value)}
                  hint="Define o custo de setup (tela/matriz/arte) e por peça usados no cálculo deste produto."
                >
                  <option value="">Selecione uma máquina</option>
                  {maquinasSetupPorPecaFiltradas.map((maquina) => (
                    <option key={maquina.id} value={maquina.id}>
                      {maquina.nome}
                      {maquina.emManutencao ? " (em manutenção)" : ""}
                    </option>
                  ))}
                </Select>
                {maquinaSetupPorPecaEmManutencao && (
                  <Alert variant="warning">
                    Esta máquina está com uma parada em andamento agora. Você ainda pode
                    salvar o produto assim configurado, mas confira em{" "}
                    <Link href="/configuracoes/maquinas/manutencao" className="underline">
                      Configurações → Máquinas → Manutenção
                    </Link>{" "}
                    antes de produzir.
                  </Alert>
                )}
              </>
            )}
            <p className="text-xs text-slate-500">
              Sem nesting — custo fixo de setup por tela/matriz/arte + custo variável por
              peça, com um piso mínimo de job. Largura/altura ficam opcionais no orçamento.
            </p>
          </div>
        )}

        {modeloCalculo === "BORDADO" && (
          <div className="flex flex-col gap-4 border-t border-slate-100 pt-4 dark:border-slate-800">
            {maquinasBordado.length === 0 ? (
              <Alert variant="error">
                Nenhuma máquina de bordado cadastrada ainda. Cadastre uma em{" "}
                <Link href="/configuracoes/maquinas" className="underline">
                  Configurações → Máquinas
                </Link>{" "}
                antes de usar o modelo Bordado.
              </Alert>
            ) : (
              <>
                <Select
                  label="Máquina de bordado"
                  name="maquinaBordadoId"
                  value={maquinaBordadoId}
                  onChange={(e) => setMaquinaBordadoId(e.target.value)}
                  hint="Define o custo por mil pontos e a taxa de digitalização de matriz usados no cálculo deste produto."
                >
                  <option value="">Selecione uma máquina</option>
                  {maquinasBordado.map((maquina) => (
                    <option key={maquina.id} value={maquina.id}>
                      {maquina.nome}
                      {maquina.emManutencao ? " (em manutenção)" : ""}
                    </option>
                  ))}
                </Select>
                {maquinaBordadoEmManutencao && (
                  <Alert variant="warning">
                    Esta máquina está com uma parada em andamento agora. Você ainda pode
                    salvar o produto assim configurado, mas confira em{" "}
                    <Link href="/configuracoes/maquinas/manutencao" className="underline">
                      Configurações → Máquinas → Manutenção
                    </Link>{" "}
                    antes de produzir.
                  </Alert>
                )}
              </>
            )}
            <p className="text-xs text-slate-500">
              Sem nesting — custo por mil pontos da arte (informado por pedido) + taxa de
              digitalização de matriz (1× por arte) + custo do substrato (peça em branco).
              Largura/altura ficam opcionais no orçamento.
            </p>
          </div>
        )}

        {modeloCalculo === "TEMPO_MAQUINA" && (
          <div className="flex flex-col gap-4 border-t border-slate-100 pt-4 dark:border-slate-800">
            {maquinasTempo.length === 0 ? (
              <Alert variant="error">
                Nenhuma máquina cadastrada ainda para este modelo. Cadastre uma em{" "}
                <Link href="/configuracoes/maquinas" className="underline">
                  Configurações → Máquinas
                </Link>{" "}
                antes de usar o modelo Tempo de máquina.
              </Alert>
            ) : (
              <>
                <Select
                  label="Máquina"
                  name="maquinaTempoId"
                  value={maquinaTempoId}
                  onChange={(e) => setMaquinaTempoId(e.target.value)}
                  hint="Define o custo por hora de máquina, setup por job e (opcional) custo por metro de corte usados no cálculo deste produto."
                >
                  <option value="">Selecione uma máquina</option>
                  {maquinasTempo.map((maquina) => (
                    <option key={maquina.id} value={maquina.id}>
                      {maquina.nome}
                      {maquina.emManutencao ? " (em manutenção)" : ""}
                    </option>
                  ))}
                </Select>
                {maquinaTempoEmManutencao && (
                  <Alert variant="warning">
                    Esta máquina está com uma parada em andamento agora. Você ainda pode
                    salvar o produto assim configurado, mas confira em{" "}
                    <Link href="/configuracoes/maquinas/manutencao" className="underline">
                      Configurações → Máquinas → Manutenção
                    </Link>{" "}
                    antes de produzir.
                  </Alert>
                )}
              </>
            )}
            <p className="text-xs text-slate-500">
              Sem nesting — custo pelo tempo estimado de máquina e/ou pelos metros de corte
              (informados por pedido) + setup fixo por job, com um piso mínimo. Largura/altura
              ficam opcionais no orçamento.
            </p>
          </div>
        )}

        {(temBobinasOrfas || temFormatosOrfaos) && (
          <Alert variant="error">
            {temBobinasOrfas &&
              `Existem ${bobinas.length} bobina(s) de uma configuração anterior — elas não são usadas enquanto o modelo não for M2 ou Flexografia.`}
            {temBobinasOrfas && temFormatosOrfaos && " "}
            {temFormatosOrfaos &&
              `Existem ${formatos.length} formato(s) de folha de uma configuração anterior — eles não são usados enquanto o modelo não for Offset.`}
          </Alert>
        )}

        {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}

        <Button type="submit" loading={isPending} className="self-start">
          {isPending ? "Salvando..." : "Salvar configuração"}
        </Button>
      </Card>
    </form>
  );
}
