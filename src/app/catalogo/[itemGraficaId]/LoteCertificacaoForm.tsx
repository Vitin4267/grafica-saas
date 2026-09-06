"use client";

import { useActionState, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { CampoAjuda } from "@/components/ui/CampoAjuda";
import {
  CERTIFICACOES_MATERIAL,
  ROTULO_CERTIFICACAO_MATERIAL,
  type CertificacaoMaterial,
} from "@/lib/certificacao-material";
import { salvarLoteCertificacao } from "./actions";

type ValoresAtuais = {
  controlaLote: boolean;
  certificacao: string;
  certificacaoOutro: string;
};

// Achado F4 da auditoria de abrangência (Parte 7, 2026-09-05): schema já
// documentava a EXIGÊNCIA de lote (Cliente.preferenciasProducao usa como
// exemplo real "não aceita variação de tom entre lotes") sem ter onde
// registrar de qual lote a matéria-prima saiu. `controlaLote` é o opt-in
// que liga os campos de lote/validade na tela de Entrada de compra (ver
// LancarMovimentacaoForm.tsx) — ligar aqui NUNCA obriga nada em matéria-
// prima já cadastrada nem muda como qualquer outra matéria-prima funciona.
// Certificação (FSC/PEFC) cadastrada no mesmo card por ser a mesma
// preocupação de rastreabilidade/compliance — mas é puramente descritiva
// (nunca lida por src/lib/pricing/), enquanto controlaLote de fato muda
// quais campos aparecem no formulário de entrada.
export function LoteCertificacaoForm({
  itemGraficaId,
  valoresAtuais,
}: {
  itemGraficaId: string;
  valoresAtuais: ValoresAtuais;
}) {
  const [state, formAction, isPending] = useActionState(salvarLoteCertificacao, null);
  const [controlaLote, setControlaLote] = useState(valoresAtuais.controlaLote);
  const [certificacao, setCertificacao] = useState(valoresAtuais.certificacao);

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">
          Lote, validade e certificação
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Opcional — não faz FEFO nem escolhe automaticamente qual lote sai num pedido, só registra
          o rastro: qual lote entrou e qual validade tinha.
        </p>
      </div>
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="itemGraficaId" value={itemGraficaId} />

        <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
          <input
            type="checkbox"
            name="controlaLote"
            checked={controlaLote}
            onChange={(e) => setControlaLote(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
          />
          <span>
            Controlar lote e validade deste material
            <CampoAjuda texto="Liga os campos 'Nº do lote' e 'Validade' na tela de Entrada de compra. Sem isso ligado, entrada de compra continua exatamente como hoje — sem nenhum campo de lote. Não confundir com 'Lote mínimo de compra' (quantidade mínima do fornecedor) na Configuração de compra acima." />
          </span>
        </label>

        <div className="flex flex-wrap gap-3">
          <div className="w-64">
            <Select
              label="Certificação de cadeia de custódia"
              name="certificacao"
              value={certificacao}
              onChange={(e) => setCertificacao(e.target.value)}
            >
              <option value="">Não informado</option>
              {CERTIFICACOES_MATERIAL.map((c) => (
                <option key={c} value={c}>
                  {ROTULO_CERTIFICACAO_MATERIAL[c as CertificacaoMaterial]}
                </option>
              ))}
            </Select>
          </div>
          {certificacao === "OUTRO" && (
            <div className="w-56">
              <Input
                label="Qual? (opcional)"
                name="certificacaoOutro"
                type="text"
                maxLength={60}
                defaultValue={valoresAtuais.certificacaoOutro}
              />
            </div>
          )}
        </div>

        <Button type="submit" variant="outline" loading={isPending} className="self-start">
          {isPending ? "Salvando..." : "Salvar"}
        </Button>
        {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}
      </form>
    </Card>
  );
}
