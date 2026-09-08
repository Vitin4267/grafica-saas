"use client";

import { useState } from "react";
import { ORDEM_MOTIVO_REFUGO, ROTULOS_MOTIVO_REFUGO } from "@/lib/refugo-producao";
import type { MotivoRefugo } from "@/generated/prisma/enums";

const CAMPO_CLASSE =
  "rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";

// Achado B3 da Parte 2 (Produção) da auditoria de abrangência
// (2026-09-07) — refugo real de produção (folhas cortadas errado, peça com
// defeito, falha no meio de uma bobina) não tinha onde ser registrado
// depois da perda de calibragem (que só acontece uma vez, na entrada em
// PRODUCAO). Campos condicionais no MESMO form compacto que
// AvancarPedidoButton.tsx já usa pra selecaoMaquina (achado B2) — mesmo
// estilo visual (label text-xs + select/input pequenos), este form é uma
// linha inline, não a tela cheia de ParadaPedidoSecao/
// TerceirizacaoPedidoSecao. "Boa"/"Refugo" ficam sempre visíveis (com
// default pronto pra só clicar Avançar sem digitar nada); "Motivo" só
// aparece quando refugo > 0 (nunca força o operador a escolher motivo pra
// zero refugo) — mesmo padrão condicional de FormularioNovaParada
// (motivo=OUTRO revela motivoOutro).
export function RefugoEtapaCampos({ quantidadePedido }: { quantidadePedido: number }) {
  const [quantidadeRefugo, setQuantidadeRefugo] = useState("0");
  const [motivoRefugo, setMotivoRefugo] = useState<MotivoRefugo>("ACERTO_MAQUINA");
  const refugoInformado = Number(quantidadeRefugo) > 0;

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-0.5">
        <span className="text-xs text-slate-500">Boa</span>
        <input
          type="number"
          name="quantidadeBoa"
          min={0}
          step={1}
          defaultValue={quantidadePedido > 0 ? quantidadePedido : undefined}
          className={`w-20 ${CAMPO_CLASSE}`}
        />
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="text-xs text-slate-500">Refugo</span>
        <input
          type="number"
          name="quantidadeRefugo"
          min={0}
          step={1}
          value={quantidadeRefugo}
          onChange={(e) => setQuantidadeRefugo(e.target.value)}
          className={`w-20 ${CAMPO_CLASSE}`}
        />
      </label>

      {refugoInformado && (
        <>
          <label className="flex flex-col gap-0.5">
            <span className="text-xs text-slate-500">Motivo do refugo</span>
            <select
              name="motivoRefugo"
              value={motivoRefugo}
              onChange={(e) => setMotivoRefugo(e.target.value as MotivoRefugo)}
              className={CAMPO_CLASSE}
            >
              {ORDEM_MOTIVO_REFUGO.map((motivo) => (
                <option key={motivo} value={motivo}>
                  {ROTULOS_MOTIVO_REFUGO[motivo]}
                </option>
              ))}
            </select>
          </label>

          {motivoRefugo === "OUTRO" && (
            <label className="flex flex-col gap-0.5">
              <span className="text-xs text-slate-500">Descreva</span>
              <input
                type="text"
                name="motivoRefugoOutro"
                maxLength={200}
                required
                className={`w-40 ${CAMPO_CLASSE}`}
              />
            </label>
          )}

          {/* Nunca imposta — o operador decide se quer a baixa extra de
              matéria-prima (ver comentário no enunciado do achado B3).
              Desmarcado por padrão: só registrar o refugo, sem mexer em
              estoque, é o caminho mais seguro quando não se tem certeza. */}
          <label className="mb-2 flex items-center gap-1.5 text-xs text-slate-500">
            <input type="checkbox" name="gerarBaixaRefugo" className="rounded border-slate-300" />
            Dar baixa de estoque extra pra repor o refugo
          </label>
        </>
      )}
    </div>
  );
}
