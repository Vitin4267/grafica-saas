import Link from "next/link";
import { redirect } from "next/navigation";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeVerMeuNegocio, obterModulosVisiveis } from "@/lib/auth/permissoes";
import { buscarVisaoGeralNegocio } from "@/lib/meu-negocio";
import { formatoMoeda } from "@/lib/moeda";
import { UserNav } from "@/components/UserNav";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatTile } from "@/components/ui/StatTile";
import { ValorAnimado } from "@/components/ui/ValorAnimado";
import { Sparkline } from "@/components/ui/Sparkline";
import { ProportionBar, type FaixaProporcao } from "@/components/ui/ProportionBar";
import {
  TrendingUpIcon,
  ReceiptIcon,
  PrinterIcon,
  UsersIcon,
  BoxIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  ArrowRightIcon,
} from "@/components/icons";

const CORES_BARRA_ORCAMENTO: Record<string, string> = {
  RASCUNHO: "bg-slate-300 dark:bg-slate-600",
  ENVIADO: "bg-blue-500",
  APROVADO: "bg-emerald-500",
  REJEITADO: "bg-rose-500",
};

const CORES_BARRA_PEDIDO: Record<string, string> = {
  FILA: "bg-slate-300 dark:bg-slate-600",
  IMPRESSAO: "bg-blue-500",
  ACABAMENTO: "bg-amber-500",
  PRONTO: "bg-violet-500",
  ENTREGUE: "bg-emerald-500",
};

function SecaoHeader({
  titulo,
  href,
}: {
  titulo: string;
  href: string;
}) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">{titulo}</h2>
      <Link
        href={href}
        className="flex items-center gap-1 text-xs font-medium text-teal-700 hover:underline dark:text-teal-400"
      >
        Ver tudo
        <ArrowRightIcon className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

