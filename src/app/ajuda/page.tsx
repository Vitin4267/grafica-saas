import type { ReactNode, SVGProps } from "react";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeVerMeuNegocio, obterModulosVisiveis } from "@/lib/auth/permissoes";
import { UserNav } from "@/components/UserNav";
import { Card } from "@/components/ui/Card";
import {
  ReceiptIcon,
  PrinterIcon,
  BoxIcon,
  UsersIcon,
  TrendingUpIcon,
  LayersIcon,
  SettingsIcon,
  UserIcon,
  BuildingIcon,
} from "@/components/icons";

// icons.tsx não exporta o tipo de props (é interno ao módulo) — mesmo
// formato (SVGProps<SVGSVGElement>), só pra tipar o componente de ícone
// de cada seção abaixo.
type IconProps = SVGProps<SVGSVGElement>;

// Sem gate de módulo de propósito — igual a /comecar (ver comentário de
// exigirVerModulo em src/lib/auth/permissoes.ts): ajuda é conteúdo estático,
// faz sentido pra qualquer papel/permissão ver, independente de quais
// módulos essa conta libera.
//
// Conteúdo 100% baseado no que o sistema faz de verdade hoje (checado direto
// no código de cada módulo em 2026-08-31) — nada aqui é aspiracional. Se um
// módulo ganhar uma funcionalidade nova, atualize a seção correspondente
// abaixo junto com o código.
type Secao = {
  id: string;
  titulo: string;
  Icone: (props: IconProps) => ReactNode;
  conteudo: ReactNode;
};

// Classes de prose compartilhadas (mesmo truque de src/app/termos/page.tsx)
// pra não repetir className em cada <h3>/<ul> de cada seção.
const PROSE =
  "flex flex-col gap-4 text-sm leading-relaxed text-slate-600 dark:text-slate-300 " +
  "[&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-slate-900 dark:[&_h3]:text-white " +
  "[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1.5 " +
  "[&_strong]:font-semibold [&_strong]:text-slate-800 dark:[&_strong]:text-slate-100";

