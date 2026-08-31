"use client";

import { useState } from "react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { gerarChave } from "@/lib/chave-local";
import type { CamposEtiqueta, CamposHotStamping } from "./etiqueta-campos";

// Tipos e etiquetaInicial/etiquetaParaCampos moraram aqui antes — movidos pra
// ./etiqueta-campos.ts (módulo sem "use client") porque page.tsx (Server
// Component) precisa chamar etiquetaParaCampos() diretamente, e React Server
// Components não permite invocar função vinda de módulo "use client". Re-exportado
// abaixo só pra não quebrar os imports client-a-client já existentes.
export { etiquetaInicial, etiquetaParaCampos, type CamposEtiqueta, type CamposHotStamping } from "./etiqueta-campos";

const OPCOES_MATERIAL_SUBSTRATO: [string, string][] = [
  ["PAPEL_TERMICO", "Papel Térmico"],
  ["COUCHE_C_ROT", "Couchê C/ROT"],
  ["BOPP_METALIZADO_ROT", "BOPP Metalizado ROT"],
  ["BOPP_BCO_PEROLIZADO", "BOPP Bco Perolizado"],
  ["BOPP_BCO_FOSCO", "BOPP Bco Fosco"],
  ["BOPP_TRANSPARENTE", "BOPP Transparente"],
  ["L2_SEM_ADESIVO", "L2 - Sem Adesivo"],
  ["POLIETILENO_BRANCO", "Polietileno Branco"],
  ["POLIETILENO_TRANSPARENTE", "Polietileno Transp."],
  ["POLIESTER_BRANCO", "Poliéster Branco"],
  ["POLIESTER_TRANSPARENTE", "Poliéster Transparente"],
  ["POLIESTER_CROMO_FOSCO", "Poliéster Cromo Fosco"],
  ["ELETROSTATICO_SEM_COLA", "Eletrostático sem cola"],
  ["OUTRO", "Outro"],
];
const OPCOES_TIPO_ADESIVO: [string, string][] = [
  ["ACRILICO_20G", "Acrílico 20g"],
  ["ACRILICO_30G", "Acrílico 30g"],
  ["BORRACHA_20G", "Borracha 20g"],
  ["BORRACHA_25G", "Borracha 25g"],
  ["BORRACHA_30G", "Borracha 30g"],
  ["BORRACHA_50G", "Borracha 50g"],
  ["OUTRO", "Outro"],
];
const OPCOES_SUPERFICIE: [string, string][] = [
  ["VIDRO", "Vidro"],
  ["PLASTICO", "Plástico"],
  ["METAL", "Metal"],
  ["PAPEL", "Papel"],
  ["PAPELAO", "Papelão"],
  ["OUTROS", "Outros"],
];
const OPCOES_ROTULAGEM: [string, string][] = [
  ["MANUAL", "Manual"],
  ["AUTOMATICA", "Automática"],
];
const OPCOES_SERRILHA: [string, string][] = [
  ["SERRILHA", "Serrilha"],
  ["MICRO_SERRILHA", "Micro serrilha"],
  ["GAP", "Gap"],
  ["OUTRO", "Outro"],
];
const OPCOES_LAMINACAO: [string, string][] = [
  ["BRILHO", "Brilho"],
  ["FOSCO", "Fosco"],
  ["SOFT_TOUCH", "Soft Touch"],
  ["METALIZADA", "Metalizada"],
  ["OUTRO", "Outro"],
];
const OPCOES_VERNIZ: [string, string][] = [
  ["BRILHO", "Brilho"],
  ["FOSCO", "Fosco"],
  ["RIBBON", "Ribbon"],
  ["SOFT_TOUCH", "Soft Touch"],
  ["OUTRO", "Outro"],
];
const OPCOES_LADO: [string, string][] = [
  ["ROTULO", "Rótulo"],
  ["CONTRA_ROTULO", "Contra-rótulo"],
];
const OPCOES_TIPO_HOT_STAMPING: [string, string][] = [
  ["HOT", "Hot"],
  ["COLD", "Cold"],
  ["OUTRO", "Outro"],
];