export default async function MeuNegocioPage() {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!podeVerMeuNegocio(usuario)) {
    redirect("/orcamento");
  }

  const visaoGeral = await buscarVisaoGeralNegocio(usuario.graficaId);

  const faixasOrcamento: FaixaProporcao[] = visaoGeral.funilOrcamentos.map((f) => ({
    chave: f.status,
    rotulo: f.rotulo,
    quantidade: f.quantidade,
    corClasse: CORES_BARRA_ORCAMENTO[f.status] ?? "bg-slate-300 dark:bg-slate-600",
  }));

  const faixasPedido: FaixaProporcao[] = visaoGeral.pipelineProducao.map((f) => ({
    chave: f.status,
    rotulo: f.rotulo,
    quantidade: f.quantidade,
    corClasse: CORES_BARRA_PEDIDO[f.status] ?? "bg-slate-300 dark:bg-slate-600",
  }));

  return (
    <div className="flex flex-1 flex-col">
      <UserNav
        nome={usuario.nome}
        graficaNome={usuario.grafica.nome}
        papel={usuario.papel}
        paginaAtual="/meu-negocio"
        mostrarMeuNegocio
        modulosVisiveis={await obterModulosVisiveis(usuario)}
      />

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Meu Negócio</h1>
            <p className="mt-1 text-slate-500">
              Um resumo rápido de como sua gráfica está indo, com atalhos pra cada
              área.
            </p>
          </div>
          <Link
            href="/meu-negocio/relatorios"
            className="flex items-center gap-1 text-sm font-medium text-teal-700 hover:underline dark:text-teal-400"
          >
            Ver relatórios completos
            <ArrowRightIcon className="h-3.5 w-3.5" />
          </Link>
        </div>

        {/* Hero: faturamento do mês */}
        <StatTile
          size="lg"
          tone="positive"
          icon={<TrendingUpIcon className="h-5 w-5" />}
          label="Faturamento aprovado este mês"
          value={<ValorAnimado valor={visaoGeral.faturamentoMes.total} />}
          caption={
            visaoGeral.faturamentoMes.quantidadeAprovados > 0
              ? `de ${visaoGeral.faturamentoMes.quantidadeAprovados} orçamento${
                  visaoGeral.faturamentoMes.quantidadeAprovados > 1 ? "s" : ""
                } aprovado${visaoGeral.faturamentoMes.quantidadeAprovados > 1 ? "s" : ""}`
              : "Nenhum orçamento aprovado ainda este mês"
          }
          href="/orcamento"
        />
        <div className="mt-3 flex items-center justify-between gap-4 px-1">
          <p className="text-xs text-slate-500">Faturamento das últimas 8 semanas</p>
          <Sparkline dados={visaoGeral.serieFaturamentoSemanal.map((s) => s.total)} />
        </div>

        {/* Tiras de contagem */}
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatTile
            label="Clientes"
            value={String(visaoGeral.totalClientes)}
            icon={<UsersIcon className="h-4 w-4" />}
            href="/clientes"
          />
          <StatTile
            label="Produtos ativos no catálogo"
            value={String(visaoGeral.produtosAtivos)}
            icon={<BoxIcon className="h-4 w-4" />}
            href="/catalogo"
          />
          <StatTile
            label="Orçamentos este mês"
            value={String(visaoGeral.orcamentosDoMes)}
            icon={<ReceiptIcon className="h-4 w-4" />}
            href="/orcamento"
          />
          <StatTile
            label="Saldo real do mês"
            value={formatoMoeda.format(visaoGeral.saldoReal)}
            caption="Faturamento aprovado menos despesas já pagas"
            tone={visaoGeral.saldoReal >= 0 ? "positive" : "neutral"}
            icon={<TrendingUpIcon className="h-4 w-4" />}
            href="/financeiro"
          />
          <StatTile
            label="Despesas a pagar este mês"
            value={formatoMoeda.format(visaoGeral.despesasPendentesMes.total)}
            caption={
              visaoGeral.despesasPendentesMes.quantidade > 0
                ? `${visaoGeral.despesasPendentesMes.quantidade} despesa${
                    visaoGeral.despesasPendentesMes.quantidade > 1 ? "s" : ""
                  } pendente${visaoGeral.despesasPendentesMes.quantidade > 1 ? "s" : ""}`
                : "Nenhuma despesa pendente este mês"
            }
            icon={<ReceiptIcon className="h-4 w-4" />}
            href="/financeiro"
          />
        </div>

        {/* Funil de orçamentos + pipeline de produção */}
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <SecaoHeader titulo="Funil de orçamentos" href="/orcamento" />
            {visaoGeral.totalOrcamentos === 0 ? (
              <EmptyState
                icone={<ReceiptIcon className="h-5 w-5" />}
                texto="Nenhum orçamento criado ainda. Assim que você salvar o primeiro, ele aparece aqui."
                href="/orcamento"
                rotuloCta="Criar orçamento"
              />
            ) : (
              <Card className="p-6">
                <ProportionBar faixas={faixasOrcamento} total={visaoGeral.totalOrcamentos} />
              </Card>
            )}
          </div>

          <div>
            <SecaoHeader titulo="Pipeline de produção" href="/producao" />
            {visaoGeral.totalPedidos === 0 ? (
              <EmptyState
                icone={<PrinterIcon className="h-5 w-5" />}
                texto="Nenhum pedido em produção. Pedidos aparecem aqui automaticamente quando um orçamento é aprovado."
                href="/producao"
                rotuloCta="Ver produção"
              />
            ) : (
              <Card className="p-6">
                <ProportionBar faixas={faixasPedido} total={visaoGeral.totalPedidos} />
              </Card>
            )}
          </div>
        </div>

        {/* Estoque baixo + top clientes */}
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <SecaoHeader titulo="Previsão de estoque" href="/catalogo/estoque" />
            {visaoGeral.alertasEstoque.length > 0 ? (
              <Card className="divide-y divide-slate-100 p-0 dark:divide-slate-800">
                {visaoGeral.alertasEstoque.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-3 p-4">
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400">
                        <AlertTriangleIcon className="h-4 w-4" />
                      </span>
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                        {item.nome}
                      </p>
                    </div>
                    <p className="text-sm font-medium text-rose-600 dark:text-rose-400">
                      {item.diasRestantes !== null
                        ? `Acaba em ${Math.max(0, Math.round(item.diasRestantes))} dia${Math.round(item.diasRestantes) === 1 ? "" : "s"}`
                        : `${item.estoqueAtual} de ${item.estoqueMinimo} restantes`}
                    </p>
                  </div>
                ))}
              </Card>
            ) : (
              <Card className="flex items-center gap-3 p-6">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
                  <CheckCircleIcon className="h-5 w-5" />
                </span>
                <p className="text-sm text-slate-500">
                  {visaoGeral.temItensComEstoqueControlado
                    ? "Estoque em dia — nada abaixo do mínimo nem previsto pra acabar em breve."
                    : "Nenhum item com controle de estoque cadastrado ainda. Configure estoque atual no Catálogo."}
                </p>
              </Card>
            )}
          </div>

          <div>
            <SecaoHeader titulo="Clientes com maior faturamento" href="/clientes" />
            {visaoGeral.topClientes.length === 0 ? (
              <EmptyState
                icone={<UsersIcon className="h-5 w-5" />}
                texto="Nenhum orçamento aprovado ainda — seus melhores clientes vão aparecer aqui."
                href="/clientes"
                rotuloCta="Ver clientes"
              />
            ) : (
              <Card className="divide-y divide-slate-100 p-0 dark:divide-slate-800">
                {visaoGeral.topClientes.map((cliente, indice) => (
                  <div key={cliente.id} className="flex items-center justify-between gap-3 p-4">
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-50 text-xs font-semibold text-teal-700 dark:bg-teal-950 dark:text-teal-300">
                        {indice + 1}
                      </span>
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                        {cliente.nome}
                      </p>
                    </div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">
                      {formatoMoeda.format(cliente.total)}
                    </p>
                  </div>
                ))}
              </Card>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
