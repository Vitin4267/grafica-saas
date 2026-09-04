"use client";

import { useActionState, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import {
  TIPOS_DOBRA,
  ROTULO_TIPO_DOBRA,
  TIPOS_ENCADERNACAO,
  ROTULO_TIPO_ENCADERNACAO,
  TIPOS_COLAGEM,
  ROTULO_TIPO_COLAGEM,
  type TipoDobra,
  type TipoEncadernacao,
  type TipoColagem,
} from "@/lib/acabamento-estrutural";
import { salvarAcabamentoEstrutural } from "./actions";

type ValoresAtuais = {
  tipoDobra: string;
  tipoDobraOutro: string;
  tipoEncadernacao: string;
  tipoEncadernacaoOutro: string;
  tipoColagem: string;
  tipoColagemOutro: string;
};

// Achado C5 da auditoria de abrangência (Parte 7, 2026-09-04): etiqueta já
// tem dropdown estruturado de acabamento (adesivo, serrilha, laminação,
// verniz, hot stamping) — este card leva o mesmo tipo de opção pra
// embalagem/livro/comunicação visual/brinde, onde um SERVICO de acabamento
// hoje só tem nome livre. Card à parte (não dentro de
// ConfiguracaoAcabamentoForm) de propósito: os 3 campos vivem direto em
// ItemGrafica, puramente descritivos, sem nenhuma relação com
// ConfiguracaoAcabamento/o motor de precificação — não faz sentido forçar a
// gráfica a configurar base de cobrança só pra registrar "isto é uma
// sanfona". Atrás de <details> porque uma gráfica tipicamente usa só 1 dos
// 3 tipos por serviço (dobra OU encadernação OU colagem), raramente os 3
// juntos.
export function AcabamentoEstruturalForm({
  itemGraficaId,
  valoresAtuais,
}: {
  itemGraficaId: string;
  valoresAtuais: ValoresAtuais;
}) {
  const [state, formAction, isPending] = useActionState(salvarAcabamentoEstrutural, null);
  const [tipoDobra, setTipoDobra] = useState(valoresAtuais.tipoDobra);
  const [tipoEncadernacao, setTipoEncadernacao] = useState(valoresAtuais.tipoEncadernacao);
  const [tipoColagem, setTipoColagem] = useState(valoresAtuais.tipoColagem);

  const jaConfigurado =
    Boolean(valoresAtuais.tipoDobra) ||
    Boolean(valoresAtuais.tipoEncadernacao) ||
    Boolean(valoresAtuais.tipoColagem);

  return (
    <Card className="p-6">
      <details open={jaConfigurado}>
        <summary className="cursor-pointer list-none">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                Tipo de acabamento estrutural (opcional)
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Dobra, encadernação ou colagem — organiza o cadastro pra gráfica de embalagem,
                livro/editorial, comunicação visual ou brinde, mesmo espírito do dropdown que
                etiqueta já tem. Só descritivo: não afeta preço nem entra em nenhum cálculo do
                sistema — quem define o preço continua sendo a configuração de acabamento acima
                (base de cobrança, setup, mínimo).
              </p>
            </div>
          </div>
        </summary>

        <form action={formAction} className="mt-4 flex flex-col gap-4">
          <input type="hidden" name="itemGraficaId" value={itemGraficaId} />

          <div className="flex flex-wrap gap-3">
            <div className="w-56">
              <Select
                label="Tipo de dobra"
                name="tipoDobra"
                value={tipoDobra}
                onChange={(e) => setTipoDobra(e.target.value)}
              >
                <option value="">Nenhum</option>
                {TIPOS_DOBRA.map((t) => (
                  <option key={t} value={t}>
                    {ROTULO_TIPO_DOBRA[t as TipoDobra]}
                  </option>
                ))}
              </Select>
            </div>
            {tipoDobra === "OUTRO" && (
              <div className="w-56">
                <Input
                  label="Qual? (opcional)"
                  name="tipoDobraOutro"
                  type="text"
                  maxLength={60}
                  defaultValue={valoresAtuais.tipoDobraOutro}
                />
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="w-56">
              <Select
                label="Tipo de encadernação"
                name="tipoEncadernacao"
                value={tipoEncadernacao}
                onChange={(e) => setTipoEncadernacao(e.target.value)}
              >
                <option value="">Nenhum</option>
                {TIPOS_ENCADERNACAO.map((t) => (
                  <option key={t} value={t}>
                    {ROTULO_TIPO_ENCADERNACAO[t as TipoEncadernacao]}
                  </option>
                ))}
              </Select>
            </div>
            {tipoEncadernacao === "OUTRO" && (
              <div className="w-56">
                <Input
                  label="Qual? (opcional)"
                  name="tipoEncadernacaoOutro"
                  type="text"
                  maxLength={60}
                  defaultValue={valoresAtuais.tipoEncadernacaoOutro}
                />
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="w-56">
              <Select
                label="Tipo de colagem"
                name="tipoColagem"
                value={tipoColagem}
                onChange={(e) => setTipoColagem(e.target.value)}
              >
                <option value="">Nenhum</option>
                {TIPOS_COLAGEM.map((t) => (
                  <option key={t} value={t}>
                    {ROTULO_TIPO_COLAGEM[t as TipoColagem]}
                  </option>
                ))}
              </Select>
            </div>
            {tipoColagem === "OUTRO" && (
              <div className="w-56">
                <Input
                  label="Qual? (opcional)"
                  name="tipoColagemOutro"
                  type="text"
                  maxLength={60}
                  defaultValue={valoresAtuais.tipoColagemOutro}
                />
              </div>
            )}
          </div>

          <Button type="submit" variant="outline" loading={isPending} className="self-start">
            {isPending ? "Salvando..." : "Salvar"}
          </Button>
          {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}
        </form>
      </details>
    </Card>
  );
}
