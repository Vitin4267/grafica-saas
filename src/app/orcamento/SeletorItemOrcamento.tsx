"use client";

import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { CampoAjuda } from "@/components/ui/CampoAjuda";
import { CamposEtiquetaOrcamento, etiquetaInicial, type CamposEtiqueta } from "./CamposEtiquetaOrcamento";
import {
  CamposPrecificacaoEtiquetaOrcamento,
  precificacaoEtiquetaInicial,
  type CamposPrecificacaoEtiqueta,
  type PapelDisponivel,
} from "./CamposPrecificacaoEtiquetaOrcamento";
import {
  UNIDADES_DIMENSAO,
  ROTULO_UNIDADE_DIMENSAO,
  converterParaCm,
  converterDeCm,
  passoInputDimensao,
  type UnidadeDimensao,
} from "@/lib/unidade-dimensao";

export type ItemVenda = {
  id: string;
  nome: string;
  categoria: string;
  precoVenda: string;
  modeloCalculo:
    | "SIMPLES"
    | "M2"
    | "OFFSET"
    | "FLEXOGRAFIA"
    | "DIGITAL"
    | "SERIGRAFIA"
    | "SUBLIMACAO"
    | "ESTAMPAGEM_QUENTE"
    | "PERSONALIZACAO"
    | "REVENDA";
  // ConfiguracaoClicheEtiqueta presente pra este produto — só produtos M2
  // marcados assim mostram o seletor de papel/cores/faca/frete abaixo.
  usaClicheEtiqueta: boolean;
};

// Serviço do catálogo (ItemGrafica tipo SERVICO) já configurado como acabamento
// (ver ConfiguracaoAcabamentoForm.tsx em catalogo/[itemGraficaId]) — só esses
// entram na lista, senão o motor de preço não sabe cobrar.
export type ItemAcabamentoDisponivel = {
  id: string;
  nome: string;
  // Decide se o acabamento cobra por hora (ver ConfiguracaoAcabamento.baseCobranca
  // no schema) — só esse valor liga o campo "Horas estimadas" abaixo. Os
  // outros valores possíveis não mudam nada nesta tela (o custo deles é
  // derivado da geometria do item, sem input extra do vendedor).
  baseCobranca: "UNIDADE" | "M2" | "FOLHA_IMPRESSA" | "METRO_LINEAR" | "FIXO" | "HORA" | "MILHEIRO" | "CENTO";
};

export type CamposItemOrcamento = {
  itemGraficaId: string;
  quantidade: string;
  // Valor DIGITADO pelo usuário, na unidade de `unidadeDimensao` abaixo — NÃO
  // é necessariamente centímetro (ver conversão na fronteira do servidor em
  // src/app/orcamento/actions.ts e src/app/orcamento/[id]/actions.ts).
  largura: string;
  altura: string;
  // Achado F7 — terceira dimensão (caixa/embalagem, acrílico, livro) do item
  // VENDIDO. Mesma unidade `unidadeDimensao` abaixo que largura/altura,
  // SEMPRE visível (não condicionada a categoria/modeloCalculo do produto —
  // uma caixa pode ser vendida como SIMPLES) e nunca entra no motor de
  // preço.
  profundidade: string;
  // Espessura de chapa/placa (corte a laser/router) — SEMPRE em milímetro
  // (chapa é vendida em mm no Brasil), não segue `unidadeDimensao` abaixo.
  // Também sempre visível e nunca entra no motor de preço.
  espessuraMm: string;
  unidadeDimensao: UnidadeDimensao;
  corFrente: string;
  corVerso: string;
  numeroCoresFlexo: string;
  // Só DIGITAL — opcional (em branco = default 1 clique/peça no motor).
  numeroCliques: string;
  // Só SERIGRAFIA/SUBLIMACAO/ESTAMPAGEM_QUENTE (compartilham este campo).
  numeroSetups: string;
  // Só relevante quando algum dos acabamentoIds abaixo tem baseCobranca=HORA
  // — independente do modeloCalculo do item, ao contrário de numeroSetups.
  horasEstimadas: string;
  // Só REVENDA (achado A12) — override opcional, POR ORÇAMENTO, do custo de
  // aquisição; em branco = motor cai no preço de compra cadastrado no
  // catálogo.
  custoAquisicaoUnitario: string;
  // Só DIGITAL/SERIGRAFIA/SUBLIMACAO/ESTAMPAGEM_QUENTE/PERSONALIZACAO (achado
  // B7) — quando true, o cliente já trouxe a peça em branco e a gráfica só
  // aplica a estampa/gravação; zera o custo do substrato pra este item.
  materialFornecidoPeloCliente: boolean;
  cores: string;
  // Texto livre — só usado quando o item é SIMPLES (ver comentário em
  // OrcamentoItem.acabamento no schema). M2/OFFSET usam acabamentoIds abaixo.
  acabamento: string;
  // Achado B6 — sobrepõe o nome do catálogo no PDF/link público quando
  // preenchido (ver src/lib/pdf/mapear-dados.ts). Disponível pra QUALQUER
  // modeloCalculo, ao contrário de `acabamento` acima — nunca entra no
  // motor de preço.
  descricaoLivre: string;
  acabamentoIds: string[];
  etiqueta: CamposEtiqueta;
  precificacaoEtiqueta: CamposPrecificacaoEtiqueta;
};

