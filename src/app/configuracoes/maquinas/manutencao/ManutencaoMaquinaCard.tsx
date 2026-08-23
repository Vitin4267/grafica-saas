"use client";

import { useActionState, useState } from "react";
import { useAoMudar } from "@/lib/hooks/useAoMudar";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { ROTULO_TIPO_MANUTENCAO } from "@/lib/manutencao-maquina";
import { iniciarManutencao, encerrarManutencao } from "./actions";
import type { TipoRegistroManutencao } from "@/generated/prisma/enums";

type RegistroAtivo = {
  id: string;
  tipo: TipoRegistroManutencao;
  motivo: string;
  dataInicioFormatada: string;
  registradoPorNome: string;
};

// Um card por prensa/máquina de flexografia, com os dois estados possíveis:
// disponível (botão "Registrar parada" revela um form inline, mesmo padrão
// de NovaPrensaForm) ou parada (mostra motivo/tipo/desde-quando + botão
// "Encerrar parada"). `campoId` decide qual hidden field a Server Action
// espera — mesma FK opcional por tipo do resto do domínio de máquinas.
export function ManutencaoMaquinaCard({
  maquinaId,
  maquinaNome,
  campoId,
  registroAtivo,
}: {
  maquinaId: string;
  maquinaNome: string;
  campoId:
    | "prensaId"
    | "maquinaFlexografiaId"
    | "equipamentoId"
    | "impressoraDigitalId"
    | "maquinaSetupPorPecaId";
  registroAtivo: RegistroAtivo | null;
}) {
  const [mostrarForm, setMostrarForm] = useState(false);
  const [estadoInicio, iniciarAction, iniciando] = useActionState(iniciarManutencao, null);
  const [estadoFim, encerrarAction, encerrando] = useActionState(encerrarManutencao, null);

  useAoMudar(estadoInicio, (estado) => {
    if (estado?.ok) setMostrarForm(false);
  });

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-medium text-slate-900 dark:text-white">{maquinaNome}</p>
          {registroAtivo ? (
            <p className="mt-0.5 text-xs text-slate-500">
              Parada desde {registroAtivo.dataInicioFormatada} · registrado por{" "}
              {registroAtivo.registradoPorNome}
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-slate-500">Disponível pra produção</p>
          )}
        </div>
        {registroAtivo ? (
          <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
            {ROTULO_TIPO_MANUTENCAO[registroAtivo.tipo]}
          </span>
        ) : (
          <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
            Em produção
          </span>
        )}
      </div>

      {registroAtivo && (
        <>
          <p className="text-sm text-slate-600 dark:text-slate-300">{registroAtivo.motivo}</p>
          <form action={encerrarAction} className="self-start">
            <input type="hidden" name="registroId" value={registroAtivo.id} />
            <Button type="submit" variant="outline" loading={encerrando}>
              {encerrando ? "Encerrando..." : "Encerrar parada"}
            </Button>
          </form>
          {estadoFim && !estadoFim.ok && <Alert variant="error">{estadoFim.mensagem}</Alert>}
        </>
      )}

      {!registroAtivo && !mostrarForm && (
        <Button
          type="button"
          variant="outline"
          className="self-start"
          onClick={() => setMostrarForm(true)}
        >
          Registrar parada
        </Button>
      )}

      {!registroAtivo && mostrarForm && (
        <form
          action={iniciarAction}
          className="flex flex-col gap-3 border-t border-slate-100 pt-3 dark:border-slate-800"
        >
          <input type="hidden" name={campoId} value={maquinaId} />
          <Select label="Tipo de parada" name="tipo" defaultValue="QUEBRA">
            <option value="QUEBRA">Quebra/parada não planejada</option>
            <option value="PREVENTIVA">Manutenção preventiva agendada</option>
          </Select>
          <Textarea
            label="Motivo"
            name="motivo"
            placeholder="ex: trocou o rolo de tinta, aguardando peça..."
            required
            rows={2}
          />
          {estadoInicio && !estadoInicio.ok && <Alert variant="error">{estadoInicio.mensagem}</Alert>}
          <div className="flex gap-3">
            <Button type="submit" loading={iniciando}>
              {iniciando ? "Registrando..." : "Confirmar parada"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setMostrarForm(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
