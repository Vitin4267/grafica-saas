# Auditoria do motor de preço — cobertura completa (2026-09-13)

> **RECONCILIADO 2026-09-18** — os 19 achados abaixo (7🔴+12🟡) foram todos
> construídos no mesmo commit `1684868` ("Resolve os 19 achados da auditoria
> do motor de preco e N24-N31 da Parte 9"), ainda 2026-09-13, algumas horas
> depois deste relatório. O doc só não tinha os marcadores — achado aberto
> nesta lista é um doc que apodreceu, não um bug real pendente (mesmo padrão
> já visto em `auditoria-abrangencia-modulos.md`).

Complementa `auditoria-motor-m2-offset-2026-09-12.md` (fatia M2+OFFSET, 10 achados, todos já construídos). Esta rodada cobre **todo o resto** do motor: os 8 modelos de custo-base que nunca tinham passado pela lente, a camada de acabamento, a orquestração (`precificar.ts`/`carregar.ts`/`validar.ts`) e a camada de orçamento acima (`orcamento-precificacao.ts` e vizinhos).

Fatias A e B foram auditadas por agentes Opus 5 dedicados; C e D pelo fio principal (os dois agentes dessas fatias morreram no limite de gasto da conta antes de gravar o relatório). Os achados A1, B1, B2, B10 foram reverificados na mão contra o código; C e D são de primeira mão.

## Resumo executivo

A aritmética de bancada continua sólida em todos os motores — Decimal puro, unidades coerentes, custo fixo não escalando com tiragem, nenhum `Number()` no meio de cadeia. **Todos os 19 achados são de junção**, o mesmo diagnóstico da rodada anterior, agora confirmado em escala: dado cadastrado que não chega ao motor, trava que existe num modelo e não no gêmeo, campo que significa coisas diferentes em cada ponta, e piso/base aplicado sobre o conjunto errado.

**Total: 7 🔴 + 12 🟡.** O mais grave (A1) deixa um modelo de cálculo inteiro inoperante em produção hoje.

Três padrões transversais valem mais que a lista individual:

1. **Trava que não foi replicada no gêmeo** — A2 (flexo escolhe bobina pelo critério que o Offset já corrigiu), B3 e B10 (custo zero barrado em 6 motores e liberado em 2), C1 (faixa de gramatura validada no Offset e não no Editorial). Toda vez que a rodada anterior corrigiu algo, o irmão ficou para trás.
2. **Teste cristalizando o critério errado** — A2, A3 e B4 têm teste verde afirmando o comportamento defeituoso. Corrigir o motor exige corrigir o teste junto, e o CI verde não vai avisar.
3. **CI verde sobre caminho que o app não consegue produzir** — A1: o teste de integração cria, via Prisma, um estado que nenhuma tela grava. É o mesmo padrão do bug de `/usuarios` que passou meses despercebido.

---

## 🔴 Crítico

### 🔴 A1 — o motor DIGITAL exige `FormatoFolha` numa MATERIA_PRIMA, e nenhuma tela grava isso: todo orçamento DIGITAL morre em `MATERIAL_SEM_FOLHA` — CONSTRUÍDO (commit 1684868, 2026-09-13)
**Princípios 1 e 2** · `src/lib/pricing/carregar.ts:440-464` · `digital.ts:54` · `validar.ts:194-199`

`carregarContextoPrecificacao` monta `contexto.digital.folhas` a partir de `papelDigital.formatosFolha`, onde `papelDigital` é obrigatoriamente `itemCatalogo.tipo = "MATERIA_PRIMA"` (`carregar.ts:445`). Mas os únicos escritores de `FormatoFolha` no app são `catalogo/[itemGraficaId]/actions.ts:417` e `:819`, sempre com `itemGraficaId` = o item sendo configurado; esse formulário só renderiza quando `itemCatalogo.tipo === "PRODUTO"` (`page.tsx:353`), e dentro dele o `FormatosFolhaEditor` só aparece nos ramos OFFSET e CHAPA_RIGIDA. `seed.ts:178` e `dados-exemplo.ts:184` também gravam em PRODUTO. **Não existe caminho no sistema que crie um formato de folha numa matéria-prima.**

Cenário: gráfica rápida cadastra "Couché 250g" (matéria-prima, R$1,20/folha), configura "Cartão de visita" como DIGITAL, escolhe a impressora, monta o orçamento de 1.000 cartões 9×5 cm e escolhe o papel. `contexto.digital.folhas = []` → `MATERIAL_SEM_FOLHA`. O preço nunca sai, e a dica da tela manda o usuário numa "aba 'Formatos de folha' do papel" que não existe (`EditarOrcamentoForm.tsx:842-845`). O correto seria nUp=21 numa SRA3 → 48 folhas → R$57,60 de papel + 48 cliques. **Agravante:** `itens.precificacao-digital.test.ts:81` cria `formatosFolha` direto via Prisma na matéria-prima — estado que o app não produz, então o CI fica verde sobre um caminho quebrado.

### 🔴 A2 — a FLEXOGRAFIA escolhe a bobina só pelo `custoMaterial`, ignorando que a bobina decide a metragem e, com ela, toda a rodagem — CONSTRUÍDO (commit 1684868, 2026-09-13)
**Princípios 2 e 3** · `src/lib/pricing/flexografia.ts:108-110` (vs. `offset.ts:184, 203-205`)

O `reduce` compara `custoMaterial` (≈ metragem × largura nominal), mas a bobina escolhida também fixa `nUp` → `numRevolucoes` → `metragemBoa`, base de `custoRodagem` (linhas 126-133). Rodagem é R$ por metro linear, indiferente à largura — minimizar o material favorece sistematicamente a bobina estreita, que roda muito mais metro. É o mesmo defeito do achado 5 da rodada anterior, corrigido no Offset (que compara `custoBaseCandidato` = papel + chapas + rodagem) e nunca replicado aqui.

Cenário: etiqueta 0,10 × 0,05 m, Q=50.000, 1 cor. Passo 0,30 m, largura 0,50 m, R$0,80/m de rodagem, 80 m de acerto, perda 5%, material R$4,00/m². Bobina A (0,46 m) → nUp 3, 5.330,1 m, material R$9.807,39 + rodagem R$4.264,08 = **R$14.071,47**. Bobina B (0,30 m) → nUp 2, 7.955 m, material R$9.546,00 (R$261 mais barato, **então o motor escolhe B**) + rodagem R$6.364,00 = **R$15.910,00**. Entrega **R$1.838,53 a mais (13%)** e consome 2.625 m de bobina a mais. **Agravante:** `flexografia.test.ts:68-82` cristaliza o critério errado ("escolhe a de menor custoMaterial resultante").

### 🔴 A3 — CHAPA_RIGIDA: a geometria da chapa vem do PRODUTO e o preço vem de outro registro, e o motor escolhe de propósito o maior formato pagando um preço só — CONSTRUÍDO (commit 1684868, 2026-09-13)
**Princípios 2 e 3** · `src/lib/pricing/chapa-rigida.ts:77, 90-91` · `carregar.ts:609-621`

`contexto.folhas` é `item.formatosFolha` (lista, do **PRODUTO**) e `precoPorChapa` é `item.chapa.precoCompra` (escalar, de **outra** `ItemGrafica`). Nada liga um ao outro: `FormatoFolha` não tem coluna de preço (`06-catalogo.prisma:738-750`) e nada valida que os formatos do produto são os formatos da chapa escolhida. Pior, o critério de escolha é `imposicao.nUp > melhor.imposicao.nUp` — sempre prefere a chapa **maior**, e cobra por ela o preço único cadastrado.

Cenário: produto "Placa ACM 4mm" com dois formatos (1,00×2,00 e 1,22×2,44), chapa vinculada "ACM 4mm 1000×2000 — R$180/chapa". Peça 0,50×0,70 m, Q=100. nUp(1,00×2,00)=3; nUp(1,22×2,44)=6 → escolhe a 2,44, `nChapas=ceil(100/6)=17`, `custoChapas = 17 × 180 = R$3.060`. A chapa 1,22×2,44 custa ~R$268 na prática → o certo seria R$4.556 (**faltam R$1.496, 33%**); e se a gráfica só compra a de 1,00×2,00, o certo seria `ceil(100/3)=34 × 180 = R$6.120` (**erra R$3.060, 50%**). Não existe leitura em que o número atual esteja certo. **Agravante:** `chapa-rigida.test.ts:65` fixa a premissa errada.

### 🔴 B1 — `MaquinaBordado.custoHoraMaq` é validado, gravado e prometido na tela, mas nunca chega ao motor — CONSTRUÍDO (commit 1684868, 2026-09-13)
**Princípios 2 e 3** · `src/lib/pricing/carregar.ts:147-151` · `tipos.ts:352-356` · `bordado.ts:32-43`

`carregarParametrosMaquinaBordado` seleciona 3 campos e **descarta `custoHoraMaq`**, que `maquinas/bordado/actions.ts:103-123` valida e grava e que o schema tem em `04-maquinas-equipamentos.prisma:190`. O texto de ajuda manda o dono fazer exatamente a coisa errada: *"Preencha só se quiser separar o custo de hora-máquina (energia, manutenção) do custo por ponto"*.

Cenário: bordadeira com R$0,20/mil pontos ("só a linha, o resto separei") + R$40/h no campo separado. 1.000 bonés × 8.000 pontos → `custoPontos = R$1.600` e **R$0,00 de hora-máquina**. A 800 pontos/min a máquina roda ~166 h = **R$6.667 de custo real fora do orçamento** — vendido a ~1/5 do custo de máquina. Quem NÃO seguiu o hint não sente nada: é um campo-armadilha que só quebra quem lê a ajuda.

> **Ressalva de escopo (verificada no fio principal):** consertar não é passar o campo adiante. `PedidoBordado` não tem tempo nenhum (nem minutos, nem velocidade em pontos/min), então não há o que multiplicar por R$/h. O conserto real é (a) derivar tempo de `numeroPontos ÷ velocidade`, exigindo um campo novo na máquina, ou (b) remover o campo e o hint. Isso muda o tamanho do item na triagem.

### 🔴 B2 — TEMPO_MAQUINA valida a quantidade e nunca a usa; a tabela de faixas recalcula justamente a quantidade — CONSTRUÍDO (commit 1684868, 2026-09-13)
**Princípios 1 e 3** · `src/lib/pricing/tempo-maquina.ts:31-43` · `src/lib/orcamento-faixas-quantidade.ts:81-83`

`calcularTempoMaquina` exige `quantidade` (`validar.ts:279`) e depois não a lê em lugar nenhum — custo = tempo + metros + setup, tudo "por job". Isso é coerente com a UI ("produzir este item inteiro (todas as peças)"), mas `montarDadosParaFaixa` copia `tempoEstimadoMin`/`metrosCorte`/`horasEstimadas` **verbatim** e troca só `quantidade`, e `adicionarFaixaQuantidadeOrcamento` reprecifica com o mesmo motor. (`numeroCliques`/`numeroSetups`/`numeroPontos` copiados verbatim estão certos — são por folha/por tela/por peça.)

Cenário: placa de acrílico em router, 50 peças, 200 min, R$120/h + R$50 de setup → custoBase R$450, unitário ~R$13,50. O vendedor adiciona a faixa "200 unidades": o motor devolve **os mesmos R$450**, unitário ~R$3,38 — a máquina real rodaria ~800 min = R$1.650. A tabela comparativa mostrada ao cliente vende 200 peças por **27% do custo de máquina**. Vale igual pro corte opcional de CHAPA_RIGIDA (`chapa-rigida.ts:109-116`) e pro acabamento por HORA.

### 🔴 B3 — acabamento com preço de compra em branco custa R$0,00 e nada avisa — é o único custo do motor sem essa trava — CONSTRUÍDO (commit 1684868, 2026-09-13)
**Princípios 1 e 3** · `src/lib/pricing/acabamento.ts:60-67` · `carregar.ts:672`

`custoUnitario: Number(item.precoCompra ?? 0)` e `calcularCustoAcabamento` aceita 0 sem reclamar. Todo motor irmão barra o mesmo estado com `CUSTO_INVALIDO` (`validar.ts:78` M2, `:114` Offset, `:203` Digital, `:235` Revenda, `:260` Bordado, `:371` Chapa) — a camada de acabamento é a exceção. `precoCompra` é nullable e opcional no cadastro, e a tela mostra a ausência num `Alert variant="success"` **verde** ("Custo unitário usado na fórmula = não definido"), que um público leigo lê como "ok".

Cenário: "Laminação BOPP" cadastrada como SERVICO, base M2, setup e mínimo 0, `precoCompra` nunca preenchido. 20 banners 3,00×1,50 m → `qtdBase = 20 × 3,04 × 1,54 = 93,6 m²` × R$0,00 = **R$0,00**, e a linha ainda sai no PDF como acabamento incluído. A R$12/m² são **R$1.123 comidos em cada orçamento**, repetidamente, sem nenhum sinal.

*(Nota: o guard de `orcamento-precificacao.ts:623-648` — verificado — bloqueia corretamente acabamento M2/METRO_LINEAR sem geometria e HORA sem horas. Ele simplesmente não cobre `precoCompra = 0`, que é este buraco.)*

### 🔴 C1 — EDITORIAL não valida faixa de gramatura; o Offset valida, e o campo é digitação livre sem teto — CONSTRUÍDO (commit 1684868, 2026-09-13)
**Princípios 1 e 3** · `src/lib/orcamento-precificacao.ts:436-446` · `src/lib/pricing/validar.ts:314-360` (ausência) · `SeletorItemOrcamento.tsx:961-978`

O guard de EDITORIAL checa `gramaturaMioloGm2`/`gramaturaCapaGm2` apenas `Number.isFinite(...) && > 0`. `validarPedidoEditorial` também não checa faixa. O gêmeo OFFSET valida `gramaturaMinGm2 <= g <= gramaturaMaxGm2` (configurável por tenant, default 30-500, achado N13) e `ContextoOffset` carrega os quatro campos de faixa/origem — **`ContextoEditorial` não tem nenhum deles** (`tipos.ts:411-416` vs `:96-118`). Os dois inputs da tela são `type="number" min={1}` **sem `max`**, nos dois formulários (adicionar e editar). E `resolverPrecoPapel` nunca lança por gramatura exótica — cai em silêncio na linha mais próxima (documentado em `papel.ts:12-15`).

Cenário: livro A5 (0,148 × 0,21 m = 0,03108 m²/página), 200 páginas de miolo, cadernos de 16 → 13 cadernos → 208 páginas efetivas → 104 folhas. Tabela do papel: 75g R$8,50 · 90g R$8,00 · 120g R$7,40. Gramatura correta 90 → `pesoMiolo = 104 × 0,03108 × 90/1000 = 0,2909 kg` → R$2,33/livro → **R$2.327 em 1.000 livros**. O dono digita **9** em vez de 90: `resolverPrecoPapel(tabela, 9)` devolve a linha de 75g (R$8,50) sem erro, e `pesoMiolo = 0,0291 kg` → R$0,247/livro → **R$247**. São **R$2.080 de papel de miolo a menos** num único orçamento, sem nenhum aviso — e a capa tem exatamente o mesmo buraco, pelo mesmo caminho. Na direção oposta (900 em vez de 90) o orçamento sai ~R$21.500 e a gráfica perde a venda sem entender por quê.

---

## 🟡 Médio

### 🟡 A4 — `numeroCliques` passou a ser "cliques por FOLHA" (achado N4) mas todo texto de tela continua dizendo "por peça", e não há teto — CONSTRUÍDO (commit 1684868, 2026-09-13)
**Princípios 1 e 2** · `src/lib/pricing/digital.ts:81-83` · `validar.ts:184-193` · `EditarOrcamentoForm.tsx:508-521`

`custoCliques = numeroFolhas × numeroCliques × custoPorClique` — o campo multiplica FOLHAS. A tela diz três vezes o contrário ("1 clique por peça"). `validarPedidoDigital` só exige inteiro ≥ 1, sem teto nem sanidade contra `numeroFolhas`. Cenário: 1.000 cartões em SRA3 → nUp 21, 48 folhas. O usuário informa 48 (o total que calculou) → `48 × 48 × R$0,35 = R$806,40` em vez de **R$16,80**, 48× a mais. Só não morde hoje porque A1 impede qualquer orçamento DIGITAL de fechar.

### 🟡 A5 — `paginasPorCaderno` aceita qualquer inteiro ≥ 1, inclusive ímpar: o motor passa a cobrar meia folha física por exemplar — CONSTRUÍDO (commit 1684868, 2026-09-13)
**Princípios 1 e 3** · `src/lib/pricing/validar.ts:345-351` · `editorial.ts:60-67` · `configuracoes/actions.ts:432`

Um caderno é sempre múltiplo de 4 páginas (uma folha dobrada). O validador só exige inteiro ≥ 1. Com valor ímpar, `paginasEfetivas` fica ímpar e `numFolhasMiolo = paginasEfetivas / 2` vira fracionário. Cenário provável do leigo: lê "páginas por caderno" como "páginas por folha" e digita **2** — aí `ceil(numeroPaginas/2) × 2` nunca arredonda pra caderno nenhum, e um miolo de 100 páginas é orçado como 100 em vez das 112 reais (7 cadernos de 16): 6 folhas a menos + 12 páginas a menos de impressão por exemplar = **R$892 a menos numa tiragem de 1.000**. Precisa da mesma trava de faixa que `validarPerdaPercent` ganhou no achado 2 — aqui, múltiplo de 4.

### 🟡 B4 — o piso `custoMinimo` do job é comparado contra um total que inclui a peça em branco, então nunca protege o serviço — CONSTRUÍDO (commit 1684868, 2026-09-13)
**Princípios 2 e 3** · `src/lib/pricing/setup-por-peca.ts:40-43` · `bordado.ts:40-43`

O hint diz *"Piso — se **setup + variável** ficar abaixo disso, cobra este valor"*, mas o código compara `custoMinimo` contra `setup + variável + substrato`. Cenário: serigrafia com piso de R$120 (o mínimo pra ligar a máquina), 5 camisetas premium a R$25. Substrato R$125, serviço R$40 + R$10 = R$50. `max(120; 40+10+125) = 175` → o piso **não age**, e a gráfica cobra R$50 de serviço onde configurou R$120 de mínimo. Quanto mais cara a peça em branco, mais o piso some. **Agravante:** `setup-por-peca.test.ts` trava o comportamento atual — ou o teste ou o hint está errado.

### 🟡 B5 — a base M2/METRO_LINEAR do acabamento significa uma coisa diferente em cada motor, pra exatamente a mesma peça — CONSTRUÍDO (commit 1684868, 2026-09-13)
**Princípios 2 e 3** · `src/lib/pricing/acabamento.ts:14,35` · `m2.ts:331-332` · `precificar.ts:160`

`calcularQtdBase` recebe `larguraEfetivaM/alturaEfetivaM` sem saber de onde vêm: M2/DTF mandam **com margem de segurança** (`w+2s`, s=0,02), OFFSET/FLEXO **com sangria** (~0,003), DIGITAL/CHAPA/EDITORIAL **nominal**. Cenário: mesma "Laminação" (R$15/m²) na mesma peça 1,00×0,50 m, 500 un. Produto M2: `500 × 1,04 × 0,54 = 280,8 m²` = R$4.212. Produto DIGITAL: `250 m²` = R$3.750. **R$462 de diferença pela mesma peça física**, decidida só pelo motor do produto. Em METRO_LINEAR o erro é estrutural: bainha/ilhós são feitos na peça acabada (perímetro 3,00 m), e o M2 cobra 3,16 m — +53% numa etiqueta 0,10×0,05.

### 🟡 B6 — `horasEstimadas` é um número só por item, e todo acabamento por HORA cobra as mesmas horas — CONSTRUÍDO (commit 1684868, 2026-09-13)
**Princípios 1 e 2** · `src/lib/pricing/acabamento.ts:41-50` · `precificar.ts:161`

`ContextoAcabamento.horasEstimadas` vem de um único `OrcamentoItem.horasEstimadas`, e `calcularQtdBase` devolve esse mesmo número pra **cada** config HORA anexada. Cenário (do próprio comentário do código): item com "Instalação" R$50/h e "Criação de arte" R$80/h, `horasEstimadas = 4` (estimadas pra instalação) → cobra 4h nas duas: R$200 + R$320 = **R$520**, sendo que as 4h de arte nunca foram estimadas. Não há combinação certa de um número só.

### 🟡 B7 — "Número de setups" tem dois textos de ajuda que se contradizem e é o único campo que decide o custo de tela — CONSTRUÍDO (commit 1684868, 2026-09-13)
**Princípios 1 e 3** · `src/lib/pricing/setup-por-peca.ts:36` · `validar.ts:218-224` · `SeletorItemOrcamento.tsx:631-640`

`custoSetup = numeroSetups × custoPorSetup`, com `custoPorSetup` rotulado "Por tela/matriz/arte". No mesmo campo, o balão diz *"Cada arte diferente conta como 1 setup"* e o hint abaixo diz *"Quantas telas/matrizes/artes esta arte usa"* — em serigrafia os dois números diferem (1 arte de 4 cores = 4 telas), e nada deriva isso de uma contagem de cores que já existe em outros modelos. Cenário: serigrafia 4 cores, 300 camisetas, tela R$35. Seguindo o balão o vendedor digita 1 → R$35; o real são R$140. **R$105 por pedido.**

### 🟡 B8 — o nº de cores que paga o clichê de etiqueta é digitado duas vezes, em campos que ninguém compara — CONSTRUÍDO (commit 1684868, 2026-09-13)
**Princípios 1 e 2** · `src/lib/orcamento-etiqueta.ts:20-29` · `CamposEtiquetaOrcamento.tsx:309-320`

No mesmo formulário convivem "Quantidade de cores (clichês)" (o único que entra no preço) e "Cores rótulo"/"Cores contra-rótulo" (descritivos). Nenhum deriva do outro. Cenário: etiqueta 10×5 cm, clichê R$1,50/cm² → R$75/cor. O vendedor preenche "Cores rótulo 4 / contra-rótulo 2" (6 clichês reais) e deixa o campo de precificação em 4 → clichê sai **R$300 em vez de R$450**, em todo pedido dessa arte.

### 🟡 B9 — setup-por-peça e bordado classificam custo em categorias trocadas na previsão de custo do pedido — CONSTRUÍDO (commit 1684868, 2026-09-13)
**Princípio 2** · `src/lib/pedido-aprovacao.ts:267-274` e `:285-293`

O comentário do branch de setup-por-peça ainda diz *"sem conceito de material/substrato"*, escrito antes de `custoSubstrato` entrar no `custoBase`: o `custoBase` **inteiro** vira `{ chave: "impressao" }`. O irmão BORDADO faz o oposto — manda `custoPontos` pro bucket "material". Cenário: 500 camisetas a R$25 = R$12.500 de peça em branco lançados como custo de *impressão*; o mesmo pedido em bordado lançaria em *material*. Os relatórios por categoria ficam incomparáveis, e o dado pra acertar já existe (`metricas.custoSubstrato`, gravado por `precificar.ts:691-693`, nunca lido aqui).

### 🟡 B10 — setup-por-peça é o único motor com substrato que não barra substrato zerado — CONSTRUÍDO (commit 1684868, 2026-09-13)
**Princípios 1 e 2** · `src/lib/pricing/validar.ts:215-225` (ausência) vs `:203` e `:260`

`ContextoSetupPorPeca` (`tipos.ts:298-300`) não tem `materialFornecidoPeloCliente` e `validarPedidoSetupPorPeca` nem recebe contexto. Os gêmeos Digital e Bordado têm os dois: barram `<= 0` e só liberam quando a flag justifica. Confirmado do outro lado em `orcamento-precificacao.ts:604-606`, que zera o substrato do setup-por-peça **sem** marcar a flag (porque o tipo não a tem). Como `carregar.ts:484` faz `Number(item.precoCompra ?? 0)`, um produto SERIGRAFIA sem preço de compra passa direto. Cenário: 300 camisetas → `custoSubstrato = R$0`. A R$22 a camiseta são **R$6.600 de custo invisível**, com margem cheia sobre um custo que não existe. Em bordado o mesmo cadastro é rejeitado com mensagem clara.

### 🟡 C2 — o EDITORIAL descarta o aviso de "gramatura aproximada" que o Offset ganhou no achado N12 — justamente o sinal que denunciaria o C1 — CONSTRUÍDO (commit 1684868, 2026-09-13)
**Princípio 2** · `src/lib/pricing/carregar.ts:583-596` · `precificar.ts:569-580` · `orcamento-margem.ts:46-64`

`resolverPrecoPapel` devolve `{ precoKg, gramaturaBase, origem }`. No branch EDITORIAL de `carregar.ts`, `precoMiolo`/`precoCapa` têm **só `precoKg` lido** — `gramaturaBase` e `origem` são jogados fora. As `metricas` do branch EDITORIAL em `precificar.ts` não têm nenhum dos dois, e `lerAvisoGramaturaAproximada` (que a tela usa pra avisar o vendedor) só encontra `origemPrecoPapel` no breakdown de OFFSET. É exatamente o que o achado N12 construiu pro Offset, nunca replicado no gêmeo — e o Editorial resolve **dois** papéis por esse fallback, não um. Sem isso, o C1 é completamente invisível na tela.

### 🟡 D1 — a margem agregada do orçamento soma itens medidos contra bases de custo diferentes (com e sem overhead) — CONSTRUÍDO (commit 1684868, 2026-09-13)
**Princípios 2 e 3** · `src/lib/orcamento-margem.ts:88-92` e `:118-135`

`calcularMargemItemOrcamento` usa `breakdown.custoTotal` (que é `custoDireto × (1 + overhead)`, ver `compor.ts:57`) pros itens do motor avançado, e `precoCompra × quantidade × área` (**sem overhead**) pros itens SIMPLES. Por item isso é defensável — um item SIMPLES tem preço digitado à mão, sem componente de overhead. Mas `calcularMargemAgregadaOrcamento` **soma os dois numa única `margemPercent`**, e é esse número que a tela mostra contra `LIMIAR_MARGEM_ATENCAO = 15`.

Cenário: orçamento com dois itens de custo real idêntico (R$1.000 de custo direto cada) e preço R$1.200 cada, overhead 15%. O item SIMPLES mede contra R$1.000 → 16,7%; o item M2 mede contra R$1.150 → 4,2%. A margem agregada sai ~10,4% — um número que não descreve nem um item nem o outro, e que dispara (ou não) o alerta dependendo só da proporção de itens SIMPLES no orçamento.

### 🟡 D2 — `Cliente.margemPadraoOverride` não tem teto, e o erro só aparece ao orçar, apontando pro lugar errado — CONSTRUÍDO (commit 1684868, 2026-09-13)
**Princípio 1** · `src/app/clientes/actions.ts:172-184` · `src/lib/pricing/compor.ts:66`

`validarMargemPadraoOverride` rejeita negativo e não-numérico, mas **não tem limite superior** (a coluna é `Decimal(5,4)`, aceita até 9,9999). O único freio é `validarSomaEncargos` (`>= 0.85` lança), que roda **no orçamento**, não no cadastro.

Cenário: o dono cadastra um cliente com margem diferenciada `0.9` (quis dizer 90%). O cadastro salva sem reclamar. A partir daí **todo orçamento desse cliente** falha com *"A soma de margem + imposto + comissão + taxa financeira precisa ser menor que 85%"* — mensagem que aponta pra Configurações, onde não há nada errado. O culpado é um campo na ficha do cliente que a mensagem nem menciona. Não é cálculo errado (o sistema barra), é impossível de diagnosticar pro público-alvo. O `limiteCredito` logo abaixo tem a mesma forma e o mesmo buraco.

---

## Sem achados (lido e considerado correto)

- **`src/lib/pricing/editorial.ts`** — aritmética correta: `numFolhasMiolo = paginasEfetivas/2`, `pesoMioloKg` em kg, impressão por FACE, capa aberta = 2× largura + 2 orelhas, tudo × Q linearmente. As simplificações (lombada fora da capa, sem perda) estão documentadas como escopo deliberado.
- **`src/lib/pricing/revenda.ts`, `bordado.ts`, `setup-por-peca.ts`, `tempo-maquina.ts` (fórmulas)** — custo fixo 1× por job, variável × Q, unidades min/h e pontos/mil corretas. Os problemas são todos de entrada/piso.
- **`src/lib/pricing/acabamento.ts` (bases)** — FOLHA_IMPRESSA soma boas + perda, MILHEIRO/CENTO pró-rata, FIXO = 1, e cada base que exige dado ausente lança em vez de custar 0. O buraco é só o `precoCompra = 0` (B3).
- **`src/lib/gang-run.ts` — `ratearCustoSetup`** — o último item absorve a sobra de centavos, então a soma das fatias bate **exatamente** com `custoTotal`; nunca perde nem inventa centavo. Correto.
- **`src/lib/perda-fixa-producao.ts`** — agrega por `chaveFisicaMaterial` antes de validar contra o saldo, o que é exatamente certo: dois produtos do mesmo orçamento consumindo o mesmo material são somados antes da checagem.
- **`src/lib/cobertura-overhead.ts`** — base é `custoDiretoAgregado` (a base real sobre a qual o overhead incide), não receita bruta; divisão por zero tratada com `null`. Correto e bem documentado.
- **`comporPreco` chamado pelos 10 branches** — conferido um a um: todos os 10 passam `custoEmbalagem`, `custoFreteEstimado`, `custoFaca`, `margemLucroOverride` e `parametros`. (M2/OFFSET usam truthiness e os outros 8 usam `!== undefined`, mas `comporPreco` faz `?? paraDecimal(0)`, então o resultado é idêntico — inconsistência de estilo, custo zero.)
- **`margemLucroOverride`** — re-derivado **no servidor** de `cliente.margemPadraoOverride` nos 6 call sites, nunca lido do formulário. Respeita a regra permanente de "tudo sensível no backend".
- **`recalcularTotalOrcamento`** — piso de pedido aplicado UMA vez sobre a soma e só depois arredondado, na ordem certa (achado N3).
- **Conversões cm→m** — conferidas em `orcamento-precificacao.ts:657-658, 798-804, 829-830` contra as colunas Decimal do schema. Nenhuma unidade trocada.
- **Guards de `calcularItemOrcamento`** — cobertura muito boa: quantidade não-inteira/Infinity, dimensões negativas, planificadas em par, e um guard por modelo. Bloqueia corretamente acabamento M2/METRO_LINEAR sem geometria e HORA sem horas estimadas.

## Gap registrado (não é defeito — vai pro backlog)

- **DTF não aceita "material fornecido pelo cliente".** O bloco de `orcamento-precificacao.ts:596-614` zera o substrato de DIGITAL, setup-por-peça e BORDADO, e o comentário justifica excluir REVENDA e TEMPO_MAQUINA — mas não menciona DTF, que tem `custoSubstratoPorPeca` (a peça em branco, somada ao custo em `m2.ts:287,293`). O checkbox da tela também é gated a `usaModeloDigital || usaModeloSetupPorPeca || usaModeloBordado` (`SeletorItemOrcamento.tsx:698`). Front e back são **consistentes entre si**, então nada calcula errado hoje — mas estampar DTF em camiseta do cliente é o caso mais comum de DTF e não tem como ser orçado direito. Gap de cobertura, não bug.
