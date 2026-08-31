# Auditoria de abrangência — GrafPro (pesquisa, não implementado)

## O que é o GrafPro

GrafPro é um SaaS multi-tenant (Next.js + Prisma/Postgres, deployado na
Vercel com banco Neon) pra gráficas brasileiras — cada gráfica é um tenant
isolado, com seu próprio catálogo, motor de precificação, orçamentos,
produção, financeiro, compras, clientes e configurações. Está em produção
real, com uma gráfica física de verdade como cliente-piloto (Assus
Graphics, especializada em rótulos/etiquetas — dono do GrafPro é filho do
dono da Assus). O produto nasceu resolvendo o problema real dessa gráfica
específica, mas o objetivo é vender pra **centenas de gráficas de perfis
muito diferentes**: comunicação visual/banner, estamparia/camiseta,
brindes, editorial/livro, embalagem/cartonagem, corte a laser/acrílico,
DTF, bordado, serigrafia, rótulos, offset comercial etc.

## O princípio por trás desta auditoria

Diretriz permanente do dono do produto: cada módulo do sistema precisa
cobrir o universo real de tipos de gráfica que vão usar o SaaS, não só o
perfil da gráfica-piloto (Assus). Ou seja, procurar sistematicamente pontos
onde o produto assume implicitamente "toda gráfica funciona como a Assus"
quando o mercado brasileiro real é mais variado — desde um campo que falta
no cadastro até um motor de cálculo inteiro que não existe pra um tipo de
processo de impressão/personalização.

## Como esta auditoria foi conduzida

Rodada por rodada, um subagente por vez (Opus nas Partes 1-6, nunca em
paralelo por economia de token; a Parte 7, adicionada em 2026-08-30, usou
5 subagentes haiku em paralelo — pesquisa mais rápida e barata, ver nota
no início da Parte 7), cada um **só pesquisando e planejando** — sem
acesso de escrita, sem tocar em código. Cada subagente recebeu uma
briefing completa (o que é o produto, o princípio acima, o estado atual
do módulo verificado no schema/código, achados de rodadas anteriores pra
não redescobrir o que já foi achado) e devolveu um relatório em texto,
que foi colado aqui (Partes 1-6 sem edição de conteúdo; Parte 7 condensada
pela thread principal pro estilo do resto do documento). A pesquisa
favorece fontes reais (blogs de gráfica brasileira, documentação fiscal,
ERPs concorrentes, fóruns do setor) citadas com link; quando não havia
fonte externa aplicável, o relatório marca explicitamente
"(inferência minha)".

**Total catalogado:** 88 achados nas Partes 1-6 + 24 achados na Parte 7
seções A-E (haiku) + 9 achados na Parte 7 seção F (Opus, 2026-08-31) =
**121 achados**.

**Nada aqui foi implementado ainda** — é material bruto de pesquisa, a
base pra decidir o que atacar. Duas exceções: os achados "motor de preço
Digital/Serigrafia/Sublimação/Estampagem" e "NF-e fora do Simples
Nacional" da Parte 1 **já foram construídos e estão em produção** (rodada
anterior a esta auditoria completa) — se algum achado das partes
seguintes mencionar isso, é só contexto, não é mais gap.

**Atualização 2026-08-24 — 3 achados adicionais CONSTRUÍDOS e em produção**
(rodada "resolver os achados mais graves", ver detalhe em cada achado
abaixo):
- **A1 da Parte 1** (METRO_LINEAR/HORA inalcançáveis) — corrigido.
- **A2 da Parte 5** (CNPJ alfanumérico mutilado na emissão) — corrigido só
  o bug de mutilação em `focus-nfe.ts`; o resto da proposta (validação de
  dígito verificador, normalização no cadastro do cliente) segue como gap.
- **A1 da Parte 6** (8 parâmetros sem tela) — os 5 já lidos pelo motor
  foram destravados, e os 3 que não tinham NENHUM código consumindo
  (`comissaoEntraNoCustoPedido`, `perdaEhCustoDoPedido`,
  `diasPrecoInsumoDesatualizado`) ganharam implementação real, não só tela.

**Atualização 2026-08-24 (rodada 2) — mais 3 achados CONSTRUÍDOS** (3
subagentes em paralelo, "resolver mais pendências urgentes"):
- **A3 da Parte 6** (auditoria cobre só 2 de 14 telas) — `registrarAuditoria`
  adicionado a 11 arquivos de Configurações (máquinas, fiscal, filiais,
  automação, identidade, categorias-custo), token Focus NFe e webhook
  nunca logados por valor. `assinatura/actions.ts` ficou de fora
  deliberadamente (fluxo Stripe hospedado, não escreve parâmetro local).
- **A14 (correção) da Parte 4** (despesa recorrente perde `categoriaCustoId`)
  — corrigido, 1 linha.
- **A9 da Parte 5** (Cliente só hard-delete, sem `updatedAt`/desativação/LGPD)
  — `desativadoEm`, `bloqueadoParaVenda`+`motivoBloqueio`, `updatedAt`
  adicionados; actions `desativarCliente`/`reativarCliente`/`anonimizarCliente`;
  dropdowns de cliente (orçamento, produção, relatórios) filtram
  `desativadoEm: null`. **CONSTRUÍDO 2026-08-24 (rodada 3)**: aviso
  não-bloqueante de `bloqueadoParaVenda` na aprovação de orçamento —
  `atualizarStatusOrcamento` (`src/app/orcamento/[id]/actions.ts`) passou a
  ler `cliente.bloqueadoParaVenda`/`motivoBloqueio` junto do orçamento e
  devolve `aviso` no resultado quando aprova um orçamento de cliente
  bloqueado (aprovação continua acontecendo — não existe fluxo de "aprovação
  forçada" no produto, então bloquear a ação seria pior que avisar);
  `OrcamentoAcoes.tsx` renderiza esse aviso num `<Alert variant="warning">`
  mesmo no caminho de sucesso do APROVADO (que normalmente esconde
  `mensagem` pra dar lugar ao check verde animado). Só o painel autenticado
  (staff aprovando em nome do cliente) mostra o aviso — o link público de
  aprovação (`/o/[token]`) é o próprio cliente aprovando, não faz sentido
  avisar o cliente que ele está bloqueado. 2 testes de integração novos em
  `src/app/orcamento/[id]/actions.aviso-bloqueio.test.ts`.

**Atualização 2026-08-24 (rodada 4) — mais 3 achados CONSTRUÍDOS** (3
subagentes em paralelo, "resolver mais pendências urgentes"):
- **A2 (resto) da Parte 5** (CNPJ alfanumérico mutilado) — o CNPJ da própria
  gráfica (emitente) tinha o mesmo bug já corrigido pro destinatário na
  rodada 1: `cnpj_emitente: input.emitente.cnpj.replace(/\D/g, "")` apagava
  letras de CNPJ alfanumérico. Nova função `normalizarCnpjEmitente` em
  `src/lib/focus-nfe.ts`, reaproveitando o `limparDocumento` interno da
  correção anterior. 5 testes novos.
- **A17 da Parte 4** (`CustoPedido` fora da trilha de auditoria) —
  `lancarCustoPedido`/`excluirCustoPedido` já tinham `registrarAuditoria`
  desde a fase "custo real" (achado estava desatualizado nesse ponto); só
  faltava mesmo o estorno em `cancelarPedido`, agora instrumentado (ação
  `custo_pedido.estornar`, diff via `criarDiffCampos`). `CustoPedido`
  adicionado a `CORES_ENTIDADE` em `financeiro/auditoria/page.tsx`. 2 testes
  de integração novos.
- **A13 da Parte 5** (listagem de clientes não escala) — `/clientes` ganhou
  busca por nome/documento + paginação real (50/página) via `searchParams`,
  mantendo o filtro `desativadoEm: null`. Escopo deliberadamente contido: os
  outros 4 lugares que carregam a base inteira pra popular `<select>`
  (orçamento, produção, relatórios) não foram tocados — isso é combobox com
  busca server-side, fica pra outra rodada.

**Atualização 2026-08-24 (rodada 5) — mais 2 achados CONSTRUÍDOS** (2
subagentes em paralelo, "só corrija 2 coisas"):
- **A2 da Parte 1** (setup-por-peça sem custo de substrato) — SERIGRAFIA,
  SUBLIMACAO e ESTAMPAGEM_QUENTE precificavam camiseta/caneca/boné/squeeze
  com custo ZERO da peça em branco (o `breakdown` mentia o lucro por uma
  ordem de grandeza). Novo `ContextoSetupPorPeca` espelhando
  `ContextoDigital.custoSubstratoPorPeca`, carregado a partir de
  `item.precoCompra` em `carregar.ts`, somado ao `custoBase` em
  `calcularSetupPorPeca`. Nenhuma migration necessária.
- **A3 da Parte 5** (CFOP fixo ignora UF do cliente) — primeira venda
  interestadual saía com CFOP interno (`5102`) errado, sempre, em silêncio.
  Novo `DadosFiscaisGrafica.cfopPadraoInterestadual`/
  `DadosFiscaisFilial.cfopPadraoInterestadual` (default `"6102"`) + função
  pura `resolverCfop()` em `src/lib/nota-fiscal.ts`, usada na emissão.
  Migration aditiva aplicada ao banco de dev com aprovação explícita
  (mesmo procedimento seguro das rodadas anteriores — hand-written +
  `db execute` + `migrate resolve`). Escopo contido: distinção
  contribuinte × não-contribuinte (6102 vs 6108 + DIFAL) fica de fora,
  registrada como gap remanescente no achado.

Verificação da rodada: `tsc --noEmit` limpo, 809/809 testes (76 arquivos)
passando com a migration já aplicada, `npm run build` OK.

**Atualização 2026-08-24 (rodada 6) — mais 2 achados CONSTRUÍDOS** (2
subagentes em paralelo; um deles atingiu o limite de gasto mensal da conta
no meio da tarefa e foi retomado/concluído diretamente por mim, sem novo
subagente):
- **B1 da Parte 1** (`TipoFrete` só 2 das 6 modalidades NF-e) — bug irmão
  corrigido junto: `focus-nfe.ts` mandava `modalidade_frete` fixo em `"9"`,
  ignorando o frete real do orçamento. Enum expandido (RENAME VALUE + ADD
  VALUE, mesma técnica de `StatusPedido`) + `resolverModalidadeFrete()`
  nova em `nota-fiscal.ts`.
- **A3 da Parte 1** (`ProcessoSetupPorPeca` sem escape `OUTRO`) —
  `ModeloCalculo.PERSONALIZACAO` + 5 processos novos (tampografia, gravação
  a laser, DTG, transfer, outro) destravam brindes/personalização, mesmo
  motor `calcularSetupPorPeca` de sempre. O subagente que fez esta parte
  caiu no meio do trabalho por limite de gasto — ao retomar, encontrei e
  corrigi 5 pontos de UI em `src/app/orcamento/` que ainda checavam só os 3
  literais antigos (SERIGRAFIA/SUBLIMACAO/ESTAMPAGEM_QUENTE) pra decidir se
  mostravam o motor avançado/campo de setups — sem isso, item PERSONALIZACAO
  cairia silenciosamente no motor SIMPLES (custo zero) na calculadora. Também
  faltava o campo condicional `tipoProcessoOutro` nos 2 formulários de
  cadastro de máquina — adicionado seguindo o mesmo padrão de
  `categoriaOutro` em Equipamentos.

Ambas as migrations desta rodada (aditivas) aplicadas ao banco de dev com
aprovação explícita. Verificação: `tsc --noEmit` limpo, 816/816 testes (76
arquivos) passando, `npm run build` OK.

**Atualização 2026-08-24 (rodada 7) — mais 2 achados CONSTRUÍDOS** (2
subagentes em paralelo):
- **A12 da Parte 1** (revenda/terceirização sem motor de custo real) — novo
  `ModeloCalculo.REVENDA`, `custoBase = Q × custoAquisicaoUnitario` passando
  pelo `comporPreco` de sempre (ganha overhead/margem/piso/breakdown, ao
  contrário de SIMPLES). Instruí o subagente a fazer, ao final, a mesma
  varredura exaustiva que faltou na rodada 6 (grep de todo lugar que decide
  comportamento por `ModeloCalculo`) — encontrou e corrigiu sozinho um bug
  de silent-failure em `catalogo/[itemGraficaId]/actions.ts`: salvar um
  produto como REVENDA **ou** PERSONALIZACAO (rodada 6) retornava "sucesso"
  sem gravar nada.
- **A11 da Parte 5** (Cliente sem observação interna nem origem) —
  `observacoes`/`preferenciasProducao`/`origem`+`origemOutro`, incluindo
  threading pela importação de planilha e exibição na Ordem de Produção.

Ambas as migrations (aditivas) aplicadas ao banco de dev com aprovação
explícita. Verificação: `tsc --noEmit` limpo, 822/822 testes (77 arquivos)
passando, `npm run build` OK.

**Atualização 2026-08-24 (rodada 8) — mais 2 achados CONSTRUÍDOS** (2
subagentes em paralelo):
- **B7 da Parte 1** (flag "material fornecido pelo cliente") — **corrige uma
  regressão real que o nosso próprio trabalho recente causou**: depois de A2
  (rodada 5) passar a cobrar o substrato em DIGITAL/SERIGRAFIA/SUBLIMACAO/
  ESTAMPAGEM_QUENTE/PERSONALIZACAO, toda gráfica onde o cliente traz a peça
  em branco (padrão comum em estamparia) passou a ser cobrada por um
  material que nunca comprou. `OrcamentoItem.materialFornecidoPeloCliente`
  zera o substrato quando marcado. Achado extra na verificação: um guard
  pré-existente de "silêncio" em `validarPedidoDigital` barrava o zero
  intencional com a mesma mensagem de "esqueceu de configurar preço" —
  corrigido com `ContextoDigital.materialFornecidoPeloCliente`.
- **B2 da Parte 1** (sem tolerância de tiragem ±%) — `Orcamento.toleranciaTiragemPercent`,
  mesmo mecanismo de snapshot-no-envio de `validoAteEm`, impresso no PDF.

Ambas as migrations (aditivas) aplicadas ao banco de dev com aprovação
explícita, apesar de conectividade instável ao Neon durante a aplicação
(retries necessários — nenhum dado em risco, `db execute` é idempotente por
natureza da migration ser aditiva). Verificação: `tsc --noEmit` limpo,
827/827 testes (78 arquivos) passando, `npm run build` OK.

**Atualização 2026-08-24 (rodada 9) — mais 3 achados PARCIALMENTE
CONSTRUÍDOS** (3 subagentes em paralelo, incluindo 1 Haiku pra tarefa
puramente aditiva):
- **A8 da Parte 6** (identidade/contato só no nível da gráfica, PDF sem
  CNPJ/telefone/e-mail) — bloco de contato comercial (`telefone`/
  `emailContato`/`site`/`enderecoResumido`) editável em
  `/configuracoes/identidade`, impresso no rodapé do PDF. Identidade por
  filial fica de fora (a própria pesquisa já marcava como prioridade baixa).
- **B6 da Parte 1** (linha de orçamento presa ao catálogo, sem descrição
  própria) — `OrcamentoItem.descricaoLivre` sobrepõe o nome do catálogo no
  PDF/link público. `itemGraficaId` continua obrigatório de propósito (a
  parte "item sem catálogo" do achado é escopo maior).
- **A9 da Parte 6** (roteamento de notificação hardcoded) —
  `AreaAdministrativa.PRAZO_PRODUCAO` reaproveita o mecanismo já existente
  pra Nota Fiscal; alerta de prazo agora pode ir pra um responsável
  dedicado em vez de todo DONO, com fallback pro comportamento de hoje
  quando ninguém for configurado. A tela de responsáveis virou tabela
  funcionário × área — o próprio comentário do componente já previa esse
  dia ("no dia que uma segunda área existir..."). `COBRANCA`/`COMPRAS`
  ficam de fora.

Todas as 3 migrations (aditivas) aplicadas ao banco de dev com aprovação
explícita, com a mesma instabilidade intermitente de conexão ao Neon já
vista antes (retries resolveram, sem risco aos dados). Verificação:
`tsc --noEmit` limpo, 832/832 testes (79 arquivos) passando, `npm run build`
OK.

**Atualização 2026-08-24 (rodada 10) — mais 2 achados CONSTRUÍDOS** (2
subagentes em paralelo; o de A7/Clientes atingiu o limite de gasto mensal
da conta no meio da tarefa pela segunda vez nesta sessão — retomado
diretamente por mim, sem novo subagente):
- **A13 da Parte 1** (bases de cobrança MILHEIRO/CENTO faltando) —
  aritmética trivial (`qtd/1000`, `qtd/100`), sem risco de custo silencioso.
- **A7 da Parte 5** (sem segmento de cliente nem margem diferenciada) —
  `Cliente.segmento`/`margemPadraoOverride` ligados a um gancho que o motor
  de preço já tinha pronto e nunca usado
  (`ContextoPrecificacao.margemLucroOverride`, plumbado em todos os 7
  branches desde sempre). O subagente completou o cadastro/formulário
  inteiro antes de cair; faltava só o fio final — 5 pontos em
  `src/app/orcamento/actions.ts`/`[id]/actions.ts`/`opcoes.actions.ts` que
  ainda não buscavam `cliente.margemPadraoOverride` nem repassavam pro
  motor. Corrigido e coberto por um teste de integração novo que confirma o
  preço final muda de verdade com o override (não só que compila).

Ambas as migrations (aditivas) aplicadas ao banco de dev com aprovação
explícita, mesma instabilidade intermitente de conexão ao Neon de sempre
(retries resolveram). Verificação: `tsc --noEmit` limpo, 840/840 testes (80
arquivos) passando, `npm run build` OK.

**Atualização 2026-08-27 (rodada 11) — mais 3 achados CONSTRUÍDOS** (3
subagentes em paralelo, primeira rodada depois de commitar as 10
anteriores):
- **A6 da Parte 6** (nada no schema diz que tipo de gráfica o tenant é) —
  `Grafica.segmento`/`segmentoOutro` (10 valores + OUTRO), respondido de
  forma opcional e não-bloqueante em `/configuracoes/identidade`.
  `CATEGORIAS_CUSTO_SUGERIDAS` virou `Record<SegmentoGrafica | "PADRAO",
  string[]>` com listas curadas pra cada segmento; `dados-exemplo.ts` ganhou
  pacotes de Comunicação Visual e Estamparia além do pacote Offset
  original; e `listarPendenciasConfiguracao` ganhou a checagem genérica
  `MAQUINA_NAO_VINCULADA` (item de maior retorno do achado: produto OFFSET
  sem prensa, DIGITAL sem impressora etc. antes só quebrava em silêncio na
  hora de orçar, com `ErroPrecificacao` — agora vira pendência visível).
  `segmento` é só descritivo, nunca restritivo.
- **A2 da Parte 6** (PDF promete "dias úteis" sem calendário nenhum por
  trás) — `ParametrosGrafica.prazoEmDiasUteis`/`diasFuncionamento` (bitmask
  seg-dom) + `model FeriadoGrafica` novo (por gráfica, nunca um calendário
  nacional único — Carnaval é feriado estadual no Rio e não em SP). Novo
  helper `somarDiasUteis` em `src/lib/dias-uteis.ts` (deliberadamente NÃO
  em `data.ts`, que é importado por componente cliente — evita vazar
  Prisma pro bundle do browser); tela de aprovação passa a SUGERIR
  `prazoEntrega` a partir do prazo estimado (campo continua editável);
  `alerta-prazo-email.ts` conta em dia útil quando o tenant cota assim, só
  no caminho "ainda não venceu" (o "venceu há N dias" continua em dias
  corridos — "atraso em dias úteis" não é um conceito que faça sentido
  aí); PDF deriva o texto ("dias úteis" vs. "dias corridos") do parâmetro
  em vez do literal fixo de sempre. Tela nova `/configuracoes/feriados`
  (CRUD), semeia os 8 feriados nacionais fixos na primeira abertura, mesmo
  padrão lazy-bootstrap de `garantirCategoriasCustoPadrao`.
- **A8 da Parte 5** (sem vendedor atribuído ao cliente — comissão sempre
  vai pra quem DIGITOU o orçamento, não pra quem vendeu) —
  `Cliente.vendedorId` (FK `Usuario`) +
  `ParametrosGrafica.comissaoSegueVendedorDoCliente` (default `false`,
  preserva 100% do comportamento de hoje). Quando ligada,
  `Comissao.usuarioId` no fechamento passa a vir de `Cliente.vendedorId`
  (lido na hora da aprovação, nunca snapshotado — mesmo princípio já usado
  pra `margemLucroOverride` na rodada 10) em vez de `Orcamento.usuarioId`,
  com fallback pro comportamento de hoje quando o cliente não tem vendedor.
  Espelhado nos dois caminhos de aprovação (painel autenticado e link
  público `/o/[token]`). Escopo contido: nenhuma role nova de "vendedor",
  nenhuma tela de "minha carteira" — só o campo e o fio até a comissão.

Achado extra na verificação: os 3 subagentes editaram `prisma/schema.prisma`
concorrentemente (esperado, sem worktree isolado) — reconciliação limpa,
sem nenhuma edição sobrescrita. Um teste de integração do achado A8
(`actions.vendedor-cliente.test.ts`) falhava com `resultado.ok === false`
porque o usuário de teste "criador" nasceu com `papel: "OPERADOR"` sem
nenhuma `PermissaoUsuario` de `ORCAMENTO` concedida — `podeEditarModulo`
barra OPERADOR sem permissão explícita antes mesmo de chegar na lógica de
comissão (bug do fixture do teste, não da action; corrigido trocando pra
`papel: "ADMIN"`, mesmo padrão já usado em `actions.comissao-custo.test.ts`).
As 3 migrations (aditivas) aplicadas ao banco de dev com aprovação
explícita, com a mesma instabilidade intermitente de conexão ao Neon já
vista antes (1 retry resolveu). Verificação: `tsc --noEmit` limpo, 867/867
testes (84 arquivos) passando, `npm run build` OK.

**Atualização 2026-08-27 (rodada 12) — mais 5 achados CONSTRUÍDOS** (5
subagentes em paralelo):
- **A1 da Parte 5** (sem distinção Pessoa Física × Jurídica — bug fiscal:
  faltava razão social/Inscrição Estadual/indicador de contribuinte do
  destinatário, risco de rejeição SEFAZ 728/791) — `Cliente.tipoPessoa`/
  `razaoSocial`/`nomeFantasia`/`inscricaoEstadual`/
  `indicadorInscricaoEstadual`/`inscricaoMunicipal`. `focus-nfe.ts` manda
  `indicador_inscricao_estadual_destinatario` sempre (1/2/9) e
  `inscricao_estadual_destinatario` só quando CONTRIBUINTE — exatamente a
  regra que evita a 791. Nova pendência em `verificarProntidaoFiscal`
  bloqueando ANTES da SEFAZ rejeitar. `razaoSocial ?? nome` na emissão,
  `nome` do cadastro nunca migrado/alterado.
- **A6 da Parte 4** (sem controle de crédito do cliente) —
  `Cliente.limiteCredito`/`prazoPagamentoPadraoDias`/
  `bloqueadoParaFaturamento` + `ParametrosGrafica.
  bloqueiaAoUltrapassarLimiteCredito` (default `false` = só avisa, igual
  `descontoMaxSemAprovacao`). Deliberadamente NÃO reaproveita
  `bloqueadoParaVenda` (causas independentes — bloqueio manual vs. estouro
  automático de exposição), mas os dois avisos são compostos num único
  `aviso` na resposta de `atualizarStatusOrcamento`. A trava (quando
  ligada) vale nos dois caminhos de aprovação; o aviso não-bloqueante só no
  painel autenticado.
- **A13 da Parte 4** (`ContaPrepaga` é a carteira da GRÁFICA com um
  fornecedor; crédito do CLIENTE — sentido oposto — não tinha onde ir) —
  `model CreditoCliente`/`MovimentacaoCreditoCliente` novo, espelhando a
  mecânica de `ContaPrepaga` (saldo sempre calculado a partir da soma de
  movimentações, nunca armazenado). Tela `/financeiro/creditos-clientes`.
  Consumo na aprovação do orçamento é opcional (campo "quanto usar", nunca
  forçado), revalidado no servidor dentro da mesma transação — nunca deixa
  `CONSUMO` exceder o saldo real.
- **A14 da Parte 4** (resto do achado — despesa recorrente só mensal,
  valor sempre igual, sem fim; o bug concreto de `categoriaCustoId` já
  tinha sido corrigido numa rodada anterior) — `Despesa.periodicidade`
  (7 valores, default MENSAL preserva 100% do comportamento de toda série
  já existente), `recorrenciaAteEm` (série para de gerar depois dessa
  data), `valorVariavel` (ocorrência nasce com valor 0, badge "a
  confirmar"). Achado de implementação: o teto de catch-up (gerar até N
  ocorrências de uma vez se a gráfica ficou muito tempo sem abrir
  `/financeiro`) tinha que parar de ser contado em OCORRÊNCIAS (24
  ocorrências anuais seria catch-up de 24 anos) e virar um teto de TEMPO
  (24 meses de calendário, qualquer periodicidade).
- **A4 da Parte 5** (sem cadastro de contatos do cliente — comprador ≠
  financeiro ≠ aprovador de arte ≠ recebimento, tudo caía no mesmo
  e-mail/telefone genérico) — `model ContatoCliente` (soft-delete via
  `ativo`, só 1 principal por cliente, imposto na action) +
  `Orcamento.contatoClienteId` convivendo com o snapshot em texto já
  existente `contatoNome`/`contatoEmail` (mesmo precedente de `Comissao`/
  `opcaoEscolhidaNome`) — escolher um contato pré-preenche o snapshot, mas
  digitar à mão continua funcionando. Roteamento automático (link de
  aprovação pro contato de `APROVACAO_ARTE`, boleto pro `FINANCEIRO`)
  deliberadamente fora desta rodada.

Achado extra na verificação: os 5 subagentes editaram `prisma/schema.prisma`
concorrentemente (até 3 ao mesmo tempo em `ClienteForm.tsx`/
`clientes/actions.ts`) — reconciliação limpa, um deles inclusive detectou
sozinho uma colisão de NOME DE ARQUIVO com outro subagente
(`src/lib/credito-cliente.ts` já estava em uso pro achado A13/CreditoCliente)
e se renomeou pra `src/lib/exposicao-credito-cliente.ts` sem que eu
precisasse intervir. Um teste do achado A4
(`actions.contatos.test.ts`) falhava com `"Invalid input"` em 4 dos 6 casos
— **bug do fixture do teste, não da action**: `contatoClienteSchema` (mesmo
padrão de `clienteSchema`) espera `undefined` ou string pros campos
opcionais, mas o helper `formDataDe` do teste só chama `FormData.set` pros
campos explicitamente passados, então campos como `cargo`/`telefone`
ausentes viravam `null` (não `undefined`) — coisa que nunca acontece com um
`<form>` de verdade (`ContatosClienteCard.tsx` sempre renderiza os 4 inputs,
mesmo vazios). Corrigido preenchendo os campos opcionais com `""` explícito
nos 5 `formDataDe(...)` que criam contato de verdade no teste. As 5
migrations (aditivas) aplicadas ao banco de dev com aprovação explícita, com
a mesma instabilidade intermitente de conexão ao Neon de sempre (1 retry
resolveu). Verificação: `tsc --noEmit` limpo, 916/916 testes (89 arquivos)
passando, `npm run build` OK.

**Atualização 2026-08-28 (rodada 13) — mais 3 achados CONSTRUÍDOS** (3
subagentes em paralelo, um por módulo, pra minimizar conflito de arquivo):
- **A6 da Parte 5** (zero dados comerciais do cliente) — completa o A6 da
  Parte 4 (rodada 12: `limiteCredito`/`prazoPagamentoPadraoDias`) com
  `formaPagamentoPreferida` (reusa o enum `FormaPagamento` já existente),
  `descontoPadraoPercent` e `observacaoFinanceira`. O valor real não é só o
  cadastro: `Orcamento.condicoesPagamento` é sugerido a partir do cliente
  selecionado na Calculadora (nova RPC `buscarCondicoesComerciaisCliente`),
  o campo Vencimento de `ContaReceber` vem pré-calculado a partir de
  `prazoPagamentoPadraoDias`, e `descontoPadraoPercent` pré-preenche o
  desconto por item — sempre como sugestão editável, nunca travando nada,
  e sempre passando pela trava de `descontoMaxSemAprovacao` que já existe.
- **A4 da Parte 3** (mapa de cotação de fornecedor) — `model
  CotacaoFornecedor` (preço, prazo, condição de pagamento, frete, validade,
  vencedora) por par (solicitação, fornecedor). A transição COTANDO→APROVADO
  agora exige uma vencedora marcada e copia os dados dela pra solicitação
  (sobrepondo qualquer valor manual). Nova UI `CotacoesFornecedorCard.tsx`
  no detalhe da solicitação, pré-preenchendo com o último preço conhecido do
  fornecedor. Caminho antigo (SOLICITADO→APROVADO direto, pulando cotação)
  preservado e testado intacto.
- **A7 da Parte 4** (condição de pagamento estruturada) — `model
  CondicaoPagamento`/`CondicaoPagamentoParcela` (âncora + parcelas com
  percentual/dias), bootstrap lazy com as 4 condições mais comuns do mercado
  brasileiro (pesquisa do próprio achado). `ContaReceber` é gerada
  automaticamente (snapshot, nunca recalculada depois — mesma disciplina de
  `Comissao`) na aprovação do orçamento, nos dois caminhos (painel
  autenticado e link público). **Escopo restrito de propósito**: só a âncora
  `APROVACAO` dispara geração automática nesta rodada — `EMISSAO_NOTA` e
  `ENTREGA` ficam com enum/campo prontos mas sem gatilho (plumbar em
  `emitirNfe`/transição pra ENTREGUE fica pra rodada futura). **Gap real
  maior**: nenhuma UI foi construída — hoje `condicaoPagamentoId` só é
  setável via Prisma direto (usado assim nos testes); falta tela de
  configuração de condições e um seletor no formulário de orçamento pra
  esta feature virar utilizável em produção. Por isso fica como
  **PARCIALMENTE CONSTRUÍDO**, diferente dos outros 2 achados da rodada.

Achado extra na verificação: um teste do achado A6/Clientes
(`actions.dados-comerciais.test.ts`) tinha o mesmo bug de fixture já visto
nas rodadas 11/12 — o helper `formDataBase` só setava `clienteId`/`nome`,
então os outros campos opcionais do `clienteSchema` chegavam como `null`
(não `undefined`) e quebravam o zod antes mesmo de rodar os validadores
novos. Corrigido preenchendo a base com `""` explícito pra todo campo
opcional do schema (mesma correção de sempre). Também 1 assert frágil
comparando `Decimal.toString()` contra `"0.1000"` — trocado por comparação
numérica. As 3 migrations aplicadas ao banco de dev com aprovação explícita
(1 retry por cold-start do Neon). Dois testes de integração (`o/[token]`,
um do A6/Financeiro rodada 12 e outro do A7/Financeiro desta rodada)
falharam de forma isolada e não-reprodutível na suíte cheia mas passaram
100% quando rodados sozinhos — contenção de conexão no Postgres de dev sob
carga da suíte inteira (949 testes), não bug de lógica; suíte cheia rodada
3× até estabilizar 949/949 verde antes do build. Verificação final: `tsc
--noEmit` limpo, 949/949 testes (95 arquivos) passando, `npm run build` OK.

**Atualização 2026-08-29 (rodada 14) — mais 3 achados CONSTRUÍDOS** (3
subagentes em paralelo, um por módulo):
- **A3 da Parte 3** (compra não distingue reposição × sob encomenda, nunca
  vira custo do pedido) — `enum OrigemSolicitacaoCompra` +
  `SolicitacaoCompra.pedidoId` (obrigatório na aplicação quando
  `origem=PEDIDO_ESPECIFICO`), `COMPRA` adicionado a `OrigemCusto`. Ao
  confirmar RECEBIDO com `pedidoId` preenchido, gera `CustoPedido` origem
  `COMPRA` automaticamente (dedup via `solicitacaoCompraId @unique`, mesmo
  padrão defensivo de `criarCustoAutomaticoConsumo`), marcando
  `possivelDuplicidade` quando o material comprado também está na ficha
  técnica de algum item do pedido. `REPOSICAO_ESTOQUE` (default) continua
  sem gerar custo nenhum, comportamento de hoje preservado.
- **A8 da Parte 4** (sem recebimento/pagamento parcial) — `BaixaContaReceber`
  e `PagamentoDespesa` (N:N com valor), `StatusContaReceber`/`StatusDespesa`
  ganham `PARCIAL`, saldo sempre calculado (nunca armazenado, mesma
  disciplina de `CreditoCliente`). Caminho de valor EXATO preservado 100%
  sem alteração; caminho novo só fecha (nunca cria) uma conta `PARCIAL` cujo
  saldo bate exato, e rejeita explicitamente pagamento que não bate nem com
  o total nem com o saldo remanescente (nunca aplica parcial "adivinhando").
  UI mínima (campo de valor editável nas ações de pagamento existentes, em
  vez de tela nova). Gap documentado: o CSV pro contador e o "saldo real" do
  Meu Negócio continuam atribuindo o valor cheio ao mês do fechamento final,
  não fracionado por mês de cada baixa parcial.
- **A5 da Parte 5** (um único endereço por cliente) — `model EnderecoCliente`
  (tipo PRINCIPAL/COBRANCA/ENTREGA, um `padrao` por tipo, soft-delete),
  seguindo exatamente o padrão estrutural de `ContatoCliente` (achado A4,
  rodada 12). `Orcamento.enderecoEntregaId` convivendo com o texto livre
  `localEntrega` já existente (snapshot, mesmo precedente de
  `contatoClienteId`). Campos fiscais inline do `Cliente` inalterados —
  continuam sendo o endereço da nota fiscal.

Achado extra na verificação: o teste do achado A5/Clientes
(`actions.enderecos.test.ts`) tinha o mesmo bug de fixture recorrente — o
helper de FormData da rodada não cobria TODOS os campos opcionais do
`enderecoClienteSchema` (esqueceu especificamente `municipio`/`uf` na
primeira correção, exigindo um segundo ajuste). Padrão se repetindo rodada
após rodada (11, 12, 13, 14) — todo subagente que escreve teste de uma
action com `formData.get()` direto precisa de uma base cobrindo 100% dos
campos `.optional()` do schema, não só os que o caso de teste usa. As 3
migrations aplicadas ao banco de dev com aprovação explícita (1 retry por
cold-start do Neon; sem colisão real apesar de 2 pastas de migration
compartilharem o mesmo timestamp de minuto). Verificação final: `tsc
--noEmit` limpo, 977/977 testes (100 arquivos) passando 2× seguidas, `npm
run build` OK.

**Atualização 2026-08-29 (rodada 15) — mais 3 achados CONSTRUÍDOS**
(B1+B2 da Parte 2 construídos juntos por um subagente só, já que B2 é
literalmente um campo a mais no model que B1 cria; A9 da Parte 1 por
outro subagente em paralelo). Rodada interrompida no meio por ter batido
no limite de gasto mensal da conta e retomada depois — ver nota de
processo abaixo:
- **B1 da Parte 2** (transição de etapa sem rastro) — `model
  ApontamentoEtapa` (status, iniciadoEm/finalizadoEm, operador,
  `origemConfirmacao` APP/LINK_PUBLICO/QR_ETIQUETA), aberto/fechado dentro
  da MESMA transação do CAS que já protege `avancarStatusPedido` — o
  branch sem baixa de estoque não era transacional antes e precisou virar
  `$transaction` pra garantir atomicidade. Os 3 canais (painel, link
  público, QR) gravam a origem correta. **Escopo restrito de propósito:**
  `quantidadeBoa`/`quantidadeRefugo`/`motivoRefugo` (achado B3) ficaram de
  fora deliberadamente — é o próximo passo natural, mesmo model.
- **B2 da Parte 2** (não registra em qual máquina o pedido rodou) — as 5
  FKs opcionais de máquina em `ApontamentoEtapa`, mesmo padrão de
  `RegistroManutencao` ("no máximo 1 preenchida", 0 também válido).
  Sugestão pré-preenchida a partir da máquina usada na precificação,
  editável pelo operador; aviso de divergência na tela de fechamento do
  pedido. Só o canal do painel autenticado coleta máquina — link público e
  QR ficam rápidos/simples, decisão consciente.
- **A9 da Parte 1** (peça maior que a bobina é erro fatal) — `model
  ConfiguracaoEmenda` opcional por `ItemGrafica` (custo por metro linear +
  sobreposição). Sem cadastro, `calcularM2` continua lançando
  `PECA_EXCEDE_BOBINA` como sempre; com cadastro, calcula nºPainéis, soma
  o custo de emenda ao `custoBase` e devolve aviso no breakdown em vez de
  erro.

**Nota de processo (corte de orçamento, 2026-08-29):** os 2 subagentes
originais desta rodada foram cortados no meio da tarefa por limite de
gasto mensal da conta Anthropic (HTTP 429) — não foi bug, foi orçamento.
Retomados depois com `model: "sonnet"` explícito (esquecido nas rodadas
11-15 até este ponto — corrigido daqui pra frente, ver
[[feedback-orquestracao-modelo]] na memória), revisando o que já existia
em vez de recomeçar do zero — nenhum trabalho foi perdido, só terminado.

**Achados extras notados pelos subagentes, fora do escopo desta rodada**
(a pedido do usuário, subagentes agora reportam bug de lógica real que
notarem na área tocada, mesmo fora do achado):
- `cancelarPedido` nunca fecha o `ApontamentoEtapa` aberto ao cancelar um
  pedido — fica com `finalizadoEm: null` pra sempre, linha do tempo
  "pendurada" pra pedidos cancelados. Não corrigido (fora de B1/B2),
  registrado pra rodada futura.
- `custoImpressao` no caminho de emenda continua calculado sobre a área
  nominal da peça inteira, não por painel — comportamento pretendido
  (impressão cobre a arte inteira, sobreposição é só informativa), mas
  vale confirmar a intenção de negócio antes de considerar 100% fechado.

Verificação: `tsc --noEmit` limpo, 999/999 testes (102 arquivos) passando
2× seguidas, `npm run build` OK.

**Atualização 2026-08-30 (rodada 16) — mais 5 achados CONSTRUÍDOS** (5
subagentes em paralelo — primeira rodada usando `model: "haiku"` pros 2
achados mais mecânicos, `sonnet` pros outros 3, ver
[[feedback-orquestracao-modelo]] na memória):
- **A12 da Parte 5** (haiku) — cliente órgão público: `Orcamento.
  notaEmpenho`/`processoLicitatorio`, texto livre, exibidos no PDF quando
  preenchidos. Deliberadamente sempre visíveis no form (não condicionado a
  `segmento === ORGAO_PUBLICO`) — decisão de simplicidade aceita.
- **A13 da Parte 6** (haiku) — `ParametrosGrafica.toleranciaTiragemPercent`
  (default 0, comportamento de hoje preservado), interpolado no texto
  padrão de termos e exibido como faixa aceitável na Ordem de Produção.
- **A6 da Parte 3** (sonnet) — unidade de compra ≠ unidade de estoque:
  `enum UnidadeCompra`, campos de conversão em `SolicitacaoCompra` e
  configuração padrão (`unidadeCompraPadrao`/`fatorConversaoCompraPadrao`/
  `loteMinimoCompra`/`multiploCompra`) em `ItemGrafica`. `quantidade`
  (estoque) continua a única fonte de verdade lida pelo resto do sistema,
  sempre recalculada no servidor a partir da quantidade de compra (nunca
  confia no valor cru enviado pelo cliente). Aviso de múltiplo é só aviso,
  nunca bloqueia.
- **A10 da Parte 5** (sonnet) — visão financeira/histórico do cliente:
  `@@index([graficaId, clienteId])` em `Orcamento`, `ContaReceber.
  clienteId` (com backfill do histórico existente via join na própria
  migration), novo card na ficha do cliente com últimos orçamentos, total
  faturado no período e contas a receber em aberto/vencidas — tudo lendo
  dado que já existia.
- **A9 da Parte 3** (sonnet) — contrato de fornecimento com preço fixo:
  `model ContratoFornecimento` (contrato "coringa" por fornecedor ou
  específico por item/variante), finalmente dá função real a
  `OrigemSolicitacaoCompra.CONTRATO_PROGRAMADO` (existia sem uso desde a
  rodada 14) — solicitação vinculada nasce direto em APROVADO, pulando
  COTANDO, com `quantidadeConsumida` incrementada atomicamente ao
  confirmar RECEBIDO. Alerta de vigência/quantidade esgotando (30 dias /
  90%, fixos por ora — sem uso real que justifique configuração por
  tenant ainda).

**Achado extra na verificação — bug real de build corrigido**: o `npm run
build` quebrou com `Module not found: Can't resolve 'util/types'` — o
subagente de A9 colocou a função pura `contratosAplicaveis` (consumida por
`NovaSolicitacaoForm.tsx`, um Client Component) no mesmo arquivo
`src/lib/contrato-fornecimento.ts` da função `listarContratosProximosDoLimite`,
que importa `@/lib/prisma` — vazando o driver `pg` pro bundle do navegador.
Mesmo motivo pelo qual `src/lib/dias-uteis.ts` foi separado de `data.ts` na
rodada 11. Corrigido movendo a função com Prisma pra
`src/lib/contrato-fornecimento-db.ts`, mesma separação já usada em
`comparativo-fornecedores.ts`/`comparativo-fornecedores-db.ts`. Também 2
asserts frágeis (`Decimal` do Prisma comparado direto com número em
`configuracoes/actions.test.ts`) corrigidos com `Number(...)`. As 5
migrations aplicadas ao banco de dev com aprovação explícita (1 retry por
cold-start do Neon). Suíte cheia mostrou flakiness pontual e diferente a
cada rodada (1-2 testes isolados falhando, sempre um arquivo diferente,
sempre passando ao rodar de novo) — mesma contenção de conexão no Postgres
de rodadas anteriores, não bug de lógica; precisou rodar a suíte 4× até
estabilizar 100% verde. Verificação final: `tsc --noEmit` limpo, 1043/1043
testes (109 arquivos) passando, `npm run build` OK (com cache do Turbopack
limpo — o build também apresentou um erro interno do Turbopack não
relacionado ao código, resolvido apagando `.next`).

**Atualização 2026-08-31 (rodada 17) — 10 achados 🟢 Barato CONSTRUÍDOS, primeira rodada dentro da Parte 7** (2 subagentes em paralelo, `haiku` pro bundle mecânico, `sonnet` pro bundle que mexe em schema/migration, mesmo princípio de agrupar achados que tocam o mesmo código num prompt só):
- **B1-B5 da Parte 7** (haiku) — 19 itens novos em `CATALOGO_MESTRE`
  (`src/lib/catalogo-mestre.ts`): tecido em rolo (5, "Sublimação e
  Vestuário"), filme/pó/tinta DTF (3, categoria nova "DTF e Transfer"),
  corpos de brinde em branco (6, categoria nova "Brindes (Corpos)"), filme
  metalizado por cor (4, categoria nova "Hot Stamping"), papelão ondulado
  (1, "Placas e Chapas"). Trabalho puro de conteúdo — sem schema, sem
  migration, confirma a recategorização como SEED que a revisão Opus já
  tinha feito.
- **A1/A2/A3/A5 da Parte 7** (sonnet) — `CategoriaEquipamento` ganhou
  `BORDADO`/`CORTE_VINCO`/`VINCADORA`; `Equipamento` ganhou
  `larguraMaximaMm Int?`/`tecnologiaImpressao String?` com campo nos 2
  forms (`NovoEquipamentoForm.tsx`/`[id]/EquipamentoForm.tsx`) e
  validação/auditoria em `actions.ts` — sem isso o campo existiria no banco
  sem forma de a gráfica preencher, o que anularia o próprio ponto da
  Parte 7. Implementadas só as versões CORRIGIDAS pela revisão Opus (A1 sem
  `ProcessoSetupPorPeca.BORDADO`/`numeroCabecotes`, que conflitaria com o
  achado A4/Parte 1; **A4 não precisou de nenhuma mudança de código** —
  `MaquinaSetupPorPeca.custoPorSetup`/`custoPorPeca`, campos já existentes,
  já resolvem o achado).
- **Achado extra fora de escopo, corrigido no processo**: o subagente
  sonnet detectou e reverteu sozinho 13 hunks de reformatação cosmética
  (`npx prisma format` mexendo em alinhamento de coluna de 7 models não
  relacionados) que tinham vazado pro diff antes da revisão — deixou o
  `schema.prisma` só com as 21 linhas reais da mudança.
- B6 (materiais de bordado) ficou de fora de propósito, pra fechar em
  exatamente 10 — próximo candidato natural.
- 1 migration aplicada ao banco de dev com aprovação explícita
  (`20260831100000_abrangencia_maquinas_parte7` — 3× `ADD VALUE` em enum +
  2 colunas nullable, 100% aditiva). Verificação: `prisma validate` OK,
  `tsc --noEmit` limpo, 1043/1043 testes passando **de primeira** (sem
  flakiness desta vez), `npm run build` OK.

Placar depois desta rodada: das Partes 1-6 seguem 34 construídos + 8
parciais de 88 (sem mudança). Na Parte 7, 10 dos 33 achados construídos
(A1-A5 e B1-B5 da seção "Máquinas e matérias-primas"), 23 pendentes.

**Atualização 2026-08-31 (rodada 18) — F6 CONSTRUÍDO** (1 subagente sonnet, pedido pontual do usuário depois de perguntar como o PIX funcionava hoje): `Grafica` ganhou `chavePix`/`tipoChavePix`/`favorecidoPix`/`dadosBancarios`, editáveis em `/configuracoes/identidade`, impressos no PDF do orçamento e exibidos em `/o/[token]` só depois de `APROVADO`. Escopo mantido estritamente enxuto (combinado antes de construir): zero validação de formato de chave, zero automação/confirmação de pagamento — `ContaReceber`/conciliação continuam 100% manuais. 1 migration aplicada (1 enum + 4 colunas nullable, 100% aditiva). Suíte cheia rodou 2× (1 falha isolada e não-reprodutível na 1ª rodada, mesmo padrão de contenção de conexão de rodadas anteriores — passou sozinha isolada e na 2ª rodada completa), 1049/1049 verde; build OK.

Placar depois desta rodada: Parte 7 com 11 dos 33 achados construídos, 22 pendentes.

**Atualização 2026-08-31 (rodada 19) — 8 achados 🟢 Barato CONSTRUÍDOS** (5 subagentes: 2 haiku pros bundles mecânicos, 3 sonnet pros que precisavam de mais julgamento):
- **C1/C2/C3/C4 da Parte 7** (haiku) — acabamento de etiqueta: `durabilidadeAdesivo` (só a versão corrigida de C1), `SOFT_TOUCH`/`METALIZADA` em `TipoLaminacao`, `SOFT_TOUCH` em `TipoAcabamentoVerniz`, `tipoEfeitoHotStamping` em `OrcamentoItemHotStamping`.
- **B6 da Parte 7** (haiku) — 4 itens de seed em `CATALOGO_MESTRE` (materiais de bordado).
- **A9 restante da Parte 6** (sonnet) — `COBRANCA`/`COMPRAS` no enum `AreaAdministrativa`; só `COMPRAS` religado de verdade (`alerta-estoque.ts`) — `COBRANCA` ficou cadastrável mas sem call site pra adaptar (não existe HOJE nenhum disparo de e-mail de cobrança no código, só a tela destacando visualmente).
- **F7 da Parte 7** (sonnet) — `OrcamentoItem.profundidadeCm`/`espessuraMm`, fiação completa (18 arquivos: criar/editar/duplicar item, opção alternativa, PDF de orçamento e de ordem de produção).
- **F9 da Parte 7** (sonnet) — `SegmentoGrafica` +5 valores + `Grafica.segmentosSecundarios[]`, com consumo aditivo real em `dados-exemplo.ts` (catálogo extra dos segmentos secundários, nunca substitui o principal).
- **Achado de processo grave, corrigido no meio da rodada**: ao mesclar o bundle de C1-C4 (haiku) por cima do que já tinha sido aplicado, a thread principal COPIOU ARQUIVOS SEM PERCEBER que 11 deles também tinham sido tocados pelo bundle F7 (sonnet) — como os 2 subagentes trabalharam em worktrees isolados sem se ver, a cópia apagou a fiação do F7 nesses 11 arquivos. Nada tinha sido commitado ainda, então foi recuperável: a thread principal reconstruiu a fiação do F7 nos 11 arquivos NA MÃO, guiada pelos erros exatos do `tsc --noEmit` (cada erro apontava exatamente o arquivo/linha faltando) mais um grep cruzado de `largura`/`profundidade` em todo `src/app/orcamento` pra confirmar que nada mais tinha sido perdido silenciosamente (um campo que só é lido via JSON solto, sem tipo estrito, não dispara erro de `tsc` mesmo faltando). Ver [[feedback-orquestracao-modelo]] pra a lição de processo.
- **2 bugs reais pegos na verificação, nenhum deles do reconstrução**: (1) a migration do F7 usava `ALTER TABLE "OrcamentoItem"` — nome errado, o model tem `@@map("orcamento_itens")`, teria falhado ao aplicar; corrigido antes de aplicar. (2) 2 arquivos de teste (`actions.dimensoes-item.test.ts` ×2, escritos pelo próprio F7) tinham asserções frágeis de `Decimal.toString()` esperando zero à direita (`"50.00"` em vez de `"50"`) e um mock de `redirect()` faltando em `criarOrcamento` — nenhum dos dois tinha rodado de verdade antes (a migration não estava aplicada nas verificações anteriores), corrigidos só depois da migration ir pro ar e os testes rodarem pela primeira vez de verdade.
- 4 migrations aplicadas ao banco de dev com aprovação explícita, todas aditivas.

Placar depois desta rodada: Parte 7 com 18 dos 33 achados construídos, 15 pendentes; Parte 6 A9 fechado (com a ressalva COBRANCA documentada acima).

## Como ler cada parte

Cada uma das 6 partes abaixo cobre um módulo (ou par de módulos muito
interligados) do sistema, com metodologia própria no parágrafo de
abertura, achados numerados (`A1`, `A2`...) no formato **O que falta** /
**Pesquisa** / **Proposta**, e termina com uma tabela de "Prioridade
sugerida" (Alta/Média/Baixa) e uma lista de "Critical files" (caminhos no
repositório, pra quem for implementar). As propostas de schema seguem os
padrões já estabelecidos no projeto: enum fechado + campo `Outro` de
escape quando faz sentido, campos sempre `nullable`/opcionais quando o gap
é aditivo (nenhuma proposta aqui quebra um tenant existente), e
preferência por resolver com dado (schema/config) em vez de lógica
hardcoded — esse último é um princípio recorrente do projeto, não
específico desta auditoria.

Ordem das partes: (1) Orçamento + Catálogo — o motor de precificação em
si, tratado junto por serem genuinamente interligados; (2) Produção —
fluxo de etapas do pedido; (3) Compras; (4) Financeiro; (5) Clientes —
cadastro dos clientes da gráfica; (6) Configurações — onde o dono da
gráfica configura como o próprio sistema se comporta (parâmetros de
preço, dados fiscais, máquinas, permissões etc.).

---

# Parte 1 — Orçamento + Catálogo

Pesquisei como sete perfis de gráfica brasileira realmente cotam (comunicação visual, estamparia/vestuário, brindes, editorial, embalagem/cartonagem, corte a laser/acrílico, DTF/bordado) e comparei campo a campo com `prisma/schema.prisma`, `src/lib/pricing/*` e `src/lib/orcamento-precificacao.ts`. A conclusão geral: os 8 `ModeloCalculo` cobrem bem os processos de **impressão**, mas o motor ainda assume três coisas do perfil da gráfica de referência que não valem no universo geral — (a) que **o custo do produto é o custo de imprimir** (não existe custo de peça em branco/revenda/terceirização fora do Digital), (b) que **cada linha de orçamento é uma peça plana única** (não existe produto multicomponente: capa+miolo, caixa+berço, kit) e (c) que **acabamento é sempre por unidade/m²/folha** — as duas bases que o setor de comunicação visual mais usa (`METRO_LINEAR` e `HORA`) estão **fisicamente inalcançáveis no código hoje**. Achei 1 bug duro, 12 gaps de motor e 8 gaps de orçamento.

## Achados no Catálogo / motor de preço

### A1. `BaseCobranca.METRO_LINEAR` e `BaseCobranca.HORA` são inalcançáveis — bug, não gap — **CONSTRUÍDO 2026-08-24**

**Status:** corrigido e em produção. `METRO_LINEAR` deriva `2×(largura+altura efetiva)` da geometria já calculada em `precificar.ts` (nenhum campo novo); `HORA` ganhou `OrcamentoItem.horasEstimadas`, propagado por todos os fluxos de orçamento (criar, editar, opções alternativas, calculadora, duplicar). Guard de silêncio (`orcamento-precificacao.ts`) estendido pra cobrir os dois casos, com mensagem clara em vez de erro genérico.
**O que falta:** `calcularQtdBase` em `src/lib/pricing/acabamento.ts` exige `ctx.perimetroOuEmenda` (linha 28) e `ctx.horasEstimadas` (linha 42) e lança `ErroPrecificacao("CUSTO_INVALIDO")` se ausentes. Esses dois campos existem só na declaração de tipo (`src/lib/pricing/tipos.ts:90-91`) — **nenhum dos 6 branches de `precificar()` os preenche**. Verifiquei com grep: as únicas 4 ocorrências no repo inteiro são a definição e o uso. Ou seja: qualquer gráfica que configure um acabamento com base METRO_LINEAR ou HORA quebra o orçamento inteiro, sempre, em 100% dos casos. Duas das seis bases de cobrança são código morto que aparece no dropdown.

**Pesquisa que embasa a gravidade:** os três acabamentos padrão de banner/lona são **ilhós, bainha com costura e bastão** — todos cobrados por metro linear de borda ou por unidade de ilhós a cada 50 cm ([e-Revendedor](https://erevendedor.com.br/como-fazer-orcamento-de-banner/), [Casa dos Banners](https://www.casadosbanners.com.br/lonas-ilhos)). E instalação/montagem/arte é cobrada por hora-homem ([FortuneLaser](https://www.fortunelaser.com/pt/news/laser-cutting-pricing-demystified-a-complete-guide-to-service-costs/)). O catálogo mestre já tem "Instalação de Placa", "Aplicação de Adesivo", "Criação de Arte / Design Gráfico (HORA)" — todos inutilizáveis como acabamento hoje.

**Proposta:**
- Em `precificar.ts`, alimentar `ContextoAcabamento.perimetroOuEmenda` derivado da geometria já calculada: `2 × (larguraEfetivaM + alturaEfetivaM)` — vale pros 3 motores com nesting; pros sem nesting, só quando dimensões foram informadas (mesma guarda que já existe pra acabamento M2 em `orcamento-precificacao.ts:266`).
- Novo campo `OrcamentoItem.horasEstimadas Decimal?` (informado por item, igual `numeroSetups`), com guarda em `calcularItemOrcamento` no mesmo bloco das outras.
- Considerar `BaseCobranca.UNIDADE_POR_METRO` (nº de ilhós = perímetro ÷ espaçamento) com `espacamentoM` em `ConfiguracaoAcabamento` — é literalmente como ilhós é orçado.

### A2. Os 3 modelos de setup-por-peça não têm custo de substrato — o item em branco custa R$ 0 — **CONSTRUÍDO 2026-08-24 (rodada 5)**

**Status:** `ContextoSetupPorPeca` (novo, mesmo papel de `ContextoDigital.custoSubstratoPorPeca`) alimenta `calcularSetupPorPeca` com `item.precoCompra`, carregado em `carregar.ts` no mesmo branch SERIGRAFIA/SUBLIMACAO/ESTAMPAGEM_QUENTE. `custoSubstrato = Q × custoSubstratoPorPeca` agora entra no `custoBase` (e conta pro piso `custoMinimo`). Exemplo: 10 camisetas a R$15 de `precoCompra` — `custoBase` que era R$115 (só setup+variável) passa a R$265. 147/147 testes de `src/lib/pricing` + `orcamento-precificacao` passando, sem regressão em `src/app/orcamento`.

**O que faltava:** `calcularSetupPorPeca` (`src/lib/pricing/setup-por-peca.ts`) é `numeroSetups × custoPorSetup + Q × custoPorPeca`, com `custoPorPeca` vindo da **máquina** (`MaquinaSetupPorPeca.custoPorPeca`). `carregar.ts:287-307` não lê `item.precoCompra` pra esses modelos. Comparar com `ContextoDigital.custoSubstratoPorPeca`, que existe. Resultado: uma camiseta, caneca, boné ou squeeze precificado por SERIGRAFIA/SUBLIMACAO entra no motor com **custo zero da peça física** — e o `breakdown` (a árvore auditável que responde "quanto lucrei") mente por uma ordem de grandeza.

**Pesquisa:** camiseta branca algodão 30.1 a **R$ 11,00/un** contra serigrafia 2 cores a **R$ 9,50/un** — a peça em branco é ~54% do custo direto ([Camisetas em 12h](https://camisetasem12h.com.br/calcular-custo-camisetas-personalizadas-lote/), [Bantu Estamparia](https://bantuestamparia.com.br/blog/quanto-custa-fazer-camiseta-personalizada/)). O catálogo mestre já tem "Camiseta Branca (Malha PV)", "Caneca Branca de Cerâmica", "Boné em Branco" como matéria-prima — mas o motor nunca as consome nesses modelos.

**Proposta:**
- `ContextoSetupPorPeca { custoSubstratoPorPeca }`, carregado de `ItemGrafica.precoCompra` (idêntico ao Digital) e somado no `custoBase`.
- Melhor ainda (casa com A9b): `ItemGrafica.materialId` → escolha do branco no orçamento, porque a mesma "Camiseta Personalizada" é vendida em malha PV, algodão penteado e dry-fit com custos bem diferentes.
- Flag `OrcamentoItem.materialFornecidoPeloCliente Boolean @default(false)` que zera esse custo — "o cliente traz as camisetas" é modalidade padrão de estamparia (inferência minha, corroborada pela estrutura de preço "só estampa" nas mesmas fontes).

### A3. `ProcessoSetupPorPeca` é o único enum de catálogo do schema **sem escape `OUTRO`** — **CONSTRUÍDO 2026-08-24 (rodada 6)**

**Status:** `ModeloCalculo.PERSONALIZACAO` (9º rótulo, mesma `calcularSetupPorPeca` dos outros 4) + `ProcessoSetupPorPeca.TAMPOGRAFIA/GRAVACAO_LASER/DTG/TRANSFER/OUTRO` + `MaquinaSetupPorPeca.tipoProcessoOutro` (mesmo par OUTRO+texto do resto do schema). `ConfiguracaoProdutoForm.tsx` filtra máquina disponível: PERSONALIZACAO aceita qualquer `tipoProcesso` que não seja um dos 3 já nomeados 1:1. Formulários de cadastro de máquina (`NovaMaquinaSetupPorPecaForm.tsx`/`[id]/MaquinaSetupPorPecaForm.tsx`) já ofereciam os 5 processos novos automaticamente (iteram `ORDEM_PROCESSO_SETUP_POR_PECA` dinamicamente) — só precisaram do campo condicional de texto pra `OUTRO`. Also corrigidos, no mesmo trabalho: 5 pontos de UI em `src/app/orcamento/` (CalculadoraForm, SeletorItemOrcamento, EditarOrcamentoForm×3) que decidiam "mostra motor avançado?"/"mostra campo de número de setups?" checando só os 3 literais antigos — sem isso, um item PERSONALIZACAO cairia no motor SIMPLES (custo zero) na calculadora, ou perderia o campo de setups ao editar.

**O que faltava:** `CategoriaEquipamento`, `UnidadeMedida`, `MaterialSubstrato`, `TipoAdesivo`, `TipoSerrilha`, `TipoLaminacao`, `TipoAcabamentoVerniz`, `TipoHotStamping` — todos têm `OUTRO` + campo texto pareado. `ProcessoSetupPorPeca` (schema:310) tem exatamente 3 valores e nenhuma fuga, porque está amarrado 1:1 aos 3 `ModeloCalculo`. Efeito prático: **tampografia, gravação a laser, DTG, transfer, gravação em relevo, banho** — todos com a forma de custo idêntica (setup por matriz/clichê/arte + variável por peça) — não têm onde ser cadastrados.

**Pesquisa:** tampografia (clichê por cor, até 6 cores, para plásticos) e gravação a laser CO2/fibra são os dois processos dominantes de personalização de brindes no Brasil, ao lado da serigrafia ([Luminati](https://www.luminatibrindes.com.br/tipos-gravacoes.php), [Brindestar](https://brindestar.com.br/tipos-de-gravacao/), [Promus](https://www.promusbrindes.com.br/tampografia)).

**Proposta (barata e 100% no padrão do repo):**
- `ModeloCalculo.PERSONALIZACAO` — 9º rótulo, chamando a **mesma** `calcularSetupPorPeca` (exatamente o precedente dos 3 atuais).
- `ProcessoSetupPorPeca`: adicionar `TAMPOGRAFIA`, `GRAVACAO_LASER`, `DTG`, `TRANSFER`, `OUTRO` + `MaquinaSetupPorPeca.tipoProcessoOutro String?`.
- Regra de filtro: `PERSONALIZACAO` aceita qualquer máquina cujo `tipoProcesso` não seja um dos 3 já mapeados 1:1.

### A4. Bordado não tem modelo — o driver de custo (pontos) não existe em lugar nenhum

**Custo estimado:** 🔴 Caro — novo `ModeloCalculo`, novo model `MaquinaBordado` e nova fórmula de custo por pontos em `src/lib/pricing/*`.

**O que falta:** nenhum dos 8 modelos representa bordado. Encaixá-lo em `SERIGRAFIA`/setup-por-peça falha porque `custoPorPeca` mora na **máquina** (é fixo), enquanto em bordado o custo por peça varia com a arte **de cada pedido** — um logo de 3.000 pontos e uma arte de costas de 15.000 pontos, na mesma máquina, na mesma camiseta, custam 5× diferente.

**Pesquisa:** a fórmula do setor é literalmente `(contagem de pontos ÷ 1000) × preço por 1000 pontos + taxa de matriz/digitalização + material + margem`; padrão internacional US$1–3/1.000 pontos, referência brasileira ~R$0,75/1.000 pontos; a taxa de digitalização da matriz é cobrada uma vez por arte, e o custo por mil pontos deve embutir linha de bordar + linha de bobina + 2 camadas de entretela ([HoopTalent](https://www.hooptalent.com/pt/blogs/news/embroidery-pricing-mastery-calculate-costs-and-set-profitable-rates), [O Artesão Bordados](https://oartesaobordados.com.br/blogs/news/como-calcular-preco-bordado), [Fiarte](https://www.fiarte.com.br/precos.html)). "Bordado" já é um SERVICO do catálogo mestre — sem motor por trás.

**Proposta:** `ModeloCalculo.BORDADO` + `model MaquinaBordado { custoPorMilPontos, custoMatrizDigitalizacao, cabecas Int, custoHoraMaq?, custoMinimo }` + `OrcamentoItem.numeroPontos Int?` + o substrato de A2. `custoBase = custoMatrizDigitalizacao (1×, não escala com tiragem — mesmo princípio já provado no clichê de etiqueta) + Q × (pontos/1000 × custoPorMilPontos) + Q × custoSubstrato`.

### A5. DTF está classificado como o processo errado

**Custo estimado:** 🟡 Médio — novo rótulo `ModeloCalculo.DTF` reaproveitando `calcularM2` existente, mais dois campos de contexto novos em `carregar.ts`/`m2.ts`, sem model novo.

**O que falta:** DTF existe só como SERVICO no catálogo mestre. Se a gráfica escolher `SUBLIMACAO` como modelo (o rótulo mais próximo), o custo sai errado por construção: **DTF não tem tela/matriz por arte** (o setup tende a zero) e o custo real é **por metro linear de filme**, com múltiplas artes "gangadas" no mesmo metro — ou seja, a forma de custo é a do **M2 (nesting em bobina)**, não a do setup-por-peça.

**Pesquisa:** o cálculo real é por metro linear de filme, somando filme (rolo 60cm × 100m ≈ US$120-150), tinta (US$50-70/L), pó adesivo (US$15-25/kg cobrindo 100-150 m lineares), energia, cabeças e mão de obra; recomenda-se **montar painéis com múltiplas artes para reduzir sobras** e somar 5-10% de perda — isto é literalmente nesting em bobina ([A Good Printer](https://www.agoodprinter.com/pt/blog/is-dtf-printing-expensive-learn-how-to-calculate-its-true-cost.html), [MB Máquinas](https://www.lojambmaquinas.com.br/guia-completo-para-precificar-e-lucrar), [SR DTF](https://srdtf.com/pt/dtf-ao-metro/)).

**Proposta:** `ModeloCalculo.DTF` como **rótulo apontando para `calcularM2`** (mesmo precedente dos 3 rótulos que compartilham `calcularSetupPorPeca`), com dois extras: `custoSubstratoPorPeca` (a camiseta) e `custoPrensagemPorPeca` (a prensa térmica). Não precisa de motor novo — precisa parar de mandar DTF pro motor errado.

### A6. Nenhum modelo cobra por TEMPO DE MÁQUINA

**Custo estimado:** 🔴 Caro — novo `ModeloCalculo`, novo model `MaquinaTempo` e nova fórmula de custo por tempo/corte no motor de precificação.

**O que falta:** corte/gravação a laser, router CNC, plotter de recorte, montagem de letra caixa/totem, acabamento manual — nada disso tem modelo. `BaseCobranca.HORA` seria a saída via acabamento, mas está morta (A1). `CategoriaEquipamento` já lista `CORTE_LASER_ROUTER` e `PLOTTER_RECORTE` como equipamento — mas `Equipamento` explicitamente "nunca influencia preço de nenhum orçamento" (comentário do schema:373).

**Pesquisa:** "o principal custo do corte a laser depende do tempo de corte da peça... é por isso que você é cobrado por cada minuto de uso da máquina"; alguns cobram por **centímetro de corte**; o orçamento típico é `área de chapa × aproveitamento + corte + gravação + hora-máquina + mão de obra + perda + margem` ([Porto Aço e Ferro](https://portoacoeferro.com.br/blog/como-calcular-o-custo-de-corte-a-laser/), [PrintCal](https://printcal.co/calculadora-corte-laser/), [Ranger3D](https://ranger3d.com.br/software/calc-corte-laser/), [FortuneLaser](https://www.fortunelaser.com/pt/news/laser-cutting-pricing-demystified-a-complete-guide-to-service-costs/)).

**Proposta:** `ModeloCalculo.TEMPO_MAQUINA` + `model MaquinaTempo { custoHoraMaq, custoSetupPorJob, custoMinimo, custoPorMetroCorte? }` + `OrcamentoItem.tempoEstimadoMin Decimal?` e `OrcamentoItem.metrosCorte Decimal?` (a gráfica escolhe a base na máquina). Combinar com A7 pro consumo de chapa.

### A7. Não existe nesting em CHAPA RÍGIDA — a categoria "Placas e Chapas" não fecha custo

**Custo estimado:** 🔴 Caro — novo `ModeloCalculo` que reaproveita o nesting do Offset mas precisa de fórmula de custo própria, e depende de A6 (também 🔴) para o tempo de corte.

**O que falta:** `FormatoFolha` só é lido no branch OFFSET (`carregar.ts:229`) e só aparece na UI quando `modeloCalculo === "OFFSET"` (`ConfiguracaoProdutoForm.tsx:419`, com `temFormatosOrfaos` alertando o contrário). O modelo M2 **exige `BobinaMaterial`** (`ErroPrecificacao("PECA_EXCEDE_BOBINA")` / `MATERIAL_SEM_BOBINA`). Consequência: PVC, ACM, acrílico, MDF, papelão Paraná — todos já no catálogo mestre como matéria-prima, todos vendidos em **chapa 1220×2440**, nenhum com como calcular "quantas peças saem de uma chapa" nem quanto sobra. Uma gráfica de placas/comunicação visual rígida hoje só consegue usar SIMPLES (custo zero).

**Proposta:** `ModeloCalculo.CHAPA_RIGIDA` reaproveitando o **nesting 2D que o Offset já tem** (`src/lib/pricing/offset.ts`), mas com custo = `nº de chapas × preço da chapa` (não peso/gramatura/chapa de impressão) + custo de impressão por m² + o tempo de corte de A6. `FormatoFolha` passa a ser habilitado nesse modelo também (a estrutura já serve — largura/altura em metros). Casa direto com impressão UV flatbed, que é sobre rígido.

### A8. M2 é o único motor sem máquina, sem perda e sem vínculo com a matéria-prima

**Custo estimado:** 🔴 Caro — múltiplos models novos (`MaquinaGrandeFormato`, possivelmente `ModoImpressao`) mais FK nova em `ItemGrafica` e mudança estrutural no motor M2, que é o motor mais usado do sistema.

Três limitações que andam juntas, todas em `carregar.ts:162-204`:

**(a) Sem máquina.** OFFSET→`Prensa`, FLEXOGRAFIA→`MaquinaFlexografia`, DIGITAL→`ImpressoraDigital`, os 3 de personalização→`MaquinaSetupPorPeca`. M2 → nada. O custo de impressão é um único número digitado (`custoImpressaoM2`). Não há hora-máquina, tempo/perda de acerto, nem `perdaPercentPadrao` — todos os outros quatro motores têm.

**(b) Sem vínculo com o material.** O custo do m² vem de `ItemGrafica.precoCompra` **do próprio produto** (`carregar.ts:163`), exceto no caminho do clichê de etiqueta. Uma gráfica de comunicação visual que vende "Banner em Lona" em 280g, 440g, backlight e blackout precisa **duplicar o produto (e re-cadastrar as bobinas) por material**, e quando o preço da lona sobe tem que atualizar N produtos em vez de 1 matéria-prima. O Offset já resolveu isso com `papelId` + `TabelaPrecoPapel`; o M2 não herdou.

**(c) Sem passadas/camadas.** `custoImpressaoM2` é único. Em grande formato/UV, branco e verniz são **camadas separadas** e resolução (720 vs 1440 dpi) muda o consumo.

**Pesquisa:** o custo da tinta em grande formato varia de **R$3 a R$12/m² conforme a tecnologia e a configuração de cores (CMYK, Lc/Lm, branco, verniz)** e depende da resolução e do tipo de imagem; a impressão UV é feita "em camadas: cor, verniz e branco" ([Reilla Shop](https://reillashop.com.br/custos-de-impressao-em-grandes-formatos-como-calcular-e-nao-ter-prejuizos/), [Loja do Plotter — planilha ml/m²](https://www.lojadoplotter.com.br/plotter/custo-por-copia/Custo_por_Copia_Plotter_HP_510.pdf), [Fabriprint](https://www.fabriprint.pt/blog/impressoras/impressao-uv-dtf-como-personalizar-rigidos-em-serie-sem-perder-qualidade/)).

**Proposta:**
- `model MaquinaGrandeFormato { custoHoraMaq, velocidadeM2Hora, larguraMaquinaM, tempoAcertoH, metrosAcerto, perdaPercentPadrao, custoMinimo }` + `ItemGrafica.maquinaGrandeFormatoId` (mesmo padrão de `prensaId`/`maquinaFlexografiaId`, `onDelete: Restrict`).
- `ItemGrafica.materialId String?` (FK pra outro `ItemGrafica` MATERIA_PRIMA, exatamente como `papelId`), com sobrescrita opcional no orçamento — generalizando `OrcamentoItemPrecificacaoEtiqueta.papelId`, que já provou o padrão.
- `model ModoImpressao { maquinaId, nome, custoM2Adicional, multiplicadorTempo }` OU, mínimo viável, `OrcamentoItem.numeroCamadas Int? @default(1)` multiplicando `custoImpressaoM2`.

### A9. Peça maior que a bobina é erro fatal, não custo de emenda — **CONSTRUÍDO 2026-08-29 (rodada 15)**

**Status:** `model ConfiguracaoEmenda` opcional por item, exatamente como a proposta. Sem cadastro, comportamento de hoje preservado (`PECA_EXCEDE_BOBINA`); com cadastro, calcula nºPainéis + custo de emenda e devolve aviso no breakdown.

**O que falta:** `calcularM2` (`m2.ts:84-90`) lança `PECA_EXCEDE_BOBINA` com "É necessário emendar (solda/costura) — intervenção manual necessária". Em comunicação visual, **backdrop, fachada, outdoor e painel de evento emendados são rotina**, não exceção — e o catálogo mestre já vende os quatro. Hoje esses produtos simplesmente não passam pelo motor.

**Proposta:** quando nenhuma orientação couber, calcular `nºPainéis = ceil(w / wUtil)` e adicionar `custoEmendaPorMetroLinear × comprimento da emenda × (nºPainéis − 1)` — com `ConfiguracaoEmenda { itemGraficaId, custoPorMetroLinear, sobreposicaoM }` — devolvendo **aviso** no breakdown em vez de erro. Depende de A1 estar resolvido se for implementado via acabamento METRO_LINEAR.

### A10. Editorial multipágina não é representável — 7 produtos do catálogo mestre são inutilizáveis no motor

**Custo estimado:** 🔴 Caro — a própria proposta lista duas rotas alternativas e recomenda a mais estrutural (item de orçamento composto, `itemPaiId`), que é uma mudança transversal ao modelo central de orçamento.

**O que falta:** o modelo OFFSET assume **uma peça plana** (`larguraM`, `alturaM`, um `papelId`, uma `gramaturaGm2`, `corFrente`/`corVerso`). Revista, Catálogo, Livro Brochura, Livro Capa Dura, Apostila, Encadernação Espiral e Wire-o já estão no catálogo mestre — nenhum deles pode ser precificado, porque falta: **número de páginas**, cálculo de **cadernos/signatures**, e principalmente **papel/gramatura/cores do MIOLO separados dos da CAPA**.

**Pesquisa:** o formulário de orçamento de livro da PoloPrinter pede exatamente 12 campos, e os que o schema não tem são estruturais: *formato fechado, orelhas, cores da capa (4x0/2x0/1x0), papel da capa, papel especial de capa, cores do miolo (1x1), papel do miolo, número de páginas, tipo de encadernação* ([PoloPrinter](https://poloprinter.com.br/orcamento-de-livros-explicado/)). O miolo tem que ser múltiplo de 4 por causa da composição dos cadernos ([Fábrica do Livro](https://blog.fabricadolivro.com.br/como-usar-simulador-impressao-livro), [LeandroVSilva](https://leandrovsilva.download/entendendo-os-calculos-para-diagramacao-de-livro-impresso/)).

**Proposta — duas rotas, recomendo a segunda:**
1. *Específica:* `ModeloCalculo.EDITORIAL` + `OrcamentoItem.numeroPaginas` + `enum TipoEncadernacao { COLADA_HOTMELT, PUR, COSTURADA, GRAMPO_CANOA, WIRE_O, ESPIRAL, CAPA_DURA, OUTRO }` + `tipoEncadernacaoOutro` + `temOrelhas`/`larguraOrelhaCm` + tabela de componentes (MIOLO/CAPA/GUARDA/SOBRECAPA) com papel+gramatura+cores próprios.
2. *Genérica e mais valiosa:* **item de orçamento composto** — `OrcamentoItem.itemPaiId String?`, permitindo que uma linha do orçamento seja a soma de sub-linhas, cada uma com **seu próprio `modeloCalculo`**. Isso resolve num só golpe: livro (capa OFFSET + miolo OFFSET + encadernação), caixa (caixa CHAPA + berço + luva), kit de brinde (caneca REVENDA + gravação PERSONALIZACAO), letreiro (chapa cortada + iluminação + instalação). É o gap estrutural mais transversal do módulo.

### A11. Embalagem/cartonagem: a dimensão que importa é a planificação, não o produto acabado

**Custo estimado:** 🟡 Médio — campos novos nullable em `OrcamentoItem`, mas exigem alterar a chamada de nesting existente pra preferir a dimensão planificada quando presente.

**O que falta:** `larguraCm`/`alturaCm` do item alimentam direto o nesting. Numa caixa 20×15×10 cm, o que ocupa a folha é o **desenvolvimento da faca (~55×45 cm)**, não o 20×15. Sem separar os dois, o custo de uma embalagem sai errado por 2-3×.

**Pesquisa:** o cálculo de cartonagem parte "do projeto com todas as características da embalagem" e avalia "as medidas internas para o melhor aproveitamento do material cartonado"; reforços, divisórias e componentes impactam o custo à parte ([BC3](https://bc3.com.br/calculo-custo-cartonagem), [Pcboot](https://www.pcboot.com.br/calculo-custo-cartonagem), [Milênio Embalagens](https://www.milenio-embalagens.com.br/artigo/como-calcular-o-preco-da-caixa-de-papelao-ondulado)).

**Proposta:** `OrcamentoItem.larguraPlanificadaCm`/`alturaPlanificadaCm` (opcionais; o motor usa elas quando presentes, cai em `larguraCm`/`alturaCm` quando não). Para papelão ondulado, o tipo de onda (B/C/BC/E/EB) e a resistência (ECT/Coluna) cabem bem em `VarianteMateriaPrima`, que já existe — não precisa de schema novo. Os componentes (berço, divisória, luva) dependem de A10 rota 2.

### A12. Revenda e terceirização não passam pelo motor de custo — **CONSTRUÍDO 2026-08-24 (rodada 7)**

**Status:** `ModeloCalculo.REVENDA` (10º rótulo) — `custoBase = Q × custoAquisicaoUnitario`, sem máquina, mas passando pelo mesmo `comporPreco` de todo mundo (ganha overhead/imposto/margem/piso e breakdown auditável). `OrcamentoItem.custoAquisicaoUnitario` é override opcional por orçamento; sem preenchido, cai no `ItemGrafica.precoCompra` do catálogo. **Achado extra pego na varredura final**: `src/app/catalogo/[itemGraficaId]/actions.ts` (salvar modelo de cálculo do produto) não tinha branch nem pra REVENDA nem pra PERSONALIZACAO (rodada 6) — salvar um produto com qualquer um desses dois modelos retornava "sucesso" sem gravar nada, silenciosamente. Corrigido junto.

**O que faltava:** `SIMPLES` é "preço digitado, zero custo calculado". `src/lib/orcamento-margem.ts` até estima margem via `precoCompra × quantidade`, o que atenua o problema — mas: (a) o preço não é **derivado** do custo (nada de overhead/imposto/margem/piso de `comporPreco`), (b) não há `breakdown` auditável, e (c) `precoCompra` é um número **estático do catálogo**, enquanto o preço de um brinde de fornecedor muda por cotação e por faixa de quantidade a cada orçamento.

**Pesquisa:** o modelo do setor de brindes é explicitamente "produto comprado + gravação aplicada" — laser CO2/fibra ou tampografia sobre um item de terceiro ([Luminati](https://www.luminatibrindes.com.br/tipos-gravacoes.php), [XBZ](https://www.xbzbrindes.com.br/empresagravacao)). Terceirização de acabamento é prática corrente de gráfica rápida (inferência minha, apoiada no fato de que os ERPs concorrentes tratam compras/OS como fluxo integrado — [Calcme](https://www.calcme.com.br/sistema-erp-para-graficas/)).

**Proposta:** `ModeloCalculo.REVENDA` — `custoBase = Q × custoAquisicaoUnitario`, onde `custoAquisicaoUnitario` vem de `OrcamentoItem.custoAquisicaoUnitario Decimal?` (default = `ItemGrafica.precoCompra`, sobrescrevível **neste orçamento**), passando por `comporPreco` como todo mundo → ganha overhead, imposto, margem, piso e breakdown. Combinado com A10-rota-2 e A3, cobre brinde-com-gravação inteiro.

### A13. Bases de cobrança que faltam (menor) — **CONSTRUÍDO 2026-08-24 (rodada 10)**

**Status:** `BaseCobranca.MILHEIRO`/`CENTO` adicionados, `calcularQtdBase` (`src/lib/pricing/acabamento.ts`) resolve com `quantidade/1000` e `quantidade/100`. Sem risco de custo silencioso — usa o mesmo `ctx.quantidade` que `UNIDADE` já usa, sempre disponível.

`BaseCobranca` não tem `MILHEIRO`/`CENTO`, que é o jargão universal de acabamento gráfico brasileiro ("R$ X o milheiro" pra dobra, alceamento, encarte, aplicação). `ItemGrafica.unidadeContagem`/`fatorConversao` resolve a **exibição** mas não a base de cálculo do acabamento. Proposta: `MILHEIRO` e `CENTO` como bases (aritmética trivial: `qtd/1000`, `qtd/100`), já que `BaseCobranca` é um seletor de fórmula e portanto não comporta `OUTRO`.

## Achados no Orçamento

### B1. `TipoFrete` tem 2 das 6 modalidades oficiais da NF-e — e o sistema emite NF-e — **CONSTRUÍDO 2026-08-24 (rodada 6)**

**Status:** enum expandido pros 6 valores oficiais (`RENAME VALUE` nos 2 existentes preservando dado, `ADD VALUE` pros 4 novos — mesma técnica já usada em `StatusPedido`). Bug irmão corrigido junto: `src/lib/focus-nfe.ts` mandava `modalidade_frete: "9"` **fixo**, ignorando `Orcamento.frete` por completo — agora usa `resolverModalidadeFrete()` (função pura nova em `src/lib/nota-fiscal.ts`) mapeando o valor real escolhido no orçamento. `freteSchema` e as opções visíveis no formulário atualizadas nos 2 fluxos (criação e edição de orçamento).

**O que faltava:** `enum TipoFrete { EMITENTE, DESTINATARIO }` (schema:1680) mapeia só `modFrete=0` (CIF) e `modFrete=1` (FOB). O schema tem `model NotaFiscal` e `StatusNotaFiscal`, então isso vira problema fiscal no momento da emissão. Faltam quatro, sendo uma **muito comum em gráfica rápida**: `9 = Sem Ocorrência de Transporte` (retirada no balcão).

**Pesquisa:** o layout NF-e 4.0 define `modFrete` com 0 (Remetente/CIF), 1 (Destinatário/FOB), 2 (Terceiros), 3 (Transporte Próprio por conta do Remetente), 4 (Transporte Próprio por conta do Destinatário), 9 (Sem Ocorrência de Transporte); campo obrigatório e validado pela SEFAZ ([DataFrete](https://www.datafrete.com/tipos-de-frete-na-nf-e-modalidades-codigos-e-novas-exigencias-fiscais/), [NS Tecnologia](https://blog.nstecnologia.com.br/modalidades-de-frete-nf-e/), [TecnoSpeed](https://atendimento.tecnospeed.com.br/hc/pt-br/articles/360014970274-Regra-Tributaria-modFrete-Modalidade-do-frete-da-NF-e)).

**Proposta:** expandir para os 6 valores oficiais — `CIF_REMETENTE`, `FOB_DESTINATARIO`, `TERCEIROS`, `PROPRIO_REMETENTE`, `PROPRIO_DESTINATARIO`, `SEM_FRETE` — com migration `ALTER TYPE RENAME VALUE` nos dois existentes (mesma técnica já usada em `StatusPedido`, documentada no schema:2450), preservando o dado.

### B2. Não existe tolerância de tiragem (±%) — **CONSTRUÍDO 2026-08-24 (rodada 8)**

**Status:** `ParametrosGrafica.toleranciaTiragemPadraoPercent` (default 10%) snapshotado em `Orcamento.toleranciaTiragemPercent` no momento do envio (mesmo ciclo de vida de `validoAteEm` — zera ao reabrir pra RASCUNHO), impresso no PDF como "Tolerância de tiragem: ±X% sobre a quantidade contratada". Corrigido também `gerarLinkPublico`, que tem o mesmo bloco de snapshot duplicado de `validoAteEm` — sem isso, orçamentos enviados por esse caminho ficariam sem a cláusula.

**O que faltava:** nenhum campo declara a variação admissível de quantidade entregue. Sem isso, o PDF não traz a cláusula e o faturamento da quantidade real (que quase nunca bate exato) fica sem respaldo contratual.

**Pesquisa:** o mercado offset opera com variação/quebra admissível de **5% a 10% a mais ou a menos** (quebra de máquina, acerto de cor no início da rodagem), e "contratos éticos descrevem essa tolerância técnica antes de fechar o negócio" ([Neoband](https://www.neoband.com.br/como-pedir-orcamento-em-grafica-sem-surpresas/), [Revenda KWG](https://blog.revendakwg.com.br/destaque/como-realizar-um-orcamento-grafico/)). O motor já modela a perda no **custo** (`perdaPercentPadrao` na Prensa/Flexo) — mas não no **compromisso comercial**.

**Proposta:** `ParametrosGrafica.toleranciaTiragemPadraoPercent Decimal? @default(0.10)` + `Orcamento.toleranciaTiragemPercent Decimal?` (snapshot no envio, igual `validoAteEm`), impresso no PDF e usado como aviso no momento de faturar quantidade divergente.

### B3. Entrega programada / parcelada não existe

**Custo estimado:** 🔴 Caro — novo model relacionado a `Entrega`/`Pedido`, relaxar `Entrega.pedidoId` de `@unique` pra N:1, e a própria proposta avisa que interage com o financeiro (faturamento por entrega) e pede avaliação antes de implementar.

**O que falta:** `Orcamento` tem um `localEntrega String?` e um `prazoEntregaEstimadoDias Int?`; `Entrega` é **1:1 com Pedido** (`pedidoId String @unique`, schema:2612). Não há como representar "produz 60.000 rótulos agora, entrega 10.000/mês por 6 meses, fatura por entrega" — que é um **modelo de negócio explícito** de gráficas de embalagem e rótulo, exatamente o perfil que o produto já atende bem no resto.

**Pesquisa:** "nesse modelo de produção reduzem o custo por embalagem por meio de produção em alta quantidade e estoque do produto final no galpão... clientes podem solicitar entregas parciais ao longo de um trimestre, semestre ou ano, sendo o faturamento realizado somente quando das entregas e proporcional à quantidade solicitada" ([Forma Pack](https://formapack.ind.br/home2/)).

**Proposta:** `model OrcamentoEntregaProgramada { orcamentoId, ordem Int, quantidade Int, dataPrevista DateTime?, localEntrega String? }` (soma validada = quantidade total do item/orçamento), e relaxar `Entrega.pedidoId` de `@unique` para N:1, herdando as parcelas na aprovação. Interage com o financeiro (`ContaReceber` por parcela de entrega) — vale checar antes de implementar.

### B4. Prazo é por orçamento, nunca por item

**Custo estimado:** 🟢 Barato — campo nullable novo em `OrcamentoItem` (model já existente), com o cabeçalho passando a exibir o máximo dos itens; o enum de início de contagem é só um complemento opcional.

**O que falta:** `prazoEntregaEstimadoDias` é único no cabeçalho. Um orçamento com "Banner (2 dias)" + "Livro capa dura (20 dias)" só consegue declarar um número — e o vendedor acaba prometendo 20 dias pro banner ou 2 dias pro livro.

**Embasamento:** os ERPs de gráfica tratam prazo como atributo **do trabalho**: "cada trabalho pode reunir dados comerciais, medidas, material, acabamento, quantidade, **prazo**, valor, custo e identificação interna" ([Elo Visual — OS para gráfica](https://elovisual.com.br/ordem-de-servico-grafica/), [vhsys](https://www.vhsys.com.br/segmentos/graficas/)).

**Proposta:** `OrcamentoItem.prazoEstimadoDias Int?` opcional; o campo do cabeçalho passa a exibir o máximo dos itens quando algum estiver preenchido (sem quebrar quem só usa o cabeçalho). Complemento útil: `enum InicioContagemPrazo { APROVACAO_ORCAMENTO, APROVACAO_ARTE, APROVACAO_BAT, RECEBIMENTO_MATERIAL }` — "o prazo conta a partir da aprovação da arte" é cláusula padrão e o sistema já tem os marcos (`etapaAprovacaoEm`, aprovação de BAT) pra ancorar isso. *Esse enum é inferência minha* apoiada na existência dos marcos, não achei fonte que o formalize.

### B5. Não há tabela de faixas de quantidade no mesmo item

**Custo estimado:** 🟡 Médio — 1 model novo com FK direta pra `OrcamentoItem`, reaproveitando o mesmo motor de cálculo e o mesmo mecanismo de promoção na aprovação que `OrcamentoOpcao` já usa.

**O que falta:** o orçamento gráfico brasileiro clássico apresenta 3 tiragens lado a lado ("1.000 / 3.000 / 5.000"). `OrcamentoOpcao` chega perto, mas: teto de 2 alternativas + base, é criada "de uma vez só, como um carrinho" (sem edição incremental, comentário do schema:2170), e obriga a recriar o conjunto inteiro de itens só pra variar a quantidade de um.

**Pesquisa:** "o B2B trabalha com **preço por faixa de quantidade** ou por perfil de cliente, enquanto o B2C tem preço único de vitrine"; e "na maior parte dos casos o valor é tanto menor quanto maior a tiragem" ([base.com](https://base.com/pt-BR/blog/ecommerce-b2b-em-marketplace/), [Minerva](https://minerva-online.pt/en/orcamento-grafica/)).

**Proposta:** `model OrcamentoItemFaixaQuantidade { orcamentoItemId, quantidade Int, precoUnitario, precoTotal, breakdown Json? }` — cada faixa recalculada pelo **mesmo** motor (a diluição de setup/clichê/chapa acontece sozinha, o motor já é correto nisso), renderizada como tabela no PDF e no link público. Na aprovação, a faixa escolhida promove-se ao item (mesmo mecanismo de `resolverOpcoesNaAprovacao`).

### B6. Linha de orçamento sempre tem que ser um item do catálogo, e não tem descrição própria — **PARCIALMENTE CONSTRUÍDO 2026-08-24 (rodada 9)**

**Custo estimado (restante pendente):** 🔴 Caro — tornar `itemGraficaId` opcional mexe numa FK central que o motor de precificação e todo o resto do sistema assume presente, e exige derivar `custoAquisicaoUnitario` corretamente pra não mentir a margem.

**Status:** `OrcamentoItem.descricaoLivre` sobrepõe o nome do catálogo no PDF e no link público quando preenchido — resolve o caso "80% do incômodo" citado abaixo. **Fora de escopo de propósito**: `itemGraficaId` continua obrigatório — a parte opcional do achado (permitir item sem catálogo, nome+preço digitados) não foi construída.

**O que falta:** `OrcamentoItem.itemGraficaId String` é NOT NULL, e o único texto livre por item é `acabamento String?` (documentado como "modo SIMPLES apenas"). Um serviço avulso, uma terceirização pontual ou uma linha "montagem e instalação no local" exige criar item privado de catálogo antes. E o PDF mostra o nome genérico do catálogo ("Banner em Lona"), não "Banner 3×1m lona 440g com bastão e corda".

**Proposta:** `OrcamentoItem.descricaoLivre String?` (aparece no PDF/link público sobrepondo o nome do catálogo — resolve 80% do incômodo com 1 campo) e, opcionalmente, permitir `itemGraficaId` nulo com nome+preço digitados, exigindo `custoAquisicaoUnitario` de A12 pra não mentir a margem.

### B7. Flag "material fornecido pelo cliente" — **CONSTRUÍDO 2026-08-24 (rodada 8) — corrigia regressão real do A2**
**Status:** `OrcamentoItem.materialFornecidoPeloCliente` zera `custoSubstratoPorPeca` no contexto pra DIGITAL e os 4 de setup-por-peça (nunca REVENDA — lá o "custo de aquisição" é o produto inteiro). Achado extra pego na verificação final: `validarPedidoDigital` (`src/lib/pricing/validar.ts`) tinha um guard pré-existente `custoSubstratoPorPeca <= 0 → erro` (pra pegar gráfica que esqueceu de configurar `precoCompra`) que rejeitava o zero *intencional* do B7 com a mesma mensagem de configuração ausente — um teste de integração pegou isso antes de ir pro ar. Corrigido com `ContextoDigital.materialFornecidoPeloCliente?: boolean`, que o guard passou a checar antes de barrar o zero.

**O que faltava:** nenhum campo distingue "eu forneço a camiseta/papel" de "o cliente traz". Muda custo, margem e responsabilidade por perda. Ficou **especialmente crítico depois que construímos A2** (rodada 5) — sem esta flag, toda gráfica de estamparia com "cliente traz a peça" seria cobrada pelo custo de uma peça que nunca comprou. *Inferência minha*, apoiada na estrutura de preço "só estampa" que aparece nas fontes de estamparia acima.

## Prioridade sugerida (Orçamento + Catálogo)

Ordenada por quantas gráficas reais provavelmente esbarram, cruzando com o custo de implementação.

| # | Achado | Por que primeiro |
|---|---|---|
| 1 | **A1** — METRO_LINEAR e HORA mortos | É um **bug**, não um gap. Quebra o orçamento inteiro de qualquer gráfica de comunicação visual que configure bainha/ilhós/instalação. Correção pequena e localizada. |
| 2 | **A2** — substrato ausente em serigrafia/sublimação/estampagem | Ataca o diferencial central ("quanto lucrei") justo onde o custo dominante é o item em branco. Vestuário/brindes é dos maiores segmentos em número de empresas. Muito barato (copia o padrão do Digital). |
| 3 | **A8** — M2 sem máquina, sem material vinculado, sem perda | Comunicação visual/gráfica rápida é o maior grupo numérico de gráficas do Brasil, e o M2 é o motor delas. Duplicar produto por material é atrito de cadastro que o Offset já não tem. |
| 4 | **A3** — `ProcessoSetupPorPeca` sem `OUTRO` + `PERSONALIZACAO` genérica | Escape hatch clássico do repo, muito barato, e sozinho destrava tampografia, gravação a laser, DTG e transfer. Exatamente o princípio "nunca uma lista sem fuga". |
| 5 | **A12** — `REVENDA` com custo de aquisição | Todo brinde e toda terceirização hoje entra como SIMPLES sem breakdown. Barato e alinhado ao diferencial. |
| 6 | **B1** — `TipoFrete` com 6 modalidades NF-e | Risco fiscal concreto, correção de 1 enum + migration de rename. "Sem frete/retirada no balcão" é o caso mais comum de gráfica rápida e não existe. |
| 7 | **A10** — editorial multipágina (preferir a rota "item composto") | 7 produtos do catálogo mestre inutilizáveis no motor. Alto esforço, mas a rota composta resolve editorial + embalagem + kit de uma vez — é o gap estrutural mais transversal. |
| 8 | **A5** — DTF no motor certo | DTF é hoje um dos processos que mais cresce em estamparia; está classificado como o processo errado, o que é pior que não existir (erra silenciosamente). Reaproveita `calcularM2`. |
| 9 | **A7 + A6** — chapa rígida + tempo de máquina | Placas/ACM/acrílico/MDF/laser: categoria inteira já no catálogo mestre, sem custo real possível. A7 reaproveita o nesting do Offset. |
| 10 | **B3** — entrega programada/parcelada | Modelo de negócio explícito de rótulo/embalagem — o perfil que o sistema já atende melhor. Esforço médio-alto (toca financeiro). |
| 11 | **A9** — emenda/solda em vez de erro fatal | Backdrop/fachada/outdoor emendados são rotina; hoje o motor recusa o job. |
| 12 | **B2** — tolerância de tiragem | Barato, cláusula padrão do setor, evita disputa de faturamento. |
| 13 | **A4** — modelo BORDADO | Fórmula bem documentada, mas segmento menor que os de cima. |
| 14 | **B5, B4, B6, B7, A11, A13** | Faixas de quantidade, prazo por item, descrição livre, material do cliente, planificação de embalagem, bases MILHEIRO/CENTO — todos reais, todos incrementais, nenhum bloqueia um perfil inteiro de gráfica. |

Critical files: `prisma/schema.prisma` (enums `ModeloCalculo`/`BaseCobranca`/`TipoFrete`/`ProcessoSetupPorPeca`), `src/lib/pricing/precificar.ts` (achado A1), `src/lib/pricing/carregar.ts` (A2, A8b), `src/lib/orcamento-precificacao.ts`, `src/app/catalogo/[itemGraficaId]/ConfiguracaoProdutoForm.tsx`, `src/lib/pricing/acabamento.ts` e `tipos.ts`.

---

# Parte 2 — Produção

## Resumo

Pesquisei como ERPs/MES industriais brasileiros (Maxiprod, Nomus, FoccoERP, Senior, Command Perfect) e print MIS internacionais (PrintVis/Wye, Optimus, Presswise, Printlogic) modelam chão de fábrica, e como cada processo gráfico (offset, flexo, digital, serigrafia, grande formato, embalagem) realmente se organiza. A conclusão é que o GrafPro hoje modela **produção como um campo de estado (`StatusPedido`) e não como um processo**: existe uma sequência linear única, hard-coded, sem roteiro por produto, sem histórico de etapa, sem operador, sem máquina, sem quantidade produzida/refugada, sem aprovação intermediária, sem retorno para retrabalho e sem representação de etapa terceirizada. O padrão universal nos sistemas pesquisados é o oposto: **roteiro configurável por produto** (sequência de operações) + **apontamento por operação** (operador, máquina, quantidade boa, quantidade refugada, tempo).

Isso não é só um problema de abrangência para outros perfis de gráfica — é um buraco direto no diferencial declarado do produto ("quanto esse pedido me deu de lucro?"): o refugo depois da entrada em produção, o tempo-máquina realmente gasto, e o custo de etapa mandada pra fora hoje **não entram na conta de lucro**.

## Achados

### A. Estrutura do fluxo

#### A1 — Fluxo linear único, sem roteiro por produto/processo
**Custo estimado:** 🔴 Caro — a Fase 2 exige models novos (`FluxoProducao`/`EtapaFluxo`) e faz `Pedido.status` virar derivado da etapa atual, mexendo na lógica de transição protegida por CAS que já existe.

**O que falta.** `SEQUENCIA_STATUS_PEDIDO` (`src/lib/producao-estagios.ts:12`) é um array literal de 8 valores de enum, e `avancarStatusPedido` (`src/app/producao/status-transicao.ts:248-260`) avança sempre para `indice + 1`. Não existe nenhum ponto onde uma gráfica, um produto ou um `modeloCalculo` possa dizer "essa etapa não existe pra mim". Uma gráfica só-digital arrasta card por `CLICHE_FACA` sem clichê nenhum; uma serigrafia não tem onde representar "queima de tela" (que é uma operação real, com custo e refugo — a tela pode velar); uma comunicação visual não tem "aplicação/instalação no cliente", que é a etapa mais cara e mais arriscada do serviço dela.

**Pesquisa.** O conceito canônico nos ERPs industriais é *roteiro de produção*: "a sequência de operações que levam dos insumos ao item concluído"; "o usuário pode editar livremente o roteiro, acrescentando novas operações, centros de trabalho" (Maxiprod, Senior, Stout, Methos). Print MIS usa o mesmo com outro nome: "job routing can be created by dragging and dropping to create templates using blueprints" (Presswise). Os processos divergem materialmente: offset tem CTP/chapa; flexo tem clichê + cilindro; serigrafia tem film → emulsão → exposição → lavagem → impressão → **cura** (etapa que não existe em nenhum outro processo, com parâmetro de qualidade próprio — 160-170 °C pra plastisol); grande formato tem impressão → recorte (plotter/flatbed) → **aplicação/instalação no endereço do cliente**.

**Proposta.** Duas fases, sem quebrar nada de imediato.

*Fase 1 (barata, resolve o gap declarado):* per-tenant on/off + rótulo por etapa. Nova tabela `EtapaGrafica { graficaId, status StatusPedido, ativa Boolean, rotulo String?, ordem Int }`, com bootstrap das 8 linhas na primeira abertura de Configurações (mesmo padrão de `garantirCategoriasCustoPadrao`). `SEQUENCIA_STATUS_PEDIDO` deixa de ser constante e vira `resolverSequencia(graficaId)`; `proximoStatus` pula etapas inativas. Isso já entrega: gráfica digital desliga `CLICHE_FACA`; serigrafia renomeia `CLICHE_FACA` para "Queima de tela"; comunicação visual renomeia `EXPEDICAO` para "Instalação".

*Fase 2 (estrutural):* roteiro de verdade. `FluxoProducao { graficaId, nome, padrao }` + `EtapaFluxo { fluxoId, tipo TipoEtapaProducao, tipoOutro String?, nome, ordem, baixaEstoque Boolean, exigeAprovacaoQualidade Boolean, permiteTerceirizacao Boolean }`, com `ItemGrafica.fluxoProducaoId` (roteiro por produto) e fallback pro fluxo padrão da gráfica. O enum novo é a "família canônica" que o sistema sabe interpretar, com escape:

```
enum TipoEtapaProducao {
  ARTE_PRE_IMPRESSAO
  PREPARACAO_MATRIZ   // chapa/CTP, clichê, faca, tela, cilindro — hoje "CLICHE_FACA"
  PRODUCAO
  ACABAMENTO
  CONFERENCIA
  EMBALAGEM
  EXPEDICAO
  INSTALACAO          // comunicação visual / grande formato
  ENTREGUE
  OUTRA               // + tipoOutro
}
```

`Pedido` ganha `etapaFluxoId String?` convivendo com `status` durante a migração (o `status` vira derivado do `tipo` da etapa atual, mantendo dashboard/webhook/e-mail funcionando sem reescrita).

**Ponto de atenção que a implementação vai encontrar:** três constantes hard-coded se tornam incorretas com fluxo configurável e precisam virar consultas ao fluxo — `ESTAGIOS_PRE_PRODUCAO` (gate do módulo Entrega, `producao-estagios.ts:40`), `ESTAGIOS_ATRIBUIVEIS` (`:49`, também usado por `ResponsavelEstagio` e pelo bypass de permissão em `podeConfirmarEstagio`), e a condição literal `pedido.status === "CLICHE_FACA" && proximoStatus === "PRODUCAO"` que dispara a baixa de estoque (`status-transicao.ts:272`) — esta última deve virar `etapaAnterior.baixaEstoque === true`.

#### A2 — `CLICHE_FACA` embute o perfil da gráfica de referência no nome do estado
**Custo estimado:** 🟡 Médio — a proposta usa exclusivamente o campo `rotulo` do model novo `EtapaGrafica` da Fase 1 de A1; sem esse model construído primeiro, A2 não tem onde guardar o rótulo por tenant.

**O que falta.** O nome do estado (visível no Kanban, no e-mail ao responsável, no webhook de automação, no PDF) assume matriz física de flexografia/corte-e-vinco. Offset usa chapa (CTP), serigrafia usa tela, rotogravura usa cilindro, digital não usa nada.

**Pesquisa.** A taxonomia consensual do setor no Brasil é **pré-impressão → impressão → acabamento** (Gráfica Riomega, Gráfica Natal, Tecnicópias, ExpoPrint), com a matriz sendo um artefato variável dentro da pré-impressão, não uma etapa nomeada.

**Proposta.** Coberto pela Fase 1 de A1 (rótulo por tenant). Sem migração de dados: o valor de enum continua `CLICHE_FACA`, só o `rotulo` muda por gráfica. Rótulo default sugerido, neutro: "Pré-impressão".

### B. Rastreamento operacional (o buraco maior)

#### B1 — Nenhum registro de quem, quando e quanto: transição de etapa não deixa rastro nenhum — **CONSTRUÍDO 2026-08-29 (rodada 15)**

**Status:** `model ApontamentoEtapa` construído, aberto/fechado dentro da transação do CAS de `avancarStatusPedido`, nos 3 canais (painel, link público, QR). **Escopo restrito:** campos de refugo (B3) ficaram de fora de propósito.

**O que falta.** Confirmado no código: `avancarStatusPedido` faz `prisma.pedido.updateMany({ data: { status: proximoStatus } })` e nada mais. **Não chama `registrarAuditoria`** (grep confirma: auditoria existe em `custos`, `entrega` e `fechamento`, nunca na transição de status) e não existe nenhum model `Historico*` no schema. Nem pelo link público (`/p/[token]`), nem pelo QR de chão de fábrica (`/q/[token]`). O resultado prático: **não dá pra saber quando um pedido entrou em Acabamento, quanto tempo ficou lá, nem quem o moveu.** Não há como calcular lead time por etapa, gargalo, nem produtividade.

O contraste dentro do próprio schema é gritante: `SolicitacaoCompra` tem `solicitadoEm / cotandoEm / aprovadoEm / compradoEm / recebidoEm / conferidoEm / canceladoEm` — datas dedicadas por transição, com comentário explicando exatamente por que ("a tela de detalhe precisa montar sua própria linha do tempo sem depender de outra tabela"). O Pedido, que é o objeto central do produto, não tem nenhuma.

**Pesquisa.** *Apontamento de produção* é o registro de "todas as etapas que um produto percorre na linha de produção... início e fim da produção... serve para rastrear onde o produto está e também para identificar falhas, desperdícios e gargalos" (Maxiprod, FoccoERP, Command Perfect). Lead time é definido como soma decomposta por camada — "pré-processamento, espera, processamento, armazenagem, transporte e inspeção" (Nomus, Objective) — o que exige timestamp por etapa, não só o status atual.

**Proposta.** Model `ApontamentoEtapa`, criado a cada entrada em etapa e fechado na saída:

```
model ApontamentoEtapa {
  id, graficaId, pedidoId
  status StatusPedido           // ou etapaFluxoId, depois de A1 fase 2
  iniciadoEm DateTime @default(now())
  finalizadoEm DateTime?        // preenchido na transição de saída
  operadorId String?            // sem FK, mesmo padrão de MovimentacaoEstoque.criadoPorId
  operadorNomeDeclarado String? // quando veio do QR/link público, mesmo padrão de arteRespondidaPor
  origemConfirmacao OrigemConfirmacaoEtapa  // APP / LINK_PUBLICO / QR_ETIQUETA
  quantidadeBoa Int?
  quantidadeRefugo Int?
  motivoRefugo MotivoRefugo?
  motivoRefugoOutro String?
  observacao String?
  ...FKs de máquina (ver B2)
}
```

`avancarStatusPedido` fecha o apontamento aberto (`finalizadoEm = now()`) e abre o da etapa seguinte, dentro da mesma transação do `updateMany` com CAS — a idempotência já garantida pelo CAS cobre o apontamento de graça. Backfill: pedidos existentes ficam sem histórico anterior (aceitável), a linha do tempo começa a partir da migração.

Esse único model destrava: lead time por etapa, gargalo por coluna do Kanban, produtividade por operador, e é a base de B2/B3/C1.

#### B2 — Não se registra em QUAL máquina o pedido rodou — **CONSTRUÍDO 2026-08-29 (rodada 15)**

**Status:** as 5 FKs de máquina em `ApontamentoEtapa`, mesmo padrão de `RegistroManutencao`. Sugestão pré-preenchida a partir da precificação, aviso de divergência no fechamento do pedido. Só o canal autenticado coleta máquina (link público/QR ficam simples).

**O que falta.** Confirmado por grep: `prensaId / maquinaFlexografiaId / impressoraDigitalId / maquinaSetupPorPecaId` existem em **`ItemGrafica`** (catálogo, fins de preço, `onDelete: Restrict`) e em **`RegistroManutencao`** (parada de máquina). Não existem em `Pedido` nem em lugar nenhum do fluxo de produção. Ou seja: a gráfica com duas prensas offset precifica o job na Prensa A e pode rodar na Prensa B — e o sistema nunca fica sabendo. Três consequências: (i) custo hora-máquina real ≠ custo orçado, e a diferença é invisível no lucro do pedido; (ii) impossível relatório de "quanto essa máquina produziu / quanto custou"; (iii) impossível fila por máquina (ver C1).

**Pesquisa.** No apontamento padrão, "o operador ao iniciar a operação informará o código do cadastro, número da Ordem, operação **e máquina**" (Command Perfect). Print MIS roteia o job "to the most appropriate press based on substrate, run length, finishing requirements, and real-time machine availability" (Dalim/proofnation) — o vínculo job↔máquina é dado operacional de primeira classe.

**Proposta.** As 5 FKs opcionais em `ApontamentoEtapa`, **exatamente no padrão já estabelecido por `RegistroManutencao`** (5 FKs nullable, "exatamente 1 preenchida", validado em app não no banco) — reaproveitando literalmente `validarSelecaoMaquina` de `src/lib/manutencao-maquina.ts`, mais `equipamentoId` (guilhotina, laminadora, plotter etc., que hoje só serve pra manutenção e nunca aparece em produção). Sugestão padrão pré-preenchida a partir da máquina que o `ItemGrafica` usou na precificação, editável pelo operador. Quando divergir, gerar aviso na tela de custos do pedido ("rodou em máquina diferente da orçada") — encaixa no campo `possivelDuplicidade`/aviso que `CustoPedido` já sabe renderizar.

#### B3 — Refugo só existe uma vez, no lugar errado, e como perda de MATERIAL
**Custo estimado:** 🟡 Médio — campos novos em `ApontamentoEtapa` (model já existente de B1) mais 1 enum novo fechado+`OUTRO` (`MotivoRefugo`), reaproveitando o motor de baixa de estoque que `perda-fixa-producao.ts` já implementa.

**O que falta.** O sistema captura perda exatamente **uma** vez: na transição `CLICHE_FACA → PRODUCAO`, via `resolverPerdasConfirmadas` / `perdaFixaPadrao`, e o que ele modela é *perda de calibragem/acerto de máquina* (folhas de acerto), lançada como `MovimentacaoEstoque` + `CustoPedido`. Depois disso, **nada**: 300 folhas cortadas errado na guilhotina, 80 camisetas com cura mal feita, 40 metros de lona com falha de tinta no meio da bobina — nenhum desses tem onde ser registrado. E como o refugo pós-produção normalmente exige *reimprimir* (consumindo material de novo), o custo real do pedido fica sistematicamente subestimado, o que ataca diretamente o diferencial do produto.

**Pesquisa.** É padrão explícito: "além da quantidade produzida, o usuário poderá informar **até quatro motivos de refugo** e a quantidade referente a esse motivo. Ao fazer isso, o sistema fará a entrada no estoque da quantidade informada como produzida e imediatamente fará uma saída de estoque das quantidades refugadas" (Maxiprod). Na indústria gráfica especificamente, "o retrabalho é um dos problemas que mais afetam financeiramente as empresas" e figura como indicador-chave de qualidade (IndústriaPro, Núcleo do Conhecimento, Guia do Gráfico sobre controle de qualidade em mídia impressa com normas ABTG/ABNT/FOGRA).

**Proposta.** `quantidadeBoa` / `quantidadeRefugo` / `motivoRefugo` em `ApontamentoEtapa` (B1), com enum fechado + escape:

```
enum MotivoRefugo {
  ACERTO_MAQUINA        // calibragem — o caso que hoje já existe
  ERRO_REGISTRO_COR
  FALHA_IMPRESSAO       // borrão, falha de tinta, riscos
  ERRO_CORTE_REFILE
  FALHA_ACABAMENTO      // laminação bolhada, dobra torta, cola
  MATERIAL_DEFEITUOSO   // culpa do fornecedor — precisa ser separável
  ERRO_ARTE_ARQUIVO
  ERRO_OPERACIONAL
  OUTRO                 // + motivoRefugoOutro
}
```

`MATERIAL_DEFEITUOSO` separado de propósito: é o único motivo cujo custo é potencialmente recuperável do fornecedor, e amarra com `Fornecedor`/`SolicitacaoCompra` que já existem. Quando `quantidadeRefugo > 0`, oferecer (não impor) a baixa adicional de matéria-prima reaproveitando o motor que já existe em `status-transicao.ts` — mesmas funções de `perda-fixa-producao.ts`, mesmo `snapshotCustoFicha`, mesmo `criarCustoAutomaticoConsumo`.

### C. Fila, capacidade e paradas

#### C1 — Fila é única e sem ordem; não há noção de "fila por máquina"
**Custo estimado:** 🟡 Médio — campo `prioridade` novo em `Pedido` (barato isolado), mas as sub-raias por máquina e o badge de máquina parada são lógica nova moderada no Kanban existente.

**O que falta.** No `KanbanBoard.tsx`, cada coluna é uma etapa e os cards são renderizados na ordem de `createdAt` da query (`page.tsx:125`), sem prioridade, sem reordenação, sem raia por máquina. Com duas prensas offset, os dois jobs aparecem no mesmo balde "Produção" e quem decide o que roda primeiro é a memória do encarregado. Também não há como o Kanban avisar que a máquina onde o job vai rodar está parada — apesar de `buscarManutencoesAtivas` já existir e ser usada nas telas de Máquinas e de cadastro de produto.

**Pesquisa.** Scheduling board por máquina é feature central de print MIS: "full visibility of machine capacity, both short and long term, and detailed scheduling of each production step" (Labels & Labeling); "press operators can consult their work schedule on their press, and a change in schedule can be automatically seen on the shop floor" (Optimus, Printlogic, Wye).

**Proposta MVP, sem construir um Gantt.** (a) `Pedido.prioridade Int @default(0)` + ordenação por `prioridade desc, prazoEntrega asc, createdAt asc` — resolve 80% da dor com uma coluna. (b) Sub-raias por máquina dentro da coluna `PRODUCAO`, agrupando pela máquina prevista (derivada do `ItemGrafica` do pedido, ou da máquina já apontada em `ApontamentoEtapa`). (c) Badge "máquina parada" na raia reaproveitando `buscarManutencoesAtivas` — dado já existe, custo quase zero. Capacidade finita / Gantt fica explicitamente fora de escopo v1.

#### C2 — Não existe "pedido parado esperando alguma coisa"
**Custo estimado:** 🟡 Médio — 1 model novo (`ParadaPedido`) com poucos campos e FKs diretas (`Pedido`, opcionalmente `ApontamentoEtapa` e `SolicitacaoCompra`), sem workflow de múltiplas etapas, mais 1 enum novo fechado+`OUTRO`.

**O que falta.** Um job travado esperando papel chegar, ou esperando o cliente responder uma dúvida, é indistinguível de um job sendo produzido — ambos estão simplesmente "em Produção". Isso envenena qualquer métrica de lead time (B1) e faz o alerta de atraso (`alertaAtrasoEnviadoEm`, `alertaPrazoUltimoLimiarDias`) culpar a produção por espera que não é dela. `RegistroManutencao` cobre "a máquina parou", nunca "o pedido parou".

**Pesquisa.** O apontamento padrão registra "ocorrências indesejadas" além de início/fim (Maxiprod), e a decomposição canônica de lead time separa explicitamente **tempo de espera** de tempo de processamento (Nomus, Objective, Universal Robots).

**Proposta.** `ParadaPedido { pedidoId, apontamentoEtapaId?, motivo MotivoParada, motivoOutro String?, iniciadaEm, finalizadaEm?, observacao }` com `enum MotivoParada { AGUARDANDO_MATERIAL, AGUARDANDO_APROVACAO_CLIENTE, AGUARDANDO_ARTE_CLIENTE, MAQUINA_PARADA, AGUARDANDO_TERCEIRO, FALTA_OPERADOR, OUTRO }`. `AGUARDANDO_MATERIAL` deve poder apontar pra uma `SolicitacaoCompra` (FK opcional) — o vínculo "esse pedido está parado por causa dessa compra" é a resposta que o dono da gráfica mais quer, e as duas pontas já existem. O tempo parado sai do cálculo de lead time produtivo e entra na justificativa do atraso.

### D. Qualidade

#### D1 — Não existe aprovação intermediária dentro da produção (OK de máquina / prova de máquina)
**Custo estimado:** 🔴 Caro — o gate proposto depende de `EtapaFluxo.exigeAprovacaoQualidade`, campo que só existe na Fase 2 (estrutural, 🔴) de A1; sem ela, é model novo + 2 enums novos sem onde pendurar o gate opt-in.

**O que falta.** Aprovação de arte existe (`arteUrl` / `arteAprovadaEm` / `arteLinkToken` / `/a/[token]`), é voltada ao **cliente** e é **pré-produção** — o gate está literalmente em `status === "ARTE"` (`status-transicao.ts:241`). Dentro da produção não há nada: nenhum "aprovar a primeira folha antes de rodar os outros 20 mil", nenhuma inspeção final registrada, nenhuma foto de conferência, nenhum registro de não-conformidade. A etapa `CONFERENCIA` existe como *nome de coluna*, mas não guarda **nenhum dado de conferência** — só a passagem do card.

**Pesquisa.** É prática padrão e documentada: "após os ajustes da máquina, é feita uma impressão de teste para verificar se está tudo funcionando bem... **após a aprovação do teste, a máquina está pronta para imprimir em grande quantidade**" (Calcme, Guia do Gráfico). Em offset isso é instrumentado (cruzes de registro, escalas CMYK de 2% a 100% — UFSC/IPT). Em serigrafia existe checklist formal de QC de 20 pontos (Stitchi). "O cliente deve solicitar à gráfica pelo menos uma prova de impressão visando sua conferência e aprovação."

**Proposta.** Model `AprovacaoProducao { pedidoId, apontamentoEtapaId?, tipo, tipoOutro?, resultado, aprovadoPorId?, aprovadoPorNomeDeclarado?, arquivoId?, observacao, createdAt }`:

```
enum TipoAprovacaoProducao {
  OK_MAQUINA          // primeira folha / primeira peça, aprovação interna
  PROVA_CONTRATO      // prova digital calibrada aprovada pelo cliente
  AMOSTRA_CLIENTE     // BAT/boneco físico enviado ao cliente durante a produção
  INSPECAO_PROCESSO
  INSPECAO_FINAL
  OUTRO
}
enum ResultadoAprovacao { APROVADO, APROVADO_COM_RESSALVA, REPROVADO }
```

Gate opt-in **no mesmo formato do gate de arte que já existe** (elegante justamente por ser opt-in: "só bloqueia se ESTA gráfica enviou uma arte"): a etapa exige aprovação só se `EtapaFluxo.exigeAprovacaoQualidade` estiver ligada. `arquivoId` reaproveita `ArquivoArmazenado` (foto da folha aprovada tirada do celular no chão de fábrica). `AMOSTRA_CLIENTE` deve reaproveitar o padrão de link público token + `/a/[token]` que a aprovação de arte já implementou.

#### D2 — Não existe retorno de etapa: reprovado só pode ser CANCELADO
**Custo estimado:** 🔴 Caro — nova action mexe diretamente na máquina de transição de status (`avancarStatusPedido`/CAS), área sensível de concorrência, além de 1 enum novo e de alterar a semântica de estorno de estoque.

**O que falta.** Confirmado em três camadas: `avancarStatusPedido` só calcula `indice + 1`; o Kanban só habilita como droppable a coluna imediatamente seguinte; e as únicas server actions de mudança de estado são `avancarPedido` e `cancelarPedido`. Se a conferência reprova, a única saída modelada é cancelar o pedido inteiro — o que estorna todo o estoque e apaga o job, quando a realidade é "volta pra impressão e roda de novo os 300 que saíram errados". O FSM estritamente linear também é premissa explícita do `producaoLinkToken`.

**Pesquisa.** Retrabalho é indicador de gestão, não exceção: "o retrabalho é um dos problemas que mais afetam financeiramente as empresas"; "quando a não conformidade é detectada durante a execução do processo e o material pode ser imediatamente retrabalhado, o lote inteiro deve ser reverificado" (IndústriaPro, New Quality, Núcleo do Conhecimento). Existe até CFOP fiscal específico para retrabalho no Brasil.

**Proposta.** Nova action `retornarEtapa(pedidoId, etapaDestino, motivo)` — nunca via drag simples, sempre com modal de motivo obrigatório (mesmo princípio de "PROBLEMA exige que o motivo seja registrado" já aplicado em `entrega-transicao.ts:64`). Enum `MotivoRetorno { REPROVADO_QUALIDADE, ERRO_ARTE, MUDANCA_PEDIDO_CLIENTE, FALTA_MATERIAL, ERRO_OPERACIONAL, OUTRO }` + `motivoRetornoOutro`. Efeitos: fecha o apontamento atual, registra `ApontamentoEtapa` novo marcado `ehRetrabalho: true`, **não estorna estoque** (o material já foi consumido — o retrabalho consome mais, não menos), e o consumo adicional entra pelo caminho normal de refugo (B3). Permissão: exigir `PRODUCAO.podeEditar` completo, nunca liberar por `ResponsavelEstagio`.

### E. Terceirização

#### E1 — Não há como representar "esta etapa saiu da gráfica e volta depois"
**Custo estimado:** 🔴 Caro — model novo `EtapaTerceirizada` com workflow completo de múltiplos status (`AGUARDANDO_ENVIO`/`ENVIADO`/`RETORNADO`/`PROBLEMA`), mais integração com alerta de prazo e geração automática de custo.

**O que falta.** Nada no schema modela um pedido que fisicamente saiu do prédio para uma operação e vai voltar. Hoje o card fica parado em `ACABAMENTO` por cinco dias e ninguém sabe se é lentidão interna, se está no laminador, ou se sumiu. Custo do terceiro só entra como `CustoPedido` origem `MANUAL`, sem prazo, sem fornecedor vinculado, sem previsão de retorno, sem alerta.

**Pesquisa.** Isso é estruturalmente comum no Brasil — o Guia do Gráfico tem **categorias inteiras** de terceirização como mercado: laminação, acabamentos de livros, impressão UV, impressão digital, acabamentos gráficos, inspeção. No Brasil essa operação tem forma fiscal definida: **remessa para industrialização por encomenda (CFOP 5901/6901), retorno (5902/6902), ICMS suspenso (CST 50), IPI CST 55, prazo máximo de retorno tipicamente 180 dias**.

**Proposta.** Model `EtapaTerceirizada`:

```
model EtapaTerceirizada {
  id, graficaId, pedidoId
  status StatusPedido              // ou etapaFluxoId
  fornecedorId String?             // Fornecedor JÁ EXISTE, usado por SolicitacaoCompra
  fornecedorNome String?           // escape pra terceiro não cadastrado
  situacao SituacaoTerceirizacao   // AGUARDANDO_ENVIO / ENVIADO / RETORNADO / PROBLEMA
  enviadoEm, previsaoRetorno, retornadoEm
  valorAcordado, valorFinal Decimal?
  notaRemessa String?              // CFOP 5901/6901
  notaRetorno String?              // CFOP 5902/6902
  observacao String?
}
```

Efeitos: (a) quando existe uma terceirização `ENVIADO`, o card mostra "no terceiro — retorna dd/mm" e a etapa **não** conta como tempo produtivo interno (amarra com C2); (b) `valorFinal` gera `CustoPedido` automático com **novo valor de enum `OrigemCusto.TERCEIRIZACAO`** — precedente exato de `GANG_RUN`; (c) `previsaoRetorno` vencida alimenta o mesmo motor de alerta que `alertaAtrasoEnviadoEm` já usa; (d) `ItemGrafica` ganha `terceirizadoPadrao Boolean` + `fornecedorPadraoId` — a Ordem de Produção já sai impressa dizendo "verniz UV → Fulano Laminações".

### F. Escopo travado no perfil da gráfica de referência

#### F1 — Gang run só existe para OFFSET
**Custo estimado:** 🟡 Médio — sem model novo (generaliza `FilaGangRun`/`GrupoGangRun` existentes com o padrão de 5 FKs opcionais já usado em `RegistroManutencao`) mais 1 enum novo fechado+`OUTRO`, mas exige lógica nova moderada pra chave de compatibilidade por tipo de agrupamento.

**O que falta.** `FilaGangRun.prensaId` é **não-nullable**, a chave de compatibilidade é `papel + gramatura + prensa + folha + corFrente + corVerso`, e os candidatos só são registrados para `modeloCalculo=OFFSET`. Toda a UI fala em "chapa". Uma gráfica digital, uma de grande formato ou uma serigrafia não têm acesso à funcionalidade.

**Pesquisa.** Ganging não é técnica de offset, é técnica de **aproveitamento de substrato** — "as digital printing technology advances, gang printing is becoming even more efficient" (Wikipedia, Formax, Ultimate TechnoGraphics, Keboto). Em grande formato o equivalente é *nesting* na largura da bobina; em serigrafia, agrupar artes na mesma tela — e o schema **já tem** `BobinaMaterial` e `MaquinaFlexografia.larguraMaquinaM/passoCilindroM`.

**Proposta.** Generalizar `FilaGangRun`/`GrupoGangRun`: `prensaId` vira o conjunto de 5 FKs opcionais padrão-`RegistroManutencao`, mais `tipoAgrupamento TipoAgrupamentoGangRun { FOLHA_2D, BOBINA_1D, TELA_MATRIZ, MESA_PLANA, OUTRO }`. MVP realista: adicionar **DIGITAL** e **BOBINA_1D** (flexo/grande formato, reaproveitando o nesting 1D que o motor de flexo já faz).

#### F2 — Entrega é 1:1 com o pedido: não existe entrega parcial nem rastreio externo
**Custo estimado:** 🔴 Caro — relaxar `Entrega.pedidoId` de `@unique` pra N:1 é a mesma mudança estrutural já marcada 🔴 no achado B3 da Parte 1 (interage com faturamento por entrega), agora também mudando o gate de `StatusPedido.ENTREGUE` pra exigir todas as remessas concluídas.

**O que falta.** `Entrega.pedidoId` é `@unique` — um pedido tem no máximo uma entrega. Não há entrega parcial, retirada no balcão modelada, código de rastreio, ou comprovante/canhoto. `motorista` é texto livre e `transportadora` está congelada no `Orcamento`, preenchida uma vez na aprovação.

**Pesquisa.** Entrega/faturamento parcial é recurso padrão de ERP — "o faturamento parcial ocorre na necessidade de faturamento de parte de um pedido, por motivos de falta de estoque, antecipação de entrega ou algum outro fator" (Maxiprod, Senior, GestãoPro). Print MIS trata o mesmo: "the dispatch module organizes all print job deliveries **in parts**" (Presswise).

**Proposta.** Trocar `@unique` por índice, adicionar `sequencia Int` (1 de 3, 2 de 3) e `enum TipoEntrega { ENTREGA_PROPRIA, TRANSPORTADORA, CORREIOS, MOTOBOY_APP, RETIRADA_NO_BALCAO, OUTRO }` — hoje "retirada no balcão" (caso comum em gráfica rápida) é representado como entrega com motorista vazio. Adicionar `codigoRastreio`/`urlRastreio` e `comprovanteArquivoId`. Com N entregas, `StatusPedido.ENTREGUE` passa a exigir que todas as remessas estejam concluídas.

#### F3 — Produção é monolítica por pedido, não por item/componente
**Custo estimado:** 🔴 Caro — a própria proposta chama de "mudança estrutural mais cara", dependente de A1-Fase-2, e recomenda explicitamente não construir na primeira leva.

**O que falta.** Um único `status` no `Pedido` governa todos os `OrcamentoItem`. Um livro (capa offset + miolo digital + acabamento terceirizado, em paralelo) não tem como andar em ritmos diferentes.

**Pesquisa.** Print MIS modela job por componente: "a component type is a building block of a printing job... multiple components can be used to create job details on the Job Card" (PrintVis/Wye glossary).

**Proposta.** Mudança estrutural mais cara, só faz sentido depois de A1-fase-2: `PedidoItemProducao` (1:1 com `OrcamentoItem`) com etapa própria; `Pedido.status` vira derivado (a etapa mais atrasada entre os itens ativos). **Não fazer na primeira leva** — registrar como teto estrutural.

## Prioridade sugerida (Produção)

1. **`ApontamentoEtapa`** — histórico com operador, máquina, quantidade boa e refugo (B1+B2+B3). Melhor relação custo/benefício: hoje o sistema não sabe quando/quem/onde/quanto, nem audita a transição. Aditivo, cabe na transação que já existe.
2. **Fluxo configurável Fase 1** — etapas ligáveis/desligáveis/rotuláveis por gráfica (A1-fase-1+A2). É literalmente o gap declarado pelo dono do produto. Baixo risco, sem migração de dado.
3. **Retorno de etapa com motivo** (D2). Buraco funcional puro — reprovar hoje é cancelar o pedido inteiro.
4. **Terceirização de etapa** (E1). Alto impacto de abrangência e de lucro — `Fornecedor`/`CustoPedido` já existem.
5. **Aprovação intermediária de qualidade** (D1). `CONFERENCIA` já existe no fluxo sem guardar nada; gate opt-in copia o padrão de aprovação de arte.
6. **Fila com prioridade + raia por máquina + aviso de manutenção** (C1). `Pedido.prioridade` sozinho resolve boa parte; resto reaproveita dado que já existe.
7. **Parada de pedido com motivo** (C2). Torna honesto o lead time e os alertas de atraso.
8. **Entrega parcial + tipo + rastreio** (F2). Migração pequena, mexe em código consolidado.
9. **Generalizar gang run pra digital/bobina** (F1). Otimização de margem, não bloqueio de adoção.
10. **Fluxo configurável Fase 2** — roteiro por produto (A1-fase-2). Caro; só vale depois que a Fase 1 mostrar quais etapas customizadas as gráficas realmente pedem.
11. **Produção por item/componente** (F3). Teto estrutural — registrar como dívida arquitetural, não construir agora.

**Observação de sequenciamento:** os itens 1 e 2 devem ser planejados juntos mesmo que entregues separados — ambos tocam as mesmas três constantes hard-coded (`SEQUENCIA_STATUS_PEDIDO`, `ESTAGIOS_PRE_PRODUCAO`, `ESTAGIOS_ATRIBUIVEIS`) e a mesma condição literal que dispara baixa de estoque. Fazer isso em duas PRs que não conversam é o caminho mais provável pra um bug de baixa de estoque em produção.

Critical files: `prisma/schema.prisma` (`StatusPedido`, `Pedido`, `Entrega`, `CustoPedido`/`OrigemCusto`, `FilaGangRun`/`GrupoGangRun`, `RegistroManutencao` como padrão de FK polimórfica, `SolicitacaoCompra` como padrão de datas por transição), `src/lib/producao-estagios.ts` (as 3 constantes hard-coded), `src/app/producao/status-transicao.ts` (FSM, CAS, baixa de estoque condicional linha ~272), `src/app/producao/actions.ts`, `src/app/producao/KanbanBoard.tsx`, `src/lib/manutencao-maquina.ts` (`validarSelecaoMaquina`/`buscarManutencoesAtivas` reaproveitáveis).

---

# Parte 3 — Compras

## Resumo

Pesquisei como compras de insumo gráfico funciona de fato no Brasil (ponto de pedido/lead time, mapa de cotação multi-fornecedor em ERPs nacionais, MOQ/lote econômico, condições 30/60/90, rateio de frete/IPI no custo de aquisição, recebimento com divergência, OTIF, alçadas) e comparei com o código. **O workflow de status do GrafPro é sólido e bem construído — o problema não é o fluxo, é o ESCOPO do que cabe dentro dele.** `SolicitacaoCompra` modela exatamente um caso: *"a gráfica repõe UM item de matéria-prima do próprio catálogo, de UM fornecedor, sem frete, à vista, recebido integralmente"* — que é o perfil de uma gráfica offset comprando papel para estoque. Fora disso (comprar clichê de clicheria, terceirizar acabamento, comprar 6 itens numa nota só, comprar sob encomenda pra um pedido específico, receber parcial, pagar em 30/60/90) o módulo simplesmente não representa a operação, e o custo real — o diferencial do produto — fica incompleto ou vira digitação manual.

Achado transversal importante: **`SolicitacaoCompra` não aparece em NENHUM arquivo do módulo financeiro nem de custo por pedido.** Compras é hoje uma ilha ligada só ao estoque.

## Achados

### A1 — Só dá pra comprar MATÉRIA-PRIMA do próprio catálogo (bloqueia perfis inteiros de gráfica)
**Custo estimado:** 🟡 Médio — sem model novo (`itemGraficaId` vira nullable + `descricaoLivre` em `SolicitacaoCompra` já existente), mas soma 1 enum novo fechado+`OUTRO` e lógica condicional nova em `avancarStatusCompra` pra decidir quando gera `MovimentacaoEstoque`.

**O que falta.** `resolverItemMateriaPrima` (`src/app/compras/actions.ts`) filtra rigidamente `itemCatalogo: { tipo: "MATERIA_PRIMA" }`, e o schema torna `itemGraficaId` obrigatório e não-nulo. Consequência: **é impossível registrar em Compras** clichê de clicheria, tela/emulsão de serigrafia terceirizada, corte a laser externo, acabamento terceirizado, peça de manutenção de máquina, EPI, ferramenta, ou qualquer compra pontual não cadastrada no catálogo. `TipoItemCatalogo` tem `SERVICO`, mas o módulo de compras o rejeita.

**Pesquisa.** O Guia do Gráfico lista clicherias, insumos para flexografia (facas, cilindros anilox, doctor blades) e serviços terceirizados de sublimação como categorias de fornecimento próprias e recorrentes — pra flexo o clichê é uma das maiores linhas de compra recorrente, e pra serigrafia/sublimação/bordado a terceirização é rotina. ERPs nacionais (TOTVS Protheus, MXM, CRTI) tratam requisição de materiais **e** de serviços no mesmo fluxo.

**Proposta.**
- Tornar `itemGraficaId` **nullable** e adicionar `descricaoLivre String?` — solicitação com alvo estruturado OU descrição livre ("Clichê 4 cores — arte Rótulo Cerveja X").
- Enum de escape no padrão da casa: `enum TipoCompra { MATERIA_PRIMA SERVICO_TERCEIRIZADO PECA_MANUTENCAO EQUIPAMENTO CONSUMO_INTERNO OUTRO }` + `tipoCompraOutro String?`.
- Em `avancarStatusCompra`, a geração de `MovimentacaoEstoque` em RECEBIDO passa a ser **condicional a `tipoCompra === MATERIA_PRIMA` com `itemGraficaId` preenchido**. Compra de serviço não vira estoque; vira custo (ver A3).
- `SERVICO_TERCEIRIZADO`/`PECA_MANUTENCAO` também abrem gancho natural pra `RegistroManutencao`/`Equipamento`, que já existem.

### A2 — Uma solicitação = um item; não existe pedido de compra multi-linha, nem frete, nem impostos
**Custo estimado:** 🟢 Barato — pela rota que a própria proposta recomenda pra agora (a completa fica pra depois): campos `Decimal?` aditivos em `SolicitacaoCompra` (model já existente) mais um campo derivado, sem model nem enum novo.

**O que falta.** `SolicitacaoCompra` tem `itemGraficaId`, `quantidade`, `valorFinal` como escalares. Comprar 3 papéis + 2 tintas do mesmo fornecedor na mesma nota exige 5 solicitações desconectadas, o mesmo `documento` digitado 5 vezes, e ratear o valor total à mão. Não há **nenhum** campo pra frete, IPI, ICMS-ST ou desconto — só `valorFinal`. Isso ataca o diferencial do produto: `custoUnitario = valorFinal / quantidade` — R$ 400 de frete numa compra de R$ 8.000 ou infla `valorFinal` (contaminando o custo se a nota tiver outros itens) ou some do custo real.

**Pesquisa.** Rateio de frete/seguro proporcional ao valor de cada item da nota é comportamento padrão dos ERPs (Maxiprod); custo de aquisição correto é *valor do item + IPI + parcela rateada do frete*. Pra gráfica em Lucro Real/Presumido, crédito de ICMS/IPI sobre insumo muda o custo real do papel.

**Proposta.** Duas rotas:
- **Rota curta (baixo risco):** manter 1 item por solicitação, adicionar `valorFrete Decimal?`, `valorIpi Decimal?`, `valorIcmsCreditavel Decimal?`, `valorDesconto Decimal?` + campo derivado `custoAquisicaoTotal` usado no lugar de `valorFinal` pra calcular `custoUnitario`.
- **Rota completa:** promover `SolicitacaoCompra` a cabeçalho + `model SolicitacaoCompraItem` (itemGraficaId/varianteId/descricaoLivre, quantidade, unidadeCompra, precoUnitario, valorFrete rateado, valorIpi). RECEBIDO gera N `MovimentacaoEstoque`. Recomendo a rota curta agora, completa depois.

### A3 — Compra não distingue reposição de estoque × compra sob encomenda pra um pedido, e nunca vira custo do pedido — **CONSTRUÍDO 2026-08-29 (rodada 14)**

**Status:** `enum OrigemSolicitacaoCompra` + `pedidoId` construídos conforme a proposta. `COMPRA` adicionado a `OrigemCusto`. Confirmar RECEBIDO com `pedidoId` gera `CustoPedido` automaticamente, com dedup e marcação de possível duplicidade quando o material também está na ficha técnica do pedido.

**O que falta.** Não existe `pedidoId` em `SolicitacaoCompra`, nem marcação de origem. `enum OrigemCusto` (schema:2666) tem `MANUAL | CONSUMO_ESTOQUE | COMISSAO | SERVICO_INSUMO | GANG_RUN` — **não tem `COMPRA`**. Quando a gráfica compra material especificamente pra um pedido, o custo só chega depois, indiretamente, via baixa de ficha técnica — e nunca chega se o item não estiver na ficha técnica (clichê, faca, terceirização).

**Pesquisa.** A distinção *make-to-stock × make-to-order* é o eixo central do planejamento de compras: na produção sob encomenda o MRP gera solicitações a partir do pedido de venda; no ressuprimento por ponto de encomenda a compra nasce do nível de estoque (TOTVS Datasul documenta os dois "tipos de ressuprimento" como caminhos distintos).

**Proposta.** `enum OrigemSolicitacaoCompra { REPOSICAO_ESTOQUE PEDIDO_ESPECIFICO MANUTENCAO CONSUMO_INTERNO CONTRATO_PROGRAMADO OUTRO }` + `origemOutro` + `pedidoId String?` (obrigatório na aplicação quando `origem = PEDIDO_ESPECIFICO`). Adicionar `COMPRA` a `OrigemCusto` e, ao chegar em RECEBIDO com `pedidoId`, gerar `CustoPedido` (origem `COMPRA`, `solicitacaoCompraId` único pra dedup — mesmo padrão de `movimentacaoEstoqueId @unique`). Cuidado: compra sob encomenda que também entra no estoque pode duplicar custo — reusar `CustoPedido.possivelDuplicidade`, que já existe pra isso.

### A4 — O status COTANDO não guarda nenhuma cotação — **CONSTRUÍDO 2026-08-28 (rodada 13)**

**Status:** `model CotacaoFornecedor` construído conforme a proposta. Transição COTANDO→APROVADO exige vencedora marcada e copia os dados dela pra solicitação. UI de comparação no detalhe da solicitação, pré-preenchida com o último preço conhecido do fornecedor. `condicaoPagamento` ficou como texto livre (não havia enum adequado ao contexto de compra no schema).

**O que falta.** A transição para COTANDO não captura nada — só grava `cotandoEm`. Um único `fornecedorId` e um único `valorEstimado` por solicitação. Não existe forma de registrar "Suzano cotou R$5,20/kg em 10 dias, boleto 30; Ibema R$5,45 em 3 dias, à vista" e depois escolher. O `ComparativoFornecedoresCard` existente é bom, mas é histórico retrospectivo (deriva de compras já recebidas), não cotação ativa.

**Pesquisa.** "Mapa de cotação" é funcionalidade padrão dos ERPs brasileiros: envia pra múltiplos fornecedores, consolida numa tela comparativa de preço **e condições**, gera o pedido a partir da vencedora (Everflow, MXM, TOTVS Protheus). A decisão nunca é só preço — prazo de entrega e condição de pagamento entram no mesmo mapa.

**Proposta.** `model CotacaoFornecedor { solicitacaoCompraId, fornecedorId, precoUnitario, valorTotal, prazoEntregaDias?, condicaoPagamento, validaAte?, frete?, observacao, vencedora Boolean @default(false), registradaPorId, createdAt, @@unique([solicitacaoCompraId, fornecedorId]) }`. Ao avançar COTANDO→APROVADO, exigir escolher a vencedora e copiar pra solicitação. Pré-preencher com o último preço de cada fornecedor.

### A5 — `Fornecedor` é um cadastro-esqueleto e não conversa com o financeiro
**Custo estimado:** 🔴 Caro — os campos e enums novos em `Fornecedor` seriam baratos isolados, mas a proposta inclui gerar automaticamente parcelas de contas a pagar ao avançar pra COMPRADO, mudança de comportamento em área financeira sensível (dinheiro).

**O que falta.** `Fornecedor` tem só `id, graficaId, nome, contato (texto livre), ativo, createdAt`. Sem CNPJ, categoria, prazo/forma de pagamento, lead time, lote mínimo. E `Despesa` não tem `fornecedorId` (comentário do próprio schema admite: "só não tem vínculo com Despesa ainda") — nenhuma transição de compra cria `Despesa`. Uma compra de R$20.000 em boleto 30/60/90 nunca aparece no contas a pagar.

**Pesquisa.** Condições 30/60/90, boleto, Pix e desconto por antecipação são padrão de negociação B2B brasileiro (Sebrae, Cora); ERPs tratam "condição de pagamento" como cadastro estruturado ligado ao fornecedor.

**Proposta.** Enriquecer `Fornecedor`: `documento` (CNPJ, `@@unique([graficaId, documento])`), `email`, `telefone`, `condicaoPagamentoPadrao`, `prazoEntregaMedioDias`, `pedidoMinimoValor`. Categoria fechada+Outro cobrindo perfis além do offset (`PAPEL_CARTAO`, `TINTA_VERNIZ`, `CHAPA_CLICHE_MATRIZ`, `SUBSTRATO_RIGIDO`, `TECIDO_LINHA_BORDADO`, `BRINDE_PROMOCIONAL`, `ACABAMENTO_TERCEIRIZADO` etc). `CondicaoPagamento` fechada+Outro (`A_VISTA`, `BOLETO_30_60_90` etc). Adicionar `fornecedorId` a `Despesa` e, ao avançar pra COMPRADO, **gerar automaticamente as parcelas de contas a pagar**. É provavelmente o maior ganho de percepção de valor do módulo.

### A6 — Unidade de compra ≠ unidade de estoque; sem lote mínimo nem múltiplo de embalagem — **CONSTRUÍDO 2026-08-30 (rodada 16)**

**Status:** `enum UnidadeCompra` + campos de conversão em `SolicitacaoCompra`/`ItemGrafica`, conforme a proposta. `quantidade` (estoque) sempre recalculada no servidor, nunca confia no cliente. Aviso de múltiplo é só aviso.

**O que falta.** `SolicitacaoCompra.quantidade` está sempre na unidade de estoque; `ItemGrafica.quantidadePorEmbalagem` é "puramente informativo" (comentário do schema). Sem `unidadeCompra`, `fatorConversaoCompra`, `loteMinimoCompra`, `multiploCompra`. Comprador vê proposta em R$/tonelada ou R$/fardo e converte de cabeça.

**Pesquisa.** NF-e brasileira tem o par `uCom`/`uTrib` justamente pra representar "unidade comercial × unidade tributável", com tabela oficial incluindo FARDO/RESMA/BOBINA/ROLO/PALETE. Divergência de conversão de unidade é fonte notória de erro documentada pela Senior.

**Proposta.** Em `SolicitacaoCompra`: `unidadeCompra`/`unidadeCompraOutro`, `quantidadeCompra`, `fatorConversaoCompra`, `precoUnitarioCompra` — `quantidade` (unidade de estoque) vira derivada. Em `ItemGrafica`: `unidadeCompraPadrao`, `fatorConversaoCompraPadrao`, `loteMinimoCompra`, `multiploCompra`, pra pré-preencher e avisar arredondamento.

### A7 — Recebimento é tudo-ou-nada; não existe entrega parcial nem divergência
**Custo estimado:** 🟡 Médio — campos novos em `SolicitacaoCompra` mais 1 valor novo de status (`RECEBIDO_PARCIAL`), mas exige relaxar `MovimentacaoEstoque.solicitacaoCompraId` de `@unique` e nova lógica de recebimento parcial.

**O que falta.** RECEBIDO soma **`solicitacao.quantidade` inteira** ao estoque, sem informar quanto chegou de fato. Sem `quantidadeRecebida`, sem estado de recebimento parcial. `CONFERIDO` é "só auditoria do que já entrou, nunca gera segunda entrada" — se a conferência achar diferença, não há pra onde ir.

**Pesquisa.** Divergência entre NF de entrada e pedido de compra é categoria própria nos ERPs (Senior, Prosyst, Bluesoft), com "aprovar com divergência no recebimento" como permissão específica.

**Proposta.** `quantidadeRecebida`/`valorNotaFiscal` na solicitação. Transição pra RECEBIDO passa a pedir quantidade efetivamente conferida — a `MovimentacaoEstoque` usa essa, não a solicitada. Novo status `RECEBIDO_PARCIAL`. `divergenciaObservacao` + flag derivada. Atenção: `MovimentacaoEstoque.solicitacaoCompraId` hoje é `@unique` — precisaria virar não-único.

### A8 — Sugestão de compra existe, mas o ponto de pedido é um número mágico e o lead time não existe em lugar nenhum
**Custo estimado:** 🟡 Médio — campos novos em `ParametrosGrafica`/`ItemGrafica` são baratos isolados, mas a fórmula de ponto de pedido e o aprendizado de lead time real por fornecedor são lógica nova moderada.

**O que confirmei.** A sugestão **existe** e é manual: `src/app/compras/page.tsx` calcula a partir de `calcularPrevisaoEstoque`, filtro `abaixoDoMinimo || diasRestantes <= 30` — "reduz fricção, não cria nada sozinho" (decisão de produto defensável).

**O que falta.** `30` é literal, não parametrizável (`ParametrosGrafica` não tem nenhum parâmetro de compras). Sem lead time em lugar nenhum — a fórmula real do ponto de pedido não pode ser calculada. Sugestão diz *quando* mas não *quanto*.

**Pesquisa.** Fórmula consolidada: `ponto de pedido = estoque de segurança + (consumo médio diário × lead time)`. Um limiar fixo de 30 dias trata igual um fornecedor de 3 dias e uma importação de 45.

**Proposta.** `Fornecedor.prazoEntregaMedioDias` (A5) e/ou `ItemGrafica.leadTimeDias`; calcular ponto de pedido de verdade. `ParametrosGrafica.diasAlertaCompraPadrao @default(30)` + `leadTimePadraoDias @default(7)`. **Lead time real aprendido de graça**: a solicitação já tem `compradoEm`/`recebidoEm` — com `prazoEntregaPrometidoDias` da cotação vencedora (A4), dá pra calcular lead time médio real por fornecedor, realimentando o ponto de pedido e o OTIF (A11). Sugerir também a quantidade, arredondada ao múltiplo/lote mínimo (A6).

### A9 — Não existe contrato / preço fixo por período — **CONSTRUÍDO 2026-08-30 (rodada 16)**

**Status:** `model ContratoFornecimento` (coringa ou específico), dá função real a `CONTRATO_PROGRAMADO` — solicitação vinculada pula COTANDO, nasce em APROVADO. Alerta de vigência/quantidade esgotando (limiares fixos, sem configuração por tenant ainda).

**O que falta.** Nada representa acordo de fornecimento contínuo. `precoCompra`/`TabelaPrecoPapel.precoKg` são preços de referência sem vigência nem fornecedor associado.

**Pesquisa.** Contratos de fornecimento com preço fixo por período são prática corrente pra gráfica de volume alto, dispensando cotação a cada reposição.

**Proposta (média prioridade).** `model ContratoFornecimento { graficaId, fornecedorId, itemGraficaId?/varianteId?, precoUnitario, unidadeCompra, vigenciaInicio, vigenciaFim, quantidadeContratada?, quantidadeConsumida, condicaoPagamento, ativo }`. Solicitação com `origem = CONTRATO_PROGRAMADO` pula COTANDO. Alerta quando quantidade/vigência está esgotando.

### A10 — Sem alçada de aprovação e sem segregação de funções
**Custo estimado:** 🟢 Barato — 2 campos opt-in em `ParametrosGrafica` (model já existente), com precedente idêntico já construído (`descontoMaxSemAprovacao` do orçamento).

**O que falta.** Única checagem é permissão de módulo. APROVADO grava `usuarioAprovadorId` sem checar que seja diferente do solicitante. Sem teto de valor — R$200 e R$200.000 passam pelo mesmo caminho. `ParametrosGrafica.descontoMaxSemAprovacao` já existe pra orçamento; o análogo de compras não foi feito.

**Pesquisa.** Alçada por faixa de valor é padrão (Rech, Flexsys); "o solicitante nunca aprova o próprio pedido" é controle clássico contra fraude (COSO).

**Proposta.** `ParametrosGrafica.valorMaxCompraSemAprovacao?` (null = sem trava) + `exigirAprovadorDiferenteDoSolicitante @default(false)` — opt-in, gráfica pequena não tem como segregar.

### A11 — Fornecedor não tem histórico de desempenho, só de preço
**Custo estimado:** 🟢 Barato — a própria proposta diz "nenhuma tabela nova", só derivar métricas por query e exibir coluna extra no card comparativo existente; depende de A7/A8 (Médios) estarem construídos pra ter os dados de origem.

**O que falta.** Único "score" é preço. Sem pontualidade, taxa de divergência, índice de qualidade.

**Pesquisa.** OTIF (On Time In Full) é o KPI padrão de gestão de fornecedores.

**Proposta (barato, se A4/A7/A8 existirem).** Nenhuma tabela nova — derivar por fornecedor: % no prazo, % completo, OTIF combinado, nº de compras com divergência. Exibir como coluna extra no `ComparativoFornecedoresCard` existente.

## Prioridade sugerida (Compras)

| # | Achado | Por que aqui |
|---|---|---|
| 1 | **A1** — comprar serviço/terceirização e item fora do catálogo | Único achado que **bloqueia perfis inteiros** de gráfica (flexo, serigrafia, sublimação, bordado). Mudança pequena. |
| 2 | **A5** — Fornecedor comercial + geração de contas a pagar | Fecha o ciclo compra→caixa que hoje não existe; gap mais visível pro dono da gráfica. Reusa padrões prontos. |
| 3 | **A3** — vínculo compra↔pedido + `OrigemCusto.COMPRA` | Ataca o diferencial declarado do produto. Ganchos já existem. |
| 4 | **A2 (rota curta)** — frete/IPI/desconto no custo de aquisição | `custoUnitario` pode estar errado por 5-10% em toda compra com frete. |
| 5 | **A4** — cotação multi-fornecedor real | COTANDO hoje é decorativo. |
| 6 | **A6** — unidade de compra × unidade de estoque, lote mínimo | Elimina conversão de cabeça, torna comparativo real. |
| 7 | **A7** — recebimento parcial e divergência | Frequente na prática, hoje força ajuste manual que corrompe custo. |
| 8 | **A8** — lead time por fornecedor e ponto de pedido parametrizável | Tira o `30` mágico; sugestão para de avisar tarde. |
| 9 | **A10** — alçada de valor + segregação de funções | Baixo esforço, alta credibilidade pra gráficas maiores; opt-in. |
| 10 | **A11** — OTIF/desempenho de fornecedor | Quase de graça depois de A4/A7/A8. |
| 11 | **A9** — contrato de fornecimento | Modelo novo inteiro, só relevante pra gráfica de volume alto. |
| 12 | **A2 (rota completa)** — pedido de compra multi-linha | Estruturalmente correto, maior cirurgia da lista — fazer depois da rota curta provar os campos de custo. |

Critical files: `prisma/schema.prisma` (`SolicitacaoCompra`, `Fornecedor`, `Despesa`, `ItemGrafica`, `OrigemCusto`, `UnidadeMedida`), `src/app/compras/status-transicao.ts`, `src/app/compras/actions.ts`, `src/lib/compras-status.ts`, `src/app/compras/page.tsx`.

---

# Parte 4 — Financeiro

## Resumo

Pesquisei como o financeiro de uma gráfica brasileira funciona na prática (mapa de custo/RKW e custo-hora por setor, DRE simplificado para PME, régua de cobrança, comissionamento por produto/margem/desconto, retenções em NFS-e, alíquota efetiva do Simples via RBT12, prazos B2B do tipo "50%+50% na entrega" e "boleto 28/42/56") e comparei com o schema e o código atuais. **A conclusão é que o módulo está bem construído no que já cobre — Despesa, ContaReceber, Pagamento, Comissão e trilha de auditoria têm disciplina de concorrência, snapshot e soft-delete melhores que a média do mercado — mas ele é essencialmente um caderno de lançamentos, não um sistema de resultado**: falta a camada que transforma lançamento em resposta ("quanto lucrei", "vou ter caixa dia 5", "esse cliente está me dando prejuízo"). O gap mais grave para o diferencial do produto não é nenhuma tela nova: é que **a despesa que sai do caixa e o custo que entra no lucro do pedido são dois lançamentos manuais independentes que nada liga**, e que **o custo fixo real nunca é confrontado com o overhead embutido no preço** — os dois pilares do "quanto esse pedido realmente me deu de lucro".

Um segundo eixo, específico do mandato de abrangência: várias regras estão calibradas para o perfil de gráfica de etiqueta/offset da referência. Overhead como % do custo direto quebra em serigrafia/bordado/comunicação visual (material barato, mão de obra cara); comissão como percentual único por vendedor quebra em qualquer gráfica com mix de produtos de margem muito diferente; recorrência só mensal quebra com IPTU, seguro e 13º.

## Achados

### A. O eixo "quanto lucrei"

#### A1 — `Despesa` e `CustoPedido` são universos paralelos: o mesmo gasto precisa ser digitado duas vezes e nada detecta a divergência
**Custo estimado:** 🔴 Caro — os campos novos em `Despesa` são baratos isolados, mas a proposta gera `CustoPedido` automaticamente numa transação a partir de `Despesa`, mudança de comportamento em área financeira sensível (custo/lucro do pedido).

**O que falta.** `CustoPedido` é o custo real por pedido e alimenta `lucroDoPedido` (`src/lib/custo-pedido.ts`). `Despesa` é o dinheiro que de fato saiu. **Não existe nenhum vínculo entre os dois.** Quando a gráfica terceiriza a laminação de um pedido por R$800, o correto é lançar `CustoPedido` (lucro do pedido certo) **e** `Despesa` (contas a pagar certo) — dois formulários, zero validação cruzada. Na prática só um dos dois será preenchido. O número de lucro por pedido e o resultado do mês nunca fecham entre si, e o sistema não sabe disso. O padrão pra resolver já existe e está maduro: `Despesa.comissao`, `Despesa.movimentacaoContaPrepaga`, `CustoPedido.movimentacaoEstoqueId @unique` — "um lançamento espelhado em outro modelo, com FK única pra nunca duplicar".

**Proposta.** `Despesa.pedidoId String?` (`onDelete: SetNull`) + `Despesa.custoPedidoId String? @unique`. Quando o usuário informa `pedidoId` e `categoriaCustoId` numa despesa, gerar o `CustoPedido` espelhado na mesma transação, com novo `OrigemCusto.DESPESA`. Caminho inverso: checkbox "essa despesa ainda vai ser paga" no formulário de `CustoPedido`. Reaproveitar `possivelDuplicidade` (já existe em `CustoPedido`).

#### A2 — O custo fixo real nunca é confrontado com o `overheadPercent` embutido no preço
**Custo estimado:** 🔴 Caro — o campo `CategoriaCusto.natureza` e o relatório de cobertura seriam baratos/médios isolados, mas a proposta de abrangência inclui `ParametrosGrafica.overheadModo`, que muda o cálculo de overhead dentro de `comporPreco` — mudança no motor de precificação.

**O que falta.** `comporPreco` aplica `overheadPercent` (default 15%) sobre o custo direto e já grava o valor absoluto em `detalhes.overhead` no breakdown persistido. O lado "quanto meu custo fixo realmente foi" também está no banco (`Despesa` de aluguel, salário administrativo). **Ninguém compara os dois.** Uma gráfica pode faturar o ano inteiro com 15% de overhead embutido enquanto o custo fixo consome 26%, sem nenhum ruído. Obstáculo estrutural: `CategoriaCusto` não tem classificação de natureza (fixo/variável) — sem isso não dá pra calcular custo fixo total, margem de contribuição nem ponto de equilíbrio.

**Pesquisa.** O mapa de custo da Calcgraf (ferramenta de custeio pra gráficas brasileiras) descreve metodologia RKW e lista 20 itens de custo fixo típicos (seguros, aluguel, IPTU, energia, manutenção, honorários). A fórmula do setor é `(Custo Fixo do setor + rateio administrativo) ÷ Horas Produtivas = Custo/Hora` — não um percentual sobre material. Ponto de equilíbrio = `Gastos Fixos ÷ % Margem de Contribuição`.

**Proposta.** `CategoriaCusto.natureza` — enum `NaturezaCusto { VARIAVEL, FIXO, SEMIVARIAVEL }`, default `VARIAVEL`. Relatório "cobertura de overhead" em `/financeiro`: `Σ Despesa PAGA categoria FIXO` vs `Σ overhead cobrado nos pedidos faturados` — se o segundo for menor, mostrar "seu overhead de 15% cobriu R$42 mil, mas seu custo fixo foi R$61 mil — o percentual que fecharia é 21,8%". **Essa frase sozinha é a funcionalidade mais defensável do módulo inteiro.** Abrangência: `ParametrosGrafica.overheadModo` — `PERCENTUAL_CUSTO_DIRETO | VALOR_POR_HORA_MAQUINA | VALOR_FIXO_POR_PEDIDO` — 15% sobre custo direto de serigrafia/bordado (material barato, mão de obra cara) cobre uma fração do custo fixo real.

#### A3 — Não existe DRE; o "saldo real" hoje mistura competência com caixa
**Custo estimado:** 🟡 Médio — sem model novo (função pura + página nova), mas monta um motor de cálculo próprio (linhas de DRE) e corrige `saldoReal`, cálculo já usado em outro lugar do Meu Negócio.

**O que falta.** `meu-negocio.ts` calcula `saldoReal: faturamentoTotal - despesasPagasTotal`, comentado como "caixa de verdade" — mas `faturamentoTotal` vem de orçamentos **aprovados** pela data de **criação**, não de pagamento recebido. Um orçamento de R$80 mil parcelado em 90 dias entra 100% no "caixa de verdade" deste mês. O lado da despesa é caixa puro. Os dois lados da subtração estão em regimes diferentes — o rótulo mente.

**Pesquisa.** Estrutura de DRE simplificada consensual: Receita Bruta → (−) impostos/descontos → Receita Líquida → (−) custos variáveis → Margem de Contribuição → (−) custo fixo/comissões → Resultado Operacional → (−) despesas financeiras → Lucro Líquido.

**Proposta.** `src/lib/dre.ts` — função pura recebendo agregados, devolvendo linhas do DRE com `regime: "CAIXA"|"COMPETENCIA"` explícito. Página `/financeiro/dre`. Linhas: Receita bruta − impostos − descontos = Receita líquida; − custos variáveis (`CustoPedido` categoria VARIAVEL) = MC%; − custo fixo (`Despesa` FIXO) − comissões = Resultado operacional; − despesas financeiras = Resultado líquido; fechar com ponto de equilíbrio. Corrigir `saldoReal` pra somar `Pagamento` do período (caixa dos dois lados).

### B. Fluxo de caixa e cobrança

#### A4 — Não existe fluxo de caixa projetado, embora todos os dados já estejam no banco
**Custo estimado:** 🟢 Barato — a própria proposta diz "custo baixíssimo, valor altíssimo": função pura que só agrega `ContaReceber`/`Despesa` já existentes, sem model novo, sem mutar nenhum saldo.

**O que falta.** `ContaReceber.vencimento` e `Despesa.vencimento` pendentes dão exatamente as duas curvas necessárias. Nada agrega isso — ninguém responde "no dia 12 eu fico negativo".

**Pesquisa.** Horizonte mínimo recomendado é 90 dias, com projeção semanal nos primeiros 30. Falta de controle de fluxo de caixa é apontada como uma das três principais causas de mortalidade de pequenas empresas no Brasil.

**Proposta.** `src/lib/fluxo-caixa.ts` puro: saldo inicial + entradas/saídas previstas → buckets (semanal 30 dias, mensal até 90) com saldo acumulado e o primeiro dia em que fica negativo. Custo baixíssimo, valor altíssimo. Depende de saldo inicial (ver A15) e melhora com prazos de compensação por forma de pagamento (A11).

#### A5 — Não existe régua de cobrança nem juros/multa por atraso
**Custo estimado:** 🔴 Caro — model novo `ReguaCobrancaEtapa` com workflow de escalonamento, mais permitir informar `valorJuros`/`valorMulta` na baixa é mudança de comportamento em área financeira sensível (valor efetivamente recebido).

**O que falta.** Vencido hoje = pill vermelha, sem lembrete, sem escalonamento, sem juros/multa, sem status de negociação, sem baixa por perda. Infraestrutura pronta e não usada: cron diário, e-mail, webhook por evento, padrão CAS de idempotência (`Pedido.alertaAtrasoEnviadoEm`). `ContaReceber` só tem `valor` — quando cliente paga com juros, o `Pagamento` copia o valor literal e o dinheiro extra some.

**Pesquisa.** Régua padrão: preventiva 3-7 dias antes, reativa escalonada após vencimento, escalação formal (~30 dias, notificar antes de negativar). Multa por atraso limitada a 2% (uma vez); juros de mora por dia a partir do dia seguinte.

**Proposta.** `ParametrosGrafica.multaAtrasoPercent @default(2)`, `jurosMoraMensalPercent @default(1)`. Permitir marcar recebido informando `valorJuros`/`valorMulta` separados (receita financeira, linha própria no DRE). `model ReguaCobrancaEtapa` com canal e-mail/webhook, idempotência via CAS igual `alerta-atraso.ts`. `StatusContaReceber` ganha `EM_COBRANCA` e `PERDA` (hoje um calote só pode virar `CANCELADO`, indistinguível de erro de digitação). Indicadores: aging por faixa, DSO, índice de inadimplência.

#### A6 — Não existe controle de crédito do cliente — **CONSTRUÍDO 2026-08-27 (rodada 12)**

**Status:** ver bloco "Atualização (rodada 12)" no topo do documento — `Cliente.limiteCredito`/`bloqueadoParaFaturamento` + `ParametrosGrafica.bloqueiaAoUltrapassarLimiteCredito` (default só avisa). Independente de `bloqueadoParaVenda` (bloqueio manual), os dois avisos são compostos numa única resposta.
**O que falta.** `Cliente` não tem limite de crédito, prazo padrão, nem bloqueio por inadimplência. Um cliente com 3 parcelas vencidas pode ter novo orçamento de R$50 mil aprovado sem aviso nenhum.

**Proposta.** `Cliente.limiteCredito Decimal?` (null = sem limite), `prazoPagamentoPadraoDias Int?`, `bloqueadoParaFaturamento Boolean @default(false)` + motivo. Aviso não-bloqueante por padrão na aprovação (flag em `ParametrosGrafica` decide se vira trava, mesmo espírito de `descontoMaxSemAprovacao`).

#### A7 — Parcelas de contas a receber são 100% manuais; `condicoesPagamento` é texto livre morto — **PARCIALMENTE CONSTRUÍDO 2026-08-28 (rodada 13)**

**Custo estimado (restante pendente):** 🟡 Médio — os models já foram construídos; o que falta é só a UI (1 tela de CRUD de condições de pagamento + seletor no formulário de orçamento), sem schema novo.

**Status:** `model CondicaoPagamento`/`CondicaoPagamentoParcela` construídos, com bootstrap lazy das 4 condições comuns da pesquisa. `ContaReceber` gerada automaticamente (snapshot) na aprovação do orçamento, nos dois caminhos (painel e link público) — mas só pra âncora `APROVACAO`; `EMISSAO_NOTA`/`ENTREGA` ficam com enum pronto e sem gatilho. **Gap real: nenhuma UI foi construída** — hoje só é possível vincular uma condição ao orçamento via Prisma direto. Fica pra uma rodada futura: tela de configuração de condições + seletor no formulário de orçamento.

**O que falta.** `Orcamento.condicoesPagamento` é texto livre exibido no PDF e não gera nada. Parcelas são cadastradas à mão — metade não será cadastrada, e o fluxo de caixa (A4) fica cego proporcionalmente.

**Pesquisa.** Condições praticadas por gráficas brasileiras são padronizadas e poucas: 1x faturado 30 dias; 50%+50% na entrega; 30/60/90 com 2% de acréscimo; 28/42/56 dias da emissão da nota.

**Proposta.** `model CondicaoPagamento { nome, ancora AncoraVencimento, acrescimoPercent, ativa }` + `CondicaoPagamentoParcela { ordem, percentual, diasAposAncora }`, `enum AncoraVencimento { APROVACAO, EMISSAO_NOTA, ENTREGA, OUTRO }`. `Orcamento.condicaoPagamentoId` convivendo com o texto atual (vira snapshot). Gerar `ContaReceber` automaticamente quando a âncora acontece. Bootstrap com as condições comuns da pesquisa.

#### A8 — Não existe recebimento nem pagamento parcial — **CONSTRUÍDO 2026-08-29 (rodada 14)**

**Status:** `BaixaContaReceber`/`PagamentoDespesa` construídos conforme a proposta, saldo sempre calculado. Caminho de valor exato preservado sem alteração; caminho parcial rejeita explicitamente ambiguidade (nunca "adivinha"). UI mínima (campo de valor editável nas ações existentes). **Gap remanescente:** CSV pro contador e o "saldo real" do Meu Negócio continuam atribuindo o valor cheio ao mês do fechamento, não fracionado por baixa parcial.

**O que falta.** `ContaReceber`/`Despesa` são tudo-ou-nada. Reconciliação só casa em valor exato (comentário admite: "pagamento parcial ou com sobra não mexe em nada"). Cliente paga R$3.000 de parcela de R$5.000: `Pagamento` criado, `ContaReceber` continua pendente, sistema conta R$8.000 onde há R$5.000. Mesmo vale pra juros (A5) e retenção (A9) — que por definição nunca batem exato.

**Proposta.** `model BaixaContaReceber { contaReceberId, pagamentoId, valor, createdAt }` (N:N com valor). `StatusContaReceber.PARCIAL` + saldo sempre calculado, nunca armazenado (disciplina já declarada em `Pagamento`). Simétrico em `Despesa`: `StatusDespesa.PARCIAL` + `PagamentoDespesa`. Casar por valor exato **ou** saldo remanescente exato, nunca em silêncio quando houver ambiguidade.

### C. Tributos e encargos

#### A9 — Retenção de impostos na fonte não existe em lugar nenhum
**Custo estimado:** 🔴 Caro — model novo `RetencaoContaReceber` com relação direta seria médio isolado, mas muda o valor líquido esperado usado na conciliação de pagamento (A8), mudança de comportamento em área financeira sensível.

**O que falta.** `ContaReceber.valor`/`Pagamento.valor` são sempre valor cheio. Quando o tomador é PJ/órgão público, ele retém parte — hoje isso seria tratado como parcela paga a menor (que nem existe, por A8), inflando receita.

**Pesquisa.** IRRF sobre serviço ~1,5%; CSRF (PIS+COFINS+CSLL) ~4,65%; ISS retido 2-5% conforme município. Impressos personalizados são tributados por ISS, não ICMS — boa parte do faturamento de gráfica é NFS-e, onde a retenção acontece.

**Proposta.** `Cliente.tipoTomador` + `retemImpostos Boolean`. `ContaReceber.valorRetencoes` + `model RetencaoContaReceber { tributo TributoRetido, percentual, valor }`, `enum TributoRetido { IRRF, CSRF, PIS, COFINS, CSLL, ISS, INSS, OUTRO }`. Valor líquido esperado vira alvo da conciliação (A8).

#### A10 — `impostoPercent` é um número solto que não conhece o regime tributário nem o faturamento
**Custo estimado:** 🟢 Barato — a própria proposta descarta motor tributário e usa o mecanismo de pendência de configuração que já existe, só exibindo faixa de referência e aviso quando o RBT12 apurado supera o `impostoPercent` configurado.

**O que falta.** `ParametrosGrafica.impostoPercent @default(0.06)` é fixo, sem relação com `DadosFiscaisGrafica.regimeTributario` (existe desde a correção de NF-e de hoje) nem com faturamento acumulado. 0,06 é a alíquota nominal da 1ª faixa do Anexo III — razoável como default, perigoso como regra permanente.

**Pesquisa.** No Simples a alíquota efetiva cresce com o RBT12 (fórmula: `(RBT12×Alíq − PD)÷RBT12`). Fator R pode jogar a gráfica do Anexo III pro Anexo V mês a mês. Uma gráfica em crescimento continua precificando com 6% enquanto paga 9-11%, e a margem some sem aviso.

**Proposta.** Não implementar motor tributário — fechar a lacuna de percepção: mostrar a faixa de referência do regime na tela de parâmetros. Pendência de configuração (mecanismo já existe) quando o RBT12 apurado (calculável a partir dos orçamentos/pagamentos dos últimos 12 meses) indicar alíquota efetiva acima do `impostoPercent` configurado.

#### A11 — Custo financeiro de receber (maquininha, antecipação) não é apurado; formas de pagamento sem prazo de compensação
**Custo estimado:** 🟡 Médio — `Pagamento.valorTaxa` aditivo mais 1 model novo simples (`TaxaFormaPagamento`), sem relação complexa, mais 2-3 valores novos de enum de forma de pagamento.

**O que falta.** `taxaFinanceiraPercent` é só estimativa no preço — quando o pagamento chega por cartão/antecipação, a taxa real não é registrada, os ~3,5% de MDR simplesmente desaparecem do resultado. `FormaPagamento` não carrega prazo de compensação — PIX e cartão em 30 dias são radicalmente diferentes pro fluxo de caixa (A4) e hoje indistinguíveis.

**Proposta.** `Pagamento.valorTaxa @default(0)`. `model TaxaFormaPagamento { forma, percentual, diasCompensacao }`. Promover `CHEQUE` de dentro do `OUTRO` (tem data de compensação, é funcionalmente um recebível) e separar `CARTAO_CREDITO`/`CARTAO_DEBITO` (taxas e prazos diferentes).

### D. Comissão

#### A12 — Comissão é um único percentual por vendedor, sobre base global, gerada na aprovação
**Custo estimado:** 🔴 Caro — 2 models novos (`RegraComissao`, `FatorComissaoDesconto`) com resolução por especificidade, mais liberação proporcional conforme baixas de `ContaReceber`; mudança de comportamento em área financeira sensível (comissão).

**Confirmado.** Mais rígido que o esperado: um único `Usuario.comissaoPercent` (sem variação por produto/categoria/faixa), base global da gráfica (não por vendedor), gatilho fixo na aprovação (sem relação com o cliente ter pagado), `Comissao.usuarioId` obrigatório (vendedor cadastrado só como texto livre em `Orcamento.vendedor` não gera comissão, silenciosamente).

**Pesquisa.** Mercado brasileiro usa: percentual escalonado por meta, comissão sobre margem/lucro, percentual diferente por produto conforme rentabilidade, comissão por faixa de desconto (100% no preço cheio, 70% com até 5% desconto, 40% com até 10%, zero acima disso).

**Proposta.** Manter `Usuario.comissaoPercent` como fallback. `model RegraComissao { prioridade, usuarioId?, itemCatalogoId?, tipoItem?, margemMinPercent?, margemMaxPercent?, percentual, baseCalculo?, ativa }`, resolução por especificidade. `ParametrosGrafica.comissaoGatilho` — `APROVACAO|RECEBIMENTO|ENTREGA`; em RECEBIMENTO, comissão liberada proporcionalmente conforme `ContaReceber` são baixadas (`Comissao.valorLiberado`) — **protege o caixa contra pagar comissão sobre venda que virou calote**. `model FatorComissaoDesconto { descontoAtePercent, fatorComissao }`. `Comissao.usuarioId` nullable + `representanteNome`. Estorno: replicar `estornadoEm` (já existe em `CustoPedido`).

### E. Cadastros e estrutura

#### A13 — `ContaPrepaga` é a carteira da gráfica no fornecedor; crédito de cliente não existe — **CONSTRUÍDO 2026-08-27 (rodada 12)**

**Status:** ver bloco "Atualização (rodada 12)" no topo do documento — `model CreditoCliente`/`MovimentacaoCreditoCliente`, saldo sempre calculado (nunca armazenado), tela `/financeiro/creditos-clientes`, consumo opcional na aprovação do orçamento revalidado no servidor.
**Confirmado.** `ContaPrepaga` é carteira da gráfica junto a um fornecedor (ex: Lalamove) — correto e bem feito, mas é o oposto do que soa e não tem nada a ver com cliente. Cliente que deposita R$5.000 e consome ao longo de meses (comum em conta recorrente corporativa) não tem onde ser registrado — `Pagamento` exige orçamento **aprovado**, que ainda não existe.

**Proposta.** `model CreditoCliente { clienteId @unique, saldo }` + `MovimentacaoCreditoCliente { tipo DEPOSITO|CONSUMO|ESTORNO|AJUSTE, valor, orcamentoId?, pagamentoId? @unique }`, espelhando a mecânica de `ContaPrepaga`. Comentário cruzado nos dois models pra não confundir.

#### A14 — Despesa recorrente: só mensal, valor sempre igual, sem fim — e perde `categoriaCustoId` — **CONSTRUÍDO 2026-08-27 (rodada 12)** (bug do `categoriaCustoId` já corrigido na rodada 2)

**Status:** ver bloco "Atualização (rodada 12)" no topo do documento — `Despesa.periodicidade` (7 valores, default MENSAL sem regressão), `recorrenciaAteEm`, `valorVariavel`. Catch-up de série atrasada virou teto de TEMPO (24 meses), não de contagem de ocorrências.

**Status:** só o "achado concreto" (cópia de `categoriaCustoId`) foi corrigido — 1 linha. `periodicidade`/`recorrenciaAteEm`/`valorVariavel` (a proposta completa, abaixo) continuam gap.

**O que falta.** `gerarDespesasRecorrentesPendentes` avança mês a mês, copia o mesmo valor, sem data de término. **Achado concreto**: o `create` copia `descricao`/`categoria` (texto)/`valor` mas **NÃO copia `categoriaCustoId`** — toda ocorrência automática nasce sem vínculo estruturado. Como custo fixo (aluguel, energia, salário) é justamente recorrente, isso quebra silenciosamente o agrupamento por categoria e inviabiliza a linha de custo fixo do DRE (A3) e a conferência de overhead (A2).

**Proposta.** Corrigir a cópia de `categoriaCustoId` primeiro (uma linha, pré-requisito de A2/A3). `Despesa.periodicidade` — `SEMANAL|QUINZENAL|MENSAL|BIMESTRAL|TRIMESTRAL|SEMESTRAL|ANUAL`. `recorrenciaAteEm DateTime?`. `valorVariavel Boolean` (gera ocorrência com valor 0, "a confirmar", em vez de mentir um valor).

#### A15 — Não existe conta bancária/caixa, e nada é atribuível a conta ou filial
**Custo estimado:** 🟡 Médio — 1 model novo (`ContaFinanceira`) com poucos campos e FK opcional direta em `Pagamento`/`Despesa`, mais `Despesa.filialId` aditivo; é cadastro de referência, não muta cálculo de saldo existente.

**O que falta.** Nenhum `ContaBancaria`/`Caixa`. `Pagamento`/`Despesa` sabem a forma, não o destino — gráfica com 2 contas + caixa não consegue dizer onde o dinheiro está, e o fluxo de caixa projetado (A4) não tem saldo inicial. `Despesa` não tem `filialId` (mas `Orcamento.filialId` existe) — impossível resultado por filial mesmo do lado da receita.

**Proposta.** `model ContaFinanceira { nome, tipo CONTA_CORRENTE|CAIXA|POUPANCA|CARTEIRA_DIGITAL|OUTRO, saldoInicial, saldoInicialEm, ativa }` + FK opcional em `Pagamento`/`Despesa`. `Despesa.filialId String?`.

#### A16 — Exportação pro contador é foto mensal fixa, com risco de dupla contagem declarado no próprio código
**Custo estimado:** 🟡 Médio — sem schema novo, é extensão de tela/exportação existente com lógica nova moderada (intervalo livre, blocos novos, agrupamento, bloco de possíveis duplicidades).

**O que falta.** Só mês fechado, sem intervalo livre. Só 3 blocos (pagamentos, despesas pagas/pendentes) — não exporta contas a receber, comissões, custos por pedido. Não agrupa por `CategoriaCusto` estruturada. O comentário em `Pagamento.contaReceber` declara risco aceito sem mitigação: lançar `Pagamento` manual + marcar `ContaReceber` recebida conta o dinheiro duas vezes, sem deduplicação.

**Proposta.** Intervalo livre, blocos novos (contas a receber com aging, comissões, custos por pedido), agrupamento por categoria com subtotal por natureza, coluna de filial, bloco DRE, bloco "possíveis duplicidades".

#### A17 — Trilha de auditoria não cobre todas as entidades financeiras — **CONSTRUÍDO 2026-08-24 (rodada 4)**
**O que faltava.** `ContaReceber`/`ContaPrepaga` chamam `registrarAuditoria` mas caem no chip cinza genérico do mapa de cores. Mais relevante: `CustoPedido` (o número que decide o lucro do pedido) não aparecia na trilha pro estorno — alguém podia zerar o custo real de um pedido cancelado sem deixar rastro.

**Status.** `lancarCustoPedido`/`excluirCustoPedido` (`src/app/producao/actions.ts`) já tinham `registrarAuditoria` desde a fase "custo real" — o achado estava desatualizado nesse ponto. Faltava mesmo o estorno em `cancelarPedido`: agora instrumentado (ação `custo_pedido.estornar`, diff via `criarDiffCampos`). `CustoPedido` adicionado a `CORES_ENTIDADE` em `financeiro/auditoria/page.tsx`. 2 testes de integração novos em `src/app/producao/actions.custo-auditoria.test.ts`.

## Prioridade sugerida (Financeiro)

Ordenada por impacto sobre o diferencial do produto e risco do número exibido estar errado, não por esforço.

| # | Achado | Por quê |
|---|---|---|
| 1 | **A1** — ligar Despesa↔CustoPedido | Coração do "quanto lucrei". Reaproveita padrão que já existe 3x. |
| 2 | **A2** — `CategoriaCusto.natureza` + cobertura de overhead | Destrava DRE, margem de contribuição, ponto de equilíbrio. |
| 3 | **A14 (correção)** — recorrência perdendo `categoriaCustoId` | Correção de 1 linha, pré-requisito de #2/#4. |
| 4 | **A3** — DRE + corrigir `saldoReal` | `saldoReal` hoje é um número errado exibido com destaque. |
| 5 | **A4** — fluxo de caixa projetado | Melhor razão valor/esforço — agregação pura sobre dado que já existe. |
| 6 | **A8** — recebimento/pagamento parcial | Bloqueia #7 e #9 (juros/retenção nunca batem exato). |
| 7 | **A12** — regras de comissão + gatilho por recebimento | Maior gap de abrangência; protege caixa diretamente. |
| 8 | **A5** — régua de cobrança + juros/multa | Infra já existe (cron/e-mail/webhook/CAS). |
| 9 | **A7** — condições de pagamento estruturadas | Sem isso metade das parcelas nunca é cadastrada. |
| 10 | **A15** — `ContaFinanceira` + `Despesa.filialId` | Pré-requisito prático de #5 e resultado por filial. |
| 11 | **A9** — retenção de impostos | Crítico pra quem atende órgão público/grande empresa. |
| 12 | **A10** — ligar imposto ao regime/RBT12 (aviso, não motor) | Erro silencioso que corrói margem em gráfica crescendo. |
| 13 | **A6** — controle de crédito do cliente | Par de #8; baixo esforço. |
| 14 | **A11** — taxa real de cartão/antecipação | Refina #5 e o lucro real por pedido. |
| 15 | **A14 (features)** — periodicidade/fim/valor variável | Abrangência pura, não corrompe número (após #3). |
| 16 | **A13** — crédito de cliente | Real mas atinge menos gráficas. |
| 17 | **A16** — exportação pro contador | Depende de #4 pra valer a pena. |
| 18 | **A17** — auditar `CustoPedido` | Baixo impacto operacional, lacuna conceitual barata de fechar. |

Critical files: `prisma/schema.prisma` (`Despesa` ~1906, `ContaReceber` ~2039, `Pagamento` ~1854, `Comissao` ~2074, `CategoriaCusto` ~2647, `CustoPedido` ~2686, `OrigemCusto` ~2666, `ParametrosGrafica` ~100, `FormaPagamento` ~1842, `Cliente` ~1005, `ContaPrepaga` ~1971), `src/lib/custo-pedido.ts` (`lucroDoPedido`), `src/lib/meu-negocio.ts` (`saldoReal`), `src/app/financeiro/contas-receber/actions.ts` (`marcarComoRecebido`), `src/app/orcamento/[id]/actions.ts` (~2433, `registrarPagamento`), `src/lib/despesa-recorrente.ts` (linha 54-64, perda de `categoriaCustoId`), `src/lib/pricing/compor.ts` (`overheadPercent`/`impostoPercent`).

---

# Parte 5 — Clientes

Pesquisei como o cadastro de cliente é estruturado em (a) ERPs brasileiros de manufatura/comercial que gráficas de médio porte realmente usam (Senior, FoccoERP, UnoERP, Bling, Nomus, Sankhya), (b) plataformas brasileiras específicas do setor gráfico (Sistograf/web-to-print, Gráfica das Gráficas, Loja Gráfica Web, DKJ), e (c) a documentação fiscal de NF-e (Focus NFe — o mesmo gateway que o GrafPro já usa — e as rejeições da SEFAZ ligadas ao destinatário). Comparei campo a campo com `model Cliente` (`prisma/schema.prisma:1005-1036`), `src/lib/clientes.ts`, `src/app/clientes/*` e o caminho fiscal (`src/lib/nota-fiscal.ts`, `src/lib/focus-nfe.ts`). Conclusão geral: **o `Cliente` de hoje é um "contato de agenda com endereço de entrega", não um cadastro comercial** — ele cobre exatamente o caso "pessoa física do bairro que compra uma vez", que é o perfil MENOS lucrativo de qualquer gráfica, e não cobre o caso que sustenta faturamento recorrente (empresa PJ, com comprador ≠ financeiro ≠ quem aprova arte, entrega em endereço diferente do faturamento, condição de pagamento negociada, tabela de preço de revenda). Achei **2 defeitos duros já presentes no código fiscal** (um deles com prazo: o CNPJ alfanumérico entrou em vigor em 31/07/2026, três semanas atrás) e **12 gaps estruturais**. Além disso, o cadastro é o único módulo do sistema sem noção de "ativo/inativo" e sem `updatedAt`, e a ficha do cliente (`/clientes/[id]`) é literalmente só um formulário de edição — não mostra um pedido sequer, nem quanto o cliente deve.

## Achados

### A1. Não existe distinção Pessoa Física × Pessoa Jurídica — e por isso faltam razão social, Inscrição Estadual e indicador de IE do destinatário — **CONSTRUÍDO 2026-08-27 (rodada 12)**

**Status:** ver bloco "Atualização (rodada 12)" no topo do documento — `Cliente.tipoPessoa`/`razaoSocial`/`inscricaoEstadual`/`indicadorInscricaoEstadual`, pendência nova em `verificarProntidaoFiscal`, `focus-nfe.ts` enviando os campos de IE condicionalmente (evita rejeições SEFAZ 728/791). **Escopo restrito de propósito**: validação de dígito verificador e normalização do `documento` continuam gap, ver achado A2 da mesma Parte.

**O que falta:** `Cliente` tem um único campo `nome` e um único campo `documento` ("CPF ou CNPJ", texto livre). Não existe `tipoPessoa`, não existe `razaoSocial`/`nomeFantasia`, não existe `inscricaoEstadual`, não existe indicador de contribuinte de ICMS. O impacto é direto na emissão: em `src/lib/focus-nfe.ts:236-240` o payload manda `nome_destinatario` (o `Cliente.nome`, que pode perfeitamente ser o nome fantasia digitado pelo balconista) e só CPF **ou** CNPJ, decidido por contagem de dígitos. **Nenhum dos dois campos de IE do destinatário é enviado** — nem `inscricao_estadual_destinatario`, nem `indicador_inscricao_estadual_destinatario`. E `verificarProntidaoFiscal` (`src/lib/nota-fiscal.ts:82-127`) não tem como exigir IE, porque o campo não existe no schema.

**Pesquisa:** o `indicador_inscricao_estadual_destinatario` (tag `indIEDest` da NF-e 4.0) assume 1 = contribuinte de ICMS (e nesse caso **a IE é obrigatória**), 2 = contribuinte isento de inscrição, 9 = não contribuinte ([Focus NFe — DSL da NF-e](https://focusnfe.com.br/dsl/4.0/NotaFiscalXML.html), [referência da API de emissão](https://doc.focusnfe.com.br/reference/emitir_nfe), [Conta Azul — Indicador de inscrição estadual](https://ajuda.contaazul.com/hc/pt-br/articles/360045471131-NF-e-o-que-%C3%A9-e-como-preencher-Indicador-de-inscri%C3%A7%C3%A3o-estadual)). A combinação errada é rejeitada pela SEFAZ: **rejeição 728** ("NF-e sem informação da IE do destinatário") e **rejeição 791** ("NF-e com indicação de destinatário isento de IE, com a informação da IE do destinatário") ([Oobj 728](https://oobj.com.br/bc/rejeicao-728-nf3e-ie-destinatario-como-resolver/), [Oobj 791](https://oobj.com.br/bc/rejeicao-791-nfe-como-resolver/)). Sobre o nome: a nota fiscal deve ser emitida com a **razão social**; nome fantasia "não tem validade jurídica para a emissão de documentos fiscais" ([Omie](https://www.omie.com.br/blog/razao-social-e-nome-fantasia-entenda-a-diferenca/), [Contabilizei](https://www.contabilizei.com.br/contabilizei-responde/posso-emitir-nota-fiscal-com-nome-fantasia/)). Todos os ERPs brasileiros que olhei separam esses campos por tipo de pessoa e trazem IE + status de contribuinte no cadastro do cliente ([UnoERP CDW0101](https://www.unoerp.com.br/manual/cdw0101.html), [FoccoERP FCLI0200](https://help.foccoerp.com.br/Programas/FoccoERP/Comercial/Cliente/FCLI0200/), [Senior F085CAD](https://documentacao.senior.com.br/goup/5.10.3/menu_cadastros/f085cad.htm)).

**Proposta (aditiva, tudo nullable, nenhum tenant quebra):**
```
enum TipoPessoa { FISICA, JURIDICA }            // sem OUTRO: não existe terceiro tipo
enum IndicadorInscricaoEstadual { CONTRIBUINTE, ISENTO, NAO_CONTRIBUINTE }
```
- `Cliente.tipoPessoa TipoPessoa?` (null = cadastro antigo; a tela pode inferir por comprimento do documento e pedir confirmação).
- `Cliente.razaoSocial String?` + `Cliente.nomeFantasia String?` — `nome` continua sendo o rótulo de uso interno (nunca migrar dado), mas a emissão passa a preferir `razaoSocial ?? nome`.
- `Cliente.inscricaoEstadual String?` + `Cliente.indicadorInscricaoEstadual IndicadorInscricaoEstadual?` (default de aplicação `NAO_CONTRIBUINTE`, que é o comportamento implícito de hoje).
- `Cliente.inscricaoMunicipal String?` — irrelevante pra NF-e, mas é o campo do **tomador** que qualquer NFS-e municipal pede; barato guardar agora (ver nota em A3).
- Em `verificarProntidaoFiscal`: nova pendência "Cliente marcado como contribuinte de ICMS sem Inscrição Estadual" — mesmo padrão das pendências que já existem lá, bloqueando **antes** de bater na Focus e tomar 422.
- Em `focus-nfe.ts`: enviar `indicador_inscricao_estadual_destinatario` sempre e `inscricao_estadual_destinatario` **apenas** quando indicador = CONTRIBUINTE (é exatamente a regra que gera a rejeição 791 quando violada).

### A2. `documento` é texto livre não normalizado — e o CNPJ alfanumérico (vigente desde 31/07/2026) já quebra a emissão hoje — **BUG CORRIGIDO 2026-08-24 (parcial)**

**Custo estimado (restante pendente):** 🟡 Médio — sem model novo, mas soma normalização/validação de DV + uma migração de dado one-off com risco de colisão (a própria proposta avisa que precisa tratar duplicata revelada, não é puramente aditiva) + um botão novo reaproveitando o padrão do ViaCEP já no repo.

**Status:** o bug ativo (`focus-nfe.ts` mutilando CNPJ alfanumérico e mandando truncado como CPF) foi corrigido tanto pro destinatário (`normalizarDocumentoDestinatario`, rodada 1) quanto pro **emitente** — a própria gráfica (`normalizarCnpjEmitente`, rodada 4, 2026-08-24) — os dois testados. **Escopo restrito de propósito**: não implementado ainda — validação de dígito verificador, normalização do campo no cadastro (`src/lib/clientes.ts`), unicidade real, nem o botão "buscar por CNPJ". Isso continua gap, ver proposta completa abaixo.

**O que falta:** `clienteSchema` (`src/lib/clientes.ts`) valida `documento` com o validador genérico `opcional` = `string().trim().max(160)`. Sem dígito verificador, sem máscara, sem normalização. Três consequências verificadas no código:

1. **A unicidade não protege nada.** `@@unique([graficaId, documento])` é sobre a string crua: `12.345.678/0001-99` e `12345678000199` são duas linhas distintas e válidas. Duplicidade de cliente é a causa raiz de "o histórico do cliente está partido em dois cadastros".
2. **A emissão assume CNPJ 100% numérico.** `src/lib/focus-nfe.ts:227` faz `documento.replace(/\D/g, "")` e depois decide `documentoDestinatarioLimpo.length === 14 ? cnpj_destinatario : cpf_destinatario`. Para um CNPJ alfanumérico (ex.: `12ABC34501DE35`) a regex **apaga as letras**, sobram ~9 dígitos, e a nota é emitida com o número mutilado no campo **`cpf_destinatario`**. Não é rejeição elegante: é dado errado indo pra SEFAZ.
3. Como não há validação, um "documento" digitado errado só aparece como erro 422 opaco da Focus, meses depois, na hora de faturar.

**Pesquisa:** o CNPJ alfanumérico entrou em vigor em **31/07/2026** — as 12 primeiras posições passam a aceitar letras e números, só os 2 dígitos verificadores continuam numéricos, e o DV usa módulo 11 adaptado com valores ASCII. CNPJs existentes não mudam, mas "todos os sistemas envolvidos na consulta, registro e validação deverão ser ajustados para reconhecer e processar tanto os CNPJs tradicionais quanto os novos" — o Serpro publicou código de validação de referência inclusive em TypeScript ([Serpro](https://www.serpro.gov.br/menu/noticias/noticias-2024/cnpj-alfanumerico), [Inventti](https://inventti.com.br/cnpj-alfanumerico-entra-em-vigor-em-01-07-2026-sua-empresa-esta-preparada/), [TecnoSpeed](https://blog.tecnospeed.com.br/cnpj-alfanumerico/)). Sobre auto-preenchimento: BrasilAPI e OpenCNPJ expõem razão social, nome fantasia, endereço completo e **situação das inscrições estaduais** a partir do CNPJ, de graça e sem token ([BrasilAPI](https://brasilapi.com.br/), [OpenCNPJ](https://opencnpj.org/)).

**Proposta:**
- Normalizar no `clienteSchema` com um `.transform()`: guardar sempre sem pontuação e em maiúsculas (`12345678000199` / `12ABC34501DE35`). Isso conserta a unicidade sem mudar o schema Prisma — mas exige uma migração de dado one-off para limpar a pontuação dos cadastros existentes (o único ponto desta parte inteira que não é puramente aditivo; risco: pode revelar duplicatas que hoje convivem, então a migração precisa tratar colisão em vez de estourar).
- Validar DV de CPF e de CNPJ (numérico **e** alfanumérico, algoritmo do Serpro) em `src/lib/clientes.ts` — validador puro, testável, e automaticamente herdado pela importação de planilha, que reusa `clienteSchema` byte-a-byte (`src/lib/importacao/escritor-clientes.ts:18`).
- Em `focus-nfe.ts`, trocar a heurística `replace(/\D/g,"").length === 14` por decisão explícita a partir de `Cliente.tipoPessoa` (A1), com fallback pelo comprimento do documento **normalizado** (14 = CNPJ, 11 = CPF).
- Botão "buscar dados pelo CNPJ" no `ClienteForm`, preenchendo razão social/nome fantasia/endereço/IE — **precedente já existe no próprio repo**: `EnderecoFields.tsx:66` faz exatamente isso com o ViaCEP, client-side, sem chave de API.

### A3. O CFOP é fixo por gráfica e ignora a UF e o status de contribuinte do cliente — **PARCIALMENTE CONSTRUÍDO 2026-08-24 (rodada 5)**

**Custo estimado (restante pendente):** 🟡 Médio — sem model/campo novo (o indicador de contribuinte já veio do A1), é lógica nova moderada dentro de `resolverCfop`, função pura já existente, mais a pendência de configuração correspondente.

**O que faltava:** `DadosFiscaisGrafica.cfopPadrao` nasce `"5102"` e é usado tal e qual em toda emissão — `src/app/orcamento/[id]/actions.ts:2709` faz `cfop: dadosFiscais.cfopPadrao` para **todo item de toda nota**. `5xxx` é operação **dentro do estado**. Nenhum ponto do código compara `dadosFiscais.enderecoUf` com `cliente.enderecoUf`.

**Pesquisa:** venda interestadual exige CFOP da família 6xxx: **6102** para destinatário contribuinte de ICMS e **6108** para consumidor final **não contribuinte** — e neste segundo caso o remetente ainda responde pelo **DIFAL** ([NFE+ sobre 6108](https://blog.nfemais.com.br/cfop-6108-venda-de-mercadorias-adquiridas-ou-recebidas-de-terceiros-destinadas-a-nao-contribuintes-de-icms/), [Focus NFe sobre 6102](https://focusnfe.com.br/blog/cfop-6102-como-e-quando-utilizar/)). A própria SEFAZ rejeita combinações inválidas de CFOP × destinatário. Ou seja: **a primeira nota que uma gráfica emitir para um cliente de outro estado sai com CFOP errado** — e gráfica que vende etiqueta/rótulo, brinde ou material promocional vende pra fora do estado o tempo todo. (Observação lateral, fora do escopo de Clientes: `5102` é "revenda de mercadoria de terceiros"; gráfica que **fabrica** normalmente usa 5101 — vale uma revisão do default na Parte fiscal.)

**Proposta:** manter `cfopPadrao` como está (operação interna) e derivar o resto a partir do cliente, que é onde a informação mora:
- `DadosFiscaisGrafica.cfopPadraoInterestadual String? @default("6102")` (+ espelho em `DadosFiscaisFilial`, que é campo-a-campo idêntico por decisão já documentada no schema).
- `DadosFiscaisGrafica.cfopPadraoNaoContribuinte String?` / `...InterestadualNaoContribuinte String?` — ou, mais enxuto, uma função pura `resolverCfop({ ufEmitente, ufDestinatario, indicadorIE, padroes })` em `src/lib/nota-fiscal.ts`, testável como `resolverDadosFiscais` já é.
- Pendência nova em `verificarProntidaoFiscal` quando a operação for interestadual a não contribuinte e a gráfica não tiver configurado o CFOP correspondente — o sistema não deve tentar calcular DIFAL sozinho (isso é decisão contábil), mas **não pode emitir silenciosamente com 5102**.
- Nota adjacente: para gráfica, boa parte da produção é **impresso personalizado sob encomenda**, que pela Súmula 156 do STJ e pelo item 13.05 da LC 116/03 é fato gerador de **ISS**, não de ICMS ([Súmula 156 — Dizer o Direito](https://buscadordizerodireito.com.br/jurisprudencia/3386/sumula-156-stj), [Consultor Municipal](http://consultormunicipal.adv.br/artigo/tributos-municipais/01-07-2020-servicos-graficos-iss-ou-icms/)). O GrafPro só emite NF-e. Isso é um gap do módulo fiscal, não de Clientes — mas é o motivo de `inscricaoMunicipal` valer o campo desde já (A1).

**Status (2026-08-24):** construída a parte interno × interestadual — `DadosFiscaisGrafica.cfopPadraoInterestadual`/`DadosFiscaisFilial.cfopPadraoInterestadual` (default `"6102"`) + `resolverCfop()` em `src/lib/nota-fiscal.ts`, usado em `src/app/orcamento/[id]/actions.ts` na emissão. **Gap remanescente, deliberadamente fora do escopo desta rodada:** a distinção contribuinte × não-contribuinte de ICMS (6102 vs 6108, com implicação de DIFAL) continua sem existir — `resolverCfop` sempre usa `cfopPadraoInterestadual` pra qualquer venda fora do estado, porque depende do indicador de contribuinte do cliente (achado A1, campo ainda não existe no schema). Enquanto isso não for construído, gráfica que vende pra consumidor final não-contribuinte de outro estado ainda emite com CFOP potencialmente incorreto (6102 em vez de 6108) e sem cálculo/alerta de DIFAL.

### A4. Não existe cadastro de contatos do cliente — o cliente PJ é tratado como se fosse uma pessoa só — **CONSTRUÍDO 2026-08-27 (rodada 12)**

**Status:** ver bloco "Atualização (rodada 12)" no topo do documento — `model ContatoCliente` (soft-delete, 1 principal por cliente) + `Orcamento.contatoClienteId` convivendo com o snapshot em texto já existente. **Escopo restrito de propósito:** roteamento automático de aprovação de arte/financeiro pro contato certo continua gap, fica pra quando alguém pedir.

**O que falta:** um único `email` e um único `telefone` no `Cliente`. Não existe model de contato. O único contato nominal do sistema é o snapshot `Orcamento.contatoNome`/`contatoEmail`, digitado de novo a cada orçamento, sem vínculo com cadastro nenhum (é a causa raiz dos achados B6/B7 da Parte 1). Verifiquei também que `Cliente.email` é hoje **decorativo**: aparece só na listagem e no formulário de edição — nenhum e-mail do sistema é enviado para ele (os templates em `src/lib/email/templates.ts` disparam para donos/responsáveis da gráfica; o link público vai por WhatsApp/e-mail manual do vendedor).

**Pesquisa:** contatos múltiplos por cliente são tela própria em ERP brasileiro sério — a Senior tem inclusive telas separadas para contatos (F085CTO), endereço de entrega (F085ENT) e endereço de cobrança (F085COB) do mesmo cliente ([Senior F085CAD](https://documentacao.senior.com.br/goup/5.10.3/menu_cadastros/f085cad.htm)); UnoERP e FoccoERP têm "Contatos" com nome, cargo, telefone e e-mail ([UnoERP](https://www.unoerp.com.br/manual/cdw0101.html), [FoccoERP](https://help.foccoerp.com.br/Programas/FoccoERP/Comercial/Cliente/FCLI0200/)); VHSYS idem ([VHSYS](https://www.vhsys.com.br/controle-de-vendas/gestao-de-clientes/)). No setor gráfico especificamente, a Gráfica das Gráficas (B2B, vende para gráficas/revendas) instrui o cliente a **"adicionar um novo contato financeiro para receber boletos"** numa seção "Contatos" separada dentro da área do cliente ([Gráfica das Gráficas — instruções](https://instrucoes.graficadasgraficas.com.br/garantia/)) — ou seja, a separação "quem compra × quem paga" é operacional, não teórica. Somando com o fluxo de arte (o GrafPro já tem `/a/[token]` para aprovação de arte pelo cliente), os três papéis reais são comprador, financeiro e aprovador de arte.

**Proposta:**
```
enum FuncaoContatoCliente { COMPRADOR, FINANCEIRO, APROVACAO_ARTE, RECEBIMENTO, OUTRO }

model ContatoCliente {
  id String @id @default(cuid())
  clienteId String
  nome String
  cargo String?          // texto livre — "Compras", "Diretor de Marketing"
  departamento String?   // resolve B6 da Parte 1 na raiz
  email String?
  telefone String?
  whatsapp String?
  funcao FuncaoContatoCliente @default(COMPRADOR)
  funcaoOutro String?    // padrão enum-fechado + escape, igual MaterialSubstrato/TipoAdesivo
  principal Boolean @default(false)
  ativo Boolean @default(true)
  ...
  @@index([clienteId])
}
```
- `Orcamento.contatoClienteId String?` (FK, `onDelete: SetNull`) **convivendo com** `contatoNome`/`contatoEmail`, que permanecem como snapshot congelado — exatamente o precedente já estabelecido em `Comissao` (snapshot de taxa/política) e `Orcamento.opcaoEscolhidaNome`. Escolher o contato no orçamento passa a preencher o snapshot; digitar à mão continua funcionando.
- Migração zero: cliente sem nenhum `ContatoCliente` continua usando `Cliente.email`/`telefone` como hoje. (Uma migração opcional pode criar 1 contato `principal` a partir do e-mail/telefone existente — mas não é necessária.)
- Destrava coisas concretas que hoje não têm onde ir: mandar o link de aprovação de arte pro aprovador e o boleto/NF pro financeiro, sem a gráfica manter isso num caderno.

### A5. Um único endereço por cliente — não há endereço de entrega, nem filiais, nem o grupo "local de entrega" da NF-e — **CONSTRUÍDO 2026-08-29 (rodada 14)**

**Status:** `model EnderecoCliente` (PRINCIPAL/COBRANCA/ENTREGA) construído seguindo o padrão de `ContatoCliente`. `Orcamento.enderecoEntregaId` convivendo com `localEntrega` texto livre. Campos fiscais inline do `Cliente` inalterados. `clientePaiId`/matriz-filial ficou fora de escopo (inferência sem fonte confirmada no próprio achado).

**O que falta:** os 8 campos `endereco*` inline no `Cliente` são simultaneamente endereço de cadastro, de cobrança e de entrega. Não há como registrar que o faturamento vai pra matriz em São Paulo e a caixa de rótulos vai pra fábrica em Extrema. O sistema tem `Orcamento.localEntrega String?` (texto livre, digitado por pedido) e `model Entrega` (rastreamento pós-produção, sem endereço nenhum) — nenhum dos dois é cadastro reutilizável.

**Pesquisa:** endereços múltiplos com **tipo** (comercial, entrega, cobrança) são padrão em ERP brasileiro, incluindo a opção "usa endereço único" como default ([UnoERP](https://www.unoerp.com.br/manual/cdw0101.html), [Senior — telas F085ENT/F085COB](https://documentacao.senior.com.br/goup/5.10.3/menu_cadastros/f085cad.htm), [VHSYS](https://www.vhsys.com.br/controle-de-vendas/gestao-de-clientes/)). E isso não é só conveniência: a NF-e tem um **grupo próprio de "Local de Entrega" (Grupo G)** para quando a mercadoria é entregue em endereço diferente do destinatário — cenário descrito como típico de "filiais, centros de distribuição ou operadores logísticos" ([AgoraOS](https://suporte.agoraos.com.br/hc/pt-br/articles/6269434445851-Como-adicionar-um-endere%C3%A7o-de-entrega-diferente-do-endere%C3%A7o-de-faturamento-na-NFe), [Piello Contabilidade](https://www.piello.com.br/noticia/emissao-de-nota-fiscal-de-faturamento-e-de-entrega-para-cnpj-e-enderecos-diferentes)). Para o perfil da gráfica-piloto isso é diário: rótulo é insumo de fábrica, e quem paga (o escritório) quase nunca é quem recebe (a linha de produção). Para comunicação visual, o "endereço de entrega" é o local da **instalação**, que muda a cada pedido.

**Proposta:**
```
enum TipoEnderecoCliente { PRINCIPAL, COBRANCA, ENTREGA }

model EnderecoCliente {
  id String @id @default(cuid())
  clienteId String
  apelido String            // "Fábrica Extrema", "Loja Shopping Iguatemi"
  tipo TipoEnderecoCliente @default(ENTREGA)
  cep/logradouro/numero/complemento/bairro/municipio/codigoIbge/uf   // mesmos nomes do Cliente
  contatoNome String?       // quem recebe
  contatoTelefone String?
  instrucoesEntrega String? // horário de recebimento, doca, agendamento, "tocar interfone"
  padrao Boolean @default(false)
  ativo Boolean @default(true)
  @@index([clienteId])
}
```
- Os campos inline do `Cliente` **ficam como estão** e continuam sendo o endereço fiscal do destinatário (nada muda na emissão, nada migra). `EnderecoCliente` é aditivo e opcional.
- `Orcamento.enderecoEntregaId String?` (FK opcional) convivendo com `localEntrega` texto livre, mesmo padrão de snapshot de A4. Alimenta a Ordem de Produção e, no futuro, o grupo "local de entrega" da NF-e.
- Grupos econômicos / matriz-filial do cliente (mesma empresa, CNPJs diferentes) resolveriam com `Cliente.clientePaiId String?` auto-relacional — **(inferência minha)**, não vi fonte que prove que gráfica pequena precisa disso; só vale se aparecer pedido real, porque bagunça todos os relatórios "por cliente".

### A6. Zero dados comerciais: sem limite de crédito, prazo de pagamento padrão, forma de pagamento preferida ou desconto negociado — **CONSTRUÍDO 2026-08-28 (rodada 13)** (`limiteCredito`/`prazoPagamentoPadraoDias` já vieram do A6 da Parte 4, rodada 12)

**Status:** `formaPagamentoPreferida`, `descontoPadraoPercent` e `observacaoFinanceira` completam o cadastro. Pré-preenchimento real implementado nos 3 pontos: `Orcamento.condicoesPagamento` sugerido ao escolher cliente na Calculadora, `ContaReceber.vencimento` pré-calculado a partir do prazo padrão, desconto por item sugerido a partir do `descontoPadraoPercent` (sempre passando pela trava de `descontoMaxSemAprovacao`).

**O que falta:** nada em `Cliente` diz como aquele cliente compra. `Orcamento.condicoesPagamento` é texto livre redigitado a cada orçamento; `FormaPagamento` (enum) só existe em `Pagamento`, depois do dinheiro entrar; `ContaReceber` é cadastrada parcela a parcela na mão. Não há como responder "esse cliente é faturado 28 dias" nem "esse cliente já estourou o limite".

**Pesquisa:** limite de crédito + condição de pagamento + tabela de preço + representante estão juntos numa aba "Definições" do cadastro em ERP brasileiro de porte ([FoccoERP FCLI0200](https://help.foccoerp.com.br/Programas/FoccoERP/Comercial/Cliente/FCLI0200/), [UnoERP](https://www.unoerp.com.br/manual/cdw0101.html)); no Bling — o ERP que a gráfica pequena de fato usa — o cadastro traz "condições de pagamento", "limite de crédito" e "tabela de preços" ([Polivision sobre o Bling](https://polivision.com.br/cadastro-de-clientes-e-fornecedores-no-bling/), [MarketUP: como controlar o limite de crédito por cliente](https://suporte.marketup.com/hc/pt-br/articles/4407620579732-COMO-CONTROLAR-O-LIMITE-DE-CR%C3%89DITO-POR-CLIENTE)). O bloqueio de venda por limite estourado é o comportamento padrão desses sistemas ([Nomus — análise de crédito do cliente](https://ajuda.nomus.com.br/support/solutions/articles/27000062879--guia-r%C3%A1pido-an%C3%A1lise-de-cr%C3%A9dito-do-cliente), [Sankhya](https://ajuda.sankhya.com.br/hc/pt-br/articles/37673379610519)). O dado mais concreto que achei vem de um fornecedor do próprio setor (comunicação visual/serigrafia/transfer), que publica a política inteira: cadastro exige contrato social, 2 referências comerciais e 1 bancária, **mínimo de 24 meses de CNPJ**, **limite inicial de R$ 5.000 para empresa e R$ 15.000 para órgão público**, primeira parcela em **28 dias** da emissão da nota, multa de 5% + juros e negativação em caso de inadimplência ([DKJ — pagamento faturado para empresas e órgãos públicos](https://www.dkj.online/pagina/pagamento-faturado-para-empresas-e-orgaos-publicos.html)).

**Proposta (tudo campo nullable no `Cliente`, sem model novo):**
- `limiteCredito Decimal? @db.Decimal(12,2)` — null = sem limite (comportamento de hoje). Nunca um bloqueio duro: seguir a disciplina de `descontoMaxSemAprovacao`, ou seja, avisar/exigir aprovação, com o limiar configurável.
- `prazoPagamentoDiasPadrao Int?` — pré-preenche `Orcamento.condicoesPagamento` e, melhor ainda, pré-calcula o `vencimento` ao cadastrar `ContaReceber` (hoje 100% manual).
- `formaPagamentoPreferida FormaPagamento?` — **reusa o enum que já existe**, zero conceito novo.
- `descontoPadraoPercent Decimal? @db.Decimal(5,4)` — aplicado como sugestão no orçamento, respeitando `ParametrosGrafica.descontoMaxSemAprovacao` que já existe.
- `observacaoFinanceira String?` (ex.: "só paga com nota + boleto, portal da prefeitura").
- Nenhum desses campos deve ser recalculado retroativamente em orçamento já enviado — são **defaults de preenchimento**, não regras de recálculo (mesma disciplina dos snapshots de `Comissao`).

### A7. Não existe segmento de cliente nem tabela de preço diferenciada — e a gráfica que vende para revenda/agência é um mercado inteiro — **PARCIALMENTE CONSTRUÍDO 2026-08-24 (rodada 10)**

**Custo estimado (restante pendente):** 🔴 Caro — o Nível 2 que falta é 2 models novos (`TabelaPreco` + `TabelaPrecoItem`), e a própria proposta o marca como "se e quando aparecer demanda real", não pra agora.

**Status:** só o "Nível 1" da proposta (o "Nível 2", `model TabelaPreco`, fica de fora de propósito). `Cliente.segmento`/`segmentoOutro`/`margemPadraoOverride` + ligação real ao gancho dormente `ContextoPrecificacao.margemLucroOverride` (já plumbado em todos os 7 branches do motor, nunca usado até agora) — `Cliente.margemPadraoOverride`, quando preenchido, substitui `ParametrosGrafica.margemPadrao` no preço final de todo item do orçamento daquele cliente. Confirmado com teste de integração real (não só checagem de tipo): preço final muda de fato com o override. **Escopo aceito conscientemente**: a prévia de preço da Calculadora (antes do orçamento existir/de escolher cliente) sempre usa a margem padrão da gráfica — só o cálculo persistido (criação/edição/duplicação do orçamento) aplica o override do cliente corretamente.

**O que falta:** todo cliente é precificado igual. `ParametrosGrafica.margemPadrao` é uma margem única para a gráfica inteira; `ItemGrafica.precoVenda` é um preço único por produto. Não existe `tipoCliente`/`segmento`, nem tabela de preço, nem qualquer forma de dizer "esse aqui é revendedor, aplica a tabela B".

**Pesquisa:** vender para revenda/agência é um modelo de negócio inteiro no Brasil, não um caso de borda — existem gráficas que **só** atendem revenda ("atendimento exclusivo para gráficas, representantes e agências de publicidade — não vendemos para consumidor final", [Loja Gráfica Web](https://lojagraficaweb.com.br/loja/tabela_precos.php); [Gráfica das Gráficas](https://www.graficadasgraficas.com.br/tabela-de-precos)). E a plataforma brasileira de web-to-print para gráficas vende exatamente essa capacidade como diferencial: **"Tabelas diferenciadas de preço: um valor para o cliente final e outro para o revendedor, tudo no mesmo ambiente"** ([Sistograf](https://blog.sistograf.com.br/web-to-print-guia-pratico-graficas-revendas-online/)). Tabela de preço por cliente também é campo de cadastro nos ERPs citados em A6, e "segmentação de clientes" aparece como o exemplo canônico de campo personalizado no Bling ([Polivision](https://polivision.com.br/cadastro-de-clientes-e-fornecedores-no-bling/)).

**Proposta em dois níveis — e a boa notícia é que o motor já tem o gancho pronto:**

*Nível 1 (barato, alto retorno):*
```
enum SegmentoCliente { VAREJO, EMPRESA, REVENDA_AGENCIA, INDUSTRIA, ORGAO_PUBLICO, OUTRO }
Cliente.segmento SegmentoCliente?
Cliente.segmentoOutro String?     // escape padrão do repo
Cliente.margemPadraoOverride Decimal? @db.Decimal(5,4)
```
`comporPreco` (`src/lib/pricing/compor.ts:39,60`) **já aceita `margemLucroOverride`**, e `precificar.ts` já o repassa nos 6 branches (linhas 134, 191, 254, 298, 369). Verifiquei por grep: **nenhum caller em `src/app` ou em `carregar.ts` jamais preenche esse campo** — é um gancho dormente, plumbado de ponta a ponta e nunca usado. Ligar margem por cliente/segmento é literalmente passar um valor que o motor já sabe consumir, sem tocar em nenhum dos 6 modelos de cálculo.

*Nível 2 (se e quando aparecer demanda real):* `model TabelaPreco { graficaId, nome, ajustePercent, ativa }` + `Cliente.tabelaPrecoId String?` + preço por item opcional (`TabelaPrecoItem`). Cuidado de nomenclatura: `TabelaPrecoPapel` já existe no schema e é **outra coisa** (preço/kg por gramatura de papel) — o nome novo precisa não confundir.

### A8. Não há vendedor/responsável comercial atribuído ao cliente — e o vendedor do orçamento é texto livre desalinhado da comissão — **CONSTRUÍDO 2026-08-27 (rodada 11)**

**Status:** ver bloco "Atualização (rodada 11)" no topo do documento — `Cliente.vendedorId` + `ParametrosGrafica.comissaoSegueVendedorDoCliente` (default `false`, sem mudança de comportamento pra quem não liga), lido na hora da aprovação (nunca snapshotado) nos dois caminhos (painel e link público). **Escopo restrito de propósito:** `Orcamento.vendedor` (texto livre) e "minha carteira de clientes" continuam de fora — só o campo e o fio até a comissão.

**O que falta:** `Cliente` não tem dono comercial. No orçamento existem **dois conceitos concorrentes de vendedor**: `Orcamento.vendedor String?` (texto livre, digitado) e `Orcamento.usuarioId` (quem criou o registro) — e é o **segundo** que vira `Comissao.usuarioId` no fechamento (`model Comissao`: "usuarioId — vendedor, snapshot de Orcamento.usuarioId"). Ou seja, se um auxiliar administrativo digita o orçamento que a vendedora fechou, a comissão é atribuída ao auxiliar e o nome da vendedora fica num campo de texto que ninguém lê.

**Pesquisa:** "representante/vendedor" é campo do cadastro do cliente nos ERPs brasileiros pesquisados ([FoccoERP](https://help.foccoerp.com.br/Programas/FoccoERP/Comercial/Cliente/FCLI0200/), [UnoERP](https://www.unoerp.com.br/manual/cdw0101.html)); a literatura comercial brasileira trata "carteira de clientes" — clientes segmentados por vendedor, com acompanhamento de ativos/inativos — como a unidade básica de gestão de vendas ([Mercos](https://blog.mercos.com/carteira-de-clientes/), [PipeRun](https://crmpiperun.com/blog/carteira-de-clientes/)).

**Proposta:**
- `Cliente.vendedorId String?` → FK `Usuario`, `onDelete: SetNull` (`Usuario` já tem `desativadoEm` e `comissaoPercent`, então o conceito de "quem é vendedor" já existe no schema).
- Pré-preencher o vendedor do orçamento a partir do cliente, e usar esse valor (não `usuarioId`) como base da `Comissao` — decisão de negócio, mas o schema precisa oferecer a opção. Uma flag `ParametrosGrafica.comissaoSegueVendedorDoCliente Boolean @default(false)` preserva 100% do comportamento atual para quem já usa.
- Destrava "minha carteira" na listagem e no funil (o backlog de CRM já anotado ganha o campo que faltava para existir).

### A9. Cliente não pode ser desativado — só excluído (hard delete), e a exclusão falha justamente para os clientes que importam — **CONSTRUÍDO 2026-08-24 (rodada 2+3)**

**Status:** ver bloco "Atualização (rodada 2)" no topo do documento — `desativadoEm`/`bloqueadoParaVenda`/`motivoBloqueio`/`updatedAt`, actions de desativar/reativar/anonimizar e aviso de bloqueio na aprovação de orçamento, tudo construído.

**O que falta:** não existe `ativo`, `desativadoEm`, `bloqueado` nem `updatedAt` em `Cliente`. `excluirCliente` (`src/app/clientes/actions.ts`) faz `prisma.cliente.delete` e, quando há orçamento vinculado, devolve: *"Este cliente tem orçamentos vinculados e não pode ser excluído. Se quiser mesmo assim remover os dados pessoais dele, fale com o suporte."* Consequências: (a) cliente que sumiu há 3 anos continua poluindo todo dropdown do sistema para sempre; (b) não há como marcar "bloqueado por inadimplência — não vender a prazo"; (c) o pedido de exclusão de dado pessoal vira ticket manual de suporte; (d) `Cliente` é praticamente o único model relevante do schema **sem `updatedAt`** — não dá para saber quando um cadastro foi revisado pela última vez.

**Pesquisa:** bloqueio/inativação de cliente é campo padrão de cadastro ([UnoERP](https://www.unoerp.com.br/manual/cdw0101.html), [FoccoERP](https://help.foccoerp.com.br/Programas/FoccoERP/Comercial/Cliente/FCLI0200/)) e o bloqueio automático de novas vendas a prazo é a resposta esperada à inadimplência ([Nomus](https://ajuda.nomus.com.br/support/solutions/articles/27000062879--guia-r%C3%A1pido-an%C3%A1lise-de-cr%C3%A9dito-do-cliente), [Sankhya](https://ajuda.sankhya.com.br/hc/pt-br/articles/37673379610519)). Do lado legal: a LGPD não isenta ninguém por porte — "se um autônomo coleta, armazena ou usa dados pessoais de clientes como nome, telefone e endereço, está sujeito à lei" — e o titular pode pedir eliminação, com o cuidado de que dados necessários a obrigação fiscal têm retenção própria ([Sebrae](https://sebrae.com.br/sites/PortalSebrae/artigos/lgpd-exige-adequacoes-de-empresas-a-dados-de-clientes-veja-o-que-muda,fe51f2520da54710VgnVCM1000004c00210aRCRD), [DT Network — obrigações da LGPD no cadastro de clientes](https://dtnetwork.com.br/blog/lgpd-no-cadastro-de-clientes/)). Como o GrafPro é multi-tenant e o dono da plataforma é operador dos dados de centenas de gráficas, "fale com o suporte" não escala nem juridicamente nem operacionalmente.

**Proposta:**
- `Cliente.desativadoEm DateTime?` — **precedente idêntico já no repo**: `Usuario.desativadoEm` (data em vez de boolean, "porque 'quando saiu' é a pergunta que aparece junto com 'quem fez isso'", reversível voltando pra null). Some das listas e dos dropdowns, histórico intacto.
- `Cliente.bloqueadoParaVenda Boolean @default(false)` + `motivoBloqueio String?` — conceito distinto de desativado (o cliente existe e é atendido, mas só à vista). Não confundir com `AssinaturaGrafica.inadimplenteDesde`, que é sobre a gráfica dever ao GrafPro.
- `Cliente.updatedAt DateTime @updatedAt` — trivial, alinha com todo o resto do schema.
- Ação `anonimizarCliente` no lugar de "fale com o suporte": sobrescreve nome/documento/contatos por marcadores e marca `desativadoEm`, preservando os `Orcamento`/`NotaFiscal` que a legislação fiscal obriga a manter — e registrando em `LogAuditoria`, que já existe exatamente pra esse tipo de rastro.

### A10. Não há visão financeira nem histórico no cadastro — e a consulta "por cliente" nem índice tem — **CONSTRUÍDO 2026-08-30 (rodada 16)**

**Status:** índice + `ContaReceber.clienteId` (com backfill do histórico existente) + card na ficha do cliente com os 3 blocos propostos, tudo lendo dado que já existia.

**O que falta:** três coisas empilhadas.
1. `ContaReceber` se liga a `Orcamento`, não a `Cliente`. Para responder "quanto o cliente X me deve" é preciso `ContaReceber → Orcamento → clienteId`.
2. **`Orcamento` não tem índice por `clienteId`.** Os índices declarados são `[graficaId]`, `[filialId]`, `[duplicadoDeId]` e `[graficaId, status, enviadoEm]`. Toda consulta "por cliente" — o filtro de `/meu-negocio/relatorios`, a matriz cliente × mês, e qualquer futura ficha do cliente — varre orçamentos filtrando em memória.
3. A ficha `/clientes/[id]` é só o formulário de edição (verifiquei `page.tsx`): não lista um orçamento, um pedido, uma entrega, um valor em aberto. O vendedor abre o cadastro do cliente e não descobre nada sobre o cliente.

**Pesquisa:** "histórico de compras e contatos — registro de todas as compras feitas pelo cliente e de todos os contatos telefônicos e malas diretas enviadas" é um dos três grupos que o Sebrae define como conteúdo mínimo de um cadastro de clientes ([Sebrae — como elaborar um cadastro de clientes](https://sebrae.com.br/sites/PortalSebrae/ufs/ap/artigos/como-elaborar-um-cadastro-de-clientes,d1440d36ecfa1610VgnVCM1000004c00210aRCRD)). Do lado do crédito, o controle padrão verifica "se o cliente está bloqueado, se há contas a receber em atraso e se há limite disponível" — os três na mesma tela ([F5 Software de Gestão](https://suporte.f5sg.com.br/controle-de-credito/)).

**Proposta:**
- `@@index([graficaId, clienteId])` em `Orcamento` — uma linha, destrava tudo que segue.
- `ContaReceber.clienteId String?` (FK, preenchida na criação a partir do orçamento). Isso é seguro **e** verificável: `trocarClienteOrcamento` (`src/app/orcamento/[id]/actions.ts:716`) só permite trocar o cliente enquanto o orçamento está em `RASCUNHO`, e `ContaReceber` só é criada depois de `APROVADO` — logo o vínculo nunca pode dessincronizar. (Alternativa sem denormalizar: consultar via join. Mas o repo já aceitou o padrão de referência direta em `Comissao.usuarioId`/`despesaId` quando o ganho de consulta é claro.)
- Ficha do cliente com três blocos lendo dados que **já existem**: últimos orçamentos/pedidos, total faturado no período (`relatorios-negocio.ts` já agrega por cliente), e contas a receber em aberto/vencidas.
- Sobre "última compra": **não** criar `Cliente.ultimaCompraEm` denormalizado — vai contra a disciplina explícita do repo ("saldo devedor é sempre calculado, nunca armazenado — evita dessincronia", em `model Pagamento`). Com o índice de `[graficaId, clienteId]`, a consulta de "clientes sem compra há N dias" sai barata direto de `Orcamento`.

### A11. Sem observações internas e sem origem do cliente — **CONSTRUÍDO 2026-08-24 (rodada 7)**

**Status:** `Cliente.observacoes` (nunca sai em PDF/link público) + `preferenciasProducao` (aparece na Ordem de Produção, `src/app/producao/[pedidoId]/ordem-producao/route.tsx`, só quando preenchida) + `enum OrigemCliente`/`origem`/`origemOutro`. Campos mapeados também em `src/lib/importacao/` (planilha reusa `clienteSchema`) — `origem` recebido como texto livre da planilha passa por normalização com fallback pra `OUTRO`, mesmo padrão de `normalizarUnidade` em `escritor-catalogo.ts`.

**O que faltava:** `Orcamento` tem `observacoes` (nota interna que nunca vai pro PDF), `Pedido` tem observação, `Entrega` tem observação, `Despesa` tem descrição — **`Cliente` não tem nenhum campo de texto livre**. Também não há como registrar de onde o cliente veio (indicação, Instagram, Google, feira, cliente antigo que voltou).

**Pesquisa:** o Sebrae coloca observações/preferências dentro do grupo "produtos que o cliente costuma comprar (tamanhos, cores, modelos, marcas)" como parte do cadastro mínimo ([Sebrae](https://sebrae.com.br/sites/PortalSebrae/ufs/ap/artigos/como-elaborar-um-cadastro-de-clientes,d1440d36ecfa1610VgnVCM1000004c00210aRCRD)); no Bling, os exemplos canônicos de campo personalizado são exatamente "segmentação de clientes, origem do contato ou preferências de compra" ([Polivision](https://polivision.com.br/cadastro-de-clientes-e-fornecedores-no-bling/)). Para gráfica isso tem conteúdo muito específico: cor Pantone da marca, perfil de cor exigido, "manda arte sempre em RGB", "não aceita variação de tom entre lotes", "só recebe às terças".

**Proposta:**
- `Cliente.observacoes String? @db.Text` — nota interna, nunca exposta em PDF nem em link público (mesma regra já documentada em `Orcamento.observacoes`).
- `Cliente.preferenciasProducao String? @db.Text` (opcional, separado) — o que precisa chegar ao chão de fábrica junto da Ordem de Produção, que é onde essa informação de fato é usada.
- `enum OrigemCliente { INDICACAO, REDES_SOCIAIS, BUSCA_GOOGLE, ANUNCIO, FEIRA_EVENTO, PROSPECCAO_ATIVA, CLIENTE_ANTIGO, OUTRO }` + `origemOutro String?` — é o campo que transforma o backlog de "CRM de funil" em algo mensurável (qual canal traz cliente que fecha), e custa um enum.

### A12. Cliente órgão público não tem onde guardar empenho, processo licitatório e dados de faturamento próprios — **CONSTRUÍDO 2026-08-30 (rodada 16)**

**Status:** `Orcamento.notaEmpenho`/`processoLicitatorio`, exibidos no PDF quando preenchidos. Escopo mínimo conforme a proposta — sem model de licitação.

**O que falta:** nada no schema representa venda para o setor público. Não há campo de nota de empenho, número do processo/pregão, ata de registro de preços, nem o vínculo entre o pedido e o empenho que autoriza o faturamento.

**Pesquisa:** o fluxo é rígido e público: a prefeitura homologa a licitação, **emite a nota de empenho**, o fornecedor entrega, emite a nota fiscal (que costuma precisar referenciar o empenho) e recebe tipicamente em ~30 dias ([ContrataX — como vender para prefeitura](https://www.contratax.com.br/blog/como-vender-para-prefeitura), [Cartilha de compras da Prefeitura de Fortaleza](https://compras.sepog.fortaleza.ce.gov.br/publico/docs/cartilhas/cartilha-digital.pdf)). Material gráfico é item recorrente de pregão eletrônico e ata de registro de preços municipal — achei editais específicos de "material gráfico" e ARP assinada com uma gráfica ([edital de pregão — material gráfico, Alvorada de Minas/MG](https://alvoradademinas.mg.gov.br/artigos/2026/01/000000213/documentos/Edital_De_Pregao_Eletronico_Material_Grafico_1-@-695d01c9b7363.pdf), [ARP 41/2026 — Grafik Serviços Gráficos](https://fortunademinas.mg.gov.br/wp-content/uploads/2026/03/PL-09-ARP-41-GRAFIK-SERVICOS-GRAFICOS-LTDA-1.pdf), [TCE-AL — edital material gráfico](https://www.tceal.tc.br/view/documentos/EDITAL%20-%20Material%20Gr%C3%A1fico_SITE.pdf)). Que órgão público é uma categoria de crédito à parte já aparece na política comercial citada em A6, com limite inicial 3× maior que o de empresa privada ([DKJ](https://www.dkj.online/pagina/pagamento-faturado-para-empresas-e-orgaos-publicos.html)).

**Proposta (deliberadamente mínima — não é para virar módulo de licitação):**
- `SegmentoCliente.ORGAO_PUBLICO` (já contemplado em A7) é o gatilho de UI: os campos abaixo só aparecem quando o cliente é órgão público.
- `Orcamento.notaEmpenho String?` e `Orcamento.processoLicitatorio String?` — dois campos texto no orçamento, exibíveis no PDF e na nota. Não é modelagem de licitação; é o mínimo para o faturamento não travar.
- **(inferência minha)** um `model Contrato`/`AtaRegistroPreco` com vigência e saldo de quantidade por item seria o caminho completo (fornecimento parcelado ao longo de 12 meses é o normal em ARP), mas isso só se justifica quando existir uma gráfica cliente que viva de licitação — hoje é especulativo.

### A13. A listagem de clientes não escala: sem busca, sem paginação, e 4 telas carregam a base inteira — **PARCIALMENTE CONSTRUÍDO 2026-08-24 (rodada 4)**

**Custo estimado (restante pendente):** 🟡 Médio — sem schema novo, é trocar `findMany` completo por combobox com busca server-side em 4 telas existentes, lógica nova moderada repetida.

**Status:** `/clientes` (`src/app/clientes/page.tsx`) ganhou busca por nome/documento + paginação real (50/página) via `searchParams`, mantendo o filtro `desativadoEm: null`. **Ficou de fora, de propósito**: os outros 4 lugares que ainda carregam a base inteira pra popular `<select>` (`/orcamento`, `/orcamento/[id]`, `/producao`, `/meu-negocio/relatorios`) — isso é combobox com busca server-side, escopo maior, continua gap.

**O que falta (nos 4 lugares acima):** `/clientes` faz `prisma.cliente.findMany({ where: { graficaId } })` sem `take`, sem busca, sem filtro, e renderiza todos numa lista. E não é só ali: `/orcamento` (`page.tsx:60`), `/orcamento/[id]` (`page.tsx:116`), `/producao` (`page.tsx:127`) e `/meu-negocio/relatorios` (`page.tsx:80`) também carregam **todos** os clientes da gráfica para montar `<select>`s. Uma gráfica de bairro com 60 clientes não sente; uma gráfica com 5 anos de histórico e 1.500 cadastros transforma cada uma dessas páginas num payload enorme e num `<select>` inutilizável.

**Pesquisa:** não é achado de mercado, é aritmética de escala — e é exatamente o princípio da auditoria ("centenas de gráficas de perfis diferentes"). A referência de mercado disponível é que gestão de carteira pressupõe segmentar e filtrar a base (ativos, pré-inativos, inativos), o que só existe se a base for consultável ([Mercos](https://blog.mercos.com/carteira-de-clientes/)).

**Proposta:**
- Busca por nome/documento na listagem + paginação, apoiadas no índice `[graficaId]` que já existe (e num índice adicional se a busca virar `ILIKE` pesado).
- Nos dropdowns, combobox com busca server-side em vez de `findMany` completo — ou, no mínimo, `take` + filtro `desativadoEm: null` assim que A9 existir.
- Nota de implementação para quem for executar: qualquer campo novo desta parte precisa passar também por `src/lib/importacao/campos.ts` e `src/lib/importacao/escritor-clientes.ts` (a importação de planilha reusa `clienteSchema` byte-a-byte, e é justamente por ali que uma gráfica nova migra 800 clientes do sistema antigo — se os campos novos não estiverem mapeados, eles nascem vazios em toda migração).

### A14. Portal do cliente: hoje existem tokens por objeto, mas não existe identidade do cliente

**Custo estimado:** 🔴 Caro — model novo `AcessoPortalCliente` reaproveita padrão de token existente, mas é magic-link de identidade contínua (área sensível de autenticação), com múltiplas telas (pedidos, NF, cobrança, "pedir de novo") e depende de A4/A9/A10.

**O que falta:** o sistema já tem dois acessos externos sem login — `/o/[token]` (aprovar/recusar orçamento) e `/a/[token]` (aprovar arte) — cada um amarrado a **um objeto**, com identidade declarada e não verificada (`Orcamento.respostaPublicaNome`: "vale como registro, não como prova de identidade", conforme o próprio comentário do schema). Não existe nada que ligue uma pessoa ao `Cliente` e dê a ela uma visão contínua: histórico de pedidos, status de produção, 2ª via de boleto/NF, repetir pedido, baixar a arte aprovada da última vez.

**Pesquisa:** no web-to-print brasileiro isso é o produto: "o cliente acessa o portal, customiza seu produto, anexa a arte e paga", acompanha "do pedido à produção e entrega" e aprova provas online ([Sistograf](https://blog.sistograf.com.br/web-to-print-guia-pratico-graficas-revendas-online/)); gráficas B2B já operam "área do cliente" com seção de contatos e emissão/2ª via de boleto ([Gráfica das Gráficas](https://instrucoes.graficadasgraficas.com.br/garantia/)). "Repetir pedido" é o caso de uso dominante em rótulo/etiqueta e papelaria corporativa — e o GrafPro já tem a mecânica interna disso (`Orcamento.duplicadoDeId`, "Pedir de novo") sem expô-la ao cliente.

**Proposta (v1 estreita, sem virar e-commerce):**
- `model AcessoPortalCliente { id, clienteId, contatoClienteId?, email, tokenHash, expiraEm, ultimoAcessoEm, revogadoEm }` — magic link por e-mail, escopado a **um `Cliente`**, reusando integralmente o padrão de token já provado em `TokenResetSenha`/`TokenVerificacaoEmail` (inclusive os models de `Tentativa*` para rate limit, que já existem para 6 fluxos distintos).
- Depende de A4 (contatos) para saber **para quem** mandar o link e A9/A10 para saber o que mostrar. É o achado que mais depende dos outros — deve vir por último.
- Escopo v1 sugerido: ver pedidos e status, baixar NF/DANFE e 2ª via de cobrança, e "pedir de novo". Aprovação de arte e de orçamento continuam nos tokens de hoje (funcionam, e trocá-los por login é regressão de conversão).

## Prioridade sugerida

| # | Achado | Prioridade | Justificativa |
|---|---|---|---|
| A2 | CNPJ alfanumérico + documento não normalizado/validado | **Alta** | Defeito já no código (`focus-nfe.ts:227` mutila CNPJ alfanumérico e o manda como CPF) e o formato está em vigor desde 31/07/2026. |
| A1 | PF×PJ, razão social, IE e indicador de IE do destinatário | **Alta** | Sem isso, toda nota para cliente contribuinte é rejeição 728/791 esperando acontecer, e a nota sai com nome que não é razão social. |
| A3 | CFOP fixo ignora UF/contribuinte do cliente | **Alta** | Primeira venda interestadual sai com CFOP interno (5102); erro fiscal silencioso, não bloqueio visível. |
| A4 | Contatos múltiplos por cliente (`ContatoCliente`) | **Alta** | Resolve a raiz de B6/B7 e é a condição para mandar boleto pro financeiro e arte pro aprovador; é o gap nº 1 do cliente PJ recorrente. |
| A9 | Desativação/bloqueio + `updatedAt` + anonimização LGPD | **Alta** | Hoje o único caminho é hard delete que falha, e o pedido de exclusão LGPD é resolvido por ticket manual — não escala para centenas de tenants. |
| A6 | Limite de crédito, prazo, forma de pagamento, desconto padrão | **Alta** | É o bloco que todo ERP brasileiro traz na aba "Definições"; sem ele, condição comercial é redigitada a cada orçamento. |
| A10 | Financeiro por cliente + índice `[graficaId, clienteId]` + ficha do cliente | **Alta** | O índice é uma linha e destrava relatórios e ficha; "quanto esse cliente me deve" é a pergunta nº 1 do dono da gráfica. |
| A5 | Endereços múltiplos (entrega/cobrança/filiais) | **Média** | Diário para rótulo/embalagem e instalação, mas o texto livre `localEntrega` tampa o buraco no curto prazo. |
| A7 | Segmento + preço diferenciado por cliente/revenda | **Média** | Mercado inteiro de revenda/agência depende disso, e o gancho `margemLucroOverride` já existe dormente no motor — custo de implementação baixíssimo para o alcance. |
| A8 | Vendedor/carteira no cliente + alinhar com `Comissao` | **Média** | Corrige a comissão atribuída a quem digitou em vez de quem vendeu; sem isso a carteira comercial não existe. |
| A13 | Busca/paginação de clientes e dropdowns que carregam a base inteira | **Média** | Invisível hoje, garantido em gráfica com histórico; a correção é local e barata. |
| A11 | Observações internas, preferências de produção e origem do cliente | **Média** | Barato (campos texto + 1 enum) e é onde mora a memória da gráfica sobre o cliente (Pantone, tom, janela de recebimento). |
| A12 | Órgão público: empenho e processo licitatório | **Baixa** | Segmento real e recorrente em material gráfico, mas dois campos texto no orçamento resolvem 90% — modelar contrato/ARP é especulativo hoje. |
| A14 | Portal do cliente (identidade contínua, não token por objeto) | **Baixa** | Alto valor percebido, mas depende de A4/A9/A10 estarem prontos; construir antes seria portal sem o que mostrar. |

Critical files: `prisma/schema.prisma` (`Cliente` 1005-1036, `Orcamento` 1685+, `ContaReceber` 2039+, `DadosFiscaisGrafica` 502+), `src/lib/clientes.ts` (validação `clienteSchema`, reusada pela importação de planilha), `src/lib/focus-nfe.ts` (payload do destinatário — linhas 227-245: documento e ausência de IE/indicador de IE), `src/lib/nota-fiscal.ts` (`verificarProntidaoFiscal`), `src/app/clientes/actions.ts` (criar/atualizar/excluir).

---

# Parte 6 — Configurações

Metodologia: em vez de partir do mercado pra dentro (como nas 5 partes anteriores), esta rodada partiu do código pra fora — Configurações não descreve uma etapa do negócio, descreve as REGRAS que os outros módulos obedecem, então o teste decisivo é "esta regra é mesmo configurável, ou só *parece* configurável?". Li os 14 arquivos de `actions.ts` sob `src/app/configuracoes/`, o `ParametrosForm`, `src/lib/pricing/carregar.ts`, `src/lib/auth/permissoes.ts`, `src/lib/alerta-prazo-email.ts`, `src/lib/alerta-atraso.ts`, `src/lib/custo-pedido.ts`, `src/lib/dados-exemplo.ts`, `src/lib/pendencias-configuracao.ts`, os dois renderizadores de PDF e os models correspondentes do `schema.prisma`, cruzando com fontes de mercado onde havia padrão pesquisável. Conclusão geral: o módulo é sólido no que expõe, mas tem três problemas estruturais distintos. (1) **Configuração fantasma**: 8 campos de `ParametrosGrafica` são lidos pelo sistema e não têm nenhum caminho de escrita em nenhuma tela — estão hardcoded na prática, com o agravante de que dois deles (faixas de margem 10%/25%) foram calibrados pro perfil de uma gráfica só. (2) **Rastro ausente**: a auditoria cobre 2 das 14 telas — custo de hora-máquina, token fiscal, CFOP e webhook mudam sem deixar registro. (3) **O sistema não sabe que tipo de gráfica o tenant é** — não existe campo nenhum descrevendo isso, e por consequência todo default do produto (categorias de custo, dados de exemplo, pendências de configuração) foi congelado no perfil rótulos/Assus. Achados abaixo, 13 no total, com 4 de prioridade alta.

## A1 — Oito parâmetros existem no schema, são lidos pelo motor, e nenhuma tela consegue escrevê-los — **CONSTRUÍDO 2026-08-24**

**Status:** os 5 campos realmente lidos pelo motor (`custoAutomaticoConsumo`, `categoriaCustoConsumoPadraoId`, `margemFaixaBaixa`, `margemFaixaBoa`, `descontoMaxSemAprovacao`) ganharam tela em `ParametrosForm.tsx`. **Achado extra**, confirmado por grep na auditoria de código antes de implementar: `comissaoEntraNoCustoPedido`, `perdaEhCustoDoPedido` e `diasPrecoInsumoDesatualizado` não tinham NENHUM consumidor no código — não era só "falta tela", era "falta lógica". Os 3 ganharam implementação real, não só o campo: perda pode deixar de contar como custo do pedido (baixa de estoque continua); comissão pode ser espelhada em `CustoPedido` (origem `COMISSAO`, novo helper `criarCustoAutomaticoComissao`); Catálogo mostra aviso "Preço desatualizado" via novo `ItemGrafica.precoCompraAtualizadoEm`.

**O que falta.** `prisma.parametrosGrafica.update` aparece **uma única vez** em todo o código de aplicação: `src/app/configuracoes/actions.ts:266`. O objeto `data` dessa chamada grava os 9 `CAMPOS_DECIMAL` + `comissaoVendedorBase`, `custoTintaPorMl`, `termosCondicoesPdf`, `mostrarEspecificacoesTecnicas`, `diasValidadeOrcamentoPadrao`, `diasAlertaOrcamentoParado`, `alertaPrazoAtivo` e os 3 limiares. Ficam de fora, sem nenhum outro escritor (o único `upsert`, em `src/lib/pricing/carregar.ts:21`, tem `update: {}` e `create: { graficaId }` — só materializa defaults):

| Campo | Quem lê | Valor efetivo pra 100% dos tenants, pra sempre |
|---|---|---|
| `custoAutomaticoConsumo` | `src/app/producao/status-transicao.ts:286` | `true` |
| `categoriaCustoConsumoPadraoId` | idem `:287` | `null` (cai em "primeira categoria ativa por ordem") |
| `comissaoEntraNoCustoPedido` | fechamento de pedido | `false` |
| `perdaEhCustoDoPedido` | fechamento de pedido | `true` |
| `margemFaixaBaixa` | `src/app/meu-negocio/relatorios/page.tsx:93`, `MedidorMargem` | `10` |
| `margemFaixaBoa` | idem `:94` | `25` |
| `descontoMaxSemAprovacao` | `src/app/orcamento/[id]/actions.ts:1745` | `100` (= trava desligada) |
| `diasPrecoInsumoDesatualizado` | catálogo/compras | `90` |

O comentário do schema diz literalmente "tudo que varia entre gráficas nasce aqui, nunca hardcoded" (`schema.prisma:130-131`) — a intenção está certa, o form nunca acompanhou.

**Pesquisa.** (inferência minha quanto ao bug em si — é verificação de código.) A gravidade de mercado, essa sim, é pesquisável em dois desses campos: as faixas 10%/25% são um número calibrado num perfil só. Gráfica de comunicação visual trabalha com margens muito acima disso e veria "verde" em tudo (medidor inútil); gráfica offset comercial de tiragem longa trabalha abaixo e veria "vermelho" em tudo (alarme cego). E `descontoMaxSemAprovacao=100` significa que a trava de alçada de desconto — que o código de `aplicarDescontoItemOrcamento` implementa corretamente — **nunca dispara em nenhum tenant existente**: a feature está construída e desligada por impossibilidade de configuração. Sobre `custoAutomaticoConsumo`: gráfica que compra material por pedido (padrão em comunicação visual, brindes e corte a laser, onde a chapa/lona é comprada pro job) lança o custo real via nota do fornecedor; com a baixa automática ligada à força, o mesmo material entra duas vezes no P&L do pedido.

**Proposta.** Não é mudança de schema — é completar `ParametrosForm.tsx` + `salvarParametros` com uma seção nova ("Custo e margem" / "Política de desconto"), reaproveitando o padrão de log campo-a-campo que a action já tem para os `CAMPOS_DECIMAL`. Dois cuidados: `categoriaCustoConsumoPadraoId` precisa de `<select>` alimentado por `CategoriaCusto` ativa (e validado contra o tenant antes de gravar), e `margemFaixaBaixa < margemFaixaBoa` precisa de validação na action, no mesmo estilo da validação de ordem decrescente dos limiares de prazo.

## A2 — O PDF promete "dias úteis" ao cliente, mas o sistema não tem calendário de dias úteis nem feriado — **CONSTRUÍDO 2026-08-27 (rodada 11)**

**Status:** ver bloco "Atualização (rodada 11)" no topo do documento — `ParametrosGrafica.prazoEmDiasUteis`/`diasFuncionamento` + `model FeriadoGrafica` por gráfica, helper `somarDiasUteis`, tela `/configuracoes/feriados`, PDF/alerta-prazo-email/sugestão de prazo na aprovação todos ligados ao parâmetro real.

**O que falta.** `src/lib/pdf/OrcamentoDocumento.tsx:282` e `src/app/o/[token]/page.tsx:179` renderizam, em texto fixo, `` `${prazoEntregaEstimadoDias} dias úteis após aprovação` ``. Nenhum outro ponto do sistema conhece o conceito: `Pedido.prazoEntrega` é digitado à mão na aprovação (`src/app/orcamento/[id]/actions.ts:131-135`, sem nenhum cálculo a partir do estimado); `src/lib/alerta-atraso.ts` faz `Math.floor((hoje - prazo) / 86_400_000)` — dias corridos; `src/lib/alerta-prazo-email.ts` calcula `diasParaPrazo` também em dias corridos. Não existe model de feriado, de dia de funcionamento (sábado?) nem de turno — `grep -i "turno|capacidade|expediente|jornada"` não retorna nada em `src/` fora de um comentário sobre fração de folha em `gang-run.ts`.

Consequência prática, com números: um pedido aprovado numa sexta com "5 dias úteis" tem prazo real na sexta seguinte (7 dias corridos). Se o vendedor digitar a data certa, o alerta de 3 dias antes cai num sábado; se digitar `hoje+5` (a leitura literal do que o PDF prometeu), a gráfica se compromete com uma data que ela mesma não vai cumprir. Na semana do Carnaval a distorção chega a 2-3 dias.

**Pesquisa.** O mercado gráfico brasileiro cota prazo em dias úteis por padrão — a Brasil7 publica a tabela de prazos separando produção e entrega em dias úteis, e material de comunicação visual anuncia "3 a 7 dias úteis" como faixa normal ([Gráfica Brasil7 — prazos de produção e entrega](https://www.graficabrasil7.com/pagina/prazo-de-producao-e-entrega), [Agile Gráfica](https://www.agilegrafica.com.br/)). E o calendário não é único: em 2026 o governo federal classificou 16 e 17/02 como **ponto facultativo**, não feriado; o Rio de Janeiro é o único estado onde a terça é feriado **estadual**, e municípios como Araxá (MG), Balneário Camboriú (SC), Manaus (AM), Lins e Terra Roxa (SP) decretam feriado municipal na data ([Serasa Experian](https://www.serasaexperian.com.br/carreiras/blog-carreiras/carnaval-de-2026-e-feriado-ou-ponto-facultativo/), [Estado de Minas](https://www.em.com.br/trends/2026/02/7353976-afinal-carnaval-e-feriado-ou-ponto-facultativo-entenda-a-regra.html)). Ou seja: mesmo com feriados nacionais embutidos em código, uma gráfica de Manaus e uma de São Paulo teriam contagens diferentes — o calendário é irredutivelmente por tenant.

**Proposta.** Duas peças aditivas, nenhuma quebra tenant existente:

```prisma
// em ParametrosGrafica
prazoEmDiasUteis   Boolean @default(true)  // false = a gráfica cota em dias corridos
diasFuncionamento  Int     @default(31)    // bitmask seg..dom (31 = seg-sex), evita 7 booleans
```

```prisma
model FeriadoGrafica {
  id        String   @id @default(cuid())
  graficaId String
  data      DateTime @db.Date
  descricao String
  recorrenteAnual Boolean @default(false)  // 25/12 sim; Carnaval/Corpus Christi não (móveis)
  grafica   Grafica  @relation(fields: [graficaId], references: [id], onDelete: Cascade)
  @@unique([graficaId, data])
  @@index([graficaId])
  @@map("feriados_grafica")
}
```

Com isso: (a) o texto do PDF passa a ser derivado de `prazoEmDiasUteis` em vez de literal; (b) nasce um helper `somarDiasUteis(data, n, graficaId)` em `src/lib/data.ts` que a tela de aprovação usa pra **sugerir** `Pedido.prazoEntrega` a partir de `prazoEntregaEstimadoDias` (sugerir, não impor — mantém o campo digitável); (c) `alerta-prazo-email.ts` conta em dia útil quando o tenant cota assim. Vale semear os feriados nacionais fixos como sugestão na primeira abertura da tela, no mesmo padrão lazy-bootstrap de `garantirCategoriasCustoPadrao`.

## A3 — A trilha de auditoria cobre 2 das 14 telas de Configurações; custo de máquina e dados fiscais mudam sem rastro — **CONSTRUÍDO 2026-08-24 (rodada 2)**

**Status:** ver bloco "Atualização (rodada 2)" no topo do documento — `registrarAuditoria` adicionado a 11 arquivos de Configurações; `assinatura/actions.ts` deliberadamente fora (fluxo Stripe hospedado, não escreve parâmetro local).

**O que falta.** `registrarAuditoria` aparece em `src/app/configuracoes/actions.ts` (parâmetros) e `src/app/configuracoes/fornecedores/actions.ts`. Os outros 12 arquivos de action do módulo não importam auditoria nenhuma — verificado por grep no diretório inteiro. Isso inclui:

- `prensas/actions.ts`, `maquinas/flexografia`, `maquinas/impressao-digital`, `maquinas/setup-por-peca` — que gravam `custoHoraMaq`, `custoChapa`, `custoPorClique`, `custoPorSetup`, `perdaPercentPadrao`. **São entradas diretas do preço**, exatamente como `margemPadrao` (que É auditada). Trocar `custoHoraMaq` de 80 pra 120 muda todo orçamento Offset futuro e não deixa registro nenhum.
- `fiscal/actions.ts` — `focusNfeToken`, `ambiente` (homologação→produção!), `regimeTributario`, `cfopPadrao`, `csosnPadrao`. Emissão de NF-e errada por parâmetro trocado é um problema com consequência fiscal, e hoje não há como saber quem trocou.
- `automacao/actions.ts` — `webhookUrl`, tratada como segredo no próprio comentário do schema (`schema.prisma:646-649`), pode ser reapontada pra outro destino sem rastro.
- `filiais`, `categorias-custo`, `identidade`.

Achado secundário do mesmo bloco: a única tela que **lê** `LogAuditoria` é `src/app/financeiro/auditoria/page.tsx:48`, e ela exige `exigirVerModulo(usuario, "FINANCEIRO")`. Um administrador que só tem CONFIGURACOES não consegue ver o log das próprias mudanças de configuração.

**Pesquisa.** É consenso de boa prática que a trilha de auditoria priorize justamente "registros que impactam dinheiro, estoque, **fiscal**, **margem**, permissões" — que é exatamente o conjunto que está de fora aqui — e que ela registre valor anterior e valor novo, não só o evento ([DP Sistemas — Trilha de auditoria: por que registrar alterações](https://dpsistemas.com.br/2026/08/05/trilha-de-auditoria/), [Assinafy — Trilha de auditoria em sistemas](https://www.assinafy.com.br/blog/trilha-de-auditoria)). O `LogAuditoria` do projeto já tem `valorAnterior`/`valorNovo`/`ip` — a infraestrutura está pronta, só não é chamada.

**Proposta.** Nenhuma mudança de schema. Chamar `registrarAuditoria` nas 12 actions faltantes, com prioridade nas de máquina e fiscal, reaproveitando o padrão de diff campo-a-campo já escrito em `salvarParametros` (extrair aquele bloco `antesTextos`/`depoisTextos` pra um helper genérico em `src/lib/auditoria.ts` evita reescrevê-lo 12 vezes). Para o token da Focus NFe, logar só "token alterado"/"token removido", nunca o valor — mesmo cuidado que o form já toma ao não reexibir a URL do webhook. E mover/duplicar a tela de auditoria para `/configuracoes/auditoria` com gate `CONFIGURACOES` **ou** `FINANCEIRO`.

## A4 — Não existe cadastro de alçada: a única trava é global e "quem aprova" está hardcoded; Compras não tem alçada nenhuma

**Custo estimado:** 🔴 Caro — 1 model novo (`AlcadaAprovacao`) é simples isolado, mas muda o comportamento de aprovação de desconto e de compra, área sensível de autorização.

**O que falta.** Duas lacunas relacionadas:

1. **Desconto**: `src/app/orcamento/[id]/actions.ts:1751-1760` compara o desconto contra `descontoMaxSemAprovacao` e, se estourar, permite só `papel === "DONO" || papel === "ADMIN"`. Isso é um limite único pra gráfica inteira e um único nível de aprovação, com o "quem" fixo em código. Não há como dizer "vendedor júnior 5%, sênior 10%, gerente 20%, acima disso só o dono". (E, por A1, o limite está travado em 100% na prática.)
2. **Compras**: `SolicitacaoCompra` tem `usuarioAprovadorId` e `aprovadoEm`, mas `src/app/compras/status-transicao.ts:116` só grava quem aprovou — a autorização é o `podeEditarModulo(usuario, "COMPRAS")` genérico. Um OPERADOR com COMPRAS.podeEditar aprova uma solicitação de R$ 50 e uma de R$ 50.000 exatamente igual. Não existe campo de teto de valor em lugar nenhum.

**Pesquisa.** Alçada configurável por perfil e por valor é item de configuração básico em ERP brasileiro de porte pequeno/médio, não recurso enterprise. O ERPFlex expõe literalmente um campo "Aprova valores até" por perfil ("um perfil vendas pode aprovar orçamento até R$ 200,00; acima disso é necessária aprovação de um perfil acima") e uma escolha entre fluxo hierárquico completo e aprovação direta pela alçada competente ([ERPFlex — Configurador de Aprovações](https://docs.erpflex.com.br/aprovacao_orcamento/)). O TOTVS Protheus tem workflow dedicado de aprovação de pedido de venda por alçada de desconto ([TOTVS TDN](https://tdn.totvs.com/pages/releaseview.action?pageId=189310611)), e o Senior ERP Mega tem cadastro de "Alçada de Aprovação" como entidade própria ([Senior — Alçada de Aprovação](https://documentacao.senior.com.br/erp-mega/manual-do-usuario/construcao/gestao-comercial/propostas/propostas-cadastros/gestao-comercial-propostas-cadastros-alcada-de-aprovacao/)).

**Proposta.** Model novo, escopado por tenant, sem tocar no que existe:

```prisma
enum TipoAlcada {
  DESCONTO_ORCAMENTO   // limite em % de desconto
  APROVACAO_COMPRA     // limite em R$ da solicitação de compra
}

model AlcadaAprovacao {
  id        String       @id @default(cuid())
  graficaId String
  tipo      TipoAlcada
  // Alvo: por PAPEL (cobre a gráfica inteira em 3 linhas) ou por USUÁRIO
  // (exceção pontual, ex: um vendedor sênior). Exatamente um preenchido,
  // validado na action — mesmo padrão das 5 FKs de RegistroManutencao.
  papel     PapelUsuario?
  usuarioId String?
  limite    Decimal      @db.Decimal(12, 2) // % em DESCONTO_*, R$ em APROVACAO_*
  grafica   Grafica      @relation(fields: [graficaId], references: [id], onDelete: Cascade)
  @@index([graficaId, tipo])
  @@map("alcadas_aprovacao")
}
```

Resolução: alçada do usuário > alçada do papel > `descontoMaxSemAprovacao` (fallback, mantendo o comportamento atual pra quem nunca configurar nada). Aprovação em múltiplos níveis encadeados eu deixaria **fora** do escopo — é o que ERP grande faz, mas gráfica de 5 a 30 pessoas resolve com um nível e um teto (inferência minha, mas coerente com o porte do cliente-alvo).

## A5 — Permissão é por usuário, não por cargo; ADMIN passa por cima de tudo

**Custo estimado:** 🔴 Caro — 2 models novos (`PerfilAcesso`/`PermissaoPerfil`) mudando o comportamento do sistema de permissões, área sensível de autorização.

**O que falta.** `PermissaoUsuario` é `[usuarioId, modulo]` e, por `src/lib/auth/permissoes.ts:36` e `:45`, o controle fino **só se aplica a OPERADOR** — DONO e ADMIN retornam `true` sem consultar o banco. Consequências pra gráfica de porte médio: (a) admitir 3 operadores de acabamento no mesmo turno exige configurar 8 módulos × 3 usuários na mão, sem "copiar de outro usuário" nem perfil reutilizável; (b) não existe papel intermediário — quem precisa de mais que OPERADOR vira ADMIN e ganha acesso irrestrito, inclusive a `/configuracoes` (motor de preço) e à aprovação de desconto ilimitada; (c) `ResponsavelEstagio` (por status de pedido) já é uma segunda dimensão de permissão que vive fora desse modelo, com regra própria em `podeConfirmarEstagio`.

**Pesquisa.** (inferência minha — a comparação de mercado aqui é indireta: os mesmos ERPs citados em A4 organizam autorização por *perfil* e não por usuário, e é do perfil que pende a alçada, o que confirma que perfil é a unidade natural.) O sinal mais forte é interno: o próprio comentário do arquivo se declara provisório — "Primeiro uso real de controle de acesso por papel no projeto… Escopo desta rodada: só a tela /usuarios exige um papel específico" (`permissoes.ts:9-11`).

**Proposta.** Aditivo, mantendo `PermissaoUsuario` como está (override individual):

```prisma
model PerfilAcesso {
  id        String @id @default(cuid())
  graficaId String
  nome      String              // "Impressor", "Acabamento", "Vendedor externo"
  grafica   Grafica @relation(fields: [graficaId], references: [id], onDelete: Cascade)
  permissoes PermissaoPerfil[]
  @@unique([graficaId, nome])
  @@map("perfis_acesso")
}
model PermissaoPerfil {
  id         String @id @default(cuid())
  perfilId   String
  modulo     ModuloPermissao
  podeVer    Boolean @default(false)
  podeEditar Boolean @default(false)
  perfil     PerfilAcesso @relation(fields: [perfilId], references: [id], onDelete: Cascade)
  @@unique([perfilId, modulo])
  @@map("permissoes_perfil")
}
// em Usuario:
perfilAcessoId String?  // null = comportamento de hoje, permissão só individual
```

Resolução: permissão individual (se a linha existir) vence a do perfil; sem nenhuma das duas, mantém-se "ausência = sem acesso". Prioridade média, não alta: dói na gráfica de 20+ pessoas, não na de 5 — mas é barato agora e caro depois de centenas de tenants terem permissões espalhadas linha a linha.

## A6 — Nada no schema diz que TIPO de gráfica o tenant é, e por isso todo default do produto ficou congelado no perfil da gráfica-piloto — **CONSTRUÍDO 2026-08-27 (rodada 11)**

**Status:** ver bloco "Atualização (rodada 11)" no topo do documento — `Grafica.segmento`/`segmentoOutro` (descritivo, não restritivo), `CATEGORIAS_CUSTO_SUGERIDAS` por segmento, pacotes de dados de exemplo por segmento, e a pendência `MAQUINA_NAO_VINCULADA` (item de maior retorno, vale pra qualquer segmento).

**O que falta.** `model Grafica` tem `nome`, `slug`, `compartilharMeuNegocio`, `logoUrl`, `corPrimaria`, `unidadePadraoDimensao`. Não há campo de segmento, porte, nem processos que a gráfica opera. Como nenhum código pode perguntar "que tipo de gráfica é essa?", todos os pontos de partida do sistema foram fixados num perfil só — três instâncias verificadas:

1. **Categorias de custo padrão** (`src/lib/custo-pedido.ts:11-20`): `Papel, Ferramental (faca), Laminação, Clichê, Impressão, Frete, Mão de obra, Retrabalho`. O próprio comentário admite a origem: "inspirado na planilha real de controle de custo de uma gráfica cliente". Uma estamparia recebe "Clichê" e "Ferramental (faca)" e não recebe "Malha/peça", "Tinta plastisol", "Tela/quadro"; uma gráfica de comunicação visual não recebe "Lona", "Ilhós", "Instalação/mão de obra externa".
2. **Dados de exemplo** (`src/lib/dados-exemplo.ts:25-31`): um pacote único — prensa offset, papel couché, cartão de visita, panfleto A5, laminação/corte/vinco. É o "tour guiado" do produto, e ele conta uma história de gráfica offset comercial pra qualquer tenant que abrir.
3. **Pendências de configuração** (`src/lib/pendencias-configuracao.ts`): só dois tipos, `BOBINA_ETIQUETA_FALTANDO` (produto M2 sem bobina) e `PAPEL_MATERIA_PRIMA_FALTANDO`. São exatamente os bloqueios do perfil rótulo. Produto `OFFSET` sem `prensaId`, `DIGITAL` sem `impressoraDigitalId` ou `SERIGRAFIA` sem `maquinaSetupPorPecaId` produzem o **mesmo** tipo de falha (o motor lança `ErroPrecificacao` em `carregar.ts:206`, `:272`, `:292`) e não geram pendência nenhuma — o dono só descobre na hora que o vendedor tenta orçar. Esse é o caso mais claro: o mecanismo genérico existe e está preenchido com um perfil só.
4. Complementar: o catálogo mestre (`src/lib/catalogo-mestre.ts`, 120 itens) já é louvavelmente amplo — tem "Vestuário e Sublimação", "Placas e Chapas", "Personalização" (DTF, bordado, silk) — mas não tem tag de segmento, então toda gráfica navega os 120 itens sem filtro.

**Pesquisa.** Segmentar configuração por perfil de tenant e manter um registro de qual template cada tenant usa é prática estabelecida em SaaS multi-tenant — "configuration registries track which tenant uses which templates, connectors, extensions, and policy exceptions", com templates instanciados no provisionamento ([sysgenpro — Multi-tenant SaaS governance models](https://sysgenpro.com/saas/multi-tenant-saas-governance-models-for-construction-platform-operators), [Practical multi-tenant SaaS provisioning and automated onboarding](https://kodekx-solutions.medium.com/practical-multi-tenant-saas-provisioning-and-automated-onboarding-3bb6fdd3e84f)). No lado gráfico especificamente, o Calcme vende como diferencial justamente "criar modelos pré-definidos de orçamentos e pré-configurar cálculos escolhendo máquinas, acabamentos e insumos de acordo com o produto" ([Calcme — Sistema ERP para Gráficas](https://www.calcme.com.br/sistema-erp-para-graficas/)) — a ideia de pacote de configuração por tipo de trabalho é vendida como feature, não é invenção.

**Proposta.** O campo primeiro, os pacotes depois:

```prisma
enum SegmentoGrafica {
  ROTULOS_ETIQUETAS
  OFFSET_COMERCIAL
  COMUNICACAO_VISUAL
  ESTAMPARIA_VESTUARIO
  BRINDES_PERSONALIZADOS
  EMBALAGEM_CARTONAGEM
  EDITORIAL_LIVRO
  CORTE_LASER_ACRILICO
  GRAFICA_RAPIDA
  OUTRO
}
// em Grafica:
segmento      SegmentoGrafica?  // null = tenant anterior a este campo, tudo segue como hoje
segmentoOutro String?
```

Perguntado uma vez em `/registro` ou `/comecar` (uma pergunta, não um wizard). Com ele, e sem nenhuma outra mudança de schema: `CATEGORIAS_CUSTO_SUGERIDAS` vira `Record<SegmentoGrafica, string[]>`; `dados-exemplo.ts` ganha um pacote por segmento (ou pelo menos 3: rótulo, offset, comunicação visual); `listarPendenciasConfiguracao` ganha as checagens de `prensaId`/`impressoraDigitalId`/`maquinaSetupPorPecaId` nulos — que valem pra todo mundo, independente de segmento, e são o item de maior retorno imediato deste achado. Note que `segmento` é **descritivo** (semeia defaults, filtra sugestões), nunca restritivo: uma gráfica marcada como `ESTAMPARIA_VESTUARIO` continua podendo cadastrar uma prensa offset. Esse é o ponto em que a diretriz "centenas de gráficas de perfis diferentes" deixa de depender de o dono lembrar de generalizar caso a caso.

## A7 — "Uma tabela + uma pasta de tela por tipo de máquina" já custa 5 FKs nullable em dois models; com os motores previstos vira 10

**Custo estimado:** 🟡 Médio — a proposta descarta a migração polimórfica completa (seria Caro) e recomenda o meio-termo: trocar 5 FKs por um par tipo+id sem FK de banco (possível enum novo) e um componente de tela declarativo único, deliberadamente sem tocar em `ItemGrafica`.

**O que falta.** Hoje: 5 models de máquina (`Prensa`, `MaquinaFlexografia`, `ImpressoraDigital`, `MaquinaSetupPorPeca`, `Equipamento`), 4 FKs nullable em `ItemGrafica` (`schema.prisma:1181-1198`), **5 FKs nullable em `RegistroManutencao`** (`:429-436`) com a regra "exatamente uma preenchida" validada em app (`validarSelecaoMaquina`), 5 índices só pra isso, 5 arquivos de `actions.ts`, 5 rotas de detalhe e uma `maquinas/page.tsx` de 412 linhas com 5 queries e 5 seções quase idênticas. Os achados A3–A7 da Parte 1 ainda pendentes (Personalização, Bordado, DTF, Tempo de Máquina, Chapa Rígida) somariam, no mesmo padrão, mais 5 tabelas, mais ~5 FKs nullable em cada um dos dois models e ~400 linhas na mesma página.

Vale dizer que a escolha original foi consciente e bem justificada no schema (`:232-240`: não unificar `Prensa` pra não migrar dado real de produção) — e `MaquinaSetupPorPeca` já é a prova de que o projeto consegue consolidar quando o custo tem a mesma forma (3 processos, 1 tabela). O achado não é "estava errado"; é "o ponto de virada chegou".

**Pesquisa.** ERP de manufatura resolve isso com uma entidade genérica de recurso: "um centro de recurso é um conjunto de máquinas ou pessoas que desempenham a mesma função e que têm a mesma capacidade produtiva, tendo como função identificar, parametrizar e quantificar todos os recursos" ([Senior — F725CRE Centros de Recursos](https://documentacao.senior.com.br/goup/5.10.2/menu_cadastros/f725cre.htm)), com custo operacional (hora-homem / hora-máquina) parametrizado por recurso e não por tipo de recurso ([Focco ERP — Cadastro do Custo Operacional](https://foccoerp.zendesk.com/hc/pt-br/articles/48849021564561-Focco-ERP-Programas-Focco-ERP-Cadastros-Auxiliares-Custos-Cadastro-do-Custo-Operacional-FCST0103), [TOTVS Datasul — centro de custo produtivo e grupos de máquina](https://centraldeatendimento.totvs.com/hc/pt-br/articles/360034430813-Manufatura-Linha-Datasul-MCS-Como-cadastrar-novo-centro-de-custo-produtivo)).

**Proposta.** Migração completa pra um `Recurso` polimórfico é cara e arriscada, e eu **não** recomendaria agora. Recomendo o meio-termo — atacar só onde a duplicação não paga nada:

- **Manutenção**: substituir as 5 FKs nullable por um par `(maquinaTipo: TipoMaquina, maquinaId: String)`, sem FK de banco, resolvido em batch na tela — mesmo padrão que `RegistroManutencao.registradoPorId` e `MovimentacaoEstoque.criadoPorId` já usam pra `Usuario` ("sem FK direta… resolvido em batch na tela"). Isso congela o crescimento nesse model: cada motor novo passa a ser um valor de enum, não duas colunas + um índice + um branch.
- **Tela**: uma configuração declarativa `[{ tipo, titulo, query, FormNovo, rotaDetalhe }]` iterada por um componente único, em vez de 5 blocos copiados. Reduz `maquinas/page.tsx` a ~120 linhas e torna motor novo = uma entrada no array.
- **`ItemGrafica`**: **não mexer.** É o caminho quente do motor de preço, as FKs são `Restrict` de propósito, e a tipagem estrita por motor é o que faz `carregarContextoPrecificacao` ser seguro. O custo aqui é aceitável.

Prioridade média — é dívida de arquitetura que ainda não sangra, mas o momento certo de pagar é *antes* do 6º motor, não depois do 10º.

## A8 — Identidade visual e dados de contato: só existem no nível da gráfica, e o PDF nem tem CNPJ/endereço/telefone — **PARCIALMENTE CONSTRUÍDO 2026-08-24 (rodada 9)**

**Custo estimado (restante pendente):** 🟢 Barato — campos aditivos nullable em `Filial` (model já existente), com resolução por fallback no mesmo padrão que `resolverDadosFiscais` já implementa.

**Status:** construído o bloco de contato comercial no nível da GRÁFICA (`telefone`/`emailContato`/`site`/`enderecoResumido`, editável em `/configuracoes/identidade`, impresso no rodapé do PDF de orçamento). **Fora de escopo de propósito** (a própria pesquisa já marcava como prioridade baixa): identidade por filial (`logoUrl`/`corPrimaria`/contato próprios de `Filial`) continua gap.


**O que falta.** Dois problemas na mesma tela:

1. **Nenhum dado de contato em lugar nenhum.** `Grafica` não tem telefone, e-mail, site nem endereço. `DadosFiscaisGrafica` tem endereço, mas é 100% opt-in pra NF-e (comentário em `schema.prisma:492-497`) e **não é lido pelo PDF** — `src/lib/pdf/mapear-dados.ts:125-126` passa só `logoUrl` e `corPrimaria`, e o cabeçalho de `OrcamentoDocumento.tsx:233` imprime apenas `graficaNome`. O rodapé (`:363`) tem só "Gerado em <data>". Ou seja: a proposta comercial que a gráfica manda pro cliente não traz CNPJ, endereço, telefone nem e-mail — nada que permita ao cliente responder fora do link, e nada que uma proposta B2B brasileira normalmente carrega.
2. **Identidade não desce pra filial.** `Filial` tem `nome`, `endereco` (texto livre), `ativa` e `dadosFiscais` — não tem `logoUrl` nem `corPrimaria`. Um orçamento feito na Filial B sai com a logo da matriz.

**Pesquisa.** Redes de gráfica rápida com dezenas de unidades são realidade estabelecida no Brasil — a Imprimix opera "mais de 35 unidades em 20 estados" com plataforma integrada às lojas ([Imprimix — Franquia](https://www.imprimix.com.br/franquia/)), e há várias outras redes no segmento ([Sua Franquia — 5 franquias de gráfica](https://www.suafranquia.com/noticias/negocios-e-servicos/2020/03/5-franquias-de-grafica-para-investir/)). Nesse contexto, o padrão é o oposto do que o gap sugere: a marca é padronizada pela rede, o que varia por unidade é **endereço, telefone e CNPJ** no documento. Isso reforça que a peça faltante mais urgente é o bloco de contato, não a logo por filial.

**Proposta.**

```prisma
// em Grafica — bloco comercial do cabeçalho do PDF/e-mail (nada disso é fiscal)
telefone String?
emailContato String?
site String?
enderecoResumido String?  // texto livre, uma linha, mesmo espírito de Filial.endereco
```

```prisma
// em Filial — sobrescreve o da Grafica só quando preenchido
telefone         String?
emailContato     String?
logoUrl          String?
corPrimaria      String?
```

Resolução por fallback: filial → gráfica → padrão da plataforma, exatamente o padrão que `resolverDadosFiscais` (`src/lib/nota-fiscal.ts`) já implementa pra `DadosFiscaisFilial`. `mapear-dados.ts` passa a ler `orcamento.filial` (a FK `Orcamento.filialId` já existe) antes de cair na gráfica. Prioridade: o bloco de contato é média-alta (afeta 100% dos tenants, todo dia, e é trivial); a identidade por filial é baixa.

*Nota lateral, sobre a decisão de escopo de `Filial` não ter preço próprio:* não achei caso de mercado forte o bastante pra reabrir. Rede de franquia com preço por unidade existe, mas quem opera assim precisa de estoque e financeiro separados também — não é um campo a mais, é outro produto (tenant por unidade + consolidação). Mantida a decisão atual; o que muda é só identidade/contato, que é barato.

## A9 — Roteamento de notificação não é configurável: destinatário, canal e escopo estão no código — **CONSTRUÍDO 2026-08-31 (rodada 19, com ressalva)**

**Custo estimado (restante pendente):** 🟢 Barato — 2 valores novos no enum `AreaAdministrativa` já existente (`ADD VALUE`) mais religar 2 call sites de e-mail existentes, exatamente o mesmo padrão já construído pra `PRAZO_PRODUCAO`.

**Status (restante):** `AreaAdministrativa.COBRANCA`/`COMPRAS` adicionados. `COMPRAS` religado de verdade — `alerta-estoque.ts` (`verificarEDispararAlertaEstoque`) agora roteia pro(s) `ResponsavelAdministrativo(COMPRAS)`, com fallback pros DONOs (mesmo padrão de `PRAZO_PRODUCAO`). **`COBRANCA` ficou só cadastrável, sem religar** — investigação confirmou que não existe HOJE nenhum disparo de e-mail de "conta a receber vencida" no código pra adaptar (só a tela `/financeiro/contas-receber` destacando visualmente as vencidas); o valor do enum fica pronto pra quando esse alerta for construído.

**Status (original, rodada 9):** `AreaAdministrativa.PRAZO_PRODUCAO` construído, reaproveitando o mecanismo já existente pra `NOTA_FISCAL`. `alerta-prazo-email.ts` manda pro(s) responsável(is) configurado(s) em vez de todo DONO, com fallback pro comportamento de hoje quando nenhum for cadastrado. `ResponsaveisAdministrativoForm.tsx` virou tabela funcionário × área.

**O que falta.** `AutomacaoGrafica` tem 1 `webhookUrl` + 3 booleans. Além dele: `src/lib/alerta-prazo-email.ts:198-203` monta os destinatários como "vendedor do orçamento + **todos** os DONOs da gráfica", fixo. `ResponsavelAdministrativo` existe e resolve o problema certo, mas o enum `AreaAdministrativa` (`schema.prisma:2928-2930`) tem **um único valor**, `NOTA_FISCAL` — o próprio comentário diz que foi deixado aberto pra "cobrança, etc.". Na prática, uma gráfica com um PCP dedicado não tem como fazer o alerta de prazo chegar nele sem promovê-lo a DONO, e o dono de uma gráfica de 30 pessoas recebe e-mail de todo pedido que se aproxima do prazo.

**Pesquisa.** (inferência minha — é raciocínio de arquitetura sobre escala de tenant, não padrão de mercado pesquisável.) O sinal está no próprio código: `AutomacaoGrafica` já foi refatorada uma vez exatamente por essa razão ("antes dos três disparavam sempre juntos… uma gráfica que não controla estoque não quer estoque_critico poluindo o workflow", `schema.prisma:652-656`). A mesma lógica se aplica um nível acima, ao destinatário.

**Proposta.** Barata, aditiva, sem model novo: estender o enum existente em vez de criar outro mecanismo.

```prisma
enum AreaAdministrativa {
  NOTA_FISCAL
  PRAZO_PRODUCAO   // recebe alerta de prazo/atraso
  COBRANCA         // recebe alerta de conta a receber vencida
  COMPRAS          // recebe alerta de estoque crítico
}
```

`alerta-prazo-email.ts` passa a montar: vendedor + `ResponsavelAdministrativo(PRAZO_PRODUCAO)`; se não houver nenhum cadastrado, cai nos DONOs (comportamento de hoje, zero regressão). Prioridade média.

## A10 — Onboarding de tenant novo: existe checklist, não existe template nem exportação de configuração

**Custo estimado:** 🟢 Barato — a própria proposta recomenda não construir exportação/clonagem agora; o único pedaço de schema necessário (`Grafica.segmento`) já está contabilizado e construído no A6.

**O que falta.** O que já existe é mais do que a pergunta sugeria: `/comecar` com checklist de 3 passos (`obterStatusOnboarding`), `carregarDadosExemplo` com limpeza reversível, `PendenciasConfiguracaoModal` proativo pro DONO, `garantirCategoriasCustoPadrao` lazy, e importador de planilha com IA (`TipoImportacaoPlanilha`). O que não existe: (a) qualquer variação disso por perfil de gráfica — é o A6; (b) importação de planilha pra **máquinas, fornecedores e categorias de custo** (o enum só cobre `CLIENTES`, `CATALOGO`, `PEDIDOS`); (c) qualquer forma de exportar/clonar a configuração de um tenant. `/admin/graficas` só concede e revoga cortesia (`concederCortesia`, `presentearPorEmail`, `revogarCortesia`) — não provisiona nem copia nada.

**Pesquisa.** Ver A6 (registro de templates por tenant como prática de provisionamento multi-tenant). Especificamente sobre exportação, não achei fonte que a trate como expectativa de mercado em ERP SMB brasileiro — é mais uma ferramenta interna de quem opera a plataforma do que uma feature de cliente.

**Proposta / opinião.** Minha leitura é que **a maior parte disto é UX de fluxo, não modelagem**, e portanto fora do escopo desta auditoria — com uma exceção concreta: o campo `Grafica.segmento` do A6, que é o único pedaço de schema necessário pra tudo o mais virar dado em vez de código. A clonagem de configuração eu **não** construiria: enquanto o dono configura os tenants na mão, um script de seed parametrizado por segmento (rodável fora do produto) entrega o mesmo resultado sem carregar uma superfície de exportação/importação que precisa lidar com FKs, tokens fiscais e segredos de webhook. Se a exportação for construída algum dia, que seja como saída do que já é rastreável (JSON de `ParametrosGrafica` + máquinas + categorias), explicitamente **sem** `focusNfeToken` e **sem** `webhookUrl`. Prioridade: baixa, exceto pelo campo `segmento`, que já está contabilizado em A6.

## A11 — `UnidadeDimensao` não tem POLEGADA

**Custo estimado:** 🟢 Barato — `ADD VALUE` num enum já existente (`UnidadeDimensao`) mais duas entradas num `Record` no código; a própria proposta já registra que não há dívida acumulando enquanto isso não é feito.

**O que falta.** `enum UnidadeDimensao { MM, CM, M }` (`schema.prisma:18-22`) e `UNIDADES_DIMENSAO`/`FATOR_PARA_CM` em `src/lib/unidade-dimensao.ts:23,40`.

**Pesquisa.** O padrão oficial brasileiro é métrico, e mesmo o segmento de bordado — o mais "americano" da lista, por causa das máquinas importadas — publica os bastidores em duplo padrão, com o tamanho nominal em polegada e a medida real em milímetro: "4x4, 5x7 e 6x10, cujas medidas correspondentes, de acordo com os padrões da indústria, são 100x100 mm, 130x180 mm e 160x200 mm" ([MaggieFrame — Guia de tamanhos de bastidores](https://www.maggieframes.com/pt/blogs/embroidery-blogs/guia-tamanhos-bastidores-bordado-maquina)). Ou seja: a polegada aparece como *rótulo de equipamento*, não como unidade de trabalho — o campo de costura real é cotado em mm.

**Proposta / opinião.** Adicionar `POLEGADA` é tecnicamente trivial e seguro: 1 pol = 2,54 cm é exato e a coluna canônica é `Decimal(8,2)` em cm, então a conversão não perde nada relevante (a resolução do banco, 0,01 cm, equivale a ~0,004 pol — bastaria acrescentar `POLEGADA: 3` em `CASAS_EXIBICAO`). Mas eu **não** faria agora: é a definição de over-engineering enquanto nenhuma gráfica pediu, e o custo de adicionar depois é uma linha de enum + duas entradas de `Record` — não há dívida acumulando. Registro como baixa prioridade, com nota de que a implementação está pré-mapeada caso apareça um cliente que peça.

## A12 — Multi-moeda (nota de uma linha)

**Custo estimado:** 🔴 Caro — a própria proposta diz "não é um campo moeda, é reescrever precificação, financeiro e fiscal", e recomenda explicitamente não fazer.

Fora de escopo e assim deve permanecer: o sistema é BR-fiscal de ponta a ponta (`RegimeTributario` fechado sem OUTRO por decisão explícita no schema, CSOSN/CFOP/NCM, Focus NFe, `formatoMoeda` pt-BR, `dataInputParaUTC` ancorado em Brasília). Multi-moeda não é um campo `moeda` — é reescrever precificação, financeiro e fiscal. Não fazer.

## A13 — Política comercial padrão (tolerância de tiragem, dias úteis, mínimos) só existe como texto livre — **CONSTRUÍDO 2026-08-30 (rodada 16)**

**Status:** `toleranciaTiragemPercent` construído conforme a proposta (default 0). Interpolado nos termos padrão e exibido na Ordem de Produção. Faturar pela quantidade entregue continua fora de escopo (segunda etapa, deliberadamente não construída).

**O que falta.** A única expressão de política comercial configurável é `termosCondicoesPdf` — um bloco de texto de até 4.000 caracteres, único pra gráfica inteira, sem nenhum campo estruturado por trás. Não há `toleranciaTiragemPercent`, não há mínimo em quantidade (`pedidoMinimo` é em R$), e a `Entrega` não registra quantidade efetivamente entregue.

**Pesquisa.** Tolerância de tiragem é cláusula publicada por gráfica brasileira: a 2mL Gráfica Expressa declara nas condições de serviço que se reserva variação de até 5% a mais ou a menos na quantidade final impressa, com cobrança proporcional se a variação for superior a 5% em prejuízo do cliente ([2mL — Condições de Serviços](https://www.2ml.com.br/condicoes-servicos/)). É um parâmetro que varia por gráfica e por processo (offset e flexo têm quebra de tiragem inerente ao acerto; digital e corte a laser praticamente não têm) — exatamente o perfil de coisa que deveria ser configuração, não parágrafo de texto.

**Proposta.** Aditivo e pequeno, em `ParametrosGrafica`:

```prisma
toleranciaTiragemPercent Decimal @default(0) @db.Decimal(5, 2) // 0 = sem tolerância (comportamento de hoje)
```

Usos imediatos e de baixo risco: interpolar o valor no texto padrão de termos (`TERMOS_CONDICOES_PDF_PADRAO`) e exibir a faixa aceitável na Ordem de Produção. Faturar pela quantidade entregue em vez da pedida é uma segunda etapa que toca `Entrega`/`Pedido` e pertence mais à Produção/Financeiro — deixaria fora desta rodada. Prioridade baixa-média.

## Prioridade sugerida

| # | Achado | Prioridade | Justificativa |
|---|---|---|---|
| A1 | 8 parâmetros sem caminho de escrita | **Alta** | Features prontas e inalcançáveis; a trava de desconto nunca dispara e as faixas de margem estão calibradas num perfil só |
| A3 | Auditoria em 2 de 14 telas de Configurações | **Alta** | Custo de hora-máquina e token/CFOP fiscal mudam preço e nota sem deixar rastro; a infra de log já existe, só não é chamada |
| A6 | Nenhum campo de segmento do tenant | **Alta** | É a causa-raiz do viés Assus em categorias de custo, dados de exemplo e pendências; sem ele nada pode se adaptar por perfil |
| A2 | "Dias úteis" prometido em texto fixo, sem calendário | **Alta** | O PDF assume um compromisso que nenhum cálculo interno conhece; feriado municipal varia de cidade pra cidade |
| A4 | Sem cadastro de alçada (desconto e compras) | **Média-alta** | Aprovação de compra hoje não tem teto de valor nenhum; alçada por perfil é item básico em ERP SMB brasileiro |
| A8 | PDF sem CNPJ/endereço/telefone; identidade não desce pra filial | **Média-alta** (contato) / Baixa (filial) | O bloco de contato afeta todo tenant em toda proposta e é trivial; logo por filial é caso de nicho |
| A5 | Permissão por usuário, sem cargo/perfil; ADMIN irrestrito | **Média** | Não escala pra gráfica com turnos; barato agora, caro depois de centenas de tenants |
| A9 | Destinatário de notificação hardcoded | **Média** | Resolve-se estendendo um enum que já foi deixado aberto pra isso |
| A7 | Uma tabela/tela por tipo de máquina não escala pra 10 motores | **Média** | Dívida que ainda não sangra; pagar antes do 6º motor, e só em manutenção + tela, nunca em `ItemGrafica` |
| A13 | Tolerância de tiragem só como texto livre | **Baixa-média** | Cláusula real de mercado (±5%), variável por processo, hoje sem campo estruturado |
| A10 | Sem template de config por segmento nem export | **Baixa** | Majoritariamente UX; a única peça de schema necessária já está em A6 |
| A11 | Sem POLEGADA em `UnidadeDimensao` | **Baixa** | Mercado BR é métrico; conversão exata (2,54) deixa a porta aberta a custo zero — não fazer agora |
| A12 | Multi-moeda | **Não fazer** | Sistema é BR-fiscal de ponta a ponta; não é um campo, é outro produto |

Critical files: `prisma/schema.prisma` (`ParametrosGrafica` ~L100, `Grafica` ~L26, `Filial` ~L473, `RegistroManutencao` ~L425, `AreaAdministrativa` ~L2928), `src/app/configuracoes/actions.ts` (único escritor de `ParametrosGrafica`; padrão de diff de auditoria a extrair), `src/app/configuracoes/ParametrosForm.tsx` (onde os 8 campos órfãos precisam aparecer), `src/lib/pendencias-configuracao.ts` e `src/lib/custo-pedido.ts` (defaults hoje congelados no perfil rótulos), `src/lib/pdf/OrcamentoDocumento.tsx` + `src/lib/pdf/mapear-dados.ts` (o "dias úteis" literal e o cabeçalho sem contato).

# Parte 7 — Completude de cadastro ("dá pra nem cadastrar isso")

**Adicionada em 2026-08-30, frente de pesquisa diferente das Partes 1-6.**
As Partes anteriores perguntam majoritariamente "o motor de preço cobre
esse processo?". Esta pergunta a diferente e mais básica, a que gera a
reclamação mais direta de um cliente pagante: **"eu nem consigo cadastrar
o equipamento/material/acabamento/pessoa que eu tenho — o sistema não
oferece a opção."** Pedido explícito do dono do produto, com exemplo
próprio: "falta de máquinas para cadastrar". 5 subagentes (haiku, pesquisa
rápida — não é o padrão Opus das Partes 1-6, decisão de custo) cobriram 5
ângulos em paralelo: máquinas, matérias-primas, acabamento cadastrável,
equipe/prestadores, e primeira experiência (onboarding) de uma gráfica
atípica. Nada aqui foi verificado linha-a-linha pela thread principal
ainda (diferente das Partes 1-6, que passaram por reconciliação) — tratar
como pesquisa bruta, mais sujeita a imprecisão que o resto do documento.

**Atualização 2026-08-31 — revisão + rodada Opus (seção F).** Depois da
pesquisa haiku acima, um subagente Opus (lendo `arquitetura-resumo.md` +
este documento inteiro antes de raciocinar, em vez de reexplorar o repo —
ver [[feedback-orquestracao-modelo]] na memória) fez duas coisas: (1) achou
9 achados novos na seção **F — Documento e transação** abaixo, um ângulo
que os 5 haiku não cobriram (focaram todos em "catálogo de coisas" —
máquina/material/acabamento/pessoa/onboarding; nenhum tocou documento
fiscal, frete, arte, pagamento); (2) revisou criticamente os 24 achados A-E
acima, achando **3 propostas erradas** e **2 riscos de dano**, direto nos
achados abaixo (não reescritos, só anotados com "⚠️ Revisão Opus 2026-08-31"
no ponto certo):

- **A1 (bordado):** proposta de `ProcessoSetupPorPeca.BORDADO` conflita com
  o achado A4/Parte 1 (já catalogado) — bordado cobra por PONTO da arte,
  não por peça fixa como `calcularSetupPorPeca` assume. Encaixar ali seria
  o mesmo erro que o achado A5/Parte 1 aponta pro DTF (classificado no
  motor errado, erra silenciosamente). Corrigir pra `CategoriaEquipamento.
  BORDADO` (só cadastro, sem motor de custo — é o que `Equipamento` já é).
- **A3+A4 (impressora/prensa):** dois campos de texto livre genéricos
  (`tecnologiaImpressao`, `notas`) despejados no mesmo model sem
  coordenação entre os 2 agentes que os escreveram. Pior: A4 diagnostica
  diferença de CUSTO entre tipo de prensa mas propõe resolver em
  `Equipamento`, que o próprio schema documenta como "nunca influencia
  preço". Se o custo muda de verdade, o campo é em `MaquinaSetupPorPeca`
  (`custoPorSetup`/`custoPorPeca`), não em `Equipamento`.
- **B1-B6 (matérias-primas):** são trabalho de SEED (conteúdo do catálogo
  mestre), não gap de cadastro — `ItemCatalogo` privado por gráfica +
  `UnidadeMedida.OUTRO` já permitem cadastrar tudo isso hoje. Recategorizar
  como 1 item de baixa prioridade ("ampliar catálogo mestre por segmento"),
  não 6 achados separados inflando o placar.
- **C1 (TipoAdesivo):** contradição interna — propõe `HOT_MELT` como "o
  mesmo material que BORRACHA com outro nome" e ao mesmo tempo pede
  adicionar (duplicaria o dado histórico). "Siliconado" é atributo do
  SUBSTRATO, não do adesivo — o próprio achado admite isso e propõe no
  lugar errado mesmo assim.
- **C5:** é o melhor achado da seção C (gap estrutural real, verificado) —
  deveria estar em destaque, não no rodapé.
- **D1 (colaborador sem login):** a proposta original (relaxar `email`/
  `senhaHash` de `Usuario` pra nulo) está ERRADA, não só arriscada —
  contamina toda a cadeia de auth/sessão/billing por usuário. O caminho
  correto já está provado no próprio achado: nome DECLARADO em texto
  (`ApontamentoEtapa.operadorNomeDeclarado`, `Entrega.motorista`), ou um
  model NOVO (`Colaborador`) se cadastro estruturado for mesmo necessário
  — nunca um `Usuario` capenga.
- **D3 (dados de pessoa/pagamento):** se sobrepõe a F6 abaixo (pra onde a
  GRÁFICA recebe) e ao A15/Parte 4 (`ContaFinanceira`, conta bancária
  interna) — são 3 achados de "dado de pagamento" chegando em 3 lugares
  diferentes do schema sem se conhecer. Decidir 1 modelo antes de construir
  qualquer um dos 3.
- **E1/E2 (esconder card/menu por segmento):** potencialmente PERIGOSO como
  está — `Grafica.segmento` é documentado no próprio schema como
  "DESCRITIVO, nunca restritivo" e é opcional (maioria dos tenants tem
  `null`, a regra proposta nem dispararia) e mono-valorado (gráfica híbrida
  perderia módulo que usa). Sinal melhor pra "esconder card vazio": uso
  real (ex: "0 pedidos em produção nos últimos N dias"), não identidade
  declarada.
- **E3:** o melhor achado da seção E, mas ainda não conferido contra
  `src/lib/onboarding.ts`/`dados-exemplo.ts` — checar antes de construir.

Placar depois desta rodada: **112 + 9 = 121 achados catalogados** no
documento inteiro.

## A. Máquinas e equipamentos cadastráveis

### A1 — Máquina de bordado sem categoria própria — **CONSTRUÍDO 2026-08-31 (rodada 17)**
**Custo estimado:** 🟢 Barato — pela proposta CORRIGIDA pela revisão Opus (`CategoriaEquipamento.BORDADO`, só cadastro, sem motor de custo), é só `ADD VALUE` num enum já existente; a proposta original (`ProcessoSetupPorPeca.BORDADO`) foi descartada por conflitar com o achado A4/Parte 1.

**Status:** `CategoriaEquipamento.BORDADO` adicionado (só a versão corrigida — sem `ProcessoSetupPorPeca.BORDADO`/`numeroCabecotes`, que ficaria descartado por cobrar por ponto da arte, não por peça fixa). Utilizável end-to-end via `/configuracoes/maquinas/equipamentos` sem mudança de form (categoria é validada dinamicamente contra o dicionário).

**O que falta.** Não existe `BORDADO` em `CategoriaEquipamento` nem em `ProcessoSetupPorPeca` — uma gráfica de estamparia com máquina de bordado (mono ou multicabeça) cadastra como `OUTRO` genérico e perde a diferenciação de custo por número de cabeçotes (multicabeça reduz tempo de setup proporcionalmente).

**Pesquisa.** Máquinas Juki/Brother/Tajima com 1, 6, 8 ou 12 cabeçotes são padrão de mercado ([Galpão das Máquinas](https://galpaodasmaquinas.com.br/categoria/textil/maquina-de-bordar)).

**Proposta.** `ProcessoSetupPorPeca.BORDADO` (mesmo padrão dos 5 processos já adicionados no achado A3/Parte 1) + `MaquinaSetupPorPeca.numeroCabecotes Int? @default(1)`.

### A2 — Corte e vinco (cartonagem) sem categoria — **CONSTRUÍDO 2026-08-31 (rodada 17)**
**Custo estimado:** 🟢 Barato — `ADD VALUE` num enum já existente (`CategoriaEquipamento`) mais uma entrada de conteúdo no dicionário de exemplos.

**Status:** `CategoriaEquipamento.CORTE_VINCO` adicionado, com "ex: Makpel, DellMarck, Slottec" em `EXEMPLOS_MARCA_CATEGORIA_EQUIPAMENTO`.

**O que falta.** `CategoriaEquipamento` não tem opção pra máquina de corte-e-vinco (corta e vinca papel/papelão simultaneamente) — diferente de `CORTE_LASER_ROUTER`, que é outra tecnologia. Gráfica de embalagem cadastra como `OUTRO`.

**Pesquisa.** Marcas brasileiras: Makpel, DellMarck, Slottec ([Flockcolor](https://flockcolor.com.br/maquina-de-corte-vinco-para-caixas-embalagens)).

**Proposta.** Adicionar `CORTE_VINCO` a `CategoriaEquipamento` + entrada em `EXEMPLOS_MARCA_CATEGORIA_EQUIPAMENTO`.

### A3 — Impressora de grande formato sem tecnologia/largura/velocidade — **CONSTRUÍDO 2026-08-31 (rodada 17)**
**Custo estimado:** 🟢 Barato — campos aditivos nullable em `Equipamento` (model já existente), sem enum novo (texto livre por ora); a revisão Opus só pede coordenar com A4 pra não duplicar campo de texto livre solto no mesmo model.

**Status:** `Equipamento.larguraMaximaMm Int?` + `tecnologiaImpressao String?`, com campo no form de criar/editar equipamento (não específico de categoria — aparece pra qualquer tipo) e validação/auditoria em `actions.ts`. Velocidade ficou de fora (não veio no texto final da proposta).

**O que falta.** `Equipamento`/`ImpressoraDigital` não têm campo de tecnologia de impressão (solvente/eco-solvente/UV/sublimática) nem largura máxima — dado que muda o preço por m² de forma relevante.

**Pesquisa.** (Inferência minha, baseada em catálogo de fabricante — Roland, Mimaki, HP Latex, Epson SureColor variam preço/m² por tecnologia e largura).

**Proposta.** `Equipamento.larguraMaximaMm Int?` + `tecnologiaImpressao String?` (texto livre por ora, sem enum fechado).

### A4 — Prensa térmica/estampador sem tipo diferenciado — **CONSTRUÍDO 2026-08-31 (rodada 17, sem mudança de código)**
**Custo estimado:** 🟢 Barato — mas só pela proposta CORRIGIDA pela revisão Opus: a original (`Equipamento.notas`) está no model errado, porque `Equipamento` "nunca influencia preço" e o achado descreve diferença real de custo; se o custo importa de verdade, o lugar é reaproveitar `custoPorSetup`/`custoPorPeca`, campos que já existem em `MaquinaSetupPorPeca` — nenhum campo novo necessário.

**Status:** confirmado que a proposta corrigida não precisa de nenhuma mudança de schema — `MaquinaSetupPorPeca.custoPorSetup`/`custoPorPeca` já existem e já diferenciam prensa plana×cap press×carrossel pelo cadastro atual (cada prensa é sua própria `MaquinaSetupPorPeca`). Nenhum código tocado.

**O que falta.** `ProcessoSetupPorPeca` (SUBLIMACAO/ESTAMPAGEM_QUENTE) não diferencia prensa plana, cap press (boné), caneca press e carrossel rotativo — setup e custo por peça mudam muito entre eles (carrossel multicolor é setup paralelo, ~8× mais eficiente que prensa plana).

**Pesquisa.** (Inferência minha, baseada em equipamento industrial padrão do setor).

**Proposta.** Campo simples `Equipamento.notas String?` pra a gráfica descrever o tipo (pragmático, evita over-engineering num enum fechado sem uso validado ainda).

### A5 — Gofradeira/vincadeira sem categoria — **CONSTRUÍDO 2026-08-31 (rodada 17)**
**Custo estimado:** 🟢 Barato — `ADD VALUE` num enum já existente (`CategoriaEquipamento`).

**Status:** `CategoriaEquipamento.VINCADORA` adicionado (sem marca de exemplo — pesquisa não achou marca consolidada, hint descreve a função).

**O que falta.** Máquina que faz só vinco (sem cortar, comprime o papel pra dobra) — etapa anterior à dobra em cartonagem — não tem categoria, só `OUTRO`.

**Pesquisa.** (Inferência minha).

**Proposta.** Adicionar `VINCADORA` a `CategoriaEquipamento`.

## B. Matérias-primas, substratos e insumos cadastráveis

### B1 — Tecido em rolo pra estamparia (antes de virar peça) — **CONSTRUÍDO 2026-08-31 (rodada 17)**
**Custo estimado:** 🟢 Barato — a revisão Opus recategoriza B1-B6 como trabalho de SEED (conteúdo do catálogo mestre), não gap de schema: `ItemCatalogo` privado por gráfica já permite cadastrar isso hoje.

**Status:** 5 itens adicionados em `CATALOGO_MESTRE` (categoria "Sublimação e Vestuário"): Tecido Algodão/Poliéster/Dry-Fit/Malha PV/Ribana (Rolo), unidade `METRO_LINEAR`.

**O que falta.** Catálogo tem peças prontas ("Camiseta Branca") mas não o tecido em rolo (algodão, poliéster, dry-fit, malha PV, ribana) que uma gráfica de estamparia real compra como matéria-prima.

**Pesquisa.** Fio (20s/30s) e composição são tabelados (NBR 12.748, ABIT); preço varia ~R$35-70/kg conforme composição.

**Proposta.** Novos itens de catálogo mestre em categoria "Sublimação e Vestuário", unidade METRO_LINEAR (já existe).

### B2 — Filme DTF e insumos (pó adesivo, tinta DTF) — **CONSTRUÍDO 2026-08-31 (rodada 17)**
**Custo estimado:** 🟢 Barato — mesma recategorização de B1: trabalho de SEED, sem gap de schema.

**Status:** 3 itens adicionados em `CATALOGO_MESTRE` (categoria nova "DTF e Transfer"): Filme DTF (ROLO), Pó Adesivo DTF (KG), Tinta DTF CMYK (LITRO).

**O que falta.** Existe "Papel Transfer Sublimático" mas não filme DTF (processo distinto), pó adesivo (powder) nem tinta DTF específica.

**Pesquisa.** Filme em rolo 60/80cm × 100m (~R$120-180); pó adesivo por kg (~R$25-35).

**Proposta.** 3 itens novos: Filme DTF (ROLO), Pó Adesivo DTF (KG), Tinta DTF CMYK (LITRO).

### B3 — Corpos de brinde em branco (antes de personalizar) — **CONSTRUÍDO 2026-08-31 (rodada 17)**
**Custo estimado:** 🟢 Barato — mesma recategorização de B1: trabalho de SEED, usando `VarianteMateriaPrima` que já existe.

**Status:** 6 itens adicionados em `CATALOGO_MESTRE` (categoria nova "Brindes (Corpos)"): Caneta/Squeeze/Copo/Chaveiro/Botton/Sacola em Branco, unidade `UNIDADE`. Variante de modelo/cor fica pra gráfica configurar depois (mecanismo já existente, não precisou de seed).

**O que falta.** Catálogo só tem produto final ("Caneta Personalizada"), não o corpo em branco que uma gráfica-revenda de brindes compra e precifica com custo real do dia.

**Pesquisa.** Fornecedores (Luminati, XBZ, DGL) vendem o corpo separado, por caixa/mil.

**Proposta.** Categoria nova "Brindes (Corpos)": caneta/squeeze/copo/chaveiro/botton/sacola em branco, com `VarianteMateriaPrima` pra modelo/cor.

### B4 — Filme metalizado (hotfoil) pra hot stamping — **CONSTRUÍDO 2026-08-31 (rodada 17)**
**Custo estimado:** 🟢 Barato — mesma recategorização de B1: trabalho de SEED, sem gap de schema.

**Status:** 4 itens adicionados em `CATALOGO_MESTRE` (categoria nova "Hot Stamping"): Filme Metalizado Ouro/Prata/Cobre/Holográfico, unidade `ROLO`.

**O que falta.** Hot stamping é acabamento implementado, mas o insumo (filme metalizado — ouro/prata/cobre/holográfico) não está no catálogo.

**Pesquisa.** Rolo 32-40cm × 200m, ~R$50-120/rolo conforme cor ([Sposi](https://www.sposi.com.br/)).

**Proposta.** Categoria "Hot Stamping": 4 itens por cor, unidade ROLO.

### B5 — Papelão ondulado sem especificação de onda (B/C/BC/E) — **CONSTRUÍDO 2026-08-31 (rodada 17)**
**Custo estimado:** 🟢 Barato — mesma recategorização de B1: trabalho de SEED, usando `VarianteMateriaPrima` que já existe.

**Status:** "Papelão Ondulado" adicionado em `CATALOGO_MESTRE` (categoria "Placas e Chapas", complementa "Papelão Paraná" que é maciço), unidade `METRO_QUADRADO`. A distinção de onda B/C/BC/E vira variante depois, configurada pela gráfica (mecanismo já existente).

**O que falta.** Catálogo tem "Papelão Paraná" genérico (maciço, não ondulado). Cartonagem real usa onda B/C/BC/E, com resistência e preço bem diferentes (~30-50% de variação).

**Pesquisa.** Normatizado pela ABNT NBR 14713; preço C ~R$1,5-2,5/m², BC ~R$2,5-3,5/m².

**Proposta.** `VarianteMateriaPrima` pra "Papelão Ondulado" com 4 variantes de onda, preço próprio por variante.

### B6 — Materiais de bordado (tecido específico, entretela, linha, bobina) — **CONSTRUÍDO 2026-08-31 (rodada 19)**
**Custo estimado:** 🟢 Barato — mesma recategorização de B1: trabalho de SEED, sem gap de schema.

**Status:** 4 itens adicionados em `CATALOGO_MESTRE` (categoria "Bordado (Materiais)"): Entretela Fusível/Não-Fusível (METRO_LINEAR), Linha de Bordar e Bobina de Bobbing (UNIDADE).

**O que falta.** Entretela (fusível/não-fusível, peso em oz), linha de bordar e bobina de bobbing não têm representação — críticos pra custo real de bordado.

**Pesquisa.** (Inferência minha, baseada em insumo padrão do setor têxtil).

**Proposta.** Categoria "Bordado (Materiais)": tecido/entretela/linha/bobina, unidades conforme item.

## C. Tipos de acabamento cadastráveis (opção existir, não precificação)

### C1 — TipoAdesivo sem hot melt, siliconado, durabilidade — **CONSTRUÍDO 2026-08-31 (rodada 19)**
**Custo estimado:** 🟢 Barato, mas a proposta precisa ser corrigida antes de construir — a revisão Opus aponta contradição interna (HOT_MELT duplicaria BORRACHA; siliconado é atributo do substrato, não do adesivo, e a proposta erra o lugar mesmo admitindo isso). O que sobra depois de corrigido (campo de durabilidade) é campo aditivo nullable, sem model/enum novo.

**Status:** só a versão corrigida — `OrcamentoItemEtiqueta.durabilidadeAdesivo String?` (texto livre). Sem `HOT_MELT` no enum e sem `superficieComSilicone` (ambos descartados pela correção). Campo visível no formulário de etiqueta.

**O que falta.** Enum só tem acrílico/borracha em gramas — falta hot melt (nome técnico da "borracha" já existente, mas usado com outro nome no mercado), flag de liner siliconado (atributo de substrato, não de adesivo), e permanente×removível (critério de venda comum).

**Pesquisa.** [Guia do Gráfico — tipos de adesivo](https://www.guiadografico.com.br/artigos/tipos-de-adesivo-aplicados-em-substratos-utilizados-pelos-convertedores-de-rotulos-e-etiquetas-autoadesivas).

**Proposta.** Campo `durabilidadeAdesivo` opcional + flag `superficieComSilicone Boolean`.

### C2 — TipoLaminacao sem soft touch/metalizada — **CONSTRUÍDO 2026-08-31 (rodada 19)**
**Custo estimado:** 🟢 Barato — `ADD VALUE` num enum já existente (`TipoLaminacao`), 2 valores.

**Status:** `SOFT_TOUCH`/`METALIZADA` adicionados; dropdown já era dinâmico (`OPCOES_LAMINACAO` em `CamposEtiquetaOrcamento.tsx`), só editar o dicionário bastou.

**O que falta.** Só BRILHO/FOSCO/OUTRO — soft touch (aveludado, sem marca de dedo) é categoria própria vendida com preço premium.

**Pesquisa.** [EMBRAPA — acabamento gráfico](https://www.embrapa.br/manual-de-editoracao/conceitos-e-normas-editoriais/o-processo-e-o-fluxo-editorial/nocoes-e-tecnicas-para-producao-grafica/acabamento/) lista soft touch como tipo principal, ao lado de brilho/fosco.

**Proposta.** Adicionar `SOFT_TOUCH` e `METALIZADA` a `TipoLaminacao`.

### C3 — TipoAcabamentoVerniz sem soft touch/UV explícito — **CONSTRUÍDO 2026-08-31 (rodada 19, parcial)**
**Custo estimado:** 🟢 Barato — `ADD VALUE` num enum já existente (`TipoAcabamentoVerniz`).

**Status:** `SOFT_TOUCH` adicionado, dropdown dinâmico (`OPCOES_VERNIZ`). A distinção UV×convencional (fora do escopo do valor de enum) não foi construída.

**O que falta.** Falta soft touch (mesma lógica de C2) e a aplicação UV×convencional não é selecionável (fica implícita).

**Pesquisa.** (Mesma fonte de C2 — soft touch é comum a laminação e verniz).

**Proposta.** Adicionar `SOFT_TOUCH` a `TipoAcabamentoVerniz`.

### C4 — TipoHotStamping sem efeito holográfico/colorido — **CONSTRUÍDO 2026-08-31 (rodada 19)**
**Custo estimado:** 🟢 Barato — campo aditivo nullable (texto/enum simples), sem model novo.

**Status:** `OrcamentoItemHotStamping.tipoEfeitoHotStamping String?` (texto livre), campo visível no formulário de etiqueta.

**O que falta.** Só HOT/COLD — não captura o efeito visual (holográfico, espelhado, colorido), que é vendido como serviço distinto.

**Pesquisa.** (Inferência minha, baseada em catálogo de fornecedor de filme — ver B4 acima).

**Proposta.** Campo `tipoEfeitoHotStamping` opcional (holográfico/espelhado/metalizado/colorido/outro).

### C5 — Sem NENHUM enum de acabamento fora de etiquetas (dobra, encadernação, colagem) — **gap estrutural, maior que C1-C4**
**Custo estimado:** 🟡 Médio — 3 enums novos fechado+escape (`TipoDobra`/`TipoEncadernacao`/`TipoColagem`) mais lógica condicional de exibição por tipo de serviço; sem model novo e sem tocar o motor de preço (seção é "opção existir, não precificação").

**O que falta.** `TipoAdesivo`/`TipoSerrilha`/`TipoLaminacao`/`TipoAcabamentoVerniz`/`TipoHotStamping` só existem em `OrcamentoItemEtiqueta` (motor M2/flexografia de rótulo). Pra embalagem, livro/editorial, comunicação visual, brinde — não existe NENHUM dropdown estruturado de acabamento; a gráfica cria um "serviço" com nome livre. Uma gráfica desses perfis vê seleção estruturada só pra etiqueta e assume que falta a feature pro resto.

**Pesquisa.** Dobra (meia-dobra/sanfona/carta/paralela — [Zapgrafica](https://blog.zapgrafica.com.br/acabamentos-graficos-quais-sao-os-4-tipos-de-dobras-e-como-usa-los/)), encadernação (brochura/wire-o/espiral/capa dura — [Guia do Gráfico](https://www.guiadografico.com.br/produtos-e-servicos/categoria/acabamentos-de-livros)), colagem (cola fria/quente/PUR — cartonagem).

**Proposta.** Enums paralelos `TipoDobra`/`TipoEncadernacao`/`TipoColagem`, referenciáveis por um serviço (`ItemGrafica` tipo=SERVICO) via campo opcional — dropdown só aparece quando fizer sentido pro tipo de serviço.

## D. Equipe e prestadores externos

### D1 — Sem conceito de "colaborador sem login" (motorista, operador de chão de fábrica)
**Custo estimado:** 🟡 Médio — a proposta original (relaxar `email`/`senhaHash` de `Usuario`) está ERRADA segundo a revisão Opus, por contaminar toda a cadeia de auth/sessão/billing; a corrigida é um model novo simples `Colaborador` (ou reaproveitar o padrão de nome declarado já usado em `ApontamentoEtapa`/`Entrega.motorista`) — nunca mexer em `Usuario`.

**O que falta.** `Usuario` é 100% acoplado a autenticação (`email`/`senhaHash` obrigatórios). `Entrega.motorista` é texto livre sem histórico auditado; `ApontamentoEtapa.operadorNomeDeclarado` (já construído, rodada 15) prova que o sistema já aceita "pessoa sem login" nesse ponto específico, mas não generalizou o conceito.

**Pesquisa.** Motorista terceirizado e freelancer de design são modelo comum em gráfica de pequeno/médio porte ([Design com Café — terceirizar design](https://designcomcafe.com.br/terceirizar-design-grafico-ou-fazer-voce-mesmo/)).

**Proposta.** `Entrega.motoristaUsuarioId String?` (FK opcional pra `Usuario` com `email`/`senhaHash` nulos — exige relaxar as colunas obrigatórias, mudança não-trivial) — **avaliar com cuidado antes de construir**, é mudança estrutural em `Usuario`, não um campo aditivo simples como o resto do documento.

### D2 — Prestador de serviço recorrente (≠ Fornecedor de insumo)
**Custo estimado:** 🟡 Médio — 1 model novo (`PrestadorServico`) com poucos campos, análogo a `Fornecedor`, sem relação complexa.

**O que falta.** `Fornecedor` é só pra compra de material. Acabamento terceirizado (laminação, encadernação feita por terceiro), logística/despachante, freelancer de design — não têm onde ser cadastrados como prestador recorrente; viram `Despesa` genérica sem estrutura.

**Pesquisa.** (Inferência minha, mas alinhada ao próprio achado A9/Parte 3 já catalogado: "ERPs tratam requisição de material e de serviço no mesmo fluxo").

**Proposta.** `model PrestadorServico` (nome, tipo fechado+OUTRO: ACABAMENTO/LOGISTICA/DESIGN/OUTRO, CPF/CNPJ, contato) — parecido com `Fornecedor` mas pra serviço, não insumo.

### D3 — Dados de pessoa incompletos pra pagamento (CPF, PIX, especialidade)
**Custo estimado:** 🔴 Caro — os campos aditivos em si seriam baratos, mas a revisão Opus aponta que este achado se sobrepõe a F6 e ao A15/Parte 4 (3 achados de "dado de pagamento" chegando em lugares diferentes do schema) e pede explicitamente decidir 1 modelo antes de construir qualquer um dos três.

**O que falta.** `Usuario` não tem CPF, dados bancários/PIX nem especialidade — necessário pra gerar recibo de comissão/serviço e saber pra onde pagar.

**Pesquisa.** (Inferência minha — CPF é exigência fiscal básica pra qualquer recibo no Brasil).

**Proposta.** Campos opcionais em `Usuario`: `cpf`, `chavePix`, `especialidade` (texto livre) — nunca exibidos fora de tela de folha/comissão com acesso restrito.

*(Nota: um 4º achado desta pesquisa — "cargo desvinculado de papel/permissão" — é DUPLICATA do achado A5 já catalogado na Parte 6 ["Permissão é por usuário, não por cargo"]. Omitido aqui de propósito, não é achado novo.)*

## E. Primeira experiência (onboarding) de uma gráfica atípica

### E1 — Dashboard mostra "Pipeline de produção" mesmo pra quem não produz
**Custo estimado:** 🟢 Barato — mas só pela versão CORRIGIDA pela revisão Opus: condicionar por USO real (ex.: "0 pedidos em produção nos últimos N dias"), não por `Grafica.segmento`, que é descritivo/opcional/mono-valorado e a própria revisão chama de potencialmente perigoso pra esse fim. É lógica condicional de UI sobre consulta que já existe, sem schema novo.

**O que falta.** `/meu-negocio` sempre mostra os cards "Pipeline de produção" e "Previsão de estoque", mesmo pra uma gráfica REVENDA pura (achado A12/Parte 1, já construído — terceiriza 100%) que nunca vai ter nada nesses cards. Fica eternamente "Nenhum pedido em produção", confundindo mais que ajudando.

**Pesquisa.** Gráfica de revenda (brinde, papelaria, etiqueta) compra pronto/semiacabado e não passa por etapa de produção interna nenhuma (inferência baseada no próprio modelo de revenda já reconhecido no achado A12/Parte 1).

**Proposta.** Condicionar os 2 cards a `Grafica.segmento` — omitir ou trocar por "Últimas compras/terceirizações" quando o segmento for REVENDA/BRINDES_PERSONALIZADOS.

### E2 — Link "Produção" no menu oferecido mesmo pra quem não usa
**Custo estimado:** 🟢 Barato — mesma correção de E1 (sinal de uso real, não `segmento`); reaproveita a mesma lógica condicional, só aplicada ao menu.

**O que falta.** Mesmo problema de E1, no menu de navegação (`UserNav.tsx`) — o link é condicionado só a permissão de módulo, não a segmento.

**Proposta.** Mesma condição de E1.

### E3 — Segmento é respondido DEPOIS do onboarding — dados de exemplo saem errados
**Custo estimado:** 🟢 Barato — checagem condicional simples (`segmento === null`) + banner, sem schema novo; a revisão Opus pede só confirmar contra `onboarding.ts`/`dados-exemplo.ts` antes de construir (é o melhor achado da seção E, ainda não conferido).

**O que falta.** `/comecar` carrega dados de exemplo a partir de `Grafica.segmento`, mas responder o segmento é uma tela opcional em Configurações, fora do fluxo inicial. Uma gráfica de estamparia que passa por `/comecar` antes de configurar o segmento recebe exemplos de Offset/Etiqueta (pacote padrão) — cria confusão de identidade logo na primeira experiência.

**Proposta.** Checar `segmento === null` antes de carregar exemplo em `/comecar`; se nulo, mostrar banner linkando pra escolher o segmento primeiro (opção conservadora, não quebra conta existente).

### E4 — Segmentos "Brindes"/"Corte a laser" caem no pacote de exemplo errado (Offset)
**Custo estimado:** 🟢 Barato — trabalho de conteúdo (novos pacotes de dados de exemplo por segmento já nomeado no enum), sem mudança de schema.

**O que falta.** `PACOTES_POR_SEGMENTO` em `src/lib/dados-exemplo.ts` só tem entrada dedicada pra COMUNICACAO_VISUAL e ESTAMPARIA_VESTUARIO — os demais segmentos (já nomeados no enum, ex. BRINDES_PERSONALIZADOS, CORTE_LASER_ACRILICO) caem no pacote padrão de Offset comercial, sem nenhuma relação com o negócio real.

**Proposta.** Criar pacotes de exemplo dedicados pros segmentos já nomeados no enum que ainda não têm um.

### E5 — Dados de exemplo sem marca visual, risco de virar orçamento real
**Custo estimado:** 🟡 Médio — sem schema novo, mas exige badge em múltiplos seletores (produto/cliente) mais lógica nova de aviso na criação do orçamento.

**O que falta.** O único sinal de que um cliente/produto é de exemplo é o prefixo de texto "[Exemplo] " no nome — sem badge/cor/ícone. Um usuário distraído pode incluir um cliente ou produto de exemplo num orçamento real.

**Proposta.** Badge visual nos seletores de produto/cliente quando a origem for exemplo; aviso no momento de criar orçamento se algum item/cliente selecionado for de exemplo.

## F. Documento e transação

**Adicionada em 2026-08-31, por um subagente Opus** (não haiku — ver nota
de atualização no topo desta Parte). Ângulo que os 5 haiku de A-E não
cobriram: não "catálogo de coisas" (máquina/material/acabamento/pessoa),
mas o documento e a transação em si — nota fiscal, frete, arte, pagamento,
ferramental. Cada achado abaixo foi verificado contra o código real
(`prisma/schema.prisma`, `src/lib/`) antes de ser escrito, com grep
confirmando ausência — diferente de A-E, tratar com mais confiança.

### F1 — Ferramental reutilizável (faca, clichê, tela, matriz de bordado) não tem cadastro nenhum
**Custo estimado:** 🔴 Caro — model novo `Ferramental` com 3 enums novos, múltiplas FKs (cliente, item de catálogo) e ciclo de vida com status (ATIVO/EM_MANUTENCAO/DESCARTADO/DEVOLVIDO_AO_CLIENTE) — workflow completo, não só cadastro simples.

**O que falta.** Nenhum model representa a ferramenta física — só o dinheiro dela (`ConfiguracaoClicheEtiqueta`/`Flexografia`, `ConfiguracaoAcabamento.custoFerramental`, `OrcamentoItemPrecificacaoEtiqueta.custoFaca`). `ConfiguracaoClicheFlexografia` é OBRIGATÓRIA pra todo produto FLEXOGRAFIA, então toda repetição de tiragem recalcula o clichê como se fosse novo — `TipoPedidoOrcamento.REPETICAO_SEM_ALTERACAO` é só rótulo, nada por trás sabe que a matriz já existe. Também: sem localização física, sem registro de propriedade (cliente x gráfica), sem controle de vida útil por tiragem acumulada.

**Pesquisa.** No web-to-print de baixa tiragem a faca é refeita a cada pedido ([Gráfica das Gráficas](https://instrucoes.graficadasgraficas.com.br/corte-especial/)); em flexo/rótulo industrial o clichê é lavado, guardado e reutilizado, com vida útil variando por cuidado de manuseio ([Clicheria Blumenau](https://www.clicheriablumenau.com.br/blog/mercado/quais-fatores-afetam-o-desempenho-do-cliche-flexografico/)). Clicherias/facas são categoria de fornecimento própria e recorrente ([Guia do Gráfico](https://www.guiadografico.com.br/produtos-e-servicos/categoria/clicherias)).

**Proposta.** `enum TipoFerramental { FACA_CORTE_VINCO CLICHE_FLEXO CLICHE_HOT_STAMPING TELA_SERIGRAFIA MATRIZ_BORDADO CILINDRO_ROTOGRAVURA FERRAMENTA_ACABAMENTO OUTRO }` + `ProprietarioFerramental { GRAFICA CLIENTE }` + `StatusFerramental { ATIVO EM_MANUTENCAO DESCARTADO DEVOLVIDO_AO_CLIENTE }`. `model Ferramental { graficaId, tipo, tipoOutro?, codigo, descricao, clienteId? (SetNull), itemGraficaId?, proprietario, localizacao?, tiragensAcumuladas Int @default(0), status, desativadoEm }`. `OrcamentoItem.ferramentalId String?` opcional, nunca automático — só sugere aviso ("esta faca já existe, considere não cobrar"), preço continua travado à mão.

### F2 — Sistema só emite NF-e de mercadoria; gráfica que fatura serviço não tem onde cadastrar
**Custo estimado:** 🟡 Médio — campos aditivos em 3 models existentes mais 1 enum novo (`ModeloDocumentoFiscal`) e relaxar uma constraint `@@unique`; a própria proposta restringe o escopo desta rodada a cadastro (emissão de NFS-e em si fica pra fase 2).

**O que falta.** `NotaFiscal`/`focus-nfe.ts` são inteiramente NF-e modelo 55. Zero campo de NFS-e (código de serviço, inscrição municipal do emitente, alíquota ISS). `Cliente.inscricaoMunicipal` já existe reservado com comentário "sistema só emite NF-e hoje". Atinge comunicação visual, design/arte, personalização, estamparia — e qualquer gráfica que imprima sobre material do cliente (`materialFornecidoPeloCliente`, já modelado), que é industrialização/serviço por definição.

**Pesquisa.** Súmula 156/STJ: composição gráfica personalizada sob encomenda é ISS, não ICMS. LC 116/2003 item 13.05 (composição gráfica) e 24.01 (sinalização visual, banners, adesivos). STF ressalva embalagem que integra produto industrializado (fica ICMS) — os dois mundos coexistem numa gráfica média.

**Proposta.** Cadastro primeiro, emissão depois: `ItemCatalogo.itemListaServicoLc116`/`codigoServicoMunicipal` (só quando `tipo=SERVICO`). `DadosFiscaisGrafica.inscricaoMunicipal`/`codigoMunicipioIbge`/`aliquotaIssPercent`. `NotaFiscal.modelo ModeloDocumentoFiscal @default(NFE)` (`NFE`/`NFSE`/`NFCE`) + relaxar `@@unique([orcamentoId, modelo])` pra venda mista emitir os dois. `verificarProntidaoFiscal` passa a checar pendência por modelo. Emissão de NFS-e em si fica pra fase 2.

### F3 — Frete: existe a modalidade, não existe o valor, transportadora é texto livre, nota sai com transporte vazio
**Custo estimado:** 🟡 Médio — 1 model novo (`Transportadora`) simples, análogo a `Fornecedor`, mais campos aditivos em `Orcamento`/`Entrega`; a proposta já sugere resposta pra sua única decisão em aberto (frete não entra na comissão).

**O que falta.** `Orcamento.frete` é só a modalidade (já corrigido no B1/Parte 1); não existe `valorFrete` em lugar nenhum. `transportadora` é texto livre sem CNPJ/RNTRC. `focus-nfe.ts` manda `valor_frete: "0"` LITERAL e não tem grupo de transportadora nem volumes/peso no payload.

**Pesquisa.** Grupo `transp` da NF-e 4.0 tem `transporta` (dados da transportadora) e `vol` (volumes, peso) — `modFrete` é só um elemento desse grupo ([DataFrete](https://www.datafrete.com/tipos-de-frete-na-nf-e-modalidades-codigos-e-novas-exigencias-fiscais/)).

**Proposta.** `model Transportadora` (mesmo formato de `Fornecedor`, já nascendo com `documento`). `Orcamento.transportadoraId` (FK opcional, convive com texto — padrão já estabelecido) + `valorFrete Decimal?` (null=hoje). `Entrega.volumes`/`pesoBrutoKg`/`especieVolume`/`transportadoraId`. Decisão explícita necessária: frete entra na base de comissão? (sugestão: não, mesmo espírito de `BaseComissao.LUCRO`).

### F4 — Estoque sem lote/validade — schema já cita exigência que não consegue atender
**Custo estimado:** 🟡 Médio — campos aditivos opt-in em models existentes, mais 1 enum novo fechado+`OUTRO` (`certificacao`) e lógica de snapshot de lote entre entrada e saída (reaproveita padrão de snapshot já usado no repo).

**O que falta.** `MovimentacaoEstoque` não tem lote nem validade. `Cliente.preferenciasProducao` usa como exemplo real "não aceita variação de tom entre lotes" — o sistema registra a EXIGÊNCIA e não tem onde registrar de qual lote saiu o pedido. Também sem alerta de validade (mecânica já existe em `alerta-estoque.ts`, só falta o dado) e sem certificação FSC.

**Pesquisa.** Rastreabilidade por lote é exigência regulatória (Anvisa RDC 275/2002, RDC 655/2022) pra quem fornece indústria alimentícia/farma. Cadeia de custódia FSC é aplicável a gráficas/rotuladores, com código de licença exibido na peça ([SGS](https://www.sgs.com/pt-br/services/certificacao-de-cadeia-de-custodia-fsc-na-industria-grafica)).

**Proposta.** `ItemGrafica.controlaLote Boolean @default(false)` opt-in. `MovimentacaoEstoque.lote`/`validade` preenchidos na ENTRADA_COMPRA, copiados como snapshot na SAIDA_PRODUCAO (liga lote→pedido de graça). `ItemGrafica.certificacao` enum fechado+OUTRO. Não fazer agora: FEFO/apropriação automática — só registro/rastro.

### F5 — Arte é uma só por orçamento/pedido; não existe arte por item
**Custo estimado:** 🟡 Médio — 1 model novo (`ArteItem`) com poucos campos e FK direta pra `OrcamentoItem`, sem workflow de múltiplas etapas, mais 1 valor novo de enum (`ADD VALUE`).

**O que falta.** `Orcamento.arteUrl`/`Pedido.arteUrl` são um arquivo único no cabeçalho — `OrcamentoItem` não tem campo de arte nenhum. Quebra no caso mais comum do próprio perfil-piloto: 6 SKUs de rótulo num pedido só recebem UMA aprovação, e o preflight de DPI/sangria checa o arquivo único contra a geometria de um pedido com itens de dimensões diferentes.

**Pesquisa.** (inferência minha, sustentada por 2 fatos do próprio repo) — `ArquivoArmazenado.referenciaId` já documenta `orcamentoItemId` como referência possível (a camada de storage previu isso); `OrcamentoItemTinta` já prova o formato "anexo por item".

**Proposta.** `model ArteItem { orcamentoItemId, pedidoId?, url, versao Int @default(1), aprovadaEm?, comentarioCliente?, preflightAvisos Json? }`. `Pedido.arteUrl` continua existindo (legado, nunca removido). Gate de avanço vira "toda `ArteItem` aprovada OU nenhuma existe" — zero mudança pra quem não usa. `TipoArquivoArmazenado.ARTE_ITEM` novo.

### F6 — Gráfica não tem onde cadastrar a própria chave PIX / dados de recebimento — **CONSTRUÍDO 2026-08-31 (rodada 18)**
**Custo estimado:** 🟢 Barato — a própria proposta se autodescreve como "achado mais barato do relatório": campos aditivos em `Grafica` reaproveitando a tela `/configuracoes/identidade` que já existe e já é auditada.

**Status:** `Grafica.chavePix`/`tipoChavePix` (`enum TipoChavePix`)/`favorecidoPix`/`dadosBancarios`, editáveis em `/configuracoes/identidade` (novo Card "Dados para pagamento", com auditoria — só o rótulo do tipo de chave é logado, nunca o valor). Impresso no PDF do orçamento (sempre que preenchido, independente do status) e exibido em `/o/[token]` só depois de `APROVADO`. Zero validação de formato, zero automação de conciliação — exatamente o escopo combinado.

**O que falta.** `Grafica` tem logo/cor/contato — zero dado de recebimento. Ao mesmo tempo `FormaPagamento.PIX` existe no lançamento, `CondicaoPagamento` gera `ContaReceber`, e `/o/[token]` deixa o cliente aprovar SOZINHO sem login. O fluxo termina exatamente onde o dinheiro deveria começar. Achado mais barato e mais universal do relatório — afeta 100% dos tenants, toda venda.

**Pesquisa.** (inferência minha — consequência direta de existir link público de aprovação sem nenhum dado de pagamento no documento).

**Proposta.** Em `Grafica` (identidade comercial, não `DadosFiscaisGrafica`): `chavePix`/`tipoChavePix` (enum fechado+OUTRO)/`favorecidoPix`/`dadosBancarios` (texto livre). Editável em `/configuracoes/identidade` (já existe, já auditada). Impresso no PDF e exibido em `/o/[token]` só quando preenchido. Nunca validar a chave, só exibir texto.

### F7 — Item de orçamento tem 2 dimensões; caixa/acrílico/livro têm 3 — **CONSTRUÍDO 2026-08-31 (rodada 19)**
**Custo estimado:** 🟢 Barato — campos `Decimal?` aditivos em `OrcamentoItem` (model já existente), a própria proposta diz "risco zero de mudar preço de ninguém" (ignorados por todos os motores hoje).

**O que falta.** `OrcamentoItem` só tem `larguraCm`/`alturaCm`. Sem profundidade/espessura — gráfica de embalagem não consegue registrar "caixa 20×15×10", corte a laser não registra espessura da chapa no ITEM (só existe do lado da matéria-prima). Distinto do A11/Parte 1 (que trata a mesma geometria pelo lado do CUSTO/nesting) — aqui é sobre conseguir registrar o que foi vendido.

**Proposta.** `OrcamentoItem.profundidadeCm`/`espessuraMm Decimal?` — opcionais, ignorados por 100% dos motores atuais (risco zero de mudar preço de ninguém). Sempre visíveis no formulário (mesma decisão do A12/Parte 5). `espessuraMm` em milímetro (chapa é vendida em mm no Brasil), não cm.

**Status:** construído exatamente como proposto — campos aditivos, fiação completa em todos os pontos de escrita (criar/editar/duplicar item, opção alternativa) e exibição (resumo interno, link público, PDF de orçamento e de ordem de produção). Confirmado por `git diff` que `src/lib/pricing/` não foi tocado.

### F8 — Sem onde registrar cor especial/Pantone — só a QUANTIDADE de cores
**Custo estimado:** 🟡 Médio — 2 models novos (`CorEspecialCliente`/`OrcamentoItemCor`), mas com relações diretas e simples seguindo um padrão já estabelecido no repo (`OrcamentoItemHotStamping`), sem tocar o motor de preço.

**O que falta.** Todo campo de cor no schema é um número (`corFrente`/`numeroCoresFlexo`/`coresRotulo`) — nenhum diz QUAIS cores. Cor especial é simultaneamente tinta que se mistura por fórmula, clichê/tela a mais, e o critério nº1 de aprovação/reclamação do cliente. Repetição de pedido não carrega a receita de cor.

**Pesquisa.** (inferência minha, sustentada pelo desenho interno — o produto já cobra por cor especial via `ConfiguracaoClicheEtiqueta`/`Flexografia`, só o identificador da cor ficou de fora).

**Proposta.** `model CorEspecialCliente { graficaId, clienteId?, nome, referencia ("PANTONE 485 C"), sistemaCor (enum fechado+OUTRO), formulaMistura? }` — biblioteca de cor da marca do cliente. `model OrcamentoItemCor { orcamentoItemId, corEspecialId?, nomeDeclarado }` (N:1, mesmo padrão de `OrcamentoItemHotStamping`). Nunca toca o motor — só descritivo, copiado no "Pedir de novo".

### F9 — `SegmentoGrafica` não cobre segmento que o motor já atende, e é mono-valorado — **CONSTRUÍDO 2026-08-31 (rodada 19)**
**Custo estimado:** 🟢 Barato — `ADD VALUE` num enum já existente mais um campo array aditivo (`Grafica.segmentosSecundarios`) usando o mesmo enum, sem model nem enum novo.

**Status:** os 5 valores + `Grafica.segmentosSecundarios[]` construídos, editável em `/configuracoes/identidade` (checkbox multi-select). Consumo aditivo real implementado em `dados-exemplo.ts`: catálogo extra dos segmentos secundários é criado JUNTO do catálogo do segmento principal (nunca substitui), o orçamento de demonstração continua usando só o pacote principal. Regra de ouro respeitada — nada usa `segmentosSecundarios` pra esconder/restringir.

**O que falta.** Enum não tem `SERIGRAFIA` nem `FLEXOGRAFIA` — apesar de ambos terem `ModeloCalculo` próprio. Faltam também BORDADO, PAPELARIA_CONVITES, SINALIZACAO_ADESIVAGEM. Mais grave: `Grafica.segmento` é campo ÚNICO, mas gráfica real quase nunca é uma coisa só (offset + gráfica rápida + comunicação visual no mesmo CNPJ é a norma).

**Proposta.** `ADD VALUE` puro (aditivo): SERIGRAFIA, FLEXOGRAFIA, BORDADO, PAPELARIA_CONVITES, SINALIZACAO_ADESIVAGEM. Adicionar `Grafica.segmentosSecundarios SegmentoGrafica[]`, consumido só pelo que é ADITIVO (dados de exemplo, categorias sugeridas) — mantendo `segmento` como principal, zero migração de comportamento. **Regra de ouro:** nada que RESTRINJA (esconder card/link — ver correção de E1/E2 acima) deve olhar pra `segmento`, que o próprio schema documenta como "descritivo, nunca restritivo".

---

**Como usar esta Parte 7:** ainda não passou pela reconciliação que as Partes 1-6 tiveram (thread principal lendo achado por achado contra o código antes de aceitar). Antes de construir qualquer um destes, vale uma verificação rápida contra o código atual — pesquisa em haiku é mais rápida mas também mais sujeita a imprecisão de detalhe (nome de arquivo/linha pode ter mudado ou estar levemente errado).

---

## Resumo de custo — achados pendentes

Classificação de custo/esforço aplicada a todo achado ainda não marcado `CONSTRUÍDO` (inclui o restante pendente dos `PARCIALMENTE CONSTRUÍDO`), ao longo do documento inteiro (Partes 1-7). Critério: 🟢 Barato = campo aditivo nullable em model existente, `ADD VALUE` em enum existente, ou trabalho de seed/conteúdo; 🟡 Médio = 1 model novo simples ou 1 enum novo fechado+`OUTRO`, ou extensão moderada de tela existente; 🔴 Caro = 2+ models novos com relação não-trivial, workflow completo novo, área sensível (financeiro/CAS/autenticação), motor de cálculo novo, ou proposta que expressa incerteza/decisão pendente.

**Atualização 2026-08-31 (rodada 17):** 10 dos 32 🟢 Barato construídos — Parte 7 A1/A2/A3/A4/A5 (equipamentos) + B1/B2/B3/B4/B5 (matérias-primas, seed). B6 (materiais de bordado) ficou de fora de propósito, pra fechar a rodada em exatamente 10; é o próximo candidato natural.

**Atualização 2026-08-31 (rodada 18):** +1 — Parte 7 F6 (chave PIX/dados de recebimento da gráfica).

**Atualização 2026-08-31 (rodada 19):** +8 — Parte 7 B6/C1/C2/C3/C4/F7/F9 + Parte 6 A9 (restante, com ressalva COBRANCA). Restam 13 🟢 Barato pendentes de todo o documento.

**Contagem total (87 achados classificados, 68 ainda pendentes):**

| Custo | Contagem |
|---|---|
| 🟢 Barato | 13 (19 construídos) |
| 🟡 Médio | 29 |
| 🔴 Caro | 26 |

### Candidatos 🟢 Barato por Parte — próxima rodada de construção

**Parte 1 — Orçamento + Catálogo**
- B4 — Prazo é por orçamento, nunca por item

**Parte 3 — Compras**
- A2 — Frete/IPI/desconto no custo de aquisição (rota curta)
- A10 — Alçada de valor + segregação de funções em Compras
- A11 — OTIF/desempenho de fornecedor (depende de A7/A8 Médios)

**Parte 4 — Financeiro**
- A4 — Fluxo de caixa projetado
- A10 — Aviso de alíquota efetiva do Simples acima do `impostoPercent` configurado

**Parte 6 — Configurações**
- A8 (restante) — Identidade/contato por filial
- A10 — Onboarding de tenant (nada além do que A6 já cobre)
- A11 — `UnidadeDimensao.POLEGADA` (a própria proposta recomenda NÃO construir agora — over-engineering sem sinal real de uso)

**Parte 7 — Completude de cadastro**
- E1/E2 — Esconder card/menu de Produção por USO real (não por segmento — correção Opus)
- E3 — Banner de segmento pendente no onboarding (checar contra o código antes)
- E4 — Pacotes de dados de exemplo por segmento
