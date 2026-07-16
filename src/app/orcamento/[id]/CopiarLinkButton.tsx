"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

type Variant = "primary" | "secondary" | "outline" | "ghost";

// Botão genérico de "copiar pro clipboard com feedback" — usado tanto no
// card padrão de compartilhamento (CompartilharOrcamento) quanto na
// comemoração do primeiro orçamento (PrimeiroOrcamentoCelebracao), pra não
// duplicar a lógica de clipboard + timeout em cada lugar que precisa copiar
// o link público.
export function CopiarLinkButton({
  valor,
  label = "Copiar",
  variant = "outline",
  className = "",
}: {
  valor: string;
  label?: string;
  variant?: Variant;
  className?: string;
}) {
  const [copiado, setCopiado] = useState(false);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(valor);
    } catch {
      // Clipboard indisponível (ex: contexto não seguro/permissão negada) —
      // falha silenciosa, sem feedback de "Copiado!" enganoso.
      return;
    }
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  };

  return (
    <Button type="button" variant={variant} className={className} onClick={copiar}>
      {copiado ? "Copiado!" : label}
    </Button>
  );
}
