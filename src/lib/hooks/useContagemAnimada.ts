"use client";

import { useEffect, useRef, useState } from "react";

// Anima de 0 até valorFinal uma vez quando o valor muda (não a cada
// re-render — primeiraRenderizacao evita reanimar por causa de um
// re-render do componente pai que não mudou o número). Ignorado (retorna
// valorFinal direto) se o usuário pediu menos movimento no SO.
export function useContagemAnimada(valorFinal: number, duracaoMs = 700): number {
  const [valor, setValor] = useState(valorFinal);
  const primeiraRenderizacao = useRef(true);

  useEffect(() => {
    const prefereReduzido =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (primeiraRenderizacao.current === false || prefereReduzido) {
      setValor(valorFinal);
      primeiraRenderizacao.current = false;
      return;
    }
    primeiraRenderizacao.current = false;

    const inicio = performance.now();
    let quadro: number;

    function animar(agora: number) {
      const progresso = Math.min((agora - inicio) / duracaoMs, 1);
      const facilitado = 1 - Math.pow(1 - progresso, 3); // ease-out cúbico
      setValor(valorFinal * facilitado);
      if (progresso < 1) quadro = requestAnimationFrame(animar);
    }
    quadro = requestAnimationFrame(animar);
    return () => cancelAnimationFrame(quadro);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valorFinal]);

  return valor;
}
