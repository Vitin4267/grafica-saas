import "server-only";
import { tenantAtual } from "@/lib/tenant-context";

// Achado da auditoria de segurança (2026-09-13) — Fase A do isolamento à
// prova de falhas (ver justificativa completa no plano de segurança e em
// src/lib/tenant-context.ts). Extensão do Prisma ($allOperations, aplicada
// em src/lib/prisma.ts).
//
// NÃO é RLS — é uma rede de segurança na camada de aplicação, escopada de
// propósito (ver "Por que RLS puro não cabe nesta rodada" no plano):
// 49 dos 106 models não têm graficaId, ~14 rotas não têm sessão de
// usuário, e o app conecta como dono da tabela (RLS não pegaria mesmo se
// ligado). Este guard cobre os 58 models que TÊM graficaId direto.
//
// HISTÓRICO IMPORTANTE — por que a checagem NÃO é "graficaId sempre
// presente": a primeira versão exigia presença em TODA leitura em massa
// (findMany/findFirst/aggregate/count/groupBy). Rodando a suíte de testes
// contra essa versão, ela disparou em queries genuinamente corretas —
// `ContaReceber` (TEM graficaId) filtrada por `orcamento: { clienteId }`
// (src/lib/exposicao-credito-cliente.ts), `ApontamentoEtapa` (TEM
// graficaId) filtrada por `pedidoId` (src/app/producao/status-transicao.ts)
// — porque o idioma DOMINANTE deste repo pra leitura é "escopar pelo ID do
// PAI já validado pelo caller" (pedidoId/orcamentoId/clienteId), não
// graficaId repetido em toda query. Confirmado por amostragem ampla: esse
// padrão aparece em findMany/findFirst/aggregate por igual, não é caso
// isolado. Exigir presença ali teria exigido uma lista de semTenant() do
// tamanho de dezenas de call sites — na prática, treinar o time (e a mim
// mesmo) a tratar semTenant() como carimbo de borracha em vez de exceção
// revisada. Descartado.
//
// O que sobrou, e por que CADA PARTE é segura de aplicar sem falso
// positivo:
//
// 1) PRESENÇA — só em create/createMany/createManyAndReturn. Ao criar uma
//    linha nova, o graficaId SEMPRE é um valor conhecido no escopo de quem
//    chama (usuario.graficaId ou params.graficaId) — não existe "criar sem
//    saber de qual tenant é". Confirmado por amostragem ampla (custo-pedido.ts,
//    apontamento-etapa.ts, entrega-actions.ts, aprovacao-producao-actions.ts,
//    auditoria.ts...): 100% dos creates verificados já incluem graficaId
//    direto em `data`. Nenhum falso positivo esperado aqui.
//
// 2) WHERE NÃO-VAZIO — em updateMany/deleteMany/updateManyAndReturn. Não
//    exige graficaId (o idioma de CAS pós-ownership-já-verificada é comum
//    aqui: `updateMany({ where: { id, status: X } })`, sem graficaId,
//    porque um findFirst anterior já confirmou id+graficaId — 39 updateMany
//    no repo, vários nesse formato em status-transicao.ts). Só bloqueia o
//    caso inequivocamente errado: where ausente/vazio, que mexeria em TODAS
//    as linhas de TODOS os tenants de uma vez — isso nunca é intencional.
//
// 3) VALOR — a checagem que realmente carrega o peso do isolamento.
//    Sempre que graficaId aparece EM QUALQUER LUGAR de uma query (data OU
//    where, em QUALQUER operação, inclusive findUnique/update/delete
//    singulares) E há um tenant ativo no request (tenantAtual()), o valor
//    tem que BATER com o tenant logado. Nunca exige que graficaId apareça —
//    só que, SE aparecer, esteja certo. Pega o bug mais perigoso e mais
//    fácil de escrever por engano: usar o graficaId ERRADO (variável
//    trocada, copy-paste de outro bloco, id vindo de um lugar errado) — sem
//    nenhum falso positivo possível, porque só dispara quando o próprio
//    código forneceu um graficaId que não bate.
//
// Nenhuma das checagens dispara dentro de semTenant() (cron cross-tenant,
// webhook do Stripe, etc — ver tenant-context.ts) nem em operações fora da
// lista de MODELOS_COM_GRAFICA_ID.
//
// Lacuna conhecida, deliberada: uma query que ESQUECE completamente de
// escopar (nem por graficaId nem por um id de pai já validado) e não é
// create/createMany/updateMany-vazio NÃO é pega por este guard — pegar isso
// de verdade exigiria RLS de verdade (Fase B) ou uma auditoria modelo a
// modelo do idioma de scoping de cada um dos 58 models, maior que cabe
// nesta rodada. Documentado explicitamente, não escondido.

