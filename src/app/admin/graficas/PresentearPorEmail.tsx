"use client";

import { useActionState } from "react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { presentearPorEmail } from "./actions";

export function PresentearPorEmail() {
  const [estado, acao, pending] = useActionState(presentearPorEmail, null);

  return (
    <Card className="mb-6 flex flex-col gap-3 p-5">
      <div>
        <h2 className="font-semibold text-slate-900 dark:text-white">
          Presentear com assinatura vitalícia
        </h2>
        <p className="text-sm text-slate-500">
          Digite o e-mail de quem já tem conta na plataforma — a gráfica dele
          vira cortesia na hora, sem precisar procurar na lista abaixo.
        </p>
      </div>
      <form action={acao} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Input
            label="E-mail da pessoa"
            name="email"
            type="email"
            required
            placeholder="pessoa@exemplo.com.br"
          />
        </div>
        <Button type="submit" variant="primary" loading={pending}>
          Presentear
        </Button>
      </form>
      {estado && (
        <Alert variant={estado.ok ? "success" : "error"}>{estado.mensagem}</Alert>
      )}
    </Card>
  );
}
