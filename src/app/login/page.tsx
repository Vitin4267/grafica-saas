import { redirect } from "next/navigation";
import { obterUsuarioAtual } from "@/lib/auth/session";
import { AuthLayout } from "@/components/AuthLayout";
import { LoginForm } from "./LoginForm";

export default async function LoginPage() {
  const usuario = await obterUsuarioAtual();
  if (usuario) {
    redirect("/orcamento");
  }

  return (
    <AuthLayout
      titulo="Bem-vindo de volta"
      subtitulo="Entre com sua conta para continuar de onde parou."
    >
      <LoginForm />
    </AuthLayout>
  );
}
