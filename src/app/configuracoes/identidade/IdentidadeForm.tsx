"use client";

import { useActionState, useEffect, useState, type ChangeEvent } from "react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { validarArquivoLogo } from "@/lib/upload-validacao";
import { salvarLogo, removerLogo, salvarCorPrimaria, restaurarCorPadrao } from "./actions";

const COR_PADRAO = "#0d9488";
const HEX_REGEX_COR = /^#[0-9A-Fa-f]{6}$/;

export function IdentidadeForm({
  logoUrlAtual,
  corPrimariaAtual,
}: {
  logoUrlAtual: string | null;
  corPrimariaAtual: string | null;
}) {
  const [stateSalvar, formActionSalvar, isPendingSalvar] = useActionState(salvarLogo, null);
  const [stateRemover, formActionRemover, isPendingRemover] = useActionState(removerLogo, null);
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);

  const [stateCor, formActionCor, isPendingCor] = useActionState(salvarCorPrimaria, null);
  const [stateRestaurarCor, formActionRestaurarCor, isPendingRestaurarCor] = useActionState(
    restaurarCorPadrao,
    null
  );
  // Estado local do campo de texto/color picker — inicializa com a cor
  // salva, ou o teal padrão só pra ter algo válido nos dois inputs (o
  // formulário só é enviado quando o usuário aperta "Salvar cor", então
  // mostrar o padrão aqui não muda nada no banco por conta própria).
  const [corDigitada, setCorDigitada] = useState(corPrimariaAtual ?? COR_PADRAO);
  const corValidaParaPreview = HEX_REGEX_COR.test(corDigitada) ? corDigitada : COR_PADRAO;

  // Sincroniza o campo local com o teal padrão quando "Restaurar cor padrão"
  // é confirmado — sem isso, o input continuaria mostrando a última cor
  // digitada mesmo depois do banco já ter voltado pra null (revalidatePath
  // re-renderiza o Server Component pai, mas o estado local deste Client
  // Component não se redefine sozinho por causa disso).
  useEffect(() => {
    if (stateRestaurarCor?.ok) {
      setCorDigitada(COR_PADRAO);
    }
  }, [stateRestaurarCor]);

  // Mesma ideia de EnviarArteForm.tsx: valida antes de submeter, pra nunca
  // depender do limite de corpo da Server Action pra avisar o usuário.
  function handleArquivoChange(evento: ChangeEvent<HTMLInputElement>) {
    const arquivo = evento.target.files?.[0];
    if (!arquivo) {
      setErroArquivo(null);
      return;
    }
    const validacao = validarArquivoLogo(arquivo);
    setErroArquivo(validacao.ok ? null : validacao.mensagem);
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-4 p-6">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">Logo da gráfica</h2>

        {logoUrlAtual && (
          <div className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- arquivo vem de URL externa (Vercel Blob), fora do domínio otimizável pelo next/image */}
            <img
              src={logoUrlAtual}
              alt="Logo atual"
              className="h-16 w-16 rounded-lg border border-slate-200 object-contain dark:border-slate-800"
            />
            <form action={formActionRemover}>
              <Button type="submit" variant="ghost" loading={isPendingRemover}>
                Remover logo
              </Button>
            </form>
          </div>
        )}
        {stateRemover && !stateRemover.ok && <Alert variant="error">{stateRemover.mensagem}</Alert>}

        <form action={formActionSalvar} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-end gap-3">
            <Input
              label={
                logoUrlAtual
                  ? "Trocar logo (PNG, JPG ou WEBP, até 3MB)"
                  : "Enviar logo (PNG, JPG ou WEBP, até 3MB)"
              }
              name="arquivo"
              type="file"
              accept=".png,.jpg,.jpeg,.webp"
              required
              onChange={handleArquivoChange}
              className="max-w-xs"
            />
            <Button type="submit" loading={isPendingSalvar} disabled={!!erroArquivo}>
              {logoUrlAtual ? "Trocar" : "Salvar logo"}
            </Button>
          </div>
          {erroArquivo && <p className="text-xs text-rose-600">{erroArquivo}</p>}
        </form>

        {stateSalvar && (
          <Alert variant={stateSalvar.ok ? "success" : "error"}>{stateSalvar.mensagem}</Alert>
        )}
      </Card>

      <Card className="flex flex-col gap-4 p-6">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">Cor da marca</h2>
          <p className="mt-1 text-sm text-slate-500">
            Usada no PDF de orçamento e nos e-mails enviados pros seus clientes. Sem uma cor
            configurada, usamos o teal padrão do Gráfica+.
          </p>
        </div>

        <form action={formActionCor} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Cor</span>
              <input
                type="color"
                value={corValidaParaPreview}
                onChange={(evento) => setCorDigitada(evento.target.value)}
                aria-label="Selecionar cor da marca"
                className="h-11 w-14 cursor-pointer rounded-lg border border-slate-300 bg-white p-1 dark:border-slate-700 dark:bg-slate-900"
              />
            </label>
            <Input
              label="Código hexadecimal"
              name="corPrimaria"
              value={corDigitada}
              onChange={(evento) => setCorDigitada(evento.target.value)}
              placeholder={COR_PADRAO}
              className="max-w-[140px] font-mono uppercase"
              maxLength={7}
            />
            <Button type="submit" loading={isPendingCor}>
              Salvar cor
            </Button>
          </div>
          {corDigitada && !HEX_REGEX_COR.test(corDigitada) && (
            <p className="text-xs text-rose-600">
              Formato inválido — use #RRGGBB (ex: {COR_PADRAO}).
            </p>
          )}
        </form>
        {stateCor && <Alert variant={stateCor.ok ? "success" : "error"}>{stateCor.mensagem}</Alert>}

        {corPrimariaAtual && (
          <form action={formActionRestaurarCor}>
            <Button type="submit" variant="ghost" loading={isPendingRestaurarCor}>
              Restaurar cor padrão
            </Button>
          </form>
        )}
        {stateRestaurarCor && !stateRestaurarCor.ok && (
          <Alert variant="error">{stateRestaurarCor.mensagem}</Alert>
        )}
      </Card>
    </div>
  );
}
