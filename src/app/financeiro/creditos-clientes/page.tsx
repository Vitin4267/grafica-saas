import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import {
  podeVerMeuNegocio,
  exigirVerModulo,
  podeEditarModulo,
  obterModulosVisiveis,
} from "@/lib/auth/permissoes";
import { formatoMoeda } from "@/lib/moeda";
import { UserNav } from "@/components/UserNav";
import { Card } from "@/components/ui/Card";
import { ArrowLeftIcon } from "@/components/icons";
import { NovoCreditoClienteForm } from "./NovoCreditoClienteForm";

export default async function CreditosClientesPage() {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  await exigirVerModulo(usuario, "FINANCEIRO");
  const podeEditar = await podeEditarModulo(usuario, "FINANCEIRO");

  const [creditos, clientesAtivos] = await Promise.all([
    prisma.creditoCliente.findMany({
      where: { cliente: { graficaId: usuario.graficaId } },
      include: { cliente: { select: { id: true, nome: true } } },
    }),
    prisma.cliente.findMany({
      where: { graficaId: usuario.graficaId, desativadoEm: null },
      orderBy: { nome: "asc" },
      select: { id: true, nome: true },
    }),
  ]);

  // Saldo é sempre calculado a partir das movimentações (nunca armazenado —
  // ver comentário em CreditoCliente no schema.prisma), mas pra uma lista
  // com vários clientes de uma vez, uma soma agrupada no banco é bem mais
  // barata que reler o histórico inteiro de cada um em loop.
  const somaPorCreditoETipo =
    creditos.length > 0
      ? await prisma.movimentacaoCreditoCliente.groupBy({
          by: ["creditoClienteId", "tipo"],
          where: { creditoClienteId: { in: creditos.map((c) => c.id) } },
          _sum: { valor: true },
        })
      : [];
  const saldoPorCreditoId = new Map<string, number>();
  for (const linha of somaPorCreditoETipo) {
    const soma = Number(linha._sum.valor ?? 0);
    // AJUSTE já vem com o sinal certo no próprio valor — soma direto, mesma
    // regra de saldoCreditoCliente em src/lib/credito-cliente.ts.
    const contribuicao = linha.tipo === "CONSUMO" ? -soma : soma;
    saldoPorCreditoId.set(
      linha.creditoClienteId,
      (saldoPorCreditoId.get(linha.creditoClienteId) ?? 0) + contribuicao
    );
  }

  const linhas = creditos
    .map((c) => ({
      clienteId: c.cliente.id,
      nome: c.cliente.nome,
      saldo: saldoPorCreditoId.get(c.id) ?? 0,
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome));

  return (
    <div className="flex flex-1 flex-col">
      <UserNav
        nome={usuario.nome}
        graficaNome={usuario.grafica.nome}
        papel={usuario.papel}
        paginaAtual="/financeiro"
        mostrarMeuNegocio={podeVerMeuNegocio(usuario)}
        modulosVisiveis={await obterModulosVisiveis(usuario)}
      />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <Link
          href="/financeiro"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Voltar ao Financeiro
        </Link>

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Créditos de clientes
          </h1>
          <p className="mt-1 text-slate-500">
            Saldo adiantado que um cliente tem com você — ex: uma conta corporativa que deposita
            um valor e vai consumindo em pedidos ao longo dos meses. Diferente das Contas
            prepagas: lá é você quem tem saldo com um fornecedor; aqui é o cliente que tem saldo
            com você.
          </p>
        </div>

        <div className="mb-8 flex flex-col gap-3">
          {linhas.length === 0 && (
            <Card className="p-5">
              <p className="text-sm text-slate-500">
                Nenhum cliente com crédito lançado ainda — selecione um cliente abaixo pra
                começar.
              </p>
            </Card>
          )}
          {linhas.map((linha) => (
            <Link key={linha.clienteId} href={`/financeiro/creditos-clientes/${linha.clienteId}`}>
              <Card className="flex items-center justify-between gap-4 p-5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <p className="font-medium text-slate-900 dark:text-white">{linha.nome}</p>
                <p
                  className={`font-semibold ${
                    linha.saldo > 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-slate-900 dark:text-white"
                  }`}
                >
                  {formatoMoeda.format(linha.saldo)}
                </p>
              </Card>
            </Link>
          ))}
        </div>

        {podeEditar && (
          <Card className="p-6">
            <h2 className="mb-4 text-base font-semibold text-slate-900 dark:text-white">
              Abrir extrato de um cliente
            </h2>
            <NovoCreditoClienteForm clientes={clientesAtivos} />
          </Card>
        )}
      </main>
    </div>
  );
}
