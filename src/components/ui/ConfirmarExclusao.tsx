"use client";

import { Button } from "./Button";
import { Alert } from "./Alert";

// Passo de confirmação inline (não modal) — mesmo padrão que já existia em
// OrcamentoAcoes.tsx (cancelar/rejeitar orçamento), extraído aqui pra
// reaproveitar em qualquer exclusão do site sem duplicar a marcação.
// O chamador controla o estado de "confirmando" e troca o botão de ação
// normal por isto quando confirmando=true.
export function ConfirmarExclusao({
  pergunta,
  onCancelar,
  formAction,
  campos,
  rotuloBotao = "Confirmar exclusão",
  pendente,
}: {
  pergunta: string;
  onCancelar: () => void;
  formAction: (formData: FormData) => void;
  campos: Record<string, string>;
  rotuloBotao?: string;
  pendente: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Alert variant="error">{pergunta}</Alert>
      <div className="flex gap-3">
        <form action={formAction}>
          {Object.entries(campos).map(([nome, valor]) => (
            <input key={nome} type="hidden" name={nome} value={valor} />
          ))}
          <Button type="submit" variant="secondary" loading={pendente}>
            {rotuloBotao}
          </Button>
        </form>
        <Button type="button" variant="ghost" onClick={onCancelar}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
