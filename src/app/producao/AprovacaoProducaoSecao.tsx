"use client";

import { useActionState, useState, type ChangeEvent } from "react";
import { formatoInstanteRealComHora } from "@/lib/data";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { validarArquivoArte } from "@/lib/upload-validacao";
import {
  ROTULOS_TIPO_APROVACAO_PRODUCAO,
  ORDEM_TIPO_APROVACAO_PRODUCAO,
  ROTULOS_RESULTADO_APROVACAO,
  ORDEM_RESULTADO_APROVACAO,
  rotuloTipoAprovacaoProducao,
  resultadoLiberaTransicao,
} from "@/lib/aprovacao-producao-status";
import { registrarAprovacaoProducao } from "./aprovacao-producao-actions";
import type { TipoAprovacaoProducao, ResultadoAprovacao } from "@/generated/prisma/enums";

// Achado D1 da auditoria de abrangência (Parte 2/Produção,
// pesquisa-abrangencia-modulos.md, 2026-09-11) — mesma estrutura de
// ParadaPedidoSecao.tsx: <details> colapsável com chip no summary + lista de
// histórico + formulário. Diferente de Parada (só ativa/encerrada), aqui não
// existe exclusividade — o pedido pode acumular quantas aprovações quiser
// ao longo da produção, então o formulário fica sempre disponível (não só
// "quando não há uma ativa").

export type AprovacaoResumo = {
  id: string;
  tipo: TipoAprovacaoProducao;
  tipoOutro: string | null;
  resultado: ResultadoAprovacao;
  // Usuario.nome (quem registrou, logado) OU aprovadoPorNomeDeclarado (quem
  // a pessoa logada DECLAROU ter feito a aprovação, ex: ditado por telefone)
  // — resolvido no servidor, mesmo padrão de fornecedorNome em
  // TerceirizacaoResumo. null só quando nenhum dos dois foi preenchido
  // (usuário removido depois E sem nome declarado).
  aprovadoPorNome: string | null;
  observacao: string | null;
  fotoUrl: string | null;
  createdAt: string; // ISO
};

function chipResultado(resultado: ResultadoAprovacao) {
  if (resultado === "REPROVADO") {
    return (
      <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
        Reprovado
      </span>
    );
  }
  if (resultado === "APROVADO_COM_RESSALVA") {
    return (
      <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
        Aprovado com ressalva
      </span>
    );
  }
  return (
    <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
      Aprovado
    </span>
  );
}