function SelectOpcional({
  label,
  valor,
  opcoes,
  onChange,
}: {
  label: string;
  valor: string;
  opcoes: [string, string][];
  onChange: (valor: string) => void;
}) {
  return (
    <Select label={label} value={valor} onChange={(e) => onChange(e.target.value)}>
      <option value="">não informado</option>
      {opcoes.map(([v, rotulo]) => (
        <option key={v} value={v}>
          {rotulo}
        </option>
      ))}
    </Select>
  );
}

function LinhaHotStamping({
  linha,
  onAlterar,
  onRemover,
}: {
  linha: CamposHotStamping;
  onAlterar: (campo: keyof CamposHotStamping, valor: string) => void;
  onRemover: () => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-2 dark:bg-slate-800/50">
      <div className="w-36">
        <Select label="Lado" value={linha.lado} onChange={(e) => onAlterar("lado", e.target.value)}>
          {OPCOES_LADO.map(([v, rotulo]) => (
            <option key={v} value={v}>
              {rotulo}
            </option>
          ))}
        </Select>
      </div>
      <div className="w-28">
        <Select label="Tipo" value={linha.tipo} onChange={(e) => onAlterar("tipo", e.target.value)}>
          {OPCOES_TIPO_HOT_STAMPING.map(([v, rotulo]) => (
            <option key={v} value={v}>
              {rotulo}
            </option>
          ))}
        </Select>
      </div>
      {linha.tipo === "OUTRO" && (
        <div className="w-28">
          <Input
            label="Qual tipo"
            value={linha.tipoOutro}
            onChange={(e) => onAlterar("tipoOutro", e.target.value)}
          />
        </div>
      )}
      <div className="w-28">
        <Input
          label="Medida"
          value={linha.medida}
          onChange={(e) => onAlterar("medida", e.target.value)}
        />
      </div>
      <div className="w-28">
        <Input label="Cor" value={linha.cor} onChange={(e) => onAlterar("cor", e.target.value)} />
      </div>
      <div className="w-36">
        <Input
          label="Efeito"
          value={linha.tipoEfeitoHotStamping}
          onChange={(e) => onAlterar("tipoEfeitoHotStamping", e.target.value)}
          placeholder="ex: Holográfico"
        />
      </div>
      <button
        type="button"
        onClick={onRemover}
        className="rounded-lg px-2 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50"
      >
        Remover
      </button>
    </div>
  );
}