// unidadePadrao vem de Grafica.unidadePadraoDimensao (lida pelo servidor no
// momento em que a página é montada) — o formulário nasce nessa unidade, mas
// o usuário pode trocar livremente pra este item específico (ver seletor
// mm/cm/m abaixo). Default "CM" cobre chamadas que não têm essa informação
// disponível (ver comentário em CalculadoraForm.tsx sobre a Calculadora não
// receber o padrão da gráfica).
export function camposIniciais(
  _itens: ItemVenda[],
  unidadePadrao: UnidadeDimensao = "CM"
): CamposItemOrcamento {
  return {
    // Começa SEM produto selecionado — nunca pré-seleciona itens[0]. Um select
    // nativo sem opção vazia mostra a primeira opção da lista como "escolhida"
    // mesmo sem o usuário ter clicado nela; combinado com a ordenação
    // alfabética de src/app/orcamento/page.tsx (fora do escopo deste arquivo),
    // isso fazia o primeiro produto do catálogo (podendo ser um item de
    // exemplo do onboarding, nome prefixado "[Exemplo] ") entrar sozinho no
    // orçamento sempre que o usuário preenchia quantidade/medidas e clicava
    // "Adicionar item" sem prestar atenção no dropdown. Ver SeletorItemOrcamento
    // abaixo pra opção placeholder correspondente.
    itemGraficaId: "",
    quantidade: "100",
    largura: "",
    altura: "",
    profundidade: "",
    espessuraMm: "",
    unidadeDimensao: unidadePadrao,
    corFrente: "4",
    corVerso: "0",
    numeroCoresFlexo: "4",
    numeroCliques: "",
    numeroSetups: "1",
    horasEstimadas: "",
    custoAquisicaoUnitario: "",
    materialFornecidoPeloCliente: false,
    cores: "",
    acabamento: "",
    descricaoLivre: "",
    acabamentoIds: [],
    etiqueta: etiquetaInicial(),
    precificacaoEtiqueta: precificacaoEtiquetaInicial(),
  };
}