const MODELOS_COM_GRAFICA_ID = new Set([
  "AlcadaAprovacao",
  "AnaliseTintaLog",
  "ApontamentoEtapa",
  "AprovacaoProducao",
  "ArquivoArmazenado",
  "AssinaturaGrafica",
  "AutomacaoGrafica",
  "CategoriaCusto",
  "Cliente",
  "Colaborador",
  "Comissao",
  "CondicaoPagamento",
  "ContaFinanceira",
  "ContaPrepaga",
  "ContaReceber",
  "ContratoFornecimento",
  "CorEspecialCliente",
  "CustoPedido",
  "DadosFiscaisGrafica",
  "Despesa",
  "Entrega",
  "Equipamento",
  "EtapaGrafica",
  "EtapaTerceirizada",
  "FeriadoGrafica",
  "Ferramental",
  "FilaGangRun",
  "Filial",
  "Fornecedor",
  "GrupoGangRun",
  "ImportacaoPlanilha",
  "ImpressoraDigital",
  "ItemCatalogo",
  "ItemGrafica",
  "LogAuditoria",
  "MaquinaBordado",
  "MaquinaFlexografia",
  "MaquinaSetupPorPeca",
  "MaquinaTempo",
  "NotaFiscal",
  "Orcamento",
  "OrcamentoEntregaProgramada",
  "ParadaPedido",
  "ParametrosGrafica",
  "Pedido",
  "PedidoCustoPrevisto",
  "PerfilAcesso",
  "PerguntaAssistenteLog",
  "Prensa",
  "PrestadorServico",
  "RegistroManutencao",
  "RegraComissao",
  "RetencaoContaReceber",
  "SolicitacaoCompra",
  "TaxaFormaPagamento",
  "Transportadora",
  "Usuario",
]);

