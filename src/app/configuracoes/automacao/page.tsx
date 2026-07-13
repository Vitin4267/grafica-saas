import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import {
  podeVerMeuNegocio,
  exigirVerModulo,
  obterModulosVisiveis,
} from "@/lib/auth/permissoes";
import { UserNav } from "@/components/UserNav";
import { ArrowLeftIcon } from "@/components/icons";
import { AutomacaoForm } from "./AutomacaoForm";

function mascararWebhookUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}/••••••••`;
  } catch {
    return "•••• (salvo)";
  }
}

export default async function ConfiguracoesAutomacaoPage() {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  await exigirVerModulo(usuario, "CONFIGURACOES");

  // Self-healing, mesmo padrão de carregarParametrosTenant/dadosFiscais: cria
  // a linha vazia na primeira visita, sem forçar o usuário a nada.
  const automacao = await prisma.automacaoGrafica.upsert({
    where: { graficaId: usuario.graficaId },
    update: {},
    create: { graficaId: usuario.graficaId },
  });

  const webhookUrlMascarada = automacao.webhookUrl
    ? mascararWebhookUrl(automacao.webhookUrl)
    : null;

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
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Automação (n8n)
          </h1>
          <p className="mt-1 text-slate-500">
            Um webhook seu (n8n ou qualquer outro) recebe eventos da sua
            gráfica em tempo real — pedido mudou de status, estoque crítico,
            pedido atrasado — pra você automatizar avisos por WhatsApp,
            e-mail, planilha, o que quiser do seu lado.
          </p>
        </div>

        <AutomacaoForm webhookUrlMascarada={webhookUrlMascarada} />
      </main>
    </div>
  );
}
