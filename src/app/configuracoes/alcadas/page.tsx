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
import { UserNav } from "@/components/UserNav";
import { Card } from "@/components/ui/Card";
import { CampoAjuda } from "@/components/ui/CampoAjuda";
import { ArrowLeftIcon } from "@/components/icons";
import { ROTULO_PAPEL } from "@/lib/papel-usuario";
import { ROTULO_TIPO_ALCADA, TIPOS_ALCADA } from "@/lib/alcada-aprovacao";
import type { TipoAlcada } from "@/generated/prisma/enums";
import { NovaAlcadaForm } from "./NovaAlcadaForm";
import { EditarLimiteAlcadaForm } from "./EditarLimiteAlcadaForm";

// Achado A4 da Parte 6 da auditoria de abrangência
// (pesquisa-abrangencia-modulos.md, 2026-09-02): antes desta tela, "quem
// pode aprovar quanto" era hardcoded (só DONO/ADMIN, num teto único global
// de desconto; nenhum teto pra compra). Aqui a gráfica configura, por papel
// ou por usuário específico, até quanto cada um aprova sozinho — ver
// resolverLimiteDesconto/resolverLimiteAprovacaoCompra em
// src/lib/alcada-aprovacao.ts pra como isso é usado.
export default async function AlcadasPage() {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  await exigirVerModulo(usuario, "CONFIGURACOES");
  const podeEditar = await podeEditarModulo(usuario, "CONFIGURACOES");

  const [alcadas, usuarios] = await Promise.all([
    prisma.alcadaAprovacao.findMany({
      where: { graficaId: usuario.graficaId },
      orderBy: [{ tipo: "asc" }, { papel: "asc" }],
    }),
    prisma.usuario.findMany({
      where: { graficaId: usuario.graficaId, desativadoEm: null },
      select: { id: true, nome: true, papel: true },
      orderBy: { nome: "asc" },
    }),
  ]);

  // Nome de cada usuário-alvo pra exibir na lista sem N+1 (mapa em memória
  // — a gráfica típica tem poucas dezenas de usuários no máximo).
  const nomePorUsuarioId = new Map(usuarios.map((u) => [u.id, u.nome]));

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
          <h1 className="inline-flex items-center gap-1.5 text-2xl font-bold text-slate-900 dark:text-white">
            Alçadas de aprovação
            <CampoAjuda texto="Alçada é até quanto esse papel ou pessoa pode aprovar sozinho, sem precisar de alguém acima. Sem nenhuma alçada cadastrada aqui, o sistema continua funcionando como sempre funcionou: desconto acima do limite geral (em Configurações gerais) só dono/administrador aprova, e aprovação de compra não tem teto de valor." />
          </h1>
          <p className="mt-1 text-slate-500">
            Configure, por papel ou por usuário específico, até quanto cada
            um aprova sozinho — desconto de orçamento (%) e aprovação de
            solicitação de compra (R$). Um só nível: quem estoura a própria
            alçada é bloqueado, sem fila de aprovação encadeada.
          </p>
        </div>

        {TIPOS_ALCADA.map((tipo) => {
          const alcadasDoTipo = alcadas.filter((a) => a.tipo === tipo);
          const unidade = tipo === "DESCONTO_ORCAMENTO" ? "%" : "R$";
          return (
            <section key={tipo} className="mb-8">
              <h2 className="mb-1 text-base font-semibold text-slate-900 dark:text-white">
                {ROTULO_TIPO_ALCADA[tipo as TipoAlcada]}
              </h2>
              <p className="mb-4 text-sm text-slate-500">
                {tipo === "DESCONTO_ORCAMENTO"
                  ? "Sem alçada configurada: dono/administrador aprovam qualquer desconto, operador fica travado no limite geral da gráfica."
                  : "Sem alçada configurada: qualquer pessoa com permissão de Compras aprova qualquer valor, sem teto."}
              </p>

              <div className="mb-4 flex flex-col gap-2">
                {alcadasDoTipo.length === 0 && (
                  <Card className="p-5">
                    <p className="text-sm text-slate-500">
                      Nenhuma alçada cadastrada — comportamento de sempre, descrito acima.
                    </p>
                  </Card>
                )}
                {alcadasDoTipo.map((alcada) => {
                  const descricaoAlvo = alcada.papel
                    ? `papel ${ROTULO_PAPEL[alcada.papel] ?? alcada.papel}`
                    : `usuário ${nomePorUsuarioId.get(alcada.usuarioId ?? "") ?? "removido"}`;
                  return (
                    <Card key={alcada.id} className="flex items-center justify-between gap-4 p-5">
                      <div>
                        <p className="font-medium capitalize text-slate-900 dark:text-white">
                          {descricaoAlvo}
                        </p>
                        <p className="text-xs text-slate-500">
                          Aprova sozinho até {unidade} {Number(alcada.limite).toLocaleString("pt-BR")}
                        </p>
                      </div>
                      {podeEditar ? (
                        <EditarLimiteAlcadaForm
                          alcadaId={alcada.id}
                          limiteInicial={Number(alcada.limite)}
                          unidade={unidade}
                          descricaoAlvo={descricaoAlvo}
                        />
                      ) : (
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                          {unidade} {Number(alcada.limite).toLocaleString("pt-BR")}
                        </span>
                      )}
                    </Card>
                  );
                })}
              </div>

              {podeEditar && (
                <Card className="p-6">
                  <h3 className="mb-4 text-sm font-semibold text-slate-900 dark:text-white">
                    Nova alçada de {ROTULO_TIPO_ALCADA[tipo as TipoAlcada].toLowerCase()}
                  </h3>
                  <NovaAlcadaForm tipo={tipo as TipoAlcada} usuarios={usuarios} />
                </Card>
              )}
            </section>
          );
        })}
      </main>
    </div>
  );
}
