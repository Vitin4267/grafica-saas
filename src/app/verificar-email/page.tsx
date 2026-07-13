import { redirect } from "next/navigation";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { AuthLayout } from "@/components/AuthLayout";
import { VerificarEmailForm } from "./VerificarEmailForm";

// NÃO chama exigirEmailVerificado — essa é a própria página que resolve o
// bloqueio, chamar o gate aqui criaria um loop de redirect.
export default async function VerificarEmailPage() {
  const usuario = await exigirUsuarioAutenticado();

  if (usuario.emailVerificadoEm) {
    redirect("/orcamento");
  }

  return (
    <AuthLayout
      titulo="Confirme seu e-mail"
      subtitulo={`Mandamos um código de 6 dígitos pra ${usuario.email}. Digite ele abaixo pra liberar seu acesso.`}
    >
      <VerificarEmailForm />
      <p className="mt-4 text-center text-xs text-slate-500">
        Não recebeu? Confira também a caixa de spam/lixo eletrônico — às
        vezes o e-mail cai lá.
      </p>
    </AuthLayout>
  );
}
