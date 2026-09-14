"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { useAoMudar } from "@/lib/hooks/useAoMudar";
import { AlertTriangleIcon } from "@/components/icons";
import type { PendenciaConfiguracao } from "@/lib/pendencias-configuracao";
import { formatoMoeda } from "@/lib/moeda";
import { chaveDaPendencia } from "@/lib/pendencia-chave";
import {
  obterPendenciasConfiguracao,
  responderPendenciaBobina,
  dispensarPendencia,
} from "./PendenciasConfiguracaoBanner.actions";

// Só pra exibir o percentual decimal (0.09972) como "9,97%" na pendência de
// alíquota do Simples — mesmo raciocínio de arredondamento de qualquer
// exibição de percentual no sistema, sem virar um helper compartilhado por
// um único uso.
function formatarPercentual(decimal: number): string {
  return `${(decimal * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

// Texto curto pro headline do banner fechado — a versão longa (consequência
// + CTA) só aparece quando o <details> expande, ver BlocoPendencia abaixo.
function tituloDaPendencia(pendencia: PendenciaConfiguracao): string {
  switch (pendencia.tipo) {
    case "BOBINA_ETIQUETA_FALTANDO":
      return `Falta configurar a largura da bobina — ${pendencia.nomeProduto}`;
    case "PAPEL_MATERIA_PRIMA_FALTANDO":
      return `Falta cadastrar matéria-prima de papel — ${pendencia.nomeProduto}`;
    case "ALIQUOTA_SIMPLES_ACIMA_DO_CONFIGURADO":
      return "Imposto configurado abaixo da alíquota real do Simples";
    case "MAQUINA_NAO_VINCULADA":
      return `Falta configurar a máquina — ${pendencia.nomeProduto}`;
    case "MAQUINA_BORDADO_SEM_VELOCIDADE":
      return `Falta a velocidade da máquina de bordado — ${pendencia.nomeMaquina}`;
    case "ACABAMENTO_SEM_CUSTO":
      return `Falta o custo do acabamento — ${pendencia.nomeProduto}`;
  }
}

// Fileira "Depois" + CTA reaproveitada em quase todo tipo de pendência —
// evita repetir as mesmas classes de botão 6 vezes.
function Acoes({
  aoDispensar,
  cta,
}: {
  aoDispensar: () => void;
  cta?: { href: string; texto: string };
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <button
        type="button"
        onClick={aoDispensar}
        className="text-xs font-medium text-amber-700 hover:text-amber-900 hover:underline dark:text-amber-300 dark:hover:text-amber-100"
      >
        Depois
      </button>
      {cta && (
        <Link
          href={cta.href}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-teal-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm shadow-teal-600/20 transition-colors hover:bg-teal-700"
        >
          {cta.texto}
        </Link>
      )}
    </div>
  );
}

// Formulário inline de BOBINA_ETIQUETA_FALTANDO — único tipo que resolve
// direto no banner (os outros só linkam pra tela certa). Hook próprio
// (useActionState) por instância, então vira um subcomponente separado em
// vez de uma condicional dentro de BlocoPendencia.
function FormBobina({
  pendencia,
  aoResolver,
  aoDispensar,
}: {
  pendencia: Extract<PendenciaConfiguracao, { tipo: "BOBINA_ETIQUETA_FALTANDO" }>;
  aoResolver: () => void;
  aoDispensar: () => void;
}) {
  const [state, formAction, isPending] = useActionState(responderPendenciaBobina, null);

  useAoMudar(state, (estado) => {
    if (estado?.ok) aoResolver();
  });

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="itemGraficaId" value={pendencia.itemGraficaId} />
      <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
        Largura da bobina — {pendencia.nomeProduto}
      </h3>
      <p className="text-xs text-amber-800 dark:text-amber-200">
        Esse produto usa cálculo por rolo, mas ainda não tem a largura da bobina de papel
        configurada — sem isso não dá pra montar orçamento com ele. Qual a largura da
        bobina que a prensa usa?
      </p>
      <div className="max-w-xs">
        <Input
          label="Largura da bobina (m)"
          name="larguraNominal"
          type="number"
          step="0.01"
          min="0.01"
          required
          placeholder="ex: 0.33"
        />
      </div>
      {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}
      <div className="flex items-center gap-3">
        <Button type="submit" loading={isPending}>
          {isPending ? "Salvando..." : "Salvar"}
        </Button>
        <button
          type="button"
          onClick={aoDispensar}
          className="text-xs font-medium text-amber-700 hover:text-amber-900 hover:underline dark:text-amber-300 dark:hover:text-amber-100"
        >
          Depois
        </button>
      </div>
    </form>
  );
}

function BlocoPendencia({
  pendencia,
  aoDispensar,
}: {
  pendencia: PendenciaConfiguracao;
  aoDispensar: () => void;
}) {
  if (pendencia.tipo === "BOBINA_ETIQUETA_FALTANDO") {
    return <FormBobina pendencia={pendencia} aoResolver={aoDispensar} aoDispensar={aoDispensar} />;
  }

  if (pendencia.tipo === "PAPEL_MATERIA_PRIMA_FALTANDO") {
    return (
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
          Matéria-prima de papel — {pendencia.nomeProduto}
        </h3>
        <p className="text-xs text-amber-800 dark:text-amber-200">
          Esse produto usa clichê de etiqueta, mas a gráfica ainda não tem nenhuma
          matéria-prima de papel ativa cadastrada — sem isso o seletor de papel do
          orçamento aparece vazio. Cadastre pelo menos uma matéria-prima de papel em
          Catálogo pra poder usar este produto.
        </p>
        <Acoes aoDispensar={aoDispensar} cta={{ href: "/catalogo", texto: "Ir pro Catálogo" }} />
      </div>
    );
  }

  if (pendencia.tipo === "ALIQUOTA_SIMPLES_ACIMA_DO_CONFIGURADO") {
    return (
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
          Imposto configurado abaixo da alíquota real do Simples
        </h3>
        <p className="text-xs text-amber-800 dark:text-amber-200">
          Com o faturamento apurado dos últimos 12 meses ({formatoMoeda.format(pendencia.rbt12)}), a
          faixa do Simples Nacional (Anexo III) aponta uma alíquota efetiva de{" "}
          <strong>{formatarPercentual(pendencia.aliquotaEfetiva)}</strong> — acima do{" "}
          <strong>{formatarPercentual(pendencia.impostoConfigurado)}</strong> configurado hoje em
          Imposto (%). Seus orçamentos podem estar sendo precificados reservando menos imposto do
          que sua gráfica paga de verdade, comendo a margem sem aviso.
        </p>
        <p className="text-xs text-amber-700 dark:text-amber-300">
          Isso não é um erro nem trava nada — é só um cálculo de referência (Anexo III, o mais
          comum pra gráfica). Se sua gráfica está em outro anexo do Simples, o número pode não
          bater exatamente. Ajuste o campo Imposto (%) em Configurações se fizer sentido.
        </p>
        <Acoes aoDispensar={aoDispensar} cta={{ href: "/configuracoes", texto: "Ir pra Configurações" }} />
      </div>
    );
  }

  if (pendencia.tipo === "MAQUINA_NAO_VINCULADA") {
    return (
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
          Máquina não configurada — {pendencia.nomeProduto}
        </h3>
        <p className="text-xs text-amber-800 dark:text-amber-200">
          Esse produto usa um modelo de cálculo que depende de uma máquina (prensa,
          impressora ou equipamento) configurada, mas nenhuma está vinculada ainda — sem
          isso o motor de preço não consegue montar um orçamento com ele. Escolha a
          máquina na tela do produto, em Catálogo.
        </p>
        <Acoes
          aoDispensar={aoDispensar}
          cta={{ href: `/catalogo/${pendencia.itemGraficaId}`, texto: "Configurar máquina" }}
        />
      </div>
    );
  }

  if (pendencia.tipo === "MAQUINA_BORDADO_SEM_VELOCIDADE") {
    return (
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
          Máquina de bordado sem velocidade — {pendencia.nomeMaquina}
        </h3>
        <p className="text-xs text-amber-800 dark:text-amber-200">
          Essa máquina tem custo por hora configurado mas não tem a velocidade (pontos por
          minuto) cadastrada — sem isso o motor não sabe quanto tempo o pedido consome e
          recusa orçamentos que usem essa máquina.
        </p>
        <Acoes
          aoDispensar={aoDispensar}
          cta={{
            href: `/configuracoes/maquinas/bordado/${pendencia.maquinaId}`,
            texto: "Configurar velocidade",
          }}
        />
      </div>
    );
  }

  // ACABAMENTO_SEM_CUSTO
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
        Acabamento sem custo configurado — {pendencia.nomeProduto}
      </h3>
      <p className="text-xs text-amber-800 dark:text-amber-200">
        Esse acabamento não tem nenhum custo cadastrado (preço de compra, setup, mínimo e
        ferramental todos vazios/zerados) — ao usar num orçamento, o motor de preço vai
        recusar o cálculo.
      </p>
      <Acoes
        aoDispensar={aoDispensar}
        cta={{ href: `/catalogo/${pendencia.itemGraficaId}`, texto: "Configurar custo" }}
      />
    </div>
  );
}

// Widget autossuficiente, sem props — mesmo padrão de ChatAssistente.tsx:
// evita ter que passar prop nova em ~40 páginas que já renderizam <UserNav>.
// Se checa sozinho no mount (Server Action re-deriva usuário/papel da
// sessão — nunca confia em nada vindo do cliente) e só renderiza algo se
// houver pendência de verdade pro DONO logado resolver.
//
// Banner de fluxo normal (não overlay) — role="status" sem aria-modal, sem
// foco travado, sem Esc: nunca bloqueia o resto da tela, só informa. "Depois"
// persiste no servidor (Sessao.pendenciasDispensadas, ver
// PendenciasConfiguracaoBanner.actions.ts) — sobrevive à remontagem que
// acontece a cada navegação (o componente é montado dentro de UserNav, que
// está em quase toda rota) e só é limpo no próximo login.
export function PendenciasConfiguracaoBanner() {
  const [pendencias, setPendencias] = useState<PendenciaConfiguracao[]>([]);

  useEffect(() => {
    obterPendenciasConfiguracao().then(setPendencias);
  }, []);

  function removerDaLista(chave: string) {
    setPendencias((atuais) => atuais.filter((p) => chaveDaPendencia(p) !== chave));
  }

  function aoDispensar(pendencia: PendenciaConfiguracao) {
    const chave = chaveDaPendencia(pendencia);
    removerDaLista(chave);
    dispensarPendencia(chave);
  }

  if (pendencias.length === 0) {
    return null;
  }

  const primeira = pendencias[0];

  return (
    <div
      role="status"
      className="border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
    >
      <details className="mx-auto max-w-5xl">
        <summary className="flex cursor-pointer list-none items-center gap-2 marker:content-none">
          <AlertTriangleIcon className="h-4 w-4 shrink-0" />
          <span className="text-sm font-medium">{tituloDaPendencia(primeira)}</span>
          {pendencias.length > 1 && (
            <span className="text-xs text-amber-700 underline underline-offset-2 dark:text-amber-300">
              ver todas ({pendencias.length})
            </span>
          )}
        </summary>
        <div className="mt-3 flex flex-col gap-4 border-t border-amber-200 pt-3 dark:border-amber-900">
          {pendencias.map((pendencia) => (
            <BlocoPendencia
              key={chaveDaPendencia(pendencia)}
              pendencia={pendencia}
              aoDispensar={() => aoDispensar(pendencia)}
            />
          ))}
        </div>
      </details>
    </div>
  );
}
