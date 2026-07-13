"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { concederCortesia, revogarCortesia } from "./actions";

export function AcaoCortesia({ graficaId, cortesia }: { graficaId: string; cortesia: boolean }) {
  const [estadoConceder, acaoConceder, concedendoPending] = useActionState(concederCortesia, null);
  const [estadoRevogar, acaoRevogar, revogandoPending] = useActionState(revogarCortesia, null);
  const estado = cortesia ? estadoRevogar : estadoConceder;

  return (
    <div className="flex flex-col items-end gap-1">
      {cortesia ? (
        <form action={acaoRevogar}>
          <input type="hidden" name="graficaId" value={graficaId} />
          <Button type="submit" variant="outline" loading={revogandoPending}>
            Revogar cortesia
          </Button>
        </form>
      ) : (
        <form action={acaoConceder}>
          <input type="hidden" name="graficaId" value={graficaId} />
          <Button type="submit" variant="primary" loading={concedendoPending}>
            Conceder cortesia
          </Button>
        </form>
      )}
      {estado && !estado.ok && (
        <span className="text-xs text-rose-600">{estado.mensagem}</span>
      )}
    </div>
  );
}
