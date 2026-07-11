"use client";

import { useState, useTransition } from "react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { visualizarReajuste, aplicarReajusteEmLote, type ItemReajustado } from "./actions";

type Preview = { itens: ItemReajustado[]; percentual: number; categoriaFiltro: string | null };

// Fluxo de dois passos (calcular → confirmar) não encaixa bem num único
// useActionState por form (precisa guardar o preview E permitir "voltar"
// descartando ele) — chama as Server Actions direto, mesmo padrão já usado
// em ChatAssistente.tsx pra fluxos que não são "um form, um submit".
export function ReajusteForm({
  categorias,
  totalItensSemFiltro,
}: {
  categorias: string[];
  totalItensSemFiltro: number;
}) {
  const [percentual, setPercentual] = useState("");
  const [categoriaFiltro, setCategoriaFiltro] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function montarFormData() {
    const fd = new FormData();
    fd.set("percentual", percentual);
    fd.set("categoriaFiltro", categoriaFiltro);
    return fd;
  }

  function handleVisualizar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setSucesso(null);
    startTransition(async () => {
      const resultado = await visualizarReajuste(null, montarFormData());
      if (resultado.ok) {
        setPreview(resultado);
      } else {
        setPreview(null);
        setErro(resultado.mensagem);
      }
    });
  }

  function handleConfirmar() {
    startTransition(async () => {
      const resultado = await aplicarReajusteEmLote(null, montarFormData());
      if (resultado.ok) {
        setSucesso(resultado.mensagem);
        setPreview(null);
        setPercentual("");
        setCategoriaFiltro("");
      } else {
        setErro(resultado.mensagem);
      }
    });
  }

  if (preview) {
    return (
      <Card className="flex flex-col gap-4 p-6">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Confira antes de aplicar
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {preview.percentual > 0 ? "Aumento" : "Redução"} de{" "}
            {Math.abs(preview.percentual)}%
            {preview.categoriaFiltro ? ` em "${preview.categoriaFiltro}"` : " em todos os produtos"}{" "}
            — {preview.itens.length} produto{preview.itens.length > 1 ? "s" : ""} afetado
            {preview.itens.length > 1 ? "s" : ""}. Preços são sempre arredondados pra cima, então
            uma redução pequena pode não cair exatamente o percentual.
          </p>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-800/50">
              <tr>
                <th className="px-4 py-2">Produto</th>
                <th className="px-4 py-2">Categoria</th>
                <th className="px-4 py-2 text-right">Preço atual</th>
                <th className="px-4 py-2 text-right">Preço novo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {preview.itens.map((item) => (
                <tr key={item.itemGraficaId}>
                  <td className="px-4 py-2 text-slate-900 dark:text-white">{item.nome}</td>
                  <td className="px-4 py-2 text-slate-500">{item.categoria}</td>
                  <td className="px-4 py-2 text-right text-slate-500">R$ {item.precoAtual}</td>
                  <td className="px-4 py-2 text-right font-medium text-slate-900 dark:text-white">
                    R$ {item.precoNovo}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {erro && <Alert variant="error">{erro}</Alert>}

        <div className="flex gap-3">
          <Button type="button" variant="primary" onClick={handleConfirmar} loading={pending}>
            {pending ? "Aplicando..." : "Confirmar reajuste"}
          </Button>
          <Button type="button" variant="outline" onClick={() => setPreview(null)} disabled={pending}>
            Voltar
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <form onSubmit={handleVisualizar} className="flex flex-col gap-6">
      <Card className="flex flex-col gap-4 p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Percentual"
            name="percentual"
            type="number"
            step="0.01"
            required
            value={percentual}
            onChange={(e) => setPercentual(e.target.value)}
            placeholder="ex: 10 ou -5"
            hint="Positivo aumenta, negativo diminui."
          />
          <Select
            label="Categoria (opcional)"
            name="categoriaFiltro"
            value={categoriaFiltro}
            onChange={(e) => setCategoriaFiltro(e.target.value)}
          >
            <option value="">Todos os produtos ({totalItensSemFiltro})</option>
            {categorias.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>
      </Card>

      {erro && <Alert variant="error">{erro}</Alert>}
      {sucesso && <Alert variant="success">{sucesso}</Alert>}

      <Button type="submit" loading={pending} className="self-start">
        {pending ? "Calculando..." : "Calcular"}
      </Button>
    </form>
  );
}
