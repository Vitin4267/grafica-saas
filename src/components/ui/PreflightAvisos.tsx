import type { AvisoPreflight } from "@/lib/preflight";
import { AlertTriangleIcon, InfoIcon } from "@/components/icons";

// Mostra os achados do preflight automático de arte (ver src/lib/preflight.ts)
// perto de onde a arte já é exibida — em PedidoLinha.tsx (Produção) e
// OrcamentoEnviarArteForm.tsx (Orçamento). Um <details> nativo (mesmo padrão
// de CustosPedidoSecao.tsx) em vez de useState: fecha por padrão pra não
// poluir a linha, um clique expande. NUNCA bloqueia nada — é só leitura,
// puramente informativo.
export function PreflightAvisos({ avisos }: { avisos: AvisoPreflight[] }) {
  if (avisos.length === 0) return null;

  // Amber quando há pelo menos um achado que merece atenção de verdade
  // (severidade "aviso"); azul (mesmo tom do Alert variant="info", já usado
  // em todo o app) quando são só achados informativos (ex: RGB vs CMYK).
  const temAviso = avisos.some((a) => a.severidade === "aviso");
  const Icone = temAviso ? AlertTriangleIcon : InfoIcon;
  const corResumo = temAviso
    ? "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
    : "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300";

  return (
    <details className="group w-fit">
      <summary
        className={`inline-flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium marker:content-none ${corResumo}`}
      >
        <Icone className="h-3.5 w-3.5 shrink-0" />
        {avisos.length} {avisos.length === 1 ? "aviso" : "avisos"} na arte
      </summary>
      <ul className="mt-2 flex flex-col gap-1.5">
        {avisos.map((aviso, indice) => (
          <li
            key={indice}
            className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
              aviso.severidade === "aviso"
                ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300"
                : "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-300"
            }`}
          >
            {aviso.severidade === "aviso" ? (
              <AlertTriangleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            ) : (
              <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            )}
            <span>{aviso.mensagem}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
