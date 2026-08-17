import Link from "next/link";
import { Logo } from "@/components/Logo";
import { ArrowLeftIcon } from "@/components/icons";

export const metadata = {
  title: "Política de Privacidade — GrafPro",
};

export default function PrivacidadePage() {
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
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          Política de Privacidade
        </h1>
        <p className="mt-1 text-sm text-slate-400">Última atualização: 13 de julho de 2026.</p>

        <div className="mt-8 flex flex-col gap-6 text-sm leading-relaxed [&_h2]:mt-6 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-slate-900 dark:[&_h2]:text-white [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-2 [&_table]:w-full [&_table]:text-left [&_table]:border-collapse [&_th]:border-b [&_th]:border-slate-200 dark:[&_th]:border-slate-800 [&_th]:pb-2 [&_th]:font-semibold [&_th]:text-slate-900 dark:[&_th]:text-white [&_td]:border-b [&_td]:border-slate-100 dark:[&_td]:border-slate-800/60 [&_td]:py-2 [&_td]:align-top">
          <p>
            Esta política explica quais dados o GrafPro coleta, para quê, com quem
            compartilha e quais direitos você tem sobre eles, em conformidade com a Lei Geral
            de Proteção de Dados (LGPD — Lei nº 13.709/2018). O responsável por esta plataforma
            é <strong>Victor Ferrareto Dias</strong>, pessoa física, CPF{" "}
            <strong>542.664.238-96</strong>, contato{" "}
            <strong>victorferrareto515@gmail.com</strong>.
          </p>

          <div>
            <h2>1. Controlador e operador</h2>
            <p>
              Quando você cria uma conta como gráfica, você (a gráfica) é a{" "}
              <strong>controladora</strong> dos dados dos seus clientes que cadastrar no
              sistema. O GrafPro atua como <strong>operador</strong>: processa esses dados
              apenas para viabilizar o funcionamento do sistema, seguindo as instruções da
              gráfica, e nunca os usa para nenhuma finalidade própria (como venda de dados,
              anúncios ou treinamento de modelos de terceiros).
            </p>
          </div>

          <div>
            <h2>2. Quais dados coletamos</h2>
            <table>
              <thead>
                <tr>
                  <th className="pr-4">Categoria</th>
                  <th className="pr-4">Dados</th>
                  <th>Finalidade</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="pr-4">Conta da gráfica e usuários</td>
                  <td className="pr-4">Nome, e-mail, senha (armazenada com hash, nunca em texto puro), papel de acesso</td>
                  <td>Autenticação, controle de acesso e comunicação sobre a conta</td>
                </tr>
                <tr>
                  <td className="pr-4">Clientes cadastrados pela gráfica</td>
                  <td className="pr-4">Nome, e-mail, telefone, CPF/CNPJ, endereço</td>
                  <td>Gerar orçamentos e, quando configurado, emitir nota fiscal — dado inserido e controlado pela gráfica, não por nós</td>
                </tr>
                <tr>
                  <td className="pr-4">Segurança e prevenção a abuso</td>
                  <td className="pr-4">Endereço IP em tentativas de login e cadastro</td>
                  <td>Bloquear tentativas automatizadas (bots) e ataques de força bruta</td>
                </tr>
                <tr>
                  <td className="pr-4">Assistente de IA</td>
                  <td className="pr-4">Texto da pergunta enviada ao chat de ajuda</td>
                  <td>
                    Responder dúvidas de uso do sistema — o assistente <strong>nunca</strong>{" "}
                    recebe dado de negócio (orçamento, cliente, valor, nota fiscal)
                  </td>
                </tr>
                <tr>
                  <td className="pr-4">Credenciais de integrações</td>
                  <td className="pr-4">Token da Focus NFe, URL de webhook de automação</td>
                  <td>Conectar, a pedido da gráfica, com serviços de terceiros escolhidos por ela — armazenados como segredo, nunca exibidos de volta na tela</td>
                </tr>
                <tr>
                  <td className="pr-4">Cobrança da assinatura</td>
                  <td className="pr-4">Nome, e-mail e dados de pagamento (processados diretamente pelo Stripe — nunca vemos nem armazenamos número de cartão)</td>
                  <td>Cobrar a assinatura do plano contratado e gerenciar o período de teste gratuito</td>
                </tr>
                <tr>
                  <td className="pr-4">Monitoramento técnico</td>
                  <td className="pr-4">Relatórios de erro (stack trace técnico)</td>
                  <td>Identificar e corrigir falhas do sistema — só ativo se configurado, via Sentry</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div>
            <h2>3. Cookies</h2>
            <p>
              Usamos apenas um cookie de sessão, necessário para manter você conectado depois
              do login. Não usamos cookies de rastreamento, publicidade ou analytics de
              terceiros.
            </p>
          </div>

          <div>
            <h2>4. Com quem compartilhamos dados</h2>
            <ul>
              <li>
                <strong>Focus NFe</strong> — apenas se a gráfica configurar emissão de nota
                fiscal, e apenas os dados necessários para emitir a nota daquele orçamento.
              </li>
              <li>
                <strong>ViaCEP</strong> — consulta de endereço a partir do CEP digitado, sem
                envio de dados pessoais além do próprio CEP.
              </li>
              <li>
                <strong>Webhook do assistente de IA</strong> — apenas a pergunta digitada no
                chat de ajuda, enviada para um workflow de automação mantido por nós (não pela
                gráfica); nunca dado de negócio.
              </li>
              <li>
                <strong>Webhook de automação da própria gráfica</strong> — quando configurado,
                eventos como pedido atrasado ou estoque crítico são enviados para a URL que a
                própria gráfica escolheu.
              </li>
              <li>
                <strong>Stripe</strong> — processador de pagamentos responsável pela cobrança
                das assinaturas; recebe os dados necessários para processar o pagamento
                (nome, e-mail, dados do cartão), nunca acessados ou armazenados por nós.
              </li>
              <li>Não vendemos nem alugamos dados pessoais para terceiros.</li>
            </ul>
          </div>

          <div>
            <h2>5. Por quanto tempo guardamos os dados</h2>
            <p>
              Mantemos os dados enquanto a conta estiver ativa. Se você encerrar sua conta,
              os dados são apagados em até 30 dias, salvo obrigação legal de retenção (por
              exemplo, dados fiscais de notas emitidas).
            </p>
          </div>

          <div>
            <h2>6. Seus direitos (art. 18 da LGPD)</h2>
            <p>Você pode solicitar, a qualquer momento:</p>
            <ul>
              <li>Confirmação de que tratamos seus dados e acesso a eles;</li>
              <li>Correção de dados incompletos, inexatos ou desatualizados;</li>
              <li>Exclusão de dados — clientes cadastrados podem ser excluídos diretamente na tela &ldquo;Clientes&rdquo; do sistema; para os demais casos, entre em contato;</li>
              <li>Portabilidade dos dados a outro fornecedor;</li>
              <li>Informação sobre com quem compartilhamos seus dados.</li>
            </ul>
            <p>
              Para exercer qualquer um desses direitos, escreva para{" "}
              <strong>victorferrareto515@gmail.com</strong>.
            </p>
          </div>

          <div>
            <h2>7. Segurança</h2>
            <p>
              Cada gráfica só acessa os próprios dados (isolamento entre contas), senhas nunca
              são armazenadas em texto puro, conexões usam HTTPS, há limite de tentativas em
              login/cadastro/assistente de IA para dificultar abuso automatizado, e cabeçalhos
              de segurança (CSP, HSTS) protegem contra ataques comuns de navegador.
            </p>
          </div>

          <div>
            <h2>8. Alterações nesta política</h2>
            <p>
              Podemos atualizar esta política para refletir mudanças no serviço ou na
              legislação. Alterações relevantes serão comunicadas por e-mail ou aviso no
              próprio sistema.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