// Fase B do isolamento (RLS real no Postgres, 2026-09-17) — subconjunto de
// MODELOS_COM_GRAFICA_ID acima que JÁ TEM `ENABLE ROW LEVEL SECURITY`
// ligado no banco (ver migration em prisma/migrations e o plano em
// ~/.claude/plans/deep-zooming-parasol.md). Começa só com o piloto de 5
// tabelas — cada modelo aqui listado faz src/lib/prisma.ts embrulhar toda
// operação solta (fora de transação) numa transação extra só pra setar
// `app.grafica_id`/`app.bypass_rls` antes da query real, o que custa 1
// round-trip a mais por chamada. Deliberadamente SEPARADO de
// MODELOS_COM_GRAFICA_ID (que é sobre "tem a coluna", não "tem RLS ligado
// no banco de verdade") — só cresce quando uma migration nova liga RLS
// numa tabela a mais, nunca antes.
// Lote 2 (2026-09-18) — expansão pra 15 tabelas a mais depois do piloto de
// 5 confirmado estável em produção. ItemCatalogo tem uma nuance: seu
// `graficaId` é NULLABLE (null = catálogo mestre compartilhado entre TODAS
// as gráficas, preenchido = item privado — ver comentário no schema,
// 06-catalogo.prisma) — a policy de tenant_isolation dela é diferente das
// outras por causa disso (ver migration.sql do lote 2, item ESPECIAL).
export const MODELOS_COM_RLS_ATIVO = new Set([
  "Cliente",
  "ContaReceber",
  "DadosFiscaisGrafica",
  "Pedido",
  "Entrega",
  "ParametrosGrafica",
  "Filial",
  "Orcamento",
  "Fornecedor",
  "ItemCatalogo",
  "ItemGrafica",
  "Usuario",
  "PerfilAcesso",
  "ContaFinanceira",
  "Despesa",
  "ContaPrepaga",
  "Comissao",
  "RegraComissao",
  "CategoriaCusto",
  "CustoPedido",

  // Achado real de produção (2026-09-18, Sentry pegou em /orcamento) —
  // categoria DIFERENTE dos nomes acima. Estes 6 models NÃO têm (nem vão
  // ganhar) RLS na própria tabela — entram aqui só porque cada um faz
  // include/select aninhado pra dentro de Cliente/Pedido/ContaReceber (RLS
  // já ativo em produção desde o piloto). O $allOperations só embrulha o
  // model do TOPO da chamada — sem entrar aqui, a query roda sem
  // app.grafica_id setado, a policy de RLS nega a linha aninhada, e o
  // Prisma devolve null onde o schema promete um objeto obrigatório
  // (mesmo mecanismo do bug do /orcamento, ver commit que introduziu este
  // comentário). Achados confirmados lendo cada call site até o consumo
  // (não só o include): CreditoCliente→cliente (creditos-clientes/page.tsx),
  // SolicitacaoCompra→pedido→orcamento→cliente (compras/[id]/page.tsx,
  // guardado com "&&", mas escondia silenciosamente o link do pedido),
  // Ferramental→cliente (ferramentais/page.tsx, idem, mostrava "Da gráfica"
  // errado pro dono de um ferramental que É do cliente), EtapaTerceirizada→
  // pedido→orcamento→cliente/filialId (alerta-atraso.ts, crasha dentro de
  // um after() de webhook; terceirizacao-nfe-actions.ts, crasha emitindo
  // NF-e de remessa), FilaGangRun→pedido→orcamento→cliente (gang-run-servico.ts,
  // crasha a fila de Gang Run inteira), RetencaoContaReceber→contaReceber
  // (contas-receber/actions.ts, crasha excluindo retenção de imposto).
  "CreditoCliente",
  "SolicitacaoCompra",
  "Ferramental",
  "EtapaTerceirizada",
  "FilaGangRun",
  "RetencaoContaReceber",

  // Achado do INCIDENTE de 2026-09-18 (não do achado acima) — o fix do
  // bug de /orcamento tinha um furo: adicionar `semTenant(...)` num call
  // site (session.ts, login/actions.ts, registro/actions.ts) só funciona
  // se o model do TOPO daquela chamada específica também estiver NESTE
  // Set. `semTenant` estabelece "isento" no AsyncLocalStorage, mas é
  // `$allOperations` (src/lib/prisma.ts) quem LÊ esse estado e de fato
  // chama `construirSetConfigRaw` — e ele só faz isso quando
  // `MODELOS_COM_RLS_ATIVO.has(model)` do TOPO da chamada é true. Sessao
  // faltando aqui foi o motivo do fix de auth ter subido e continuado
  // quebrado: prisma.sessao.findUnique({ include: { usuario } }) tem
  // `model = "Sessao"`, não "Usuario" — sem Sessao aqui, o wrap nunca
  // acontecia, bypass_rls nunca era setado, RLS de Usuario continuava
  // negando a linha aninhada. Grafica entra pelo mesmo motivo: o
  // deleteMany de conta abandonada em registro/actions.ts filtra por
  // `usuarios: { every: {...} }` (relação pra dentro de Usuario) com
  // `model = "Grafica"`.
  "Sessao",
  "Grafica",

  // Mesma classe de bug do achado acima (Sessao/Grafica, incidente
  // 18/09), achada de novo em produção (2026-09-21) — botão de aprovar
  // orçamento quebrando com "Cannot read properties of null (reading
  // 'itemCatalogo')". atualizarStatusOrcamento (src/app/orcamento/[id]/
  // actions/status.ts) faz `prisma.orcamentoItem.findMany({ where: {
  // orcamentoId, opcaoId }, include: { itemGrafica: { itemCatalogo } }
  // })` — o TOPO da chamada é OrcamentoItem (sem graficaId próprio,
  // nunca precisou de policy dele mesmo), mas o include aninhado toca
  // ItemGrafica/ItemCatalogo, que TÊM RLS ativo. Sem OrcamentoItem aqui,
  // o wrap nunca disparava pra essa chamada — se tenantAtual() já tivesse
  // se perdido a essa altura da action, o join aninhado voltava null em
  // silêncio (RLS fail-closed na tabela filha) em vez de dar erro
  // explícito, e o código seguinte (`item.itemGrafica.itemCatalogo`)
  // explodia. OrcamentoItem não tem policy própria no Postgres (nunca
  // precisou, RLS_LOTE nenhum ligou nela) — entrar aqui só garante que o
  // set_config da transação fica visível pros JOINs aninhados, mesmo
  // mecanismo do achado do Sessao/Grafica acima.
  "OrcamentoItem",
]);

const OPERACOES_CREATE = new Set(["create", "createMany", "createManyAndReturn"]);
const OPERACOES_ESCRITA_BULK = new Set(["updateMany", "updateManyAndReturn", "deleteMany"]);

