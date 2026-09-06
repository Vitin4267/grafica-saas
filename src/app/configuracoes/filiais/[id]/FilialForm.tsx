"use client";

import { useActionState, useState, type ChangeEvent } from "react";
import { useAoMudar } from "@/lib/hooks/useAoMudar";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { ConfirmarExclusao } from "@/components/ui/ConfirmarExclusao";
import { validarArquivoLogo } from "@/lib/upload-validacao";
import {
  salvarFilial,
  excluirFilial,
  salvarLogoFilial,
  removerLogoFilial,
  salvarCorPrimariaFilial,
  restaurarCorPadraoFilial,
} from "../actions";

const COR_PADRAO_FILIAL = "#0d9488";
const HEX_REGEX_COR = /^#[0-9A-Fa-f]{6}$/;

type ValoresFilial = {
  nome: string;
  endereco: string;
  ativa: boolean;
  telefone: string;
  emailContato: string;
};

export function FilialForm({
  filialId,
  valoresIniciais,
  logoUrlAtual,
  corPrimariaAtual,
}: {
  filialId: string;
  valoresIniciais: ValoresFilial;
  logoUrlAtual: string | null;
  corPrimariaAtual: string | null;
}) {
  const [state, formAction, isPending] = useActionState(salvarFilial, null);
  const [estadoExclusao, excluirAction, excluindo] = useActionState(excluirFilial, null);
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);

  useAoMudar(estadoExclusao, (estadoExclusao) => {
    if (estadoExclusao && !estadoExclusao.ok) setConfirmandoExclusao(false);
  });

  const [stateLogo, formActionLogo, isPendingLogo] = useActionState(salvarLogoFilial, null);
  const [stateRemoverLogo, formActionRemoverLogo, isPendingRemoverLogo] = useActionState(
    removerLogoFilial,
    null
  );
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);

  const [stateCor, formActionCor, isPendingCor] = useActionState(salvarCorPrimariaFilial, null);
  const [stateRestaurarCor, formActionRestaurarCor, isPendingRestaurarCor] = useActionState(
    restaurarCorPadraoFilial,
    null
  );
  const [corDigitada, setCorDigitada] = useState(corPrimariaAtual ?? COR_PADRAO_FILIAL);
  const corValidaParaPreview = HEX_REGEX_COR.test(corDigitada) ? corDigitada : COR_PADRAO_FILIAL;

  useAoMudar(stateRestaurarCor, (estado) => {
    if (estado?.ok) setCorDigitada(COR_PADRAO_FILIAL);
  });

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
      <form action={formAction} className="flex flex-col gap-6">
        <input type="hidden" name="filialId" value={filialId} />

        <Card className="flex flex-col gap-4 p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Nome" name="nome" type="text" defaultValue={valoresIniciais.nome} required />
            <label className="flex items-center gap-2 self-end pb-2.5">
              <input
                type="checkbox"
                name="ativa"
                defaultChecked={valoresIniciais.ativa}
                className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
              />
              <span className="text-sm text-slate-700 dark:text-slate-200">
                Filial ativa (aparece pra seleção no orçamento)
              </span>
            </label>
            <div className="sm:col-span-2">
              <Input
                label="Endereço"
                name="endereco"
                type="text"
                defaultValue={valoresIniciais.endereco}
                placeholder="opcional — só referência"
              />
            </div>
            {/* Achado A8 — telefone/e-mail PRÓPRIOS da filial, sobrescrevem
                o da gráfica no PDF de orçamento feito nela (ver rodapé de
                contato). Em branco = continua usando o dado da gráfica. */}
            <Input
              label="Telefone"
              name="telefone"
              type="tel"
              placeholder="opcional — sobrescreve o telefone da gráfica no PDF"
              defaultValue={valoresIniciais.telefone}
            />
            <Input
              label="E-mail de contato"
              name="emailContato"
              type="email"
              placeholder="opcional — sobrescreve o e-mail da gráfica no PDF"
              defaultValue={valoresIniciais.emailContato}
            />
          </div>
        </Card>

        {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}

        <Button type="submit" loading={isPending} className="self-start">
          {isPending ? "Salvando..." : "Salvar filial"}
        </Button>
      </form>

      <Card className="flex flex-col gap-4 p-6">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Logo desta filial
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Opcional — quando enviada, sobrescreve a logo da gráfica no PDF de orçamento feito
            nesta filial. Sem logo própria, o PDF continua usando a logo da gráfica.
          </p>
        </div>

        {logoUrlAtual && (
          <div className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- arquivo vem de URL externa (Vercel Blob), fora do domínio otimizável pelo next/image */}
            <img
              src={logoUrlAtual}
              alt="Logo atual da filial"
              className="h-16 w-16 rounded-lg border border-slate-200 object-contain dark:border-slate-800"
            />
            <form action={formActionRemoverLogo}>
              <input type="hidden" name="filialId" value={filialId} />
              <Button type="submit" variant="ghost" loading={isPendingRemoverLogo}>
                Remover logo da filial
              </Button>
            </form>
          </div>
        )}
        {stateRemoverLogo && !stateRemoverLogo.ok && (
          <Alert variant="error">{stateRemoverLogo.mensagem}</Alert>
        )}

        <form action={formActionLogo} className="flex flex-col gap-2">
          <input type="hidden" name="filialId" value={filialId} />
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
            <Button type="submit" loading={isPendingLogo} disabled={!!erroArquivo}>
              {logoUrlAtual ? "Trocar" : "Salvar logo"}
            </Button>
          </div>
          {erroArquivo && <p className="text-xs text-rose-600">{erroArquivo}</p>}
        </form>

        {stateLogo && <Alert variant={stateLogo.ok ? "success" : "error"}>{stateLogo.mensagem}</Alert>}
      </Card>

      <Card className="flex flex-col gap-4 p-6">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Cor desta filial
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Opcional — quando definida, sobrescreve a cor da gráfica no PDF de orçamento feito
            nesta filial. Sem cor própria, o PDF continua usando a cor da gráfica.
          </p>
        </div>

        <form action={formActionCor} className="flex flex-col gap-2">
          <input type="hidden" name="filialId" value={filialId} />
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Cor</span>
              <input
                type="color"
                value={corValidaParaPreview}
                onChange={(evento) => setCorDigitada(evento.target.value)}
                aria-label="Selecionar cor da filial"
                className="h-11 w-14 cursor-pointer rounded-lg border border-slate-300 bg-white p-1 dark:border-slate-700 dark:bg-slate-900"
              />
            </label>
            <Input
              label="Código hexadecimal"
              name="corPrimaria"
              value={corDigitada}
              onChange={(evento) => setCorDigitada(evento.target.value)}
              placeholder={COR_PADRAO_FILIAL}
              className="max-w-[140px] font-mono uppercase"
              maxLength={7}
            />
            <Button type="submit" loading={isPendingCor}>
              Salvar cor
            </Button>
          </div>
          {corDigitada && !HEX_REGEX_COR.test(corDigitada) && (
            <p className="text-xs text-rose-600">
              Formato inválido — use #RRGGBB (ex: {COR_PADRAO_FILIAL}).
            </p>
          )}
        </form>
        {stateCor && <Alert variant={stateCor.ok ? "success" : "error"}>{stateCor.mensagem}</Alert>}

        {corPrimariaAtual && (
          <form action={formActionRestaurarCor}>
            <input type="hidden" name="filialId" value={filialId} />
            <Button type="submit" variant="ghost" loading={isPendingRestaurarCor}>
              Restaurar cor da gráfica
            </Button>
          </form>
        )}
        {stateRestaurarCor && !stateRestaurarCor.ok && (
          <Alert variant="error">{stateRestaurarCor.mensagem}</Alert>
        )}
      </Card>

      <Card className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-900 dark:text-white">Excluir filial</p>
            <p className="text-xs text-slate-500">
              Orçamentos já feitos nesta filial continuam existindo, só ficam sem filial marcada.
            </p>
            {estadoExclusao && !estadoExclusao.ok && (
              <p className="mt-1 text-xs text-rose-600">{estadoExclusao.mensagem}</p>
            )}
          </div>
          {!confirmandoExclusao && (
            <Button
              type="button"
              variant="outline"
              className="shrink-0 text-rose-600"
              onClick={() => setConfirmandoExclusao(true)}
            >
              Excluir
            </Button>
          )}
        </div>
        {confirmandoExclusao && (
          <ConfirmarExclusao
            pergunta={`Tem certeza que quer excluir a filial "${valoresIniciais.nome}"? Essa ação não pode ser desfeita.`}
            onCancelar={() => setConfirmandoExclusao(false)}
            formAction={excluirAction}
            campos={{ filialId }}
            rotuloBotao="Excluir filial"
            pendente={excluindo}
          />
        )}
      </Card>
    </div>
  );
}
