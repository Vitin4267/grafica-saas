import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { exigirPapel, podeVerMeuNegocio } from "@/lib/auth/permissoes";
import { UserNav } from "@/components/UserNav";
import { Card } from "@/components/ui/Card";
import { UsuarioForm } from "./UsuarioForm";
import { UsuariosLista } from "./UsuariosLista";
import { AcessoMeuNegocioForm } from "./AcessoMeuNegocioForm";
import { ComissaoUsuarioForm } from "./ComissaoUsuarioForm";
import { ResponsaveisEstagioForm } from "./ResponsaveisEstagioForm";
import { ResponsaveisAdministrativoForm } from "./ResponsaveisAdministrativoForm";

export default async function UsuariosPage() {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  exigirPapel(usuario, ["DONO"]);

  const todosUsuarios = await prisma.usuario.findMany({
    where: { graficaId: usuario.graficaId },
    orderBy: { nome: "asc" },
    include: {
      responsaveisEstagio: { select: { status: true } },
      responsaveisAdministrativo: { select: { area: true } },
    },
  });

  // Particionado em memória (não duas queries): volume baixo por gráfica, e
  // as duas listas precisam dos mesmos campos (responsaveisEstagio incluído)
  // pra alimentar os formulários abaixo. Desativado nunca é candidato a
  // vendedor/responsável/acesso ao Meu Negócio — só usuariosAtivos alimenta
  // esses formulários; ver comentário de Usuario.desativadoEm no schema.
  const usuarios = todosUsuarios.filter((u) => !u.desativadoEm);
  const usuariosDesativados = todosUsuarios.filter((u) => u.desativadoEm);

  return (
    <div className="flex flex-1 flex-col">
      <UserNav
        nome={usuario.nome}
        graficaNome={usuario.grafica.nome}
        papel={usuario.papel}
        paginaAtual="/usuarios"
        mostrarMeuNegocio={podeVerMeuNegocio(usuario)}
      />

      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Usuários</h1>
          <p className="mt-1 text-slate-500">
            Dê acesso ao sistema pra sua equipe. Cada pessoa entra com o
            próprio e-mail e senha.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-5 lg:items-start">
          <Card className="p-6 lg:col-span-2">
            <h2 className="mb-5 text-base font-semibold text-slate-900 dark:text-white">
              Novo usuário
            </h2>
            <UsuarioForm />
          </Card>

          <div className="lg:col-span-3">
            <UsuariosLista
              usuariosAtivos={usuarios.map((u) => ({
                id: u.id,
                nome: u.nome,
                email: u.email,
                papel: u.papel,
              }))}
              usuariosDesativados={usuariosDesativados.map((u) => ({
                id: u.id,
                nome: u.nome,
                email: u.email,
                papel: u.papel,
                desativadoEm: u.desativadoEm!.toISOString(),
              }))}
            />
          </div>
        </div>

        <section className="mt-12">
          <h2 className="mb-1 text-lg font-semibold text-slate-900 dark:text-white">
            Acesso ao relatório Meu Negócio
          </h2>
          <p className="mb-4 text-sm text-slate-500">
            Por padrão, só você (dono) vê a visão geral do negócio. Compartilhe
            com a equipe e escolha quem tem acesso.
          </p>
          <AcessoMeuNegocioForm
            compartilhar={usuario.grafica.compartilharMeuNegocio}
            funcionarios={usuarios
              .filter((u) => u.papel !== "DONO")
              .map((u) => ({
                id: u.id,
                nome: u.nome,
                email: u.email,
                papel: u.papel,
                acesso: u.acessoMeuNegocio,
              }))}
          />
        </section>

        <section className="mt-12">
          <h2 className="mb-1 text-lg font-semibold text-slate-900 dark:text-white">
            Comissão por vendedor
          </h2>
          <p className="mb-4 text-sm text-slate-500">
            Defina a taxa de cada pessoa que vende — gera uma comissão
            automática sempre que um orçamento dela é aprovado. A base de
            cálculo (valor ou lucro) fica em Configurações.
          </p>
          <ComissaoUsuarioForm
            usuarios={usuarios.map((u) => ({
              id: u.id,
              nome: u.nome,
              email: u.email,
              papel: u.papel,
              comissaoPercent: u.comissaoPercent?.toString() ?? "",
            }))}
          />
        </section>

        <section className="mt-12">
          <h2 className="mb-1 text-lg font-semibold text-slate-900 dark:text-white">
            Responsáveis por etapa de produção
          </h2>
          <p className="mb-4 text-sm text-slate-500">
            Marque quem cuida de cada etapa. Quando um pedido chega lá, essa
            pessoa recebe um e-mail com um botão de confirmação — e também
            pode confirmar pelo site, mesmo sem acesso completo à Produção.
          </p>
          <ResponsaveisEstagioForm
            funcionarios={usuarios.map((u) => ({
              id: u.id,
              nome: u.nome,
              email: u.email,
              papel: u.papel,
              etapas: u.responsaveisEstagio.map((r) => r.status),
            }))}
          />
        </section>

        <section className="mt-12">
          <h2 className="mb-1 text-lg font-semibold text-slate-900 dark:text-white">
            Responsáveis administrativos
          </h2>
          <p className="mb-4 text-sm text-slate-500">
            Marque quem recebe e-mail quando um orçamento aprovado está pronto
            pra emitir Nota Fiscal, ou quando um pedido se aproxima ou passa
            do prazo de entrega.
          </p>
          <ResponsaveisAdministrativoForm
            funcionarios={usuarios.map((u) => ({
              id: u.id,
              nome: u.nome,
              email: u.email,
              papel: u.papel,
              areas: u.responsaveisAdministrativo.map((r) => r.area),
            }))}
          />
        </section>
      </main>
    </div>
  );
}
