"use client";

import { useEffect, useRef, useState } from "react";

// Mark de tendência dentro de um StatTile — não é um gráfico standalone,
// então de propósito não tem eixo, legenda ou tooltip. Traço único (cor de
// acento), sem preenchimento, 2px, pontas arredondadas.
export function Sparkline({
  dados,
  largura = 120,
  altura = 32,
  corTraco = "var(--color-accent-500)",
}: {
  dados: number[];
  largura?: number;
  altura?: number;
  corTraco?: string;
}) {
  const caminhoRef = useRef<SVGPathElement>(null);
  const [comprimento, setComprimento] = useState(0);

  const max = Math.max(...dados, 1);
  const min = Math.min(...dados, 0);
  const d =
    dados.length < 2
      ? ""
      : "M" +
        dados
          .map((v, i) => {
            const x = (i / (dados.length - 1)) * largura;
            const y = altura - ((v - min) / (max - min || 1)) * altura;
            return `${x},${y}`;
          })
          .join(" L");

  useEffect(() => {
    const prefereReduzido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const comprimentoTotal = caminhoRef.current?.getTotalLength() ?? 0;
    setComprimento(prefereReduzido ? 0 : comprimentoTotal);
  }, [d]);

  if (dados.length < 2) return null;

  return (
    <svg width={largura} height={altura} viewBox={`0 0 ${largura} ${altura}`} aria-hidden>
      <path
        ref={caminhoRef}
        d={d}
        fill="none"
        stroke={corTraco}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{
          strokeDasharray: comprimento,
          strokeDashoffset: comprimento,
          animation: comprimento ? "sparkline-draw 700ms ease-out forwards" : undefined,
        }}
      />
    </svg>
  );
}
