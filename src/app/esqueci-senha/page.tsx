import { redirect } from "next/navigation";
import { obterUsuarioAtual } from "@/lib/auth/session";
import { AuthLayout } from "@/components/AuthLayout";
import { EsqueciSenhaForm } from "./EsqueciSenhaForm";

export default async function EsqueciSenhaPage() {
  const usuario = await obterUsuarioAtual();
  if (usuario) {
    redirect("/orcamento");
  }

  return (
    <AuthLayout
      titulo="Esqueceu sua senha?"
      subtitulo="Digite seu e-mail e mandamos um link pra você criar uma senha nova."
    >
      <EsqueciSenhaForm />
    </AuthLayout>
  );
}