// Bloco de campos de etiqueta (rótulo adesivo) — só aparece quando o item
// escolhido usa modeloCalculo=M2 (flexografia). Recolhido por padrão (o
// "+ detalhes de etiqueta") porque são ~18 campos, a maioria opcional — não
// entra na conta de preço (ver src/lib/pricing/m2.ts), é só especificação
// de produção. Hot/cold stamping fica num sub-toggle ainda mais discreto,
// já que a maioria dos pedidos não usa.
export function CamposEtiquetaOrcamento({
  valores,
  onChange,
}: {
  valores: CamposEtiqueta;
  onChange: (novo: CamposEtiqueta) => void;
}) {
  const [expandido, setExpandido] = useState(false);
  const [hotStampingExpandido, setHotStampingExpandido] = useState(valores.hotStampings.length > 0);

  const set = <K extends keyof CamposEtiqueta>(campo: K, valor: CamposEtiqueta[K]) =>
    onChange({ ...valores, [campo]: valor });

  const alterarHotStamping = (chave: string, campo: keyof CamposHotStamping, valor: string) =>
    set(
      "hotStampings",
      valores.hotStampings.map((l) => (l.chave === chave ? { ...l, [campo]: valor } : l))
    );
  const removerHotStamping = (chave: string) =>
    set(
      "hotStampings",
      valores.hotStampings.filter((l) => l.chave !== chave)
    );
  const adicionarHotStamping = () =>
    set("hotStampings", [
      ...valores.hotStampings,
      { chave: gerarChave(), lado: "ROTULO", tipo: "HOT", tipoOutro: "", tipoEfeitoHotStamping: "", medida: "", cor: "" },
    ]);

  if (!expandido) {
    return (
      <button
        type="button"
        onClick={() => setExpandido(true)}
        className="self-start text-xs font-medium text-teal-700 hover:underline dark:text-teal-400"
      >
        + detalhes de etiqueta
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-800/30">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Detalhes de etiqueta</h3>
        <button
          type="button"
          onClick={() => setExpandido(false)}
          className="text-xs font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
        >
          Recolher
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SelectOpcional
          label="Material do substrato"
          valor={valores.materialSubstrato}
          opcoes={OPCOES_MATERIAL_SUBSTRATO}
          onChange={(v) => set("materialSubstrato", v)}
        />
        {valores.materialSubstrato === "OUTRO" && (
          <Input
            label="Qual material"
            value={valores.materialSubstratoOutro}
            onChange={(e) => set("materialSubstratoOutro", e.target.value)}
          />
        )}
        <SelectOpcional
          label="Tipo de adesivo"
          valor={valores.tipoAdesivo}
          opcoes={OPCOES_TIPO_ADESIVO}
          onChange={(v) => set("tipoAdesivo", v)}
        />
        {valores.tipoAdesivo === "OUTRO" && (
          <Input
            label="Qual adesivo"
            value={valores.tipoAdesivoOutro}
            onChange={(e) => set("tipoAdesivoOutro", e.target.value)}
          />
        )}
        <Input
          label="Durabilidade do adesivo"
          value={valores.durabilidadeAdesivo}
          onChange={(e) => set("durabilidadeAdesivo", e.target.value)}
          placeholder="ex: Permanente, Removível"
        />
        <SelectOpcional
          label="Superfície de aplicação"
          valor={valores.superficieAplicacao}
          opcoes={OPCOES_SUPERFICIE}
          onChange={(v) => set("superficieAplicacao", v)}
        />
        {valores.superficieAplicacao === "OUTROS" && (
          <Input
            label="Qual superfície"
            value={valores.superficieAplicacaoOutro}
            onChange={(e) => set("superficieAplicacaoOutro", e.target.value)}
          />
        )}
        <Input
          label="Formato da etiqueta"
          value={valores.formatoEtiqueta}
          onChange={(e) => set("formatoEtiqueta", e.target.value)}
          placeholder="ex: Especial"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Cores rótulo"
          type="number"
          min={0}
          value={valores.coresRotulo}
          onChange={(e) => set("coresRotulo", e.target.value)}
        />
        <Input
          label="Cores contra-rótulo"
          type="number"
          min={0}
          value={valores.coresContraRotulo}
          onChange={(e) => set("coresContraRotulo", e.target.value)}
        />
        <Input
          label="Etiquetas por rolo"
          type="number"
          min={0}
          value={valores.embalagemQtdPorRolo}
          onChange={(e) => set("embalagemQtdPorRolo", e.target.value)}
        />
        <Input
          label="Medida do tubete"
          value={valores.tubeteMedida}
          onChange={(e) => set("tubeteMedida", e.target.value)}
          placeholder="ex: 3"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SelectOpcional
          label="Rotulagem"
          valor={valores.rotulagem}
          opcoes={OPCOES_ROTULAGEM}
          onChange={(v) => set("rotulagem", v)}
        />
        <SelectOpcional
          label="Serrilha"
          valor={valores.serrilha}
          opcoes={OPCOES_SERRILHA}
          onChange={(v) => set("serrilha", v)}
        />
        {valores.serrilha === "OUTRO" && (
          <Input
            label="Qual serrilha"
            value={valores.serrilhaOutro}
            onChange={(e) => set("serrilhaOutro", e.target.value)}
          />
        )}
        <Input
          label="Rebobinamento (1-8)"
          type="number"
          min={1}
          max={8}
          value={valores.rebobinamento}
          onChange={(e) => set("rebobinamento", e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Verniz UV — rótulo</span>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={valores.vernizRotuloTotal}
                onChange={(e) => set("vernizRotuloTotal", e.target.checked)}
              />
              Total
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={valores.vernizRotuloReserva}
                onChange={(e) => set("vernizRotuloReserva", e.target.checked)}
              />
              Reserva
            </label>
          </div>
          <SelectOpcional
            label="Acabamento"
            valor={valores.vernizRotuloTipo}
            opcoes={OPCOES_VERNIZ}
            onChange={(v) => set("vernizRotuloTipo", v)}
          />
          {valores.vernizRotuloTipo === "OUTRO" && (
            <Input
              label="Qual acabamento"
              value={valores.vernizRotuloTipoOutro}
              onChange={(e) => set("vernizRotuloTipoOutro", e.target.value)}
            />
          )}
        </div>
        <div className="flex flex-col gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Verniz UV — contra-rótulo
          </span>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={valores.vernizContraRotuloTotal}
                onChange={(e) => set("vernizContraRotuloTotal", e.target.checked)}
              />
              Total
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={valores.vernizContraRotuloReserva}
                onChange={(e) => set("vernizContraRotuloReserva", e.target.checked)}
              />
              Reserva
            </label>
          </div>
          <SelectOpcional
            label="Acabamento"
            valor={valores.vernizContraRotuloTipo}
            opcoes={OPCOES_VERNIZ}
            onChange={(v) => set("vernizContraRotuloTipo", v)}
          />
          {valores.vernizContraRotuloTipo === "OUTRO" && (
            <Input
              label="Qual acabamento"
              value={valores.vernizContraRotuloTipoOutro}
              onChange={(e) => set("vernizContraRotuloTipoOutro", e.target.value)}
            />
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <SelectOpcional
            label="Laminação rótulo"
            valor={valores.laminacaoRotulo}
            opcoes={OPCOES_LAMINACAO}
            onChange={(v) => set("laminacaoRotulo", v)}
          />
          {valores.laminacaoRotulo === "OUTRO" && (
            <Input
              label="Qual laminação"
              value={valores.laminacaoRotuloOutro}
              onChange={(e) => set("laminacaoRotuloOutro", e.target.value)}
            />
          )}
        </div>
        <div className="flex flex-col gap-2">
          <SelectOpcional
            label="Laminação contra-rótulo"
            valor={valores.laminacaoContraRotulo}
            opcoes={OPCOES_LAMINACAO}
            onChange={(v) => set("laminacaoContraRotulo", v)}
          />
          {valores.laminacaoContraRotulo === "OUTRO" && (
            <Input
              label="Qual laminação"
              value={valores.laminacaoContraRotuloOutro}
              onChange={(e) => set("laminacaoContraRotuloOutro", e.target.value)}
            />
          )}
        </div>
      </div>

      {!hotStampingExpandido ? (
        <button
          type="button"
          onClick={() => setHotStampingExpandido(true)}
          className="self-start text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
        >
          + hot/cold stamping (opcional)
        </button>
      ) : (
        <div className="flex flex-col gap-2">
          <span className="text-xs text-slate-500">
            Hot/cold stamping — pode ter mais de uma variação neste item.
          </span>
          {valores.hotStampings.map((linha) => (
            <LinhaHotStamping
              key={linha.chave}
              linha={linha}
              onAlterar={(campo, valor) => alterarHotStamping(linha.chave, campo, valor)}
              onRemover={() => removerHotStamping(linha.chave)}
            />
          ))}
          <Button type="button" variant="outline" onClick={adicionarHotStamping} className="self-start !px-3 !py-1.5 text-xs">
            + adicionar variação
          </Button>
        </div>
      )}
    </div>
  );
}
