"use client";

import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";

export type ItemVenda = {
  id: string;
  nome: string;
  categoria: string;
  precoVenda: string;
  modeloCalculo: "SIMPLES" | "M2" | "OFFSET";
};

export type CamposItemOrcamento = {
  itemGraficaId: string;
  quantidade: string;
  larguraCm: string;
  alturaCm: string;
  corFrente: string;
  corVerso: string;
  cores: string;
  acabamento: string;
};

export function camposIniciais(itens: ItemVenda[]): CamposItemOrcamento {
  return {
    itemGraficaId: itens[0]?.id ?? "",
    quantidade: "100",
    larguraCm: "",
    alturaCm: "",
    corFrente: "4",
    corVerso: "0",
    cores: "",
    acabamento: "",
  };
}

// Campos de escolher produto/quantidade/medidas/cores — reaproveitado tanto pelo
// carrinho da Calculadora de orçamento (CalculadoraForm) quanto pelo "+ Adicionar
// item" na tela de detalhe de um orçamento em rascunho. Controlado pelo pai (não
// guarda estado próprio) pra ele poder ler os valores atuais (prévia de preço) e
// resetar os campos depois de adicionar um item.
export function SeletorItemOrcamento({
  itens,
  valores,
  onChange,
}: {
  itens: ItemVenda[];
  valores: CamposItemOrcamento;
  onChange: (novo: CamposItemOrcamento) => void;
}) {
  const itemSelecionado = itens.find((i) => i.id === valores.itemGraficaId);
  const usaModeloM2 = itemSelecionado?.modeloCalculo === "M2";
  const usaModeloOffset = itemSelecionado?.modeloCalculo === "OFFSET";
  const usaMotorAvancado = usaModeloM2 || usaModeloOffset;

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
      larguraCm: "",
      alturaCm: "",
      corFrente: "4",
      corVerso: "0",
      cores: "",
      acabamento: "",
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <Select
        label="Produto ou serviço"
        value={valores.itemGraficaId}
        onChange={trocarItem}
        hint={itemSelecionado?.categoria}
      >
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Largura (cm)"
          type="number"
          value={valores.larguraCm}
          onChange={set("larguraCm")}
          placeholder="opcional"
          required={usaMotorAvancado}
        />
        <Input
          label="Altura (cm)"
          type="number"
          value={valores.alturaCm}
          onChange={set("alturaCm")}
          placeholder="opcional"
          required={usaMotorAvancado}
        />
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

      <Input
        label="Acabamento"
        value={valores.acabamento}
        onChange={set("acabamento")}
        placeholder="ex: laminação fosca, corte reto"
      />
    </div>
  );
}
