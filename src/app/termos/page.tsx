import Link from "next/link";
import { Logo } from "@/components/Logo";
import { ArrowLeftIcon } from "@/components/icons";

export const metadata = {
  title: "Termos de Uso — Gráfica+",
};

export default function TermosPage() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-slate-200 py-4 dark:border-slate-800">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6">
          <Logo />
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            Voltar
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12 text-slate-700 dark:text-slate-300">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Termos de Uso</h1>
        <p className="mt-1 text-sm text-slate-400">Última atualização: 13 de julho de 2026.</p>

        <div className="mt-8 flex flex-col gap-6 text-sm leading-relaxed [&_h2]:mt-6 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-slate-900 dark:[&_h2]:text-white [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:flex [&_ol]:flex-col [&_ol]:gap-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-2">
          <p>
            Estes Termos de Uso regulam a utilização do Gráfica+, um sistema (SaaS) de
            orçamento, catálogo, estoque, financeiro e gestão para gráficas, oferecido por{" "}
            <strong>Victor Ferrareto Dias</strong>, pessoa física inscrita no CPF{" "}
            <strong>542.664.238-96</strong>, doravante &ldquo;Gráfica+&rdquo;. Ao criar uma
            conta, você concorda integralmente com estes termos.
          </p>

          <div>
            <h2>1. O que é o serviço</h2>
            <p>
              O Gráfica+ é uma plataforma online para gráficas gerenciarem orçamentos,
              clientes, catálogo de produtos, estoque, produção, financeiro e emissão de nota
              fiscal. Cada gráfica que se cadastra (&ldquo;Cliente Gráfica+&rdquo;) opera de
              forma isolada das demais, com seus próprios dados.
            </p>
          </div>

          <div>
            <h2>2. Cadastro e responsabilidades do usuário</h2>
            <ul>
              <li>Você deve fornecer dados verdadeiros ao criar sua conta.</li>
              <li>Você é responsável por manter sua senha em sigilo e por toda atividade realizada com seu login.</li>
              <li>
                O usuário com papel de <strong>Dono</strong> pode convidar outros usuários e
                controlar as permissões de acesso deles dentro da própria gráfica.
              </li>
              <li>
                É proibido usar o assistente de IA embutido no site (chat de ajuda) para fins
                diferentes de aprender a usar o sistema, incluindo tentativas de sobrecarga,
                automação abusiva ou extração de dados de terceiros.
              </li>
            </ul>
          </div>

          <div>
            <h2>3. Papéis em relação aos dados (LGPD)</h2>
            <p>
              Cada gráfica cadastrada é a <strong>controladora</strong> dos dados de seus
              próprios clientes (pessoas ou empresas que ela cadastra no sistema para gerar
              orçamentos e notas fiscais) — é ela quem decide coletar esses dados e para quê.
              O Gráfica+ atua como <strong>operador</strong>: processa esses dados apenas para
              viabilizar o funcionamento do sistema para a gráfica contratante, e nunca os
              utiliza para finalidade própria. Detalhes completos em nossa{" "}
              <Link href="/privacidade" className="font-medium text-teal-700 hover:underline dark:text-teal-400">
                Política de Privacidade
              </Link>
              .
            </p>
          </div>

          <div>
            <h2>4. Propriedade e portabilidade dos dados</h2>
            <p>
              Todos os dados que uma gráfica insere no sistema (orçamentos, clientes,
              catálogo, financeiro) pertencem a ela. A qualquer momento, a gráfica pode
              solicitar exportação ou exclusão desses dados, ou excluir diretamente registros
              individuais (como um cliente) pelas telas do próprio sistema, quando disponível.
            </p>
          </div>

          <div>
            <h2>5. Integrações e serviços de terceiros</h2>
            <p>
              O Gráfica+ pode se conectar, a critério e configuração de cada gráfica, a
              serviços de terceiros: emissão de nota fiscal (Focus NFe), consulta de endereço
              por CEP (ViaCEP) e um webhook de automação (n8n ou similar) configurado pela
              própria gráfica para receber eventos como pedido atrasado ou estoque crítico.
              O assistente de IA (chat de ajuda) é um recurso da própria plataforma, disponível
              a qualquer usuário sem configuração — não depende de credencial da gráfica.
              Processamento de pagamento é feito pelo Stripe. Essas integrações opcionais
              (Focus NFe, webhook de automação) usam credenciais de responsabilidade de cada
              gráfica.
            </p>
          </div>

          <div>
            <h2>6. Planos e cobrança</h2>
            <p>
              Novas contas começam com um período de teste gratuito de 14 dias, sem necessidade
              de cartão de crédito. Após o período de teste, o uso continuado do sistema requer
              a contratação de um dos planos pagos disponíveis em Configurações → Assinatura,
              cobrados mensalmente e de forma recorrente via Stripe, nosso processador de
              pagamentos. Os valores e limites de uso (quantidade de orçamentos por mês e de
              usuários) de cada plano são os exibidos na tela de assinatura no momento da
              contratação. Ultrapassar o limite de uso do plano contratado não bloqueia o
              acesso imediatamente: há uma janela de tolerância de 15 dias para regularizar
              (fazer upgrade de plano ou reduzir o uso) antes de qualquer bloqueio. O
              cancelamento pode ser feito a qualquer momento pelo portal do cliente Stripe,
              acessível pela tela de Assinatura; não há reembolso de período já pago. Em casos
              excepcionais, a critério do responsável pela plataforma, uma gráfica pode receber
              acesso cortesia (sem cobrança).
            </p>
          </div>

          <div>
            <h2>7. Cancelamento</h2>
            <p>
              Você pode encerrar sua conta a qualquer momento entrando em contato pelo canal
              informado na seção de contato abaixo. Após o encerramento, os dados são
              mantidos pelo prazo descrito na Política de Privacidade e depois excluídos.
            </p>
          </div>

          <div>
            <h2>8. Limitação de responsabilidade</h2>
            <p>
              O Gráfica+ é fornecido &ldquo;como está&rdquo;. Fazemos o possível para manter o
              serviço disponível e seguro, mas não garantimos operação ininterrupta.
              Recomendamos que cada gráfica mantenha seus próprios backups de informações
              críticas quando aplicável.
            </p>
          </div>

          <div>
            <h2>9. Alterações nestes termos</h2>
            <p>
              Podemos atualizar estes termos para refletir mudanças no serviço ou na
              legislação. Alterações relevantes serão comunicadas por e-mail ou aviso no
              próprio sistema.
            </p>
          </div>

          <div>
            <h2>10. Legislação aplicável</h2>
            <p>
              Estes termos são regidos pela legislação brasileira, incluindo a Lei Geral de
              Proteção de Dados (Lei nº 13.709/2018).
            </p>
          </div>

          <div>
            <h2>11. Contato</h2>
            <p>
              Dúvidas sobre estes termos: <strong>victorferrareto515@gmail.com</strong>.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
