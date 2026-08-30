"use client";

// Achado B2 da Parte 2 (Produção) — combobox único que decompõe a escolha
// num dos 5 campos que ApontamentoEtapa espera (prensaId/
// maquinaFlexografiaId/equipamentoId/impressoraDigitalId/
// maquinaSetupPorPecaId, ver validarSelecaoMaquinaOpcional em
// src/lib/manutencao-maquina.ts) — sempre no máximo 1 preenchido. O valor
// interno é codificado como "campo:id" (ou "" pra "nenhuma máquina
// informada") só pra caber num único <select>; camposOcultosMaquina abaixo
// decompõe de volta nos 5 hidden inputs que a Server Action espera.

export type MaquinaOpcaoUI = { campo: string; id: string; nome: string; grupo: string };

const CAMPOS_MAQUINA_APONTAMENTO = [
  "prensaId",
  "maquinaFlexografiaId",
  "equipamentoId",
  "impressoraDigitalId",
  "maquinaSetupPorPecaId",
] as const;

// Deriva os 5 hidden inputs a partir do valor codificado "campo:id" — usado
// tanto por SeletorMaquina (indiretamente, via os inputs que ele renderiza)
// quanto por quem monta o form em volta dele.
export function camposOcultosMaquina(valorCodificado: string): Record<string, string> {
  const [campoEscolhido, id] = valorCodificado.includes(":")
    ? valorCodificado.split(":")
    : [null, null];
  return Object.fromEntries(
    CAMPOS_MAQUINA_APONTAMENTO.map((campo) => [campo, campo === campoEscolhido ? (id ?? "") : ""])
  );
}

export function SeletorMaquina({
  maquinas,
  valor,
  onChange,
  label = "Máquina desta etapa",
}: {
  maquinas: MaquinaOpcaoUI[];
  valor: string;
  onChange: (valor: string) => void;
  label?: string;
}) {
  const grupos = [...new Set(maquinas.map((m) => m.grupo))];
  const camposOcultos = camposOcultosMaquina(valor);

  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-slate-500">{label}</span>
      <select
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      >
        <option value="">Nenhuma máquina informada</option>
        {grupos.map((grupo) => (
          <optgroup key={grupo} label={grupo}>
            {maquinas
              .filter((m) => m.grupo === grupo)
              .map((m) => (
                <option key={`${m.campo}:${m.id}`} value={`${m.campo}:${m.id}`}>
                  {m.nome}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
      {/* Os 5 hidden inputs que avancarPedido (Server Action) de fato lê —
          extrairEValidarSelecaoMaquina confere de novo, no servidor, que no
          máximo 1 veio preenchido (nunca confia só no <select> só permitir 1
          escolha por vez — ver princípio de tudo sensível no backend). */}
      {Object.entries(camposOcultos).map(([campo, id]) => (
        <input key={campo} type="hidden" name={campo} value={id} />
      ))}
    </label>
  );
}