const SECOES: Secao[] = [
  {
    id: "orcamento",
    titulo: "Orçamento",
    Icone: ReceiptIcon,
    conteudo: (
      <div className={PROSE}>
        <p>
          Onde você monta uma proposta de preço pro cliente, item por item, e acompanha até a
          aprovação.
        </p>
        <div>
          <h3>Criar e editar</h3>
          <ul>
            <li>Escolha o cliente e vá adicionando itens do catálogo — quantidade, dimensões, cores e acabamentos, conforme o que o produto pede.</li>
            <li>Enquanto está em <strong>Rascunho</strong>, dá pra aplicar desconto por item (com motivo, e aprovação se passar do limite configurado em Configurações), anexar a arte e montar até duas opções alternativas (Opção B/C) pro cliente comparar lado a lado.</li>
            <li>Cada item mostra a margem estimada com base no custo cadastrado, com aviso visual quando a margem está ruim.</li>
          </ul>
        </div>
        <div>
          <h3>Enviar pro cliente</h3>
          <ul>
            <li>Gera um link público (<strong>/o/[token]</strong>) pra mandar por WhatsApp, além do PDF pra baixar.</li>
            <li>No link, o cliente vê os itens e o total (ou as opções lado a lado) e pode <strong>aprovar</strong> ou <strong>recusar</strong> — sem precisar criar login.</li>
            <li>A tela <strong>Orçamentos parados</strong> avisa quais orçamentos foram enviados há muitos dias sem resposta, pra você cobrar antes de expirar.</li>
          </ul>
        </div>
        <div>
          <h3>Quando o cliente aprova</h3>
          <ul>
            <li>O orçamento vira <strong>Aprovado</strong>, as contas a receber são geradas conforme a condição de pagamento e a comissão do vendedor é calculada.</li>
            <li>Um pedido é criado automaticamente no módulo <strong>Produção</strong>, já na primeira etapa (Arte).</li>
            <li>Depois de aprovado, ainda dá pra registrar pagamentos, emitir nota fiscal (se os dados fiscais estiverem completos) e comparar o custo real com o orçado.</li>
          </ul>
        </div>
      </div>
    ),
  },
  {
    id: "producao",
    titulo: "Produção",
    Icone: PrinterIcon,
    conteudo: (
      <div className={PROSE}>
        <p>Acompanha um pedido aprovado do começo (arte) até a entrega, em etapas fixas.</p>
        <div>
          <h3>As etapas</h3>
          <ul>
            <li><strong>Arte → Clichê/Faca → Produção → Acabamento → Conferência → Embalagem → Expedição → Entregue</strong> (mais o status Cancelado, à parte).</li>
            <li>Dá pra ver em lista ou em <strong>Kanban</strong> — no Kanban, arraste o cartão do pedido de uma coluna pra outra pra avançar a etapa.</li>
            <li>Não dá pra sair de Arte sem antes aprovar a arte que foi enviada no orçamento.</li>
            <li>Na virada de Clichê/Faca pra Produção, o sistema pede pra escolher qual máquina vai rodar o pedido.</li>
          </ul>
        </div>
        <div>
          <h3>Custo e fechamento</h3>
          <ul>
            <li>Os custos reais do pedido (papel, chapa, mão de obra, frete etc.) são lançados por pedido e comparados automaticamente com o valor orçado.</li>
            <li>Ao concluir, dá pra fechar o pedido e ver o lucro final de verdade, não só o estimado.</li>
          </ul>
        </div>
        <div>
          <h3>Entrega e gang run</h3>
          <ul>
            <li>Depois de Expedição, dá pra registrar motorista, data de saída/entrega e o status da entrega (Aguardando → Em trânsito → Entregue, ou Problema se algo sair errado).</li>
            <li><strong>Gang run</strong>: fila de itens Offset pequenos demais pra encher uma chapa sozinhos — você combina manualmente pedidos compatíveis (mesmo papel/gramatura/prensa) pra dividir o custo fixo de chapa e acerto.</li>
            <li>Pedidos com o prazo de entrega vencido aparecem com um aviso de &ldquo;Atrasado&rdquo;.</li>
          </ul>
        </div>
      </div>
    ),
  },
  {
    id: "catalogo",
    titulo: "Catálogo",
    Icone: BoxIcon,
    conteudo: (
      <div className={PROSE}>
        <p>O cadastro de tudo que a gráfica vende ou usa pra produzir.</p>
        <div>
          <h3>Cadastrar um item</h3>
          <ul>
            <li><strong>Produto</strong>: o que você vende pro cliente final.</li>
            <li><strong>Matéria-prima</strong>: papel, tinta, insumo — o que entra na produção.</li>
            <li><strong>Serviço</strong>: acabamentos e afins, cobrados à parte.</li>
          </ul>
        </div>
        <div>
          <h3>Modelo de cálculo de preço de um produto</h3>
          <ul>
            <li><strong>Simples</strong>: preço direto que você digita.</li>
            <li><strong>M2</strong>: calcula pela área do item (metro quadrado).</li>
            <li><strong>Offset</strong>: motor avançado, considera bobina/folha de impressão.</li>
            <li><strong>Flexografia</strong>: motor com máquina flexo + clichê.</li>
            <li><strong>Digital</strong>: custo por clique + substrato.</li>
            <li><strong>Serigrafia / Sublimação / Estampagem a quente / Personalização</strong>: setup fixo (matriz/clichê/arte) mais um custo variável por peça.</li>
            <li><strong>Revenda</strong>: produto comprado pronto de terceiro ou terceirizado, sem máquina envolvida.</li>
          </ul>
        </div>
        <div>
          <h3>Estoque e preços</h3>
          <ul>
            <li>A previsão de estoque é calculada a partir do consumo real dos últimos 60 dias de produção.</li>
            <li>O <strong>reajuste de preços em lote</strong> aumenta ou diminui o preço de vários produtos de uma vez — só funciona pra produtos com cálculo Simples (os outros modelos recalculam sozinhos a partir do custo).</li>
          </ul>
        </div>
      </div>
    ),
  },
  {
    id: "clientes",
    titulo: "Clientes",
    Icone: UsersIcon,
    conteudo: (
      <div className={PROSE}>
        <ul>
          <li><strong>Cadastro</strong>: dados comerciais, contatos e endereços — um cliente pode ter mais de um contato e mais de um endereço.</li>
          <li><strong>Histórico</strong>: os orçamentos e pedidos anteriores desse cliente, tudo num só lugar.</li>
          <li><strong>Bloqueio pra venda</strong> e <strong>bloqueio pra faturamento</strong>: dois bloqueios independentes, cada um com um motivo próprio — dá pra travar um cliente inadimplente sem impedir emitir a nota fiscal de um pedido já entregue, por exemplo.</li>
          <li><strong>Desativar/reativar</strong>: um cliente desativado some das listas normais mas continua no histórico; dá pra reativar a qualquer momento, ou anonimizar os dados dele (LGPD).</li>
        </ul>
      </div>
    ),
  },
  {
    id: "financeiro",
    titulo: "Financeiro",
    Icone: TrendingUpIcon,
    conteudo: (
      <div className={PROSE}>
        <ul>
          <li><strong>Despesas</strong>: lançamento avulso ou recorrente, organizado por categoria de custo (configurável em Configurações).</li>
          <li><strong>Contas a receber</strong>: acompanha cada parcela gerada pelos orçamentos aprovados, com baixa total ou parcial.</li>
          <li><strong>Comissões</strong>: o valor que cada vendedor tem a receber, calculado pelo percentual configurado pra ele.</li>
          <li><strong>Contas prepagas</strong>: saldo tipo &ldquo;vale&rdquo; pra serviços que você recarrega aos poucos e vai debitando aos poucos (ex: uma conta Lalamove) — diferente de lançar o frete direto como custo de um pedido.</li>
          <li><strong>Créditos de clientes</strong>: saldo que um cliente deixou adiantado, pra usar em orçamentos futuros.</li>
          <li><strong>Trilha de auditoria</strong>: quem mudou o quê — não só no financeiro, também no catálogo, usuários e configurações.</li>
          <li><strong>Exportar</strong>: baixa os lançamentos financeiros em planilha.</li>
          <li>O <strong>relatório de lucro</strong> completo (visão geral e filtrável por período e cliente) fica no menu <strong>Meu Negócio</strong>, separado do Financeiro.</li>
        </ul>
      </div>
    ),
  },
  {
    id: "compras",
    titulo: "Compras",
    Icone: LayersIcon,
    conteudo: (
      <div className={PROSE}>
        <div>
          <h3>Como funciona</h3>
          <ul>
            <li>Uma solicitação de compra é sempre pra uma matéria-prima, com uma origem: reposição de estoque, pedido específico, manutenção, consumo interno, contrato programado ou outro.</li>
            <li>Pipeline: <strong>Solicitado → Cotando → Aprovado → Comprado → Recebido → Conferido</strong> (ou Cancelado a qualquer momento).</li>
          </ul>
        </div>
        <div>
          <h3>Cotação e contratos</h3>
          <ul>
            <li>Dá pra registrar várias cotações de fornecedores diferentes pra mesma solicitação e escolher a vencedora.</li>
            <li><strong>Contratos de fornecimento</strong>: uma compra programada e recorrente com um fornecedor fixo.</li>
            <li>Quando a origem é &ldquo;pedido específico&rdquo;, o custo entra automaticamente no pedido de produção correspondente assim que a compra chega em Recebido.</li>
          </ul>
        </div>
      </div>
    ),
  },
  {
    id: "configuracoes",
    titulo: "Configurações",
    Icone: SettingsIcon,
    conteudo: (
      <div className={PROSE}>
        <ul>
          <li><strong>Identidade</strong>: nome, logo e cor da gráfica (aparece no PDF e no link público de orçamento).</li>
          <li><strong>Parâmetros de negócio</strong> (na própria tela inicial de Configurações): margem mínima, limite de desconto sem precisar de aprovação, alertas de prazo, limite de crédito por cliente, comissão base do vendedor, validade padrão do orçamento.</li>
          <li><strong>Fiscal</strong>: dados necessários pra emitir nota fiscal.</li>
          <li><strong>Filiais</strong>, <strong>Fornecedores</strong>, <strong>Categorias de custo</strong> e <strong>Feriados</strong> (usados no cálculo de prazo em dias úteis).</li>
          <li><strong>Máquinas/Equipamentos</strong>: impressão digital, flexografia, prensas, setup por peça e manutenção de equipamentos.</li>
          <li><strong>Automação</strong>: um webhook seu (ex: n8n) que recebe eventos do sistema.</li>
        </ul>
      </div>
    ),
  },
  {
    id: "usuarios",
    titulo: "Usuários",
    Icone: UserIcon,
    conteudo: (
      <div className={PROSE}>
        <p>Só o dono da gráfica vê esse menu.</p>
        <ul>
          <li>Cadastro de cada funcionário que acessa o sistema, com papel (Dono, Admin ou Operador).</li>
          <li><strong>Permissão por módulo</strong>: pra Operador, dá pra escolher exatamente quais módulos ele vê e em quais pode editar (Dono e Admin sempre têm acesso total).</li>
          <li><strong>Responsável por etapa de produção</strong>: define quem pode confirmar cada etapa do pipeline, mesmo sem permissão completa de Produção.</li>
          <li><strong>Responsável administrativo</strong> e <strong>comissão por usuário</strong>: quem responde por tarefas administrativas (ex: nota fiscal) e o percentual de comissão de cada vendedor.</li>
        </ul>
      </div>
    ),
  },
  {
    id: "meu-negocio",
    titulo: "Meu Negócio",
    Icone: BuildingIcon,
    conteudo: (
      <div className={PROSE}>
        <p>
          Visão geral do negócio — orçamentos por status, pedidos por etapa, faturamento e
          alertas — e <strong>relatórios filtráveis por período e cliente</strong> com o lucro
          líquido de verdade. Só aparece pra quem o dono liberou o acesso (em Usuários);
          o próprio dono sempre vê.
        </p>
      </div>
    ),
  },
];