// Campos de escolher produto/quantidade/medidas/cores — reaproveitado tanto pelo
// carrinho da Calculadora de orçamento (CalculadoraForm) quanto pelo "+ Adicionar
// item" na tela de detalhe de um orçamento em rascunho. Controlado pelo pai (não
// guarda estado próprio) pra ele poder ler os valores atuais (prévia de preço) e
// resetar os campos depois de adicionar um item.
export function SeletorItemOrcamento({
  itens,
  acabamentosDisponiveis,
  papeisDisponiveis,
  valores,
  onChange,
}: {
  itens: ItemVenda[];
  acabamentosDisponiveis: ItemAcabamentoDisponivel[];
  papeisDisponiveis: PapelDisponivel[];
  valores: CamposItemOrcamento;
  onChange: (novo: CamposItemOrcamento) => void;
}) {
  const itemSelecionado = itens.find((i) => i.id === valores.itemGraficaId);
  const usaModeloM2 = itemSelecionado?.modeloCalculo === "M2";
  const usaModeloOffset = itemSelecionado?.modeloCalculo === "OFFSET";
  const usaModeloFlexografia = itemSelecionado?.modeloCalculo === "FLEXOGRAFIA";
  const usaModeloDigital = itemSelecionado?.modeloCalculo === "DIGITAL";
  const usaModeloSetupPorPeca =
    itemSelecionado?.modeloCalculo === "SERIGRAFIA" ||
    itemSelecionado?.modeloCalculo === "SUBLIMACAO" ||
    itemSelecionado?.modeloCalculo === "ESTAMPAGEM_QUENTE" ||
    itemSelecionado?.modeloCalculo === "PERSONALIZACAO";
  // Revenda/terceirização (achado A12) — sem nesting, sem máquina, mesma
  // ausência de dimensões do Digital acima, mas SEMPRE motor avançado (nunca
  // o preview client-side simples): custoBase precisa passar por
  // comporPreco pra ganhar overhead/margem/piso.
  const usaModeloRevenda = itemSelecionado?.modeloCalculo === "REVENDA";
  const usaMotorAvancado =
    usaModeloM2 ||
    usaModeloOffset ||
    usaModeloFlexografia ||
    usaModeloDigital ||
    usaModeloSetupPorPeca ||
    usaModeloRevenda;
  // DIGITAL e os 3 de setup-por-peça não precisam de largura/altura pro custo
  // em si (sem nesting) — só M2/OFFSET/FLEXOGRAFIA exigem dimensão aqui.
  const exigeDimensao = usaModeloM2 || usaModeloOffset || usaModeloFlexografia;
  const usaClicheEtiqueta = usaModeloM2 && itemSelecionado?.usaClicheEtiqueta === true;
  // Só aparece quando um acabamento selecionado cobra por hora — o motor
  // rejeita silenciosamente sem isso (ver guard em orcamento-precificacao.ts).
  const temAcabamentoHora = valores.acabamentoIds.some(
    (id) => acabamentosDisponiveis.find((a) => a.id === id)?.baseCobranca === "HORA"
  );
  // Agrupa visualmente os campos de cor/setup específicos de cada modelo de
  // cálculo (formulário crescido demais — ficavam soltos, todos juntos,
  // assim que apareciam) num único <details> "Cor e preparo de máquina" —
  // só renderiza quando algum desses campos se aplica ao item escolhido.
  // Nasce aberto (diferente do grupo "Mais opções" abaixo) porque, quando
  // aparece, costuma trazer campo obrigatório pro modelo em questão (ex:
  // corFrente no Offset).
  const mostrarGrupoCorPreparo =
    usaModeloOffset || usaModeloFlexografia || usaModeloDigital || usaModeloSetupPorPeca || usaModeloRevenda;

  const set =
    (campo: keyof CamposItemOrcamento) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      onChange({ ...valores, [campo]: e.target.value });

  // Trocar de produto reseta os campos que dependem do modeloCalculo dele
  // (largura/altura/cores de frente-verso são específicos do item M2/OFFSET
  // anterior) — sem isso, um item SIMPLES escolhido depois de um M2/OFFSET
  // herdava as dimensões e era cotado por m² por engano. Mantém só a
  // quantidade, que faz sentido continuar igual ao trocar de produto.
  const trocarItem = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange({
      itemGraficaId: e.target.value,
      quantidade: valores.quantidade,
      largura: "",
      altura: "",
      profundidade: "",
      espessuraMm: "",
      // Mantém a unidade que o usuário já tinha escolhido nesta sessão do
      // formulário — só as medidas em si (específicas do produto anterior)
      // são resetadas, ver comentário acima.
      unidadeDimensao: valores.unidadeDimensao,
      corFrente: "4",
      corVerso: "0",
      numeroCoresFlexo: "4",
      numeroCliques: "",
      numeroSetups: "1",
      horasEstimadas: "",
      custoAquisicaoUnitario: "",
      materialFornecidoPeloCliente: false,
      cores: "",
      acabamento: "",
      descricaoLivre: "",
      acabamentoIds: [],
      etiqueta: etiquetaInicial(),
      precificacaoEtiqueta: precificacaoEtiquetaInicial(),
    });
  };

  // Trocar a unidade CONVERTE o valor já digitado em vez de reinterpretá-lo
  // (quem digitou 9 cm e troca pra mm deve ver 90, não 9) — passa por
  // centímetros como intermediário (mesmo caminho que o servidor usa),
  // preservando a resolução da coluna no banco. Campo vazio continua vazio.
  const trocarUnidade = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const novaUnidade = e.target.value as UnidadeDimensao;
    const converter = (valorTexto: string) => {
      if (valorTexto.trim() === "") return valorTexto;
      const numero = Number(valorTexto);
      if (!Number.isFinite(numero)) return valorTexto;
      const cm = converterParaCm(numero, valores.unidadeDimensao);
      return String(converterDeCm(cm, novaUnidade));
    };
    onChange({
      ...valores,
      unidadeDimensao: novaUnidade,
      largura: converter(valores.largura),
      altura: converter(valores.altura),
      // profundidade segue a mesma unidadeDimensao de largura/altura —
      // espessuraMm fica de fora de propósito (sempre mm, nunca converte).
      profundidade: converter(valores.profundidade),
    });
  };

  const rotuloUnidade = ROTULO_UNIDADE_DIMENSAO[valores.unidadeDimensao];
  const passoDimensao = passoInputDimensao(valores.unidadeDimensao);

  return (
    <div className="flex flex-col gap-5">
      <Select
        label="Produto ou serviço"
        value={valores.itemGraficaId}
        onChange={trocarItem}
        hint={itemSelecionado?.categoria}
        required
      >
        <option value="" disabled>
          Selecione o produto ou serviço
        </option>
        {itens.map((i) => (
          <option key={i.id} value={i.id}>
            {i.nome}
          </option>
        ))}
      </Select>

      <Input
        label="Quantidade"
        type="number"
        min={1}
        value={valores.quantidade}
        onChange={set("quantidade")}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Input
          label={`Largura (${rotuloUnidade})`}
          type="number"
          step={passoDimensao}
          value={valores.largura}
          onChange={set("largura")}
          placeholder="opcional"
          required={exigeDimensao}
        />
        <Input
          label={`Altura (${rotuloUnidade})`}
          type="number"
          step={passoDimensao}
          value={valores.altura}
          onChange={set("altura")}
          placeholder="opcional"
          required={exigeDimensao}
        />
        <Select label="Unidade" value={valores.unidadeDimensao} onChange={trocarUnidade}>
          {UNIDADES_DIMENSAO.map((u) => (
            <option key={u} value={u}>
              {ROTULO_UNIDADE_DIMENSAO[u]}
            </option>
          ))}
        </Select>
      </div>

      {mostrarGrupoCorPreparo && (
        <details open className="group rounded-xl border border-slate-300 dark:border-slate-700">
          <summary className="flex cursor-pointer list-none items-center px-4 py-2.5 text-sm font-medium text-slate-700 marker:content-none dark:text-slate-200">
            Cor e preparo de máquina
          </summary>
          <div className="flex flex-col gap-4 border-t border-slate-100 px-4 py-4 dark:border-slate-800">
            {usaModeloOffset && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input
                  label={
                    <>
                      Cores de frente
                      <CampoAjuda texto="Quantas cores de tinta são usadas na frente e no verso da peça (ex: 4x4 = 4 cores nos dois lados, 4x0 = colorido só na frente, preto e branco no verso). Cada cor extra é uma chapa a mais na máquina, então aumenta o custo." />
                    </>
                  }
                  type="number"
                  min={1}
                  value={valores.corFrente}
                  onChange={set("corFrente")}
                />
                <Input
                  label="Cores de verso"
                  type="number"
                  min={0}
                  value={valores.corVerso}
                  onChange={set("corVerso")}
                  hint="0 se for só frente"
                />
              </div>
            )}

            {usaModeloFlexografia && (
              <Input
                label={
                  <>
                    Número de cores
                    <CampoAjuda texto="Na flexografia, cada cor sai numa estação separada da máquina (geralmente cores especiais/Pantone, não CMYK como no digital ou offset). Informe o total de cores usadas na arte — cada cor a mais aumenta o custo de preparação." />
                  </>
                }
                type="number"
                min={1}
                value={valores.numeroCoresFlexo}
                onChange={set("numeroCoresFlexo")}
              />
            )}

            {usaModeloDigital && (
              <Input
                label={
                  <>
                    Número de cliques
                    <CampoAjuda texto="Em impressão digital, cada passada da máquina pra imprimir uma peça é chamada de 'clique' — é assim que o custo do equipamento é cobrado. Normalmente é 1 clique por peça; só mude se seu equipamento contar diferente (ex: frente e verso separados)." />
                  </>
                }
                type="number"
                min={1}
                value={valores.numeroCliques}
                onChange={set("numeroCliques")}
                placeholder="opcional — padrão 1 por peça"
                hint="Deixe em branco pra usar 1 clique por peça (padrão)."
              />
            )}

            {usaModeloSetupPorPeca && (
              <Input
                label={
                  <>
                    Número de setups
                    <CampoAjuda texto="Setup é o tempo de preparar a máquina pra rodar esta arte — trocar tela, matriz ou ajustar a cor. Cada arte diferente neste item conta como 1 setup, e isso entra no custo porque a máquina fica parada preparando, não produzindo." />
                  </>
                }
                type="number"
                min={1}
                value={valores.numeroSetups}
                onChange={set("numeroSetups")}
                hint="Quantas telas/matrizes/artes esta arte usa."
              />
            )}

            {(usaModeloDigital || usaModeloSetupPorPeca) && (
              <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={valores.materialFornecidoPeloCliente}
                  onChange={(e) =>
                    onChange({ ...valores, materialFornecidoPeloCliente: e.target.checked })
                  }
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                />
                <span>
                  <span className="inline-flex items-center gap-1.5">
                    Material fornecido pelo cliente
                    <CampoAjuda texto="Marque quando o CLIENTE já traz a peça em branco (camiseta, caneca, brinde) pronta pra aplicar a estampa ou gravação. Nesse caso a gráfica cobra só o serviço de aplicação, sem cobrar o custo da peça em si." />
                  </span>
                  <span className="block text-xs font-normal text-slate-500">
                    A gráfica não cobra o custo da peça em branco — só a aplicação.
                  </span>
                </span>
              </label>
            )}

            {usaModeloRevenda && (
              <Input
                label="Custo de aquisição (R$)"
                type="number"
                min={0}
                step="0.01"
                value={valores.custoAquisicaoUnitario}
                onChange={set("custoAquisicaoUnitario")}
                placeholder="opcional"
                hint="Deixe em branco pra usar o custo de compra cadastrado no catálogo."
              />
            )}
          </div>
        </details>
      )}

      <Input
        label="Cores"
        value={valores.cores}
        onChange={set("cores")}
        placeholder="ex: 4x0, 4x4"
        hint="Deixe em branco se não se aplica."
      />

      <Textarea
        label="Descrição específica (opcional)"
        value={valores.descricaoLivre}
        onChange={set("descricaoLivre")}
        maxLength={500}
        rows={2}
        placeholder='ex: "Banner 3×1m lona 440g com bastão e corda"'
        hint="Sobrepõe o nome do catálogo no PDF e no link público — deixe em branco pra mostrar o nome padrão."
      />

      {usaMotorAvancado ? (
        <SeletorAcabamentos
          acabamentosDisponiveis={acabamentosDisponiveis}
          selecionados={valores.acabamentoIds}
          onChange={(acabamentoIds) => onChange({ ...valores, acabamentoIds })}
        />
      ) : (
        <Input
          label="Acabamento"
          value={valores.acabamento}
          onChange={set("acabamento")}
          placeholder="ex: laminação fosca, corte reto"
        />
      )}

      {temAcabamentoHora && (
        <Input
          label="Horas estimadas"
          type="number"
          min={0.01}
          step="0.25"
          value={valores.horasEstimadas}
          onChange={set("horasEstimadas")}
          hint="Um dos acabamentos selecionados cobra por hora (ex: instalação, criação de arte) — informe quantas horas este item vai levar."
          required
        />
      )}

      {usaClicheEtiqueta && (
        <CamposPrecificacaoEtiquetaOrcamento
          papeisDisponiveis={papeisDisponiveis}
          valores={valores.precificacaoEtiqueta}
          onChange={(precificacaoEtiqueta) => onChange({ ...valores, precificacaoEtiqueta })}
        />
      )}

      {usaModeloM2 && (
        <CamposEtiquetaOrcamento
          valores={valores.etiqueta}
          onChange={(etiqueta) => onChange({ ...valores, etiqueta })}
        />
      )}

      {/* Achado F7 — profundidade (caixa/embalagem, acrílico, livro) e
          espessura de chapa (corte a laser/router) do item VENDIDO. SEMPRE
          disponíveis, independente do modeloCalculo do produto (uma caixa
          pode ser vendida como SIMPLES) — nunca entram no motor de preço, só
          descritivas. Raramente preenchidas, por isso ficam num grupo
          fechado por padrão em vez de sempre visíveis. */}
      <details className="group rounded-xl border border-slate-300 dark:border-slate-700">
        <summary className="flex cursor-pointer list-none items-center px-4 py-2.5 text-sm font-medium text-slate-700 marker:content-none dark:text-slate-200">
          Mais opções
        </summary>
        <div className="grid grid-cols-1 gap-4 border-t border-slate-100 px-4 py-4 dark:border-slate-800 sm:grid-cols-2">
          <Input
            label={`Profundidade (${rotuloUnidade})`}
            type="number"
            step={passoDimensao}
            value={valores.profundidade}
            onChange={set("profundidade")}
            placeholder="opcional"
            hint="Ex: caixa/embalagem, acrílico, livro — terceira dimensão."
          />
          <Input
            label="Espessura (mm)"
            type="number"
            step="1"
            value={valores.espessuraMm}
            onChange={set("espessuraMm")}
            placeholder="opcional"
            hint="Ex: chapa de corte a laser/router — sempre em milímetro."
          />
        </div>
      </details>
    </div>
  );
}

