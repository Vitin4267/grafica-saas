# Auditoria do motor de preço — fatia M2 + OFFSET (2026-09-12)

Escopo: `src/lib/pricing/m2.ts`, `offset.ts`, `compor.ts`, `papel.ts`, `imposicao.ts`, as partes M2/OFFSET de `validar.ts`, mais leitura de contexto (`carregar.ts`, `precificar.ts`).

## Resumo executivo

A aritmética "de bancada" dos dois motores está sólida (Decimal em toda cadeia, unidades coerentes, nenhum `number` solto no meio da conta). Os problemas estão nas **junções**: o desconto de work-and-turn é dado nas chapas mas não é pago nas folhas (2× de papel a menos), a sobreposição de emenda é cadastrada e nunca entra no cálculo, o arredondamento por unitário desfaz o arredondamento comercial que veio logo acima, e "Perda padrão (%)" é gravada como fração sem nenhuma trava. Total: **4 🔴 + 6 🟡**. Nenhum achado abaixo repete os das rodadas 2026-09-02 / 2026-09-12 (N9, N11, N12, N20 conferidos).

---

## 🔴 Crítico

### 🔴 1 — `viraFolha` divide as chapas por 2 mas não corrige o nUp aproveitável: metade do papel some — **CONSTRUÍDO (commit 7fa750c, 2026-09-12)**
**Princípios 2 e 3** · `src/lib/pricing/offset.ts:93` e `offset.ts:127-136`

Em work-and-turn o MESMO jogo de chapas imprime frente e verso — é exatamente por isso que a linha 134 corta `nChapas` pela metade. Mas então metade dos slots da folha é verso, e cada folha rende `nUp/2` peças completas, não `nUp`. `folhasBoas = Math.ceil(Q / imposicao.nUp)` (linha 93) não sabe disso: o motor dá o desconto da chapa e ainda cobra o papel como se o jogo fosse duplo.

Cenário: pasta A4, Q=5.000, 4×4, prensa de 4 torres, folha 66×96 cm com nUp=8 (par), `viraFolha=true`. `entradas = 2` ✔, `nChapas = 4` ✔, mas `folhasBoas = ceil(5000/8) = 625` — o real é `ceil(5000/4) = 1.250`. A 250 g/m² (0,1584 kg/folha) e R$ 12/kg, faltam **625 folhas = R$ 1.188 de papel**, mais a rodagem das duas entradas calculada sobre a tiragem errada. Ou o desconto de chapa está errado, ou a contagem de folha está — os dois não podem estar certos ao mesmo tempo. Agravante: `offset.test.ts` só usa `viraFolha: false` — o caminho inteiro é não-testado.

### 🔴 2 — "Perda padrão (%)" é consumida como fração, sem nenhuma validação de faixa — **CONSTRUÍDO (commit 425da86, 2026-09-12)**
**Princípios 1 e 3** · `src/lib/pricing/validar.ts:65-109` (ausência) · `offset.ts:70,94` · `src/app/configuracoes/prensas/[id]/PrensaForm.tsx:150-162`

O campo é rotulado **"Perda padrão (%)"**, com ajuda dizendo "percentual de material que normalmente se perde", e é gravado cru (`Number(formData.get(campo))`, `actions.ts:108-114`, sem `/100`, sem teto) numa coluna `Decimal(5,4)` que aceita até 9,9999. `folhasPerda = ceil(folhasBoas × perdaPercent)` lê esse valor como fração.

Cenário: o dono digita `3` querendo 3% (é o público-alvo leigo; o campo Overhead tem o hint "ex: 0.15 = 15%", este **não tem nenhum**). Job com 10.000 folhas boas passa a ter 30.000 folhas de perda → 40.000 folhas de papel em vez de ~10.300. O papel quadruplica, o orçamento sai absurdo e nada avisa. `validarSomaEncargos` existe justamente pra barrar esse tipo de dedo-gordo nos outros percentuais (trava em 0,85) — `perdaPercent` é o único percentual do motor sem o gêmeo dessa trava. Correção mínima: validar `0 <= perdaPercent <= 1` em `validarPedidoOffset` (e o mesmo na flexo, que copia o campo).

### 🔴 3 — `sobreposicaoM` da emenda nunca entra na conta (nem no material, nem na impressão, nem na viabilidade) — **CONSTRUÍDO (commit c0620f7, 2026-09-12)**
**Princípios 2 e 3** · `src/lib/pricing/m2.ts:124-177` e `m2.ts:223`