function LinhaAprovacao({ aprovacao }: { aprovacao: AprovacaoResumo }) {
  return (
    <div className="flex flex-col gap-2 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-slate-900 dark:text-white">
          {rotuloTipoAprovacaoProducao(aprovacao.tipo, aprovacao.tipoOutro)}
        </p>
        {chipResultado(aprovacao.resultado)}
      </div>
      <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium text-slate-500">Registrada em</p>
          <p className="mt-0.5 text-slate-900 dark:text-white">
            {formatoInstanteRealComHora.format(new Date(aprovacao.createdAt))}
          </p>
        </div>
        {aprovacao.aprovadoPorNome && (
          <div>
            <p className="text-xs font-medium text-slate-500">Registrada por</p>
            <p className="mt-0.5 text-slate-900 dark:text-white">{aprovacao.aprovadoPorNome}</p>
          </div>
        )}
        {aprovacao.observacao && (
          <div className="sm:col-span-2">
            <p className="text-xs font-medium text-slate-500">Observação</p>
            <p className="mt-0.5 whitespace-pre-wrap text-slate-900 dark:text-white">{aprovacao.observacao}</p>
          </div>
        )}
        {aprovacao.fotoUrl && (
          <div className="sm:col-span-2">
            <a
              href={aprovacao.fotoUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-teal-700 hover:underline dark:text-teal-400"
            >
              Ver foto anexada
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

function FormularioNovaAprovacao({ pedidoId }: { pedidoId: string }) {
  const [state, formAction, isPending] = useActionState(registrarAprovacaoProducao, null);
  const [tipo, setTipo] = useState<TipoAprovacaoProducao>("OK_MAQUINA");
  const [resultado, setResultado] = useState<ResultadoAprovacao>("APROVADO");
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);

  // Mesma validação prévia (antes de submeter) já usada em EnviarArteForm —
  // evita descobrir "arquivo grande demais" só depois do POST.
  function handleArquivoChange(evento: ChangeEvent<HTMLInputElement>) {
    const arquivo = evento.target.files?.[0];
    if (!arquivo) {
      setErroArquivo(null);
      return;
    }
    const validacao = validarArquivoArte(arquivo);
    setErroArquivo(validacao.ok ? null : validacao.mensagem);
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="pedidoId" value={pedidoId} />
      <Select
        label="Tipo de aprovação"
        name="tipo"
        value={tipo}
        onChange={(e) => setTipo(e.target.value as TipoAprovacaoProducao)}
      >
        {ORDEM_TIPO_APROVACAO_PRODUCAO.map((t) => (
          <option key={t} value={t}>
            {ROTULOS_TIPO_APROVACAO_PRODUCAO[t]}
          </option>
        ))}
      </Select>

      {tipo === "OUTRO" && <Input label="Descreva o tipo" name="tipoOutro" maxLength={200} required />}

      <Select
        label="Resultado"
        name="resultado"
        value={resultado}
        onChange={(e) => setResultado(e.target.value as ResultadoAprovacao)}
      >
        {ORDEM_RESULTADO_APROVACAO.map((r) => (
          <option key={r} value={r}>
            {ROTULOS_RESULTADO_APROVACAO[r]}
          </option>
        ))}
      </Select>
      {!resultadoLiberaTransicao(resultado) && (
        <p className="text-xs text-rose-600">
          Reprovado NÃO libera o pedido pra sair desta etapa — registre uma nova aprovação depois de corrigido.
        </p>
      )}

      <Input
        label="Aprovado/registrado por (opcional)"
        name="aprovadoPorNomeDeclarado"
        maxLength={200}
        placeholder="Nome de quem de fato aprovou, se não for você"
      />

      <Input
        label="Foto da folha/peça (opcional — PDF, JPG ou PNG, até 30MB)"
        name="arquivo"
        type="file"
        accept=".pdf,.jpg,.jpeg,.png"
        onChange={handleArquivoChange}
      />
      {erroArquivo && <p className="text-xs text-rose-600">{erroArquivo}</p>}

      <Textarea label="Observação (opcional)" name="observacao" maxLength={2000} />

      {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}
      {state && state.ok && <Alert variant="success">{state.mensagem}</Alert>}
      <Button type="submit" variant="outline" loading={isPending} disabled={!!erroArquivo} className="self-start">
        {isPending ? "Registrando..." : "Registrar aprovação"}
      </Button>
    </form>
  );
}

export function AprovacaoProducaoSecao({
  pedidoId,
  aprovacoes,
  // Achado D1 — true quando a EtapaGrafica correspondente ao status ATUAL
  // do pedido tem exigeAprovacaoQualidade=true (ver
  // src/lib/etapa-grafica.ts/status-transicao.ts). Controla só o AVISO
  // visual abaixo — o formulário fica sempre disponível independente disso,
  // uma gráfica pode querer registrar aprovações informativas mesmo sem
  // gatear a transição.
  exigeAprovacaoQualidade,
  // Achado D1 — true quando já existe, pra passagem ATUAL do pedido por
  // esta etapa, uma aprovação com resultado que libera a transição (ver
  // resultadoLiberaTransicao) — calculado no servidor com o MESMO critério
  // do gate real em avancarStatusPedido, pra nunca divergir.
  aprovacaoQualidadeValida,
  podeEditar,
}: {
  pedidoId: string;
  aprovacoes: AprovacaoResumo[];
  exigeAprovacaoQualidade: boolean;
  aprovacaoQualidadeValida: boolean;
  podeEditar: boolean;
}) {
  return (
    <details className="group rounded-xl border border-slate-200 dark:border-slate-800" open={exigeAprovacaoQualidade && !aprovacaoQualidadeValida}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-2.5 text-sm font-medium text-slate-600 marker:content-none hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/50">
        <span>Aprovações de qualidade{aprovacoes.length > 0 && ` (${aprovacoes.length})`}</span>
        {exigeAprovacaoQualidade &&
          (aprovacaoQualidadeValida ? (
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
              Etapa aprovada
            </span>
          ) : (
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
              Aguardando aprovação de qualidade
            </span>
          ))}
      </summary>

      <div className="flex flex-col gap-4 border-t border-slate-100 p-4 dark:border-slate-800">
        {exigeAprovacaoQualidade && !aprovacaoQualidadeValida && (
          <Alert variant="warning">
            Esta etapa exige aprovação de qualidade — o pedido não avança pra próxima etapa até que alguém registre
            uma aprovação com resultado Aprovado ou Aprovado com ressalva.
          </Alert>
        )}

        {aprovacoes.length > 0 && (
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {aprovacoes.map((aprovacao) => (
              <LinhaAprovacao key={aprovacao.id} aprovacao={aprovacao} />
            ))}
          </div>
        )}

        {podeEditar && <FormularioNovaAprovacao pedidoId={pedidoId} />}
        {!podeEditar && aprovacoes.length === 0 && (
          <p className="text-xs text-slate-500">Nenhuma aprovação registrada ainda.</p>
        )}
      </div>
    </details>
  );
}
