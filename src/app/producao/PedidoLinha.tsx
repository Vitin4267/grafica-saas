"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useActionState, useState } from "react";
import { formatoInstanteRealComHora } from "@/lib/data";
import { useAoMudar } from "@/lib/hooks/useAoMudar";
import { StatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmarExclusao } from "@/components/ui/ConfirmarExclusao";
import { PreflightAvisos } from "@/components/ui/PreflightAvisos";
import type { AvisoPreflight } from "@/lib/preflight";
import { PrinterIcon } from "@/components/icons";
import { AvancarPedidoButton } from "./AvancarPedidoButton";
import {
  useIniciarImpressao,
  IniciarImpressaoBotao,
  PainelConfirmacaoImpressao,
} from "./IniciarImpressaoConfirm";
import { EnviarArteForm } from "./EnviarArteForm";
import { CustosPedidoSecao } from "./CustosPedidoSecao";
import { EntregaPedidoSecao, type EntregaResumo } from "./EntregaPedidoSecao";
import { cancelarPedido, avancarPedido } from "./actions";

type Custo = {
  id: string;
  categoriaNome: string;
  // null quando o usuário não tem CUSTOS.podeVer — ver producao/page.tsx,
  // que já nem envia o valor real pro client nesse caso.
  valor: number | null;
  observacao: string | null;
  createdAt: string;
};

