import { redirect } from "next/navigation";
import { obterUsuarioAtual } from "@/lib/auth/session";
import { AuthLayout } from "@/components/AuthLayout";
import { RegistroForm } from "./RegistroForm";

export default async function RegistroPage() {
  const usuario = await obterUsuarioAtual();
  if (usuario) {
    redirect("/orcamento");
  }

  return (
    <AuthLayout
      titulo="Cadastre sua gráfica"
      subtitulo="Leva menos de um minuto para começar a usar."
    >
      <RegistroForm />
    </AuthLayout>
  );
}
