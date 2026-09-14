"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { PlusIcon } from "@/components/icons";
import { NovaPrensaForm } from "../prensas/NovaPrensaForm";
import { NovaMaquinaFlexografiaForm } from "./flexografia/NovaMaquinaFlexografiaForm";
import { NovoEquipamentoForm } from "./equipamentos/NovoEquipamentoForm";
import { NovaImpressoraDigitalForm } from "./impressao-digital/NovaImpressoraDigitalForm";
import { NovaMaquinaSetupPorPecaForm } from "./setup-por-peca/NovaMaquinaSetupPorPecaForm";
import { NovaMaquinaBordadoForm } from "./bordado/NovaMaquinaBordadoForm";
import { NovaMaquinaTempoForm } from "./tempo-maquina/NovaMaquinaTempoForm";

type TipoMaquina =
  | "PRENSA"
  | "FLEXOGRAFIA"
  | "EQUIPAMENTO"
  | "IMPRESSORA_DIGITAL"
  | "SETUP_POR_PECA"
  | "BORDADO"
  | "TEMPO_MAQUINA";

// Mesmos rótulos já usados nos <h2> de cada seção acima nesta página — não
// inventa texto novo, só reorganiza onde ele aparece.
const OPCOES: { valor: TipoMaquina; rotulo: string }[] = [
  { valor: "PRENSA", rotulo: "Offset" },
  { valor: "FLEXOGRAFIA", rotulo: "Flexografia" },
  { valor: "EQUIPAMENTO", rotulo: "Outros equipamentos" },
  { valor: "IMPRESSORA_DIGITAL", rotulo: "Impressão Digital" },
  { valor: "SETUP_POR_PECA", rotulo: "Serigrafia / Sublimação / Estampagem a quente" },
  { valor: "BORDADO", rotulo: "Bordado" },
  { valor: "TEMPO_MAQUINA", rotulo: "Tempo de máquina" },
];

// Substitui os 7 <Card><Nova*Form/></Card> que antes ficavam sempre visíveis
// no fim de cada seção — uma gráfica que só usa 2 dos 7 tipos não precisa
// ver os outros 5 formulários toda vez que entra na tela. Cada Nova*Form
// continua exatamente como era (mesma Server Action própria, mesmo
// redirect() pra tela de detalhe ao criar com sucesso) — este componente só
// decide QUAL form mostrar, nunca reimplementa a criação em si.
export function SeletorNovaMaquina() {
  const [tipoAberto, setTipoAberto] = useState<TipoMaquina | null>(null);

  if (tipoAberto === null) {
    return (
      <Button variant="outline" onClick={() => setTipoAberto(OPCOES[0].valor)}>
        <PlusIcon className="h-4 w-4" />
        Adicionar máquina
      </Button>
    );
  }

  return (
    <Card className="p-6">
      <div className="mb-4 flex flex-col gap-4">
        <Select
          label="Que tipo de máquina?"
          value={tipoAberto}
          onChange={(e) => setTipoAberto(e.target.value as TipoMaquina)}
        >
          {OPCOES.map((opcao) => (
            <option key={opcao.valor} value={opcao.valor}>
              {opcao.rotulo}
            </option>
          ))}
        </Select>
      </div>

      {/* key={tipoAberto} — evita estado de input de um tipo vazar pro
          próximo form ao trocar a seleção no meio do preenchimento. */}
      <div key={tipoAberto} className="flex flex-col gap-4">
        {tipoAberto === "PRENSA" && <NovaPrensaForm />}
        {tipoAberto === "FLEXOGRAFIA" && <NovaMaquinaFlexografiaForm />}
        {tipoAberto === "EQUIPAMENTO" && <NovoEquipamentoForm />}
        {tipoAberto === "IMPRESSORA_DIGITAL" && <NovaImpressoraDigitalForm />}
        {tipoAberto === "SETUP_POR_PECA" && <NovaMaquinaSetupPorPecaForm />}
        {tipoAberto === "BORDADO" && <NovaMaquinaBordadoForm />}
        {tipoAberto === "TEMPO_MAQUINA" && <NovaMaquinaTempoForm />}
      </div>

      <button
        type="button"
        onClick={() => setTipoAberto(null)}
        className="mt-4 text-xs font-medium text-slate-500 hover:text-slate-700 hover:underline dark:text-slate-400 dark:hover:text-slate-200"
      >
        Cancelar
      </button>
    </Card>
  );
}