`ConfiguracaoEmenda` tem dois campos, e `carregar.ts:288-293` carrega os dois. `custoPorMetroLinear` entra no custo; **`sobreposicaoM` só aparece no texto do aviso** (linha 200). Três consequências:

1. `numPaineis = ceil(a / wUtil)` ignora que cada painel precisa de `+sobreposicao` de largura. Banner 3,00 × 1,50 m, bobina 1,60 com refile 0,02 → `wUtil = 1,56`, `a = 3,04` → 2 painéis de 1,52 m. Com sobreposição de 0,05 m cadastrada, o painel real tem 1,57 m > 1,56 — **a divisão em 2 painéis é fisicamente impossível**, o certo seriam 3 painéis. O motor orça o impossível e cobra a menos.
2. `areaFaturavel` não inclui a área sobreposta (material real gasto).
3. `custoImpressao` (linha 223) usa `w'×h'` por peça, como se a peça não tivesse sido dividida: em 100 banners, 100 × 0,05 × 1,54 = **7,7 m² de impressão** não cobrados (R$ 192 a R$ 25/m²).

### 🔴 4 — o arredondamento do unitário desfaz o arredondamento comercial feito 10 linhas acima — **CONSTRUÍDO (commit 809470a, 2026-09-12)**
**Princípio 3** · `src/lib/pricing/compor.ts:85-97`

`arredondarParaIncremento` arredonda **pra cima** no incremento (R$ 0,10) — o comentário em `decimal.ts:18` diz explicitamente que é o último passo antes de exibir, e o ceil é o que protege a margem. A linha seguinte divide por Q e faz `toDecimalPlaces(2)` (HALF_UP, que arredonda **pra baixo**), e `precoFinal` é recalculado desse unitário. O ceil é cancelado.

Cenário: Q = 10.000 etiquetas, `precoBruto` R$ 1.234,47 → alvo R$ 1.234,50 → unitário 0,12345 → **0,12** → `precoFinal` R$ 1.200,00. Perdeu R$ 34,50, **2,8% do preço — mais que a taxa financeira inteira**, e o piso do incremento nunca foi respeitado. Pior: o breakdown gravado continua declarando `custoTotal` e `detalhes.overhead` cheios, então `cobertura-overhead-db.ts` soma no DRE um overhead que não foi cobrado. Caso extremo (tiragem alta de etiqueta barata): unitário abaixo de R$ 0,005 vira 0,00, `precoFinal` = 0 e o orçamento inteiro aborta em `PRECO_ABAIXO_DO_CUSTO`. Correção: arredondar o unitário **pra cima** em 2 casas, ou guardar o unitário com mais casas e deixar `precoFinal` ser a fonte.

---

## 🟡 Médio

### 🟡 5 — a folha é escolhida só pelo custo do papel, ignorando chapas e rodagem — **CONSTRUÍDO (commit 7fa750c, 2026-09-12)**
**Princípios 2 e 3** · `src/lib/pricing/offset.ts:123-125`

`reduce` compara só `custoPapel`, mas a folha escolhida define `nUp`, e `nUp` define se o desconto de work-and-turn vale (`nUp % 2 === 0`, linha 134) e quantas folhas a rodagem cobra. Cenário: folha A com nUp=9 e papel R$ 302; folha B com nUp=8 e papel R$ 310. Job 4×4 com `viraFolha` → A paga 8 chapas (nUp ímpar, sem desconto) = R$ 1.120; B paga 4 = R$ 560. O motor escolhe A por ser R$ 8 mais barata no papel e **entrega R$ 552 a mais no total**. O critério do `reduce` deveria ser o custo-base completo do candidato.

### 🟡 6 — `resolverPrecoPapel`: desempate contradiz a própria intenção, e aceita linha com preço zero — **CONSTRUÍDO (commit 70154af, 2026-09-12)**
**Princípios 1 e 3** · `src/lib/pricing/papel.ts:34-42`

(a) O comentário promete que o empate vai pra maior gramatura "pra proteger a margem", mas em tabela de papel o **R$/kg cai** conforme a gramatura sobe. Gramatura digitada 150, tabela com 120 g a R$ 12,50 e 180 g a R$ 11,80 (empate de 30) → escolhe 180 → usa o **menor** R$/kg, o oposto do prometido. Se a intenção é proteger a margem, o desempate tem que ser pelo maior `precoKg`, não pela maior gramatura.
(b) O fallback não filtra linhas com `precoKg <= 0`: papel com 90 g cadastrado sem preço e 115 g a R$ 9,80, gramatura digitada 100 → distância 10 < 15 → devolve a linha zerada → `validarPedidoOffset:88` lança `CUSTO_INVALIDO` e o orçamento morre, **com um preço válido disponível na mesma tabela**.

