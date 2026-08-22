import Link from "next/link";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeVerMeuNegocio, exigirVerModulo, obterModulosVisiveis } from "@/lib/auth/permissoes";
import { listarFilaGangRunAgrupada } from "@/lib/gang-run-servico";
import { UserNav } from "@/components/UserNav";
import { EmptyState } from "@/components/ui/EmptyState";
import { LayersIcon, ArrowLeftIcon } from "@/components/icons";
import { GrupoGangRunSelecao } from "./GrupoGangRunSelecao";

// Fila de candidatos a gang run: itens Offset que sozinhos não enchem uma
// chapa (ver ehCandidatoGangRun em src/lib/gang-run.ts), agrupados por
// compatibilidade física (papel+gramatura+prensa+folha+cores), esperando o
// operador decidir combinar com outros pedidos da MESMA gráfica pra dividir
// o custo fixo de chapa+acerto. Candidatura acontece sozinha na aprovação do
// orçamento (registrarCandidatosGangRun); combinar é sempre ação manual
// aqui — MVP não escolhe automaticamente quais/quantos itens juntar.
export default async function GangRunPage() {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  await exigirVerModulo(usuario, "PRODUCAO");

  const grupos = await listarFilaGangRunAgrupada(usuario.graficaId);

  return (
    <div className="flex flex-1 flex-col">
      <UserNav
        nome={usuario.nome}
        graficaNome={usuario.grafica.nome}
        papel={usuario.papel}
        paginaAtual="/producao"
        mostrarMeuNegocio={podeVerMeuNegocio(usuario)}
        modulosVisiveis={await obterModulosVisiveis(usuario)}
      />

      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
        <Link
          href="/producao"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Voltar para Produção
        </Link>

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Fila de gang run
          </h1>
          <p className="mt-1 text-slate-500">
            Itens Offset pequenos demais pra encher uma chapa sozinhos, esperando
            pedidos compatíveis (mesmo papel, gramatura, prensa e folha) pra
            dividir o custo de chapa + acerto de máquina.
          </p>
        </div>

        {grupos.length === 0 ? (
          <EmptyState
            icone={<LayersIcon className="h-6 w-6" />}
            texto="Nenhum candidato a gang run no momento. Itens Offset que não enchem uma chapa sozinhos aparecem aqui automaticamente quando o orçamento é aprovado."
            href="/producao"
            rotuloCta="Ir para Produção"
          />
        ) : (
          <div className="space-y-4">
            {grupos.map((grupo) => (
              <GrupoGangRunSelecao key={grupo.chave} grupo={grupo} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
