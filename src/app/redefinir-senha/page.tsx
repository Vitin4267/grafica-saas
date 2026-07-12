import { redirect } from "next/navigation";
import { obterUsuarioAtual } from "@/lib/auth/session";
import { AuthLayout } from "@/components/AuthLayout";
import { Alert } from "@/components/ui/Alert";
import { RedefinirSenhaForm } from "./RedefinirSenhaForm";

export default async function RedefinirSenhaPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const usuario = await obterUsuarioAtual();
  if (usuario) {
    redirect("/orcamento");
  }

  const { token } = await searchParams;

  return (
    <AuthLayout
      titulo="Criar uma senha nova"
      subtitulo="Escolha uma senha forte pra sua conta."
    >
      {token ? (
        <RedefinirSenhaForm token={token} />
      ) : (
        <Alert variant="error">
          Link inválido — falta o código de redefinição. Peça um novo link em
          &quot;Esqueci minha senha&quot; na tela de login.
        </Alert>
      )}
    </AuthLayout>
  );
}
