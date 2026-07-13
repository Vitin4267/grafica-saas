import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { exigirSuperAdmin } from "@/lib/auth/superadmin";
import { UserNav } from "@/components/UserNav";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { AcaoCortesia } from "./AcaoCortesia";

const ROTULO_STATUS: Record<string, string> = {
  TRIALING: "Em teste gratuito",
  ATIVA: "Ativa",
  INADIMPLENTE: "Pagamento pendente",
  CANCELADA: "Cancelada",
};

const COR_STATUS: Record<string, string> = {
  TRIALING: "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  ATIVA: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  INADIMPLENTE: "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
  CANCELADA: "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
};

// Painel de administração da PLATAFORMA (não de uma gráfica) — só acessível
// a quem tem Usuario.superAdmin=true, ver exigirSuperAdmin. Ferramenta
// mínima pra um único propósito: conceder/revogar acesso cortesia (grátis
// permanente, sem passar pelo Stripe) a qualquer gráfica, pra não precisar
// mais editar o banco na mão pra isso.
export default async function AdminGraficasPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  exigirSuperAdmin(usuario);

  const { q } = await searchParams;
  const busca = q?.trim();

  // ÚNICA query do projeto sem `where: { graficaId: usuario.graficaId }` —
  // intencional: esta tela existe justamente pra atravessar tenants, gate
  // já garantido acima por exigirSuperAdmin.
  const graficas = await prisma.grafica.findMany({
    where: busca
      ? {
          OR: [
            { nome: { contains: busca, mode: "insensitive" } },
            { usuarios: { some: { email: { contains: busca, mode: "insensitive" } } } },
          ],
        }
      : undefined,
    include: {
      assinatura: true,
      usuarios: { where: { papel: "DONO" }, select: { nome: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
    take: busca ? 50 : 20,
  });

  return (
    <div className="flex flex-1 flex-col">
      <UserNav
        nome={usuario.nome}
        graficaNome={usuario.grafica.nome}
        papel={usuario.papel}
        paginaAtual="/admin/graficas"
        mostrarMeuNegocio={false}
        modulosVisiveis={null}
      />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Administração — Gráficas
          </h1>
          <p className="mt-1 text-slate-500">
            Conceder ou revogar acesso cortesia (liberado sem cobrança) a
            qualquer gráfica cadastrada na plataforma.
          </p>
        </div>

        <form className="mb-6 flex items-end gap-3">
          <div className="flex-1">
            <Input
              label="Buscar"
              name="q"
              defaultValue={busca ?? ""}
              placeholder="Nome da gráfica ou e-mail do dono..."
            />
          </div>
          <Button type="submit" variant="outline">
            Buscar
          </Button>
        </form>

        <div className="flex flex-col gap-3">
          {graficas.length === 0 && (
            <Card className="p-6 text-center text-sm text-slate-500">
              Nenhuma gráfica encontrada.
            </Card>
          )}

          {graficas.map((grafica) => {
            const assinatura = grafica.assinatura;
            const status = assinatura?.status ?? "TRIALING";
            const cortesia = assinatura?.cortesia ?? false;
            return (
              <Card
                key={grafica.id}
                className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium text-slate-900 dark:text-white">
                    {grafica.nome}
                  </p>
                  <p className="text-sm text-slate-500">
                    {grafica.usuarios.map((d) => `${d.nome} <${d.email}>`).join(", ") ||
                      "Sem DONO cadastrado"}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      cortesia
                        ? "bg-violet-50 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300"
                        : COR_STATUS[status]
                    }`}
                  >
                    {cortesia ? "Cortesia" : ROTULO_STATUS[status]}
                  </span>
                  <AcaoCortesia graficaId={grafica.id} cortesia={cortesia} />
                </div>
              </Card>
            );
          })}
        </div>
      </main>
    </div>
  );
}
