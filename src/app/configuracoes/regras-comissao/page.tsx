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
import { NovaRegraComissaoForm } from "./NovaRegraComissaoForm";
import { LinhaRegraComissao } from "./LinhaRegraComissao";

// Achado A12 da Parte 4 da auditoria de abrangência (2026-09-09) — antes
// desta tela, a ÚNICA fonte de percentual de comissão era
// Usuario.comissaoPercent, uma taxa global por pessoa (sem variar por
// produto/categoria/margem). Aqui a gráfica cadastra regras mais
// específicas, que vencem a taxa pessoal quando batem — ver
// resolverRegraComissao em src/lib/comissao.ts pra ordem exata de
// resolução. Sem nenhuma regra cadastrada, tudo continua exatamente como
// era antes desta feature.
export default async function RegrasComissaoPage() {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  await exigirVerModulo(usuario, "CONFIGURACOES");
  const podeEditar = await podeEditarModulo(usuario, "CONFIGURACOES");

  const [regras, usuarios, itensCatalogo] = await Promise.all([
    prisma.regraComissao.findMany({
      where: { graficaId: usuario.graficaId },
      orderBy: [{ ativa: "desc" }, { prioridade: "desc" }, { createdAt: "desc" }],
    }),
    prisma.usuario.findMany({
      where: { graficaId: usuario.graficaId, desativadoEm: null },
      select: { id: true, nome: true },
      orderBy: { nome: "asc" },
    }),
    // Só itens que esta gráfica realmente adotou (via ItemGrafica) — mesmo
    // espírito do achado A13/Parte5 (take: 200, nunca a base inteira do
    // catálogo mestre).
    prisma.itemCatalogo.findMany({
      where: { itensGrafica: { some: { graficaId: usuario.graficaId } } },
      select: { id: true, nome: true, categoria: true },
      orderBy: { nome: "asc" },
      take: 200,
    }),
  ]);

  const nomePorUsuarioId = new Map(usuarios.map((u) => [u.id, u.nome]));
  const nomePorItemId = new Map(itensCatalogo.map((i) => [i.id, i.nome]));

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
            Regras de comissão
            <CampoAjuda texto="Regra de comissão é uma exceção à taxa única de cada vendedor (Usuários): percentual diferente por pessoa, produto/categoria, ou faixa de margem do orçamento. A regra mais ESPECÍFICA que bater com a venda vence — quanto mais filtros preenchidos, mais específica. Sem nenhuma regra cadastrada aqui, tudo continua igual a hoje: a comissão usa sempre a taxa pessoal de Usuários." />
          </h1>
          <p className="mt-1 text-slate-500">
            Percentuais diferentes de comissão por vendedor, produto/
            categoria ou faixa de margem — além da taxa única de cada pessoa.
            Deixe um filtro em branco pra "vale pra qualquer um" nessa
            dimensão.
          </p>
        </div>

        <div className="mb-8 flex flex-col gap-3">
          {regras.length === 0 && (
            <Card className="p-5">
              <p className="text-sm text-slate-500">
                Nenhuma regra cadastrada — toda comissão usa a taxa pessoal de
                cada vendedor (Usuários), comportamento de sempre.
              </p>
            </Card>
          )}
          {regras.map((regra) => (
            <LinhaRegraComissao
              key={regra.id}
              regra={{
                id: regra.id,
                prioridade: regra.prioridade,
                usuarioId: regra.usuarioId,
                usuarioNome: regra.usuarioId ? (nomePorUsuarioId.get(regra.usuarioId) ?? "removido") : null,
                itemCatalogoId: regra.itemCatalogoId,
                itemNome: regra.itemCatalogoId ? (nomePorItemId.get(regra.itemCatalogoId) ?? "removido") : null,
                tipoItem: regra.tipoItem,
                margemMinPercent: regra.margemMinPercent ? Number(regra.margemMinPercent) : null,
                margemMaxPercent: regra.margemMaxPercent ? Number(regra.margemMaxPercent) : null,
                percentual: Number(regra.percentual),
                baseCalculo: regra.baseCalculo,
                ativa: regra.ativa,
              }}
              usuarios={usuarios}
              itensCatalogo={itensCatalogo}
              podeEditar={podeEditar}
            />
          ))}
        </div>

        {podeEditar && (
          <Card className="p-6">
            <h2 className="mb-4 text-sm font-semibold text-slate-900 dark:text-white">
              Nova regra de comissão
            </h2>
            <NovaRegraComissaoForm usuarios={usuarios} itensCatalogo={itensCatalogo} />
          </Card>
        )}
      </main>
    </div>
  );
}
