import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import {
  podeVerMeuNegocio,
  exigirVerModulo,
  obterModulosVisiveis,
} from "@/lib/auth/permissoes";
import { carregarParametrosTenant } from "@/lib/pricing/carregar";
import { prisma } from "@/lib/prisma";
import { UserNav } from "@/components/UserNav";
import { Card } from "@/components/ui/Card";
import { MailIcon } from "@/components/icons";
import { montarUrlSuporte } from "@/lib/suporte";
import { ParametrosForm } from "./ParametrosForm";

export default async function ConfiguracoesPage() {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  await exigirVerModulo(usuario, "CONFIGURACOES");
  const parametros = await carregarParametrosTenant(usuario.graficaId);
  // Campo de comissão a vendedor não faz parte de ParametrosTenant (tipo
  // estrito do motor de precificação, ver src/lib/pricing/carregar.ts) —
  // carregarParametrosTenant já garante (via upsert) que a linha existe,
  // então este findUnique nunca vem null.
  const {
    comissaoVendedorBase,
    custoTintaPorMl,
    diasValidadeOrcamentoPadrao,
    diasAlertaOrcamentoParado,
    alertaPrazoAtivo,
    alertaPrazoLimiar1Dias,
    alertaPrazoLimiar2Dias,
    alertaPrazoLimiar3Dias,
    termosCondicoesPdf,
    mostrarEspecificacoesTecnicas,
  } = await prisma.parametrosGrafica.findUniqueOrThrow({
    where: { graficaId: usuario.graficaId },
    select: {
      comissaoVendedorBase: true,
      custoTintaPorMl: true,
      diasValidadeOrcamentoPadrao: true,
      diasAlertaOrcamentoParado: true,
      alertaPrazoAtivo: true,
      alertaPrazoLimiar1Dias: true,
      alertaPrazoLimiar2Dias: true,
      alertaPrazoLimiar3Dias: true,
      termosCondicoesPdf: true,
      mostrarEspecificacoesTecnicas: true,
    },
  });
  // unidadePadraoDimensao mora em Grafica (não em ParametrosGrafica): não é
  // um parâmetro do motor de precificação, é só a unidade de entrada/exibição
  // de medida (ver src/lib/unidade-dimensao.ts). usuario.grafica já vem
  // carregado por exigirUsuarioAutenticado (include: usuario.grafica), então
  // não precisa de outra query.
  const unidadePadraoDimensao = usuario.grafica.unidadePadraoDimensao;

  const urlSuporte = montarUrlSuporte({
    nome: usuario.nome,
    email: usuario.email,
    graficaNome: usuario.grafica.nome,
  });

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
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Configurações do motor de precificação
          </h1>
          <p className="mt-1 text-slate-500">
            Esses parâmetros valem para toda a gráfica e afetam todos os
            orçamentos calculados com o modelo M2 ou Offset.
          </p>
        </div>

        {urlSuporte && (
          <Card className="mb-6 flex items-center justify-between gap-4 p-6">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-600 dark:bg-teal-950 dark:text-teal-400">
                <MailIcon className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                  Precisa de ajuda?
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Conte o que está acontecendo — a gente resolve e te avisa por e-mail.
                </p>
              </div>
            </div>
            <a
              href={urlSuporte}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center justify-center rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm shadow-teal-600/20 transition-colors hover:bg-teal-700"
            >
              Falar com suporte
            </a>
          </Card>
        )}

        <ParametrosForm
          parametros={parametros}
          comissaoVendedorBase={comissaoVendedorBase}
          custoTintaPorMl={custoTintaPorMl ? Number(custoTintaPorMl) : null}
          diasValidadeOrcamentoPadrao={diasValidadeOrcamentoPadrao ?? 15}
          diasAlertaOrcamentoParado={diasAlertaOrcamentoParado}
          unidadePadraoDimensao={unidadePadraoDimensao}
          alertaPrazoAtivo={alertaPrazoAtivo}
          alertaPrazoLimiar1Dias={alertaPrazoLimiar1Dias}
          alertaPrazoLimiar2Dias={alertaPrazoLimiar2Dias}
          alertaPrazoLimiar3Dias={alertaPrazoLimiar3Dias}
          termosCondicoesPdf={termosCondicoesPdf}
          mostrarEspecificacoesTecnicas={mostrarEspecificacoesTecnicas}
        />
      </main>
    </div>
  );
}