// Linha inteira é um client component (não só o botão de cancelar) pra poder
// colocar o ConfirmarExclusao como bloco abaixo da linha inteira quando
// confirmando — mesmo padrão de PagamentosCard.tsx, em vez de espremer a
// confirmação dentro do grupinho de botões à direita.
export function PedidoLinha({
  pedidoId,
  orcamentoId,
  clienteNome,
  itensResumo,
  status,
  podeEditar,
  podeEditarCustos,
  podeVerCustos,
  souResponsavelDesteStatus,
  responsaveisEtapa,
  chipAtraso,
  arteUrl,
  arteAprovadaEm,
  arteComentarioCliente,
  arteRespondidaPor = null,
  linkArtePublico,
  preflightAvisos,
  categoriasCustoAtivas,
  custos,
  lucro,
  entrega,
}: {
  pedidoId: string;
  orcamentoId: string;
  clienteNome: string;
  itensResumo: string;
  status: string;
  podeEditar: boolean;
  // Permissões de CUSTOS (não PRODUCAO) — separadas de podeEditar acima
  // porque lançar custo/retrabalho e ver valor/margem são coisas
  // diferentes (ver fase-custo-real.md §2.6). Repassadas pra
  // CustosPedidoSecao abaixo.
  podeEditarCustos: boolean;
  podeVerCustos: boolean;
  // Responsável atribuído (ver ResponsavelEstagio) pela etapa ATUAL deste
  // pedido — libera o botão de avançar mesmo sem PRODUCAO.podeEditar
  // completo. Nunca true pra ARTE/CLICHE_FACA (não são etapas atribuíveis,
  // ver ESTAGIOS_ATRIBUIVEIS), então IniciarImpressaoBotao abaixo continua
  // exigindo podeEditar puro.
  souResponsavelDesteStatus: boolean;
  // Nomes de TODOS os funcionários atribuídos como responsável pela etapa
  // ATUAL deste pedido (ver ResponsavelEstagio) — não só o usuário logado.
  // Sempre [] pra ARTE/CLICHE_FACA/ENTREGUE/CANCELADO (ver ESTAGIOS_ATRIBUIVEIS).
  responsaveisEtapa: string[];
  chipAtraso: ReactNode;
  arteUrl: string | null;
  arteAprovadaEm: Date | null;
  arteComentarioCliente: string | null;
  // Nome DECLARADO por quem aprovou a arte pelo link público (ver
  // Pedido.arteRespondidaPor no schema — não verificado, só registro).
  // Opcional/default null: producao/page.tsx (fora do escopo desta tarefa)
  // ainda não passa esta prop — ver relatório final.
  arteRespondidaPor?: string | null;
  linkArtePublico: string | null;
  // Achados do preflight automático (ver src/lib/preflight.ts) sobre a arte
  // ATUAL deste pedido — recalculado do zero a cada reenvio, null/[] quando
  // não há arte ou nada a avisar.
  preflightAvisos: AvisoPreflight[];
  // Só as categorias ATIVAS da gráfica (buscadas uma vez em producao/page.tsx,
  // fora do loop de pedidos) — populam o select de "lançar custo" abaixo.
  categoriasCustoAtivas: { id: string; nome: string }[];
  custos: Custo[];
  lucro: number | null;
  // null quando o pedido ainda está em ARTE ou CLICHE_FACA (pré-produção —
  // entrega ainda não faz sentido, ver EntregaPedidoSecao.tsx e
  // ESTAGIOS_PRE_PRODUCAO em src/lib/producao-estagios.ts) — a seção inteira
  // nem é renderizada nesse caso, mesmo critério de "ainda não construído"
  // que o resto da tela usa.
  entrega: EntregaResumo | null;
}) {
  const [state, formAction, isPending] = useActionState(cancelarPedido, null);
  const [confirmando, setConfirmando] = useState(false);
  const podeCancelar = status !== "ENTREGUE" && status !== "CANCELADO";

  // CLICHE_FACA→PRODUCAO é a única transição que baixa estoque (ver
  // avancarStatusPedido) — por isso é a única que passa por uma tela de
  // confirmação editável em vez do botão de um clique só que
  // AvancarPedidoButton usa pros outros status.
  const iniciarImpressao = useIniciarImpressao(pedidoId);
  const [avancarState, avancarFormAction, avancarPending] = useActionState(avancarPedido, null);
  useAoMudar(avancarState, (estado) => {
    if (estado?.ok) iniciarImpressao.cancelar();
  });

  // Ao contrário de PagamentosCard (onde sucesso remove a linha da lista e o
  // componente desmonta sozinho), aqui o pedido continua na lista com um
  // status novo — sem isso, a caixa de confirmação ficava presa aberta pra
  // sempre depois de cancelar com sucesso (bug encontrado testando na mão).
  useAoMudar(state, (state) => {
    if (state) setConfirmando(false);
  });

  return (
    <div className="flex flex-col gap-3 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-600 dark:bg-teal-950 dark:text-teal-400">
            <PrinterIcon className="h-5 w-5" />
          </span>
          <div>
            <p className="font-medium text-slate-900 dark:text-white">{clienteNome}</p>
            <p className="text-sm text-slate-500">{itensResumo}</p>
            <Link
              href={`/orcamento/${orcamentoId}`}
              className="text-xs text-teal-700 hover:underline dark:text-teal-400"
            >
              Ver orçamento
            </Link>
            {" · "}
            <a
              href={`/producao/${pedidoId}/ordem-producao`}
              className="text-xs text-teal-700 hover:underline dark:text-teal-400"
            >
              Ordem de produção (PDF)
            </a>
            {/* CUSTOS.podeVer (não PRODUCAO) — mesma prop já usada pra
                controlar valor/lucro nesta linha (ver fase-custo-real.md
                §2.6 / PR-5). Link pra /producao/[pedidoId]/fechamento. */}
            {podeVerCustos && (
              <>
                {" · "}
                <Link
                  href={`/producao/${pedidoId}/fechamento`}
                  className="text-xs text-teal-700 hover:underline dark:text-teal-400"
                >
                  Ver fechamento
                </Link>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {chipAtraso}
          <StatusBadge status={status} tipo="pedido" />
          {status === "CLICHE_FACA"
            ? podeEditar && (
                <IniciarImpressaoBotao estado={iniciarImpressao.estado} onIniciar={iniciarImpressao.iniciar} />
              )
            : (podeEditar || souResponsavelDesteStatus) && (
                <AvancarPedidoButton pedidoId={pedidoId} status={status} />
              )}
          {podeEditar && podeCancelar && (
            <Button
              type="button"
              variant="ghost"
              className="!text-rose-600 hover:!bg-rose-50 dark:!text-rose-400 dark:hover:!bg-rose-950/50"
              onClick={() => setConfirmando(true)}
            >
              Cancelar
            </Button>
          )}
        </div>
      </div>

      {podeEditar && status === "ARTE" && (
        <EnviarArteForm
          pedidoId={pedidoId}
          arteUrl={arteUrl}
          arteAprovadaEm={arteAprovadaEm}
          arteComentarioCliente={arteComentarioCliente}
          linkArtePublico={linkArtePublico}
        />
      )}
      {/* Quem está atribuído como responsável pela etapa ATUAL (ver
          ResponsavelEstagio, configurado em /usuarios) — informativo, não
          controla nada aqui (o botão de avançar já usa
          souResponsavelDesteStatus pra isso). */}
      {responsaveisEtapa.length > 0 && (
        <p className="text-xs text-slate-500">
          Responsável: {responsaveisEtapa.join(", ")}
        </p>
      )}
      {/* Nome é declarado, não verificado (ver comentário do prop acima) —
          por isso "aprovada por", nunca "confirmada por". Mostrado
          independente de status/podeEditar: mesmo depois do pedido sair de
          ARTE, "quem aprovou essa arte" continua sendo informação relevante
          numa disputa. */}
      {arteAprovadaEm && arteRespondidaPor && (
        <p className="text-xs text-slate-500">
          Arte aprovada por {arteRespondidaPor} em {formatoInstanteRealComHora.format(arteAprovadaEm)}
        </p>
      )}
      {/* Achados do preflight automático — mostrado independente de
          status/podeEditar (mesmo critério do bloco "aprovada por" acima),
          nunca bloqueia nada, só informa. */}
      <PreflightAvisos avisos={preflightAvisos} />

      <CustosPedidoSecao
        pedidoId={pedidoId}
        categoriasCustoAtivas={categoriasCustoAtivas}
        custos={custos}
        lucro={lucro}
        podeEditarCustos={podeEditarCustos}
        podeVer={podeVerCustos}
      />

      {/* Entrega só faz sentido depois que o pedido saiu da pré-produção
          (ARTE/CLICHE_FACA — já tem algo físico produzido/em produção, ver
          ESTAGIOS_PRE_PRODUCAO) — antes disso a seção nem renderiza, pra não
          confundir com "criar entrega" num pedido que ainda nem começou. */}
      {status !== "ARTE" && status !== "CLICHE_FACA" && (
        <EntregaPedidoSecao pedidoId={pedidoId} entrega={entrega} podeEditar={podeEditar} />
      )}

      {iniciarImpressao.estado.tipo === "confirmando" && (
        <PainelConfirmacaoImpressao
          pedidoId={pedidoId}
          itens={iniciarImpressao.estado.itens}
          formAction={avancarFormAction}
          isPending={avancarPending}
          erroSubmit={avancarState && !avancarState.ok ? avancarState.mensagem : undefined}
          onCancelar={iniciarImpressao.cancelar}
        />
      )}

      {confirmando && (
        <ConfirmarExclusao
          pergunta={
            status === "ARTE" || status === "CLICHE_FACA"
              ? "Cancelar este pedido? Nenhuma matéria-prima foi baixada ainda."
              : "Cancelar este pedido? A matéria-prima já baixada pra produção volta pro estoque automaticamente."
          }
          onCancelar={() => setConfirmando(false)}
          formAction={formAction}
          campos={{ pedidoId }}
          rotuloBotao="Cancelar pedido"
          pendente={isPending}
        />
      )}
      {state && !state.ok && <p className="text-xs text-rose-600">{state.mensagem}</p>}
    </div>
  );
}