// Substitui o texto livre "Acabamento" pra itens M2/OFFSET: em vez de descrever
// o acabamento numa frase solta, escolhe entre os serviços do catálogo já
// configurados como acabamento (ConfiguracaoAcabamento) — só assim o motor de
// preço sabe somar o custo (ver src/lib/pricing/acabamento.ts).
function SeletorAcabamentos({
  acabamentosDisponiveis,
  selecionados,
  onChange,
}: {
  acabamentosDisponiveis: ItemAcabamentoDisponivel[];
  selecionados: string[];
  onChange: (novo: string[]) => void;
}) {
  const alternar = (id: string, marcado: boolean) => {
    onChange(marcado ? [...selecionados, id] : selecionados.filter((s) => s !== id));
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Acabamentos</span>
      {acabamentosDisponiveis.length === 0 ? (
        <span className="text-xs text-slate-500">
          Nenhum serviço de acabamento configurado ainda — cadastre em Catálogo.
        </span>
      ) : (
        <>
          <div className="flex flex-col gap-1.5 rounded-xl border border-slate-300 p-3 dark:border-slate-700">
            {acabamentosDisponiveis.map((a) => (
              <label key={a.id} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={selecionados.includes(a.id)}
                  onChange={(e) => alternar(a.id, e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                />
                {a.nome}
              </label>
            ))}
          </div>
          <span className="text-xs text-slate-500">
            Opcional — soma o custo configurado no catálogo ao preço deste item.
          </span>
        </>
      )}
    </div>
  );
}