// Extrai todo valor de `graficaId` encontrado no objeto — desce só em AND/
// OR/NOT (os combinadores booleanos do MESMO model, uso comum no repo),
// nunca em filtro de relação aninhada (`orcamento: { graficaId }` é de
// OUTRO model, semântica diferente — e sobretudo, ver o histórico acima,
// NÃO participa mais de checagem de presença, só reforça o motivo de não
// precisar descer em relação). Também aceita a forma
// `{ graficaId: { equals: "x" } }` (Prisma permite filtro por operador);
// qualquer outra forma de operador (in/not/gt...) conta como PRESENTE mas
// não participa da checagem de VALOR (não dá pra reduzir com segurança a
// um "bate/não bate" contra um tenant só).
export function extrairGraficaIds(valor: unknown, profundidade = 0): string[] {
  if (profundidade > 4 || valor === null || typeof valor !== "object") return [];
  const encontrados: string[] = [];
  for (const [chave, item] of Object.entries(valor as Record<string, unknown>)) {
    if (chave === "graficaId") {
      if (typeof item === "string") {
        encontrados.push(item);
      } else if (item && typeof item === "object" && typeof (item as { equals?: unknown }).equals === "string") {
        encontrados.push((item as { equals: string }).equals);
      } else {
        encontrados.push("__presente_forma_nao_comparavel__");
      }
    } else if (chave === "AND" || chave === "OR" || chave === "NOT") {
      const itens = Array.isArray(item) ? item : [item];
      for (const sub of itens) encontrados.push(...extrairGraficaIds(sub, profundidade + 1));
    }
  }
  return encontrados;
}

class ErroIsolamentoTenant extends Error {
  constructor(mensagem: string, detalhes: Record<string, unknown>) {
    super(`[isolamento-tenant] ${mensagem} — ${JSON.stringify(detalhes)}`);
    this.name = "ErroIsolamentoTenant";
  }
}

export function conferirIsolamentoTenant(params: {
  model?: string;
  operation: string;
  args: { where?: unknown; data?: unknown } & Record<string, unknown>;
}): void {
  const { model, operation, args } = params;
  if (!model || !MODELOS_COM_GRAFICA_ID.has(model)) return;

  const estado = tenantAtual();
  if (estado?.tipo === "isento") return;
  const tenantAtivo = estado?.tipo === "tenant" ? estado.graficaId : null;

  // 1) Presença — só create/createMany (ver histórico acima pra por que
  // leitura em massa NÃO exige mais presença).
  if (OPERACOES_CREATE.has(operation)) {
    const linhas = Array.isArray(args.data) ? args.data : [args.data];
    linhas.forEach((linha, indice) => {
      const ids = extrairGraficaIds(linha, 0);
      if (ids.length === 0) {
        throw new ErroIsolamentoTenant(`${operation} em ${model} sem graficaId em data`, {
          model,
          operation,
          indice,
        });
      }
      conferirValor(ids, tenantAtivo, model, operation);
    });
    return;
  }

  // 2) Escrita em massa — nunca where vazio/ausente (mexeria em todo
  // tenant), sem exigir graficaId especificamente (idioma de CAS
  // pós-ownership já verificada pelo caller).
  if (OPERACOES_ESCRITA_BULK.has(operation)) {
    const where = args.where as Record<string, unknown> | undefined;
    if (!where || Object.keys(where).length === 0) {
      throw new ErroIsolamentoTenant(`${operation} em ${model} com where vazio/ausente`, { model, operation });
    }
    conferirValor(extrairGraficaIds(where, 0), tenantAtivo, model, operation);
    return;
  }

  // 3) Resto (findMany/findFirst/count/aggregate/groupBy, findUnique,
  // update/delete/upsert singulares, raw...): SEM checagem de presença —
  // só a checagem de VALOR, quando graficaId aparecer de qualquer jeito
  // (where ou data). É esta checagem que carrega o peso real do
  // isolamento neste guard — ver comentário "3) VALOR" acima.
  conferirValor(
    [...extrairGraficaIds(args.where, 0), ...extrairGraficaIds(args.data, 0)],
    tenantAtivo,
    model,
    operation
  );
}

function conferirValor(ids: string[], tenantAtivo: string | null, model: string, operation: string): void {
  if (!tenantAtivo) return;
  for (const id of ids) {
    if (id === "__presente_forma_nao_comparavel__") continue;
    if (id !== tenantAtivo) {
      throw new ErroIsolamentoTenant(`${operation} em ${model} com graficaId de OUTRO tenant`, {
        model,
        operation,
        tenantAtivo,
        graficaIdNaQuery: id,
      });
    }
  }
}
