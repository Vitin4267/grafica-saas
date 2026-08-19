"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { gerarChave } from "@/lib/chave-local";
import { ROTULO_UNIDADE } from "@/lib/unidade";
import { salvarModeloProduto } from "./actions";

type ModeloCalculo = "SIMPLES" | "M2" | "OFFSET" | "FLEXOGRAFIA";

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
            <span className="text-xs text-slate-500">Refile por lado (m)</span>
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
  viraFolha: viraFolhaInicial,
  custoImpressaoM2: custoImpressaoM2Inicial,
  areaMinimaFaturavel: areaMinimaFaturavelInicial,
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
}: {
  itemGraficaId: string;
  modeloCalculo: ModeloCalculo;
  viraFolha: boolean;
  custoImpressaoM2: string;
  areaMinimaFaturavel: string;
  gramaturaGm2: string;
  papelId: string;
  papeis: { id: string; nome: string; gramaturas: number[] }[];
  prensaId: string;
  prensas: { id: string; nome: string }[];
  bobinas: { larguraNominal: string; refile: string }[];
  formatosFolha: { nome: string; larguraFolha: string; alturaFolha: string }[];
  // Unidade em que a gráfica VENDE este produto (ex: rótulo por milheiro) —
  // só exibição, nunca muda o motor de preço. Vazio = comportamento atual.
  unidadeContagem: string;
  fatorConversao: string;
  maquinaFlexografiaId: string;
  maquinasFlexografia: { id: string; nome: string }[];
  custoClichePorCm2Flexo: string;
}) {
  const [modeloCalculo, setModeloCalculo] = useState<ModeloCalculo>(modeloCalculoInicial);
  const [bobinas, setBobinas] = useState<BobinaLinha[]>(() =>
    bobinasIniciais.map((b) => ({ chave: gerarChave(), ...b }))
  );
  const [formatos, setFormatos] = useState<FormatoLinha[]>(() =>
    formatosIniciais.map((f) => ({ chave: gerarChave(), ...f }))
  );
  const [papelId, setPapelId] = useState(papelIdInicial);
  const [state, formAction, isPending] = useActionState(salvarModeloProduto, null);
  const [mostrarAvancadoM2, setMostrarAvancadoM2] = useState(
    Boolean(areaMinimaFaturavelInicial)
  );

  const gramaturasDoPapel = papeis.find((p) => p.id === papelId)?.gramaturas ?? [];

  const temBobinasOrfas =
    modeloCalculo !== "M2" && modeloCalculo !== "FLEXOGRAFIA" && bobinas.length > 0;
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
          label="Modelo de cálculo"
          name="modeloCalculo"
          value={modeloCalculo}
          onChange={(e) => setModeloCalculo(e.target.value as ModeloCalculo)}
          hint="Simples usa o preço de venda direto. M2 e Offset acionam o motor avançado de precificação."
        >
          <option value="SIMPLES">Simples (preço direto)</option>
          <option value="M2">M2 — grande formato em bobina</option>
          <option value="OFFSET">Offset — impressão em folha</option>
          <option value="FLEXOGRAFIA">Flexografia — impressão em bobina</option>
        </Select>

        <div className="grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2 dark:border-slate-800">
          <Select
            label="Vender por (opcional)"
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

        {modeloCalculo === "M2" && (
          <div className="flex flex-col gap-4 border-t border-slate-100 pt-4 dark:border-slate-800">
            {temBobinasOrfas === false && bobinas.length === 0 && (
              <Alert variant="error">
                Adicione ao menos uma bobina para habilitar o cálculo M2.
              </Alert>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="Custo de impressão por m²"
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
                  hint="Métrica de auditoria — o piso comercial real é o pedido mínimo em Configurações."
                />
              </div>
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
              <Select
                label="Prensa"
                name="prensaId"
                defaultValue={prensaIdInicial}
                hint="Define o custo de máquina, chapas e rodagem usados no cálculo deste produto."
              >
                <option value="">Selecione uma prensa</option>
                {prensas.map((prensa) => (
                  <option key={prensa.id} value={prensa.id}>
                    {prensa.nome}
                  </option>
                ))}
              </Select>
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
              <Select
                label="Máquina"
                name="maquinaFlexografiaId"
                defaultValue={maquinaFlexografiaIdInicial}
                hint="Define o custo de máquina, acerto e rodagem usados no cálculo deste produto."
              >
                <option value="">Selecione uma máquina</option>
                {maquinasFlexografia.map((maquina) => (
                  <option key={maquina.id} value={maquina.id}>
                    {maquina.nome}
                  </option>
                ))}
              </Select>
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
