import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import {
  podeVerMeuNegocio,
  podeVerModulo,
  podeEditarModulo,
  obterModulosVisiveis,
} from "@/lib/auth/permissoes";
import { calcularPrevisaoEstoque } from "@/lib/previsao-estoque-db";
import { UserNav } from "@/components/UserNav";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/Badge";
import { BoxIcon, AlertTriangleIcon } from "@/components/icons";
import {
  ORDEM_STATUS_SOLICITACAO_COMPRA,
  ROTULOS_STATUS_SOLICITACAO_COMPRA,
  type StatusSolicitacaoCompra,
} from "@/lib/compras-status";
import { rotuloUnidade } from "@/lib/unidade";
import { listarContratosProximosDoLimite } from "@/lib/contrato-fornecimento-db";

const formatoQuantidade = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4 });

// Estados terminais (mesmo conceito de ehStatusTerminal em
// compras-status.ts, mas em Set aqui pra checar "já tem solicitação ativa
// em aberto" abaixo — CONFERIDO e CANCELADO não contam como "em aberto").
const STATUS_TERMINAIS = new Set<StatusSolicitacaoCompra>(["CONFERIDO", "CANCELADO"]);

export default async function ComprasPage() {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);

  const podeVer = await podeVerModulo(usuario, "COMPRAS");
  if (!podeVer) {
    redirect("/comecar");
  }
  const podeEditar = await podeEditarModulo(usuario, "COMPRAS");

  const [solicitacoes, previsaoEstoque, contratosProximosDoLimite, parametros] = await Promise.all([
    prisma.solicitacaoCompra.findMany({
      where: { graficaId: usuario.graficaId },
      include: {
        itemGrafica: { include: { itemCatalogo: true } },
        variante: true,
        fornecedor: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    calcularPrevisaoEstoque(usuario.graficaId),
    // Achado A9 da auditoria de abrangência (Parte 3/Compras) — contratos de
    // fornecimento com vigência ou quantidade contratada perto do fim.
    listarContratosProximosDoLimite(usuario.graficaId),
    // Achado A8 da auditoria de abrangência (Parte 3/Compras) —
    // diasAlertaCompraPadrao é o limiar (antes 30 fixo no código) do sinal
    // GENÉRICO "vai acabar em breve", separado do ponto de pedido real
    // (que já vem calculado dentro de previsaoEstoque, com lead time por
    // item). Consulta separada leve, mesmo padrão de diasAlertaOrcamentoParado
    // em src/app/orcamento/page.tsx.
    prisma.parametrosGrafica.findUnique({
      where: { graficaId: usuario.graficaId },
      select: { diasAlertaCompraPadrao: true },
    }),
  ]);
  const diasAlertaCompraPadrao = parametros?.diasAlertaCompraPadrao ?? 30;

  // Sugestões de compra a partir do alerta de estoque que já existe (ver
  // calcularPrevisaoEstoque) — reduz fricção de criar a solicitação, não
  // cria nada sozinho. `id` da previsão é itemGraficaId OU varianteId
  // (mesma convenção usada lá dentro), o que bate exatamente com a chave
  // usada abaixo pra saber se já existe uma solicitação ativa pra esse alvo.
  //
  // 3 sinais complementares (achado A8): (1) abaixoDoMinimo — reativo, já
  // no/abaixo do estoque de segurança cadastrado; (2) abaixoDoPontoDePedido
  // — preditivo REAL, a fórmula clássica (estoque de segurança + consumo
  // médio diário × lead time do item/gráfica); (3) diasRestantes dentro do
  // limiar genérico configurável (antes 30 fixo) — heads-up mesmo quando o
  // lead time do item ainda não foi calibrado.
  const idsComSolicitacaoAtiva = new Set(
    solicitacoes.filter((s) => !STATUS_TERMINAIS.has(s.status)).map((s) => s.varianteId ?? s.itemGraficaId)
  );
  const sugestoes = previsaoEstoque.filter(
    (item) =>
      (item.abaixoDoMinimo ||
        item.abaixoDoPontoDePedido ||
        (item.diasRestantes !== null && item.diasRestantes <= diasAlertaCompraPadrao)) &&
      !idsComSolicitacaoAtiva.has(item.id)
  );

  const grupos = ORDEM_STATUS_SOLICITACAO_COMPRA.map((status) => ({
    status,
    itens: solicitacoes.filter((s) => s.status === status),
  })).filter((grupo) => grupo.itens.length > 0);

  return (
    <div className="flex flex-1 flex-col">
      <UserNav
        nome={usuario.nome}
        graficaNome={usuario.grafica.nome}
        papel={usuario.papel}
        paginaAtual="/compras"
        mostrarMeuNegocio={podeVerMeuNegocio(usuario)}
        modulosVisiveis={await obterModulosVisiveis(usuario)}
      />

      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Compras</h1>
            <p className="mt-1 text-slate-500">
              Solicitado → Cotando → Aprovado → Comprado → Recebido → Conferido.
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/compras/contratos">
              <Button variant="outline">Contratos de fornecimento</Button>
            </Link>
            {podeEditar && (
              <Link href="/compras/nova">
                <Button>Nova solicitação</Button>
              </Link>
            )}
          </div>
        </div>

        {contratosProximosDoLimite.length > 0 && (
          <Card className="mb-8 divide-y divide-slate-100 dark:divide-slate-800">
            <div className="flex items-center gap-2 p-5 pb-3">
              <AlertTriangleIcon className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Contratos esgotando</h2>
            </div>
            {contratosProximosDoLimite.map((c) => (
              <Link
                key={c.id}
                href="/compras/contratos"
                className="flex items-center justify-between gap-4 p-5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
              >
                <div>
                  <p className="font-medium text-slate-900 dark:text-white">
                    {c.fornecedorNome}
                    {c.itemNome ? ` — ${c.itemNome}` : ""}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {c.vigenciaProxima &&
                      (c.diasRestantesVigencia >= 0
                        ? `Vigência acaba em ${c.diasRestantesVigencia} dia${c.diasRestantesVigencia === 1 ? "" : "s"}`
                        : "Vigência já venceu")}
                    {c.vigenciaProxima && c.quantidadeProxima ? " · " : ""}
                    {c.quantidadeProxima && `${Math.round((c.percentualConsumido ?? 0) * 100)}% consumido`}
                  </p>
                </div>
              </Link>
            ))}
          </Card>
        )}

        {sugestoes.length > 0 && (
          <Card className="mb-8 divide-y divide-slate-100 dark:divide-slate-800">
            <div className="flex items-center gap-2 p-5 pb-3">
              <AlertTriangleIcon className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Sugestões por estoque baixo
              </h2>
            </div>
            {sugestoes.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-4 p-5">
                <div>
                  <p className="font-medium text-slate-900 dark:text-white">{item.nome}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {item.diasRestantes !== null
                      ? `~${Math.max(0, Math.round(item.diasRestantes))} dia${Math.round(item.diasRestantes) === 1 ? "" : "s"} restante${Math.round(item.diasRestantes) === 1 ? "" : "s"}`
                      : "Abaixo do estoque mínimo"}
                    {" · "}
                    {formatoQuantidade.format(item.estoqueAtual)} {item.unidade} em estoque
                    {item.pontoDePedido !== null &&
                      ` · ponto de pedido ${formatoQuantidade.format(item.pontoDePedido)} ${item.unidade} (lead time ${item.leadTimeDias}d)`}
                  </p>
                </div>
                {podeEditar && (
                  <Link href={`/compras/nova?alvoId=${item.id}`}>
                    <Button variant="outline">Solicitar compra</Button>
                  </Link>
                )}
              </div>
            ))}
          </Card>
        )}

        {grupos.length === 0 ? (
          <EmptyState
            icone={<BoxIcon className="h-6 w-6" />}
            texto="Nenhuma solicitação de compra ainda. Crie uma pra começar a organizar o fluxo de compra de matéria-prima."
            href={podeEditar ? "/compras/nova" : undefined}
            rotuloCta={podeEditar ? "Nova solicitação" : undefined}
          />
        ) : (
          grupos.map((grupo) => (
            <div key={grupo.status} className="mb-8">
              <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {ROTULOS_STATUS_SOLICITACAO_COMPRA[grupo.status]}
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500 dark:bg-slate-800">
                  {grupo.itens.length}
                </span>
              </h2>
              <Card className="divide-y divide-slate-100 dark:divide-slate-800">
                {grupo.itens.map((solicitacao) => (
                  <Link
                    key={solicitacao.id}
                    href={`/compras/${solicitacao.id}`}
                    className="flex items-center justify-between gap-4 p-5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  >
                    <div>
                      <p className="font-medium text-slate-900 dark:text-white">
                        {solicitacao.itemGrafica.itemCatalogo.nome}
                        {solicitacao.variante ? ` (${solicitacao.variante.rotulo})` : ""}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {formatoQuantidade.format(Number(solicitacao.quantidade))}{" "}
                        {rotuloUnidade(
                          solicitacao.itemGrafica.itemCatalogo.unidade,
                          solicitacao.itemGrafica.itemCatalogo.unidadeOutro
                        )}
                        {solicitacao.fornecedor ? ` · ${solicitacao.fornecedor.nome}` : ""}
                      </p>
                    </div>
                    <StatusBadge status={solicitacao.status} tipo="compra" />
                  </Link>
                ))}
              </Card>
            </div>
          ))
        )}
      </main>
    </div>
  );
}
