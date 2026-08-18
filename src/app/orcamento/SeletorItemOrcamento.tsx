"use client";

import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
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
  modeloCalculo: "SIMPLES" | "M2" | "OFFSET";
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
};

export type CamposItemOrcamento = {
  itemGraficaId: string;
  quantidade: string;
  // Valor DIGITADO pelo usuário, na unidade de `unidadeDimensao` abaixo — NÃO
  // é necessariamente centímetro (ver conversão na fronteira do servidor em
  // src/app/orcamento/actions.ts e src/app/orcamento/[id]/actions.ts).
  largura: string;
  altura: string;
  unidadeDimensao: UnidadeDimensao;
  corFrente: string;
  corVerso: string;
  cores: string;
  // Texto livre — só usado quando o item é SIMPLES (ver comentário em
  // OrcamentoItem.acabamento no schema). M2/OFFSET usam acabamentoIds abaixo.
  acabamento: string;
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
    unidadeDimensao: unidadePadrao,
    corFrente: "4",
    corVerso: "0",
    cores: "",
    acabamento: "",
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
  const usaMotorAvancado = usaModeloM2 || usaModeloOffset;
  const usaClicheEtiqueta = usaModeloM2 && itemSelecionado?.usaClicheEtiqueta === true;

  const set =
    (campo: keyof CamposItemOrcamento) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
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
      // Mantém a unidade que o usuário já tinha escolhido nesta sessão do
      // formulário — só as medidas em si (específicas do produto anterior)
      // são resetadas, ver comentário acima.
      unidadeDimensao: valores.unidadeDimensao,
      corFrente: "4",
      corVerso: "0",
      cores: "",
      acabamento: "",
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
          required={usaMotorAvancado}
        />
        <Input
          label={`Altura (${rotuloUnidade})`}
          type="number"
          step={passoDimensao}
          value={valores.altura}
          onChange={set("altura")}
          placeholder="opcional"
          required={usaMotorAvancado}
        />
        <Select label="Unidade" value={valores.unidadeDimensao} onChange={trocarUnidade}>
          {UNIDADES_DIMENSAO.map((u) => (
            <option key={u} value={u}>
              {ROTULO_UNIDADE_DIMENSAO[u]}
            </option>
          ))}
        </Select>
      </div>

      {usaModeloOffset && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Cores de frente"
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

      <Input
        label="Cores"
        value={valores.cores}
        onChange={set("cores")}
        placeholder="ex: 4x0, 4x4"
        hint="Deixe em branco se não se aplica."
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
