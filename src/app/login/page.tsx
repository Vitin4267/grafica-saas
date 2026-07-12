import { redirect } from "next/navigation";
import { obterUsuarioAtual } from "@/lib/auth/session";
import { AuthLayout } from "@/components/AuthLayout";
import { Alert } from "@/components/ui/Alert";
import { LoginForm } from "./LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ senhaRedefinida?: string }>;
}) {
  const usuario = await obterUsuarioAtual();
  if (usuario) {
    redirect("/orcamento");
  }

  const { senhaRedefinida } = await searchParams;

  return (
    <AuthLayout
      titulo="Bem-vindo de volta"
      subtitulo="Entre com sua conta para continuar de onde parou."
    >
      {senhaRedefinida && (
        <div className="mb-5">
          <Alert variant="success">Senha redefinida! Entre com sua senha nova.</Alert>
        </div>
      )}
      <LoginForm />
    </AuthLayout>
  );
}