### 🟡 7 — o gap é contado de dois jeitos diferentes pelos dois nestings (e dentro do próprio M2) — **CONSTRUÍDO (commit 70154af, 2026-09-12)**
**Princípios 2 e 3** · `src/lib/pricing/m2.ts:87` vs `m2.ts:91` vs `imposicao.ts:52-63`

No eixo da largura o M2 usa `(wUtil + g)/(a + g)` — convenção n−1 gaps, correta, a mesma de `imposicao.ts`. No eixo do comprimento usa `lConsumido = numFaixas × (b + g)`, que cobra **n gaps**: sempre um gap a mais do que existe. Etiqueta em bobina de 0,25 m com 1.000 faixas e g = 0,008 → 8 m lineares = 2 m² cobrados a mais (R$ 16 a R$ 8/m²), sistemático em todo pedido M2/DTF. Pequeno em dinheiro, mas são dois gêmeos decidindo diferente pro mesmo dado.

### 🟡 8 — `DEFAULTS_OFFSET` é metade morto e duplica constantes de `imposicao.ts` — **CONSTRUÍDO (commit 425da86, 2026-09-12)**
**Princípio 2** · `src/lib/pricing/offset.ts:8-13`

`margemLateral` e `gapPecas` de `DEFAULTS_OFFSET` **nunca são lidos** — `calcularImposicao` resolve os próprios defaults (coincidentemente iguais hoje). `sangria` é resolvida duas vezes, com o `0.003` copiado nos dois arquivos. Quem editar `DEFAULTS_OFFSET.gapPecas` pra 0,004 não muda nada no nUp e vai debugar no lugar errado; quem editar `DEFAULTS_OFFSET.sangria` muda `larguraEfetivaM`/`alturaEfetivaM` (base dos acabamentos METRO_LINEAR/M2) **sem** mudar o nUp — dois valores de sangria diferentes no mesmo orçamento. Os defaults do Offset deveriam ser um objeto só, passado explicitamente pra `calcularImposicao` como já é feito com `pinca`.

### 🟡 9 — papel escolhido no orçamento troca o preço/kg mas não os formatos de folha — **CONSTRUÍDO (commit 425da86, 2026-09-12)**
**Princípio 2** · `src/lib/pricing/carregar.ts:322-371`

O override de papel (achado N8) muda `precoPorKg` e `gramaturaGm2`, mas `folhas` continua vindo de `item.formatosFolha`, do PRODUTO. Se a gráfica orça o mesmo produto trocando pro papel que ela só compra em 64×88 enquanto o produto tem 66×96 cadastrado, o `nUp`, `folhasBoas`, `custoPapel` e `pesoTotalPedidoKg` saem todos de uma folha que ela não vai comprar. O comentário na linha 320 marca isso como fora do escopo de N8 — segue sendo cálculo errado quando o override é usado, e o dado pra corrigir (formatos do papel escolhido) já está no banco.

### 🟡 10 — `eficiencia` infla o aproveitamento exibido usando a área com margem de segurança — **CONSTRUÍDO (commit 70154af, 2026-09-12)**
**Princípio 3 (métrica)** · `src/lib/pricing/m2.ts:249`

`eficiencia = Q × w' × h' / areaFaturavel` usa no numerador a área **com** a margem de segurança. Etiqueta 0,10 × 0,05 com s = 0,02: `w'×h' = 0,14 × 0,09 = 0,0126 m²` contra 0,005 m² reais — a tela mostra **2,5× mais aproveitamento do que existe**, e é esse número que o usuário olha pra decidir trocar de bobina. Coerente com a separação já feita em `areaCobrada` (que usa a área nominal), mas aqui a base não acompanhou.

---

## Sem achados

- `src/lib/pricing/imposicao.ts` — a geometria em si está correta (n−1 gaps nos dois eixos, pinça só na largura, rotação avaliada nas duas orientações, `null` quando não cabe). As ressalvas acima são de quem a chama, não dela.
- `src/lib/pricing/validar.ts` — nas partes M2/OFFSET, o que existe está certo; o problema é ausência (achado 2), não erro.
