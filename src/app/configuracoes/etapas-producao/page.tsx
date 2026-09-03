import Link from "next/link";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import {
  podeVerMeuNegocio,
  exigirVerModulo,
  podeEditarModulo,
  obterModulosVisiveis,
} from "@/lib/auth/permissoes";
import { resolverEtapasGrafica, ETAPAS_SEMPRE_ATIVAS } from "@/lib/etapa-grafica";
import { UserNav } from "@/components/UserNav";
import { ArrowLeftIcon } from "@/components/icons";
import { EtapasProducaoForm, type EtapaGraficaLinha } from "./EtapasProducaoForm";

// Achado A1 da auditoria de abrangência (Parte 2/Produção,
// pesquisa-abrangencia-modulos.md), Fase 1 — liga/desliga e renomeia, por
// gráfica, cada etapa de StatusPedido (ver model EtapaGrafica). CANCELADO
// fica de fora (não é uma linha em EtapaGrafica, é terminal alcançável de
// qualquer estágio — ver comentário do enum no schema).
export default async function EtapasProducaoPage() {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  await exigirVerModulo(usuario, "CONFIGURACOES");
  const podeEditar = await podeEditarModulo(usuario, "CONFIGURACOES");

  // resolverEtapasGrafica já faz o bootstrap lazy (garantirEtapasGraficaPadrao)
  // na primeira leitura — mesmo padrão de garantirCategoriasCustoPadrao em
  // /configuracoes/categorias-custo.
  const etapas = await resolverEtapasGrafica(usuario.graficaId);

  const linhas: EtapaGraficaLinha[] = etapas.todas.map((etapa) => ({
    status: etapa.status,
    rotuloPadrao: etapa.rotulo, // já resolvido: custom ?? padrão (ver resolverEtapasGrafica)
    ativa: etapa.ativa,
    rotuloCustom: etapa.rotuloCustom,
    ordem: etapa.ordem,
    sempreAtiva: ETAPAS_SEMPRE_ATIVAS.includes(etapa.status),
  }));

  return (
    <div className="flex flex-1 flex-col">
      <UserNav
        nome={usuario.nome}
        graficaNome={usuario.grafica.nome}
        papel={usuario.papel}
        paginaAtual="/configuracoes"
        mostrarMeuNegocio={podeVerMeuNegocio(usuario)}
        modulosVisiveis={await obterModulosVisiveis(usuario)}
      />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <Link
          href="/configuracoes"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Voltar a Configurações
        </Link>

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Etapas de produção
          </h1>
          <p className="mt-1 text-slate-500">
            O caminho que todo pedido percorre em Produção, do jeito que a
            sua gráfica realmente trabalha. Desligue uma etapa que você não
            usa (ex: Clichê/Faca numa gráfica só-digital) e renomeie
            qualquer etapa com o nome do seu processo (ex: &quot;Queima de
            tela&quot;, &quot;Instalação&quot;) — o pedido continua avançando
            normalmente, só pula as etapas desligadas.
          </p>
        </div>

        <EtapasProducaoForm etapas={linhas} podeEditar={podeEditar} />
      </main>
    </div>
  );
}
