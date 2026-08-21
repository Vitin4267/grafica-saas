import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeVerMeuNegocio, exigirVerModulo, obterModulosVisiveis } from "@/lib/auth/permissoes";
import { formatoMoeda } from "@/lib/moeda";
import { linkWhatsApp } from "@/lib/telefone";
import { diasParado } from "@/lib/orcamento-status";
import { UserNav } from "@/components/UserNav";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { AlertTriangleIcon, ArrowLeftIcon } from "@/components/icons";

// Padrão mais comum de venda perdida numa gráfica: "mandei o orçamento e o
// cliente sumiu". Esta tela lista todo ENVIADO sem resposta há N+ dias
// (ParametrosGrafica.diasAlertaOrcamentoParado, ver orcamentoEstaParado em
// src/lib/orcamento-status.ts), do mais parado pro mais recente, com um
// atalho de WhatsApp pra cobrar — ANTES do orçamento expirar de vez (ver
// orcamentoEstaExpirado, alerta diferente, sobre a validade da proposta).
export default async function OrcamentosParadosPage() {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  await exigirVerModulo(usuario, "ORCAMENTO");

  const parametros = await prisma.parametrosGrafica.findUnique({
    where: { graficaId: usuario.graficaId },
    select: { diasAlertaOrcamentoParado: true },
  });
  const diasAlerta = parametros?.diasAlertaOrcamentoParado ?? 5;

  // Filtro replica orcamentoEstaParado (src/lib/orcamento-status.ts) direto
  // na query — respostaPublicaEm null exclui o raro caso de um orçamento
  // ENVIADO que já foi respondido (aprovado/rejeitado troca de status junto
  // com a resposta, então isto é defensivo). enviadoEm <= corte é a mesma
  // conta de diasParado(enviadoEm) >= diasAlerta, só que feita no banco.
  const corte = new Date(Date.now() - diasAlerta * 86_400_000);
  const orcamentosParados = await prisma.orcamento.findMany({
    where: {
      graficaId: usuario.graficaId,
      status: "ENVIADO",
      respostaPublicaEm: null,
      enviadoEm: { not: null, lte: corte },
    },
    include: { cliente: true },
    // Mais parado primeiro = enviadoEm mais antigo primeiro.
    orderBy: { enviadoEm: "asc" },
  });

  return (
    <div className="flex flex-1 flex-col">
      <UserNav
        nome={usuario.nome}
        graficaNome={usuario.grafica.nome}
        papel={usuario.papel}
        paginaAtual="/orcamento"
        mostrarMeuNegocio={podeVerMeuNegocio(usuario)}
        modulosVisiveis={await obterModulosVisiveis(usuario)}
      />

      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
        <Link
          href="/orcamento"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Voltar para Orçamento
        </Link>

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Orçamentos parados
          </h1>
          <p className="mt-1 text-slate-500">
            Enviados há {diasAlerta} dias ou mais sem resposta do cliente —
            cobre antes que o orçamento expire.
          </p>
        </div>

        {orcamentosParados.length === 0 ? (
          <Card className="flex flex-col items-center gap-3 p-10 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
              <AlertTriangleIcon className="h-6 w-6" />
            </span>
            <p className="text-sm text-slate-500">
              Nenhum orçamento parado no momento. Todo ENVIADO ou já teve
              resposta, ou foi enviado há menos de {diasAlerta} dias.
            </p>
          </Card>
        ) : (
          <Card className="divide-y divide-slate-100 dark:divide-slate-800">
            {orcamentosParados.map((o) => {
              const dias = diasParado(o.enviadoEm!);
              const mensagem = `Olá ${o.cliente.nome}! Passando para saber se você já conseguiu dar uma olhada no orçamento que a ${usuario.grafica.nome} enviou. Qualquer dúvida, é só chamar!`;
              const urlWhatsApp = linkWhatsApp(o.cliente.telefone, mensagem);

              return (
                <div
                  key={o.id}
                  className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <Link href={`/orcamento/${o.id}`} className="min-w-0 flex-1">
                    <p className="font-medium text-slate-900 dark:text-white">
                      {o.cliente.nome}
                    </p>
                    <p className="mt-0.5 text-sm text-slate-500">
                      Vendedor: {o.vendedor ?? "—"} · {formatoMoeda.format(Number(o.total))}
                    </p>
                  </Link>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                      {dias} {dias === 1 ? "dia parado" : "dias parado"}
                    </span>
                    {urlWhatsApp ? (
                      <a href={urlWhatsApp} target="_blank" rel="noopener noreferrer">
                        <Button type="button" variant="primary" className="!px-3 !py-1.5 text-xs">
                          Cobrar no WhatsApp
                        </Button>
                      </a>
                    ) : (
                      <span className="text-xs text-slate-400">Sem telefone</span>
                    )}
                  </div>
                </div>
              );
            })}
          </Card>
        )}
      </main>
    </div>
  );
}