export default async function AjudaPage() {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);

  return (
    <div className="flex flex-1 flex-col">
      <UserNav
        nome={usuario.nome}
        graficaNome={usuario.grafica.nome}
        papel={usuario.papel}
        paginaAtual="/ajuda"
        mostrarMeuNegocio={podeVerMeuNegocio(usuario)}
        modulosVisiveis={await obterModulosVisiveis(usuario)}
      />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Central de Ajuda</h1>
          <p className="mt-1 text-slate-500">
            Pra que serve cada módulo e como fazer as ações do dia a dia. Clique num módulo pra
            abrir.
          </p>
        </div>

        <Card className="mb-6 p-5">
          <p className="mb-3 text-sm font-medium text-slate-500">Nesta página</p>
          <nav className="flex flex-wrap gap-2">
            {SECOES.map((secao) => (
              <a
                key={secao.id}
                href={`#${secao.id}`}
                className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                <secao.Icone className="h-3.5 w-3.5" />
                {secao.titulo}
              </a>
            ))}
          </nav>
        </Card>

        <div className="flex flex-col gap-4">
          {SECOES.map((secao, indice) => (
            <div key={secao.id} id={secao.id} className="scroll-mt-24">
              <Card className="p-0">
                {/* <details> nativo, mesmo padrão de PreflightAvisos.tsx e
                    CustosPedidoSecao.tsx — sem useState, sem "use client".
                    A primeira seção (Orçamento) já nasce aberta por ser o
                    ponto de entrada mais comum do dia a dia. */}
                <details open={indice === 0} className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 marker:content-none">
                    <secao.Icone className="h-5 w-5 shrink-0 text-teal-600 dark:text-teal-400" />
                    <span className="text-base font-semibold text-slate-900 dark:text-white">
                      {secao.titulo}
                    </span>
                  </summary>
                  <div className="border-t border-slate-100 px-5 py-4 dark:border-slate-800">
                    {secao.conteudo}
                  </div>
                </details>
              </Card>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
