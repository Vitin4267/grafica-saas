import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeVerMeuNegocio, exigirVerModulo, obterModulosVisiveis } from "@/lib/auth/permissoes";
import { UserNav } from "@/components/UserNav";
import { Card } from "@/components/ui/Card";
import { ArrowLeftIcon, UsersIcon } from "@/components/icons";
import { agruparClientesPorDocumento } from "@/lib/clientes-duplicados";

// Achado A2/Parte 5-Fiscal da auditoria de abrangência ("Fase A") — relatório
// READ-ONLY, mesmo espírito do bloco "possíveis duplicidades" do achado A16
// (src/app/financeiro/exportar/route.ts / src/lib/exportacao-financeira.ts):
// heurística de revisão manual, nunca decide/mescla nada sozinha. Antes da
// validação de dígito verificador existir, dois cadastros do MESMO CPF/CNPJ
// podiam conviver só porque a pontuação era diferente ("111.444.777-35" e
// "11144477735" não colidem no `@@unique([graficaId, documento])` do
// schema, que compara a string crua). Esta tela agrupa por documento JÁ
// normalizado (src/lib/documento.ts) pra revelar esses grupos.
export default async function ClientesDuplicadosPage() {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  await exigirVerModulo(usuario, "CLIENTES");

  // Inclui desativados de propósito — um duplicado pode ter sido desativado
  // sem o documento ser percebido como o mesmo do cliente ativo. Sem
  // paginação (mesmo precedente dos relatórios de exportação financeira):
  // é uma tela de manutenção pontual, não navegação do dia a dia.
  const clientes = await prisma.cliente.findMany({
    where: { graficaId: usuario.graficaId, documento: { not: null } },
    select: { id: true, nome: true, documento: true, desativadoEm: true },
    orderBy: { nome: "asc" },
  });

  const grupos = agruparClientesPorDocumento(clientes);

  return (
    <div className="flex flex-1 flex-col">
      <UserNav
        nome={usuario.nome}
        graficaNome={usuario.grafica.nome}
        papel={usuario.papel}
        paginaAtual="/clientes"
        mostrarMeuNegocio={podeVerMeuNegocio(usuario)}
        modulosVisiveis={await obterModulosVisiveis(usuario)}
      />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <Link
          href="/clientes"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Voltar pra Clientes
        </Link>

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Possíveis cadastros duplicados
          </h1>
          <p className="mt-1 text-slate-500">
            Clientes com o mesmo CPF/CNPJ cadastrados mais de uma vez, com pontuação
            diferente (ex: &quot;111.444.777-35&quot; e &quot;11144477735&quot;). Isso não trava
            o cadastro hoje porque a verificação de duplicidade compara o texto exato — esta
            lista só aponta candidatos pra você decidir manualmente qual manter, editar ou
            mesclar (nenhuma ação automática é feita aqui).
          </p>
        </div>

        {grupos.length === 0 ? (
          <Card className="flex flex-col items-center gap-3 p-10 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800">
              <UsersIcon className="h-6 w-6" />
            </span>
            <p className="text-sm text-slate-500">
              Nenhum grupo de documento duplicado encontrado.
            </p>
          </Card>
        ) : (
          <div className="flex flex-col gap-4">
            {grupos.map((grupo) => (
              <Card key={grupo.documentoNormalizado} className="p-5">
                <p className="mb-3 text-sm font-medium text-slate-500">
                  Documento: <span className="font-mono">{grupo.documentoNormalizado}</span> ·{" "}
                  {grupo.clientes.length} cadastros
                </p>
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {grupo.clientes.map((cliente) => (
                    <Link
                      key={cliente.id}
                      href={`/clientes/${cliente.id}`}
                      className="flex items-center justify-between gap-3 py-3 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    >
                      <div>
                        <p className="font-medium text-slate-900 dark:text-white">
                          {cliente.nome}
                        </p>
                        <p className="text-xs text-slate-400">{cliente.documento}</p>
                      </div>
                      {cliente.desativadoEm && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                          Desativado
                        </span>
                      )}
                    </Link>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
