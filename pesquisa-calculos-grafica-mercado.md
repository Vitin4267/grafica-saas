# Pesquisa: como o mercado gráfico calcula custo e preço

> Pesquisa de mercado (2026-09-21) pra servir de base de comparação contra o
> motor de precificação do GrafPro (`src/lib/pricing/`). Fontes ao final de
> cada seção. Objetivo: mapear os cálculos que gráficas reais fazem —
> componente por componente — pra depois auditar se o motor cobre cada um
> corretamente.

## 1. Estrutura geral de formação de preço

A fórmula padrão do mercado (confirmada em múltiplas fontes de
precificação/markup, não só gráfica) é o **markup divisor**, não o markup
multiplicador simples:

```
Preço = Custo Total ÷ [1 − (impostos% + comissão% + taxa financeira% + margem%)]
```

Isso é matematicamente diferente de `Preço = Custo × (1 + margem%)` — o
divisor garante que a margem/imposto/comissão sejam uma fração do PREÇO
FINAL (o que sai da nota), não do custo. É o método usado quando se quer
garantir "todo real que entra, X% é lucro líquido", em vez de "lucro é X%
em cima do custo".

Componentes típicos que entram no divisor:
- Impostos do regime tributário (Simples Nacional na maioria das gráficas
  pequenas/médias brasileiras)
- Comissão de vendedor
- Taxa financeira (cartão, boleto, antecipação de recebível)
- Margem de lucro desejada

Custo total = custo direto (material + processo) **+ overhead rateado**
(custos fixos do negócio — aluguel, energia, manutenção de máquina,
mão-de-obra fixa — trazidos pra dentro do custo do produto via um
percentual, não descontados separadamente do preço).

**Fontes:**
- [Markup: o que é, como calcular | Conta Azul](https://contaazul.com/blog/como-calcular-o-markup-e-por-que-usar-essa-precificacao/)
- [Como montar seu preço de venda — Calcgraf](https://www.calcgraf.com.br/como-montar-seu-preco-de-venda/)
- [Guia Prático da Formação de Preço](https://www.modestodepaula.com.br/6939/guia_pratico_da_formacao_de_preco)

## 2. Custo direto por processo de impressão

### 2.1 Offset

Componentes: **papel + tinta + chapas + tempo de máquina + perdas de
arranque**.

- **Chapas**: 1 chapa por cor de impressão (mínimo 4 chapas pra CMYK
  frente). Frente e verso dobra a contagem quando o verso também é
  impresso. Custo é por unidade de chapa gravada, fixo por trabalho
  (não escala com tiragem).
- **Arranque de máquina** ("make-ready"): perda de folhas/tempo até a
  máquina estabilizar cor/registro — cobrada como um acréscimo fixo
  somado ao custo variável por folha, não como % linear.
- **Perda de papel**: quando não calculada, "o orçamento fica defasado e a
  gráfica absorve o prejuízo" — ponto claramente identificado como erro
  comum. Não há um número universal único, mas a perda combinada
  (arranque + quebra + acerto de cor) tipicamente fica na faixa de poucos
  % da tiragem em processo bem controlado, podendo escalar bem mais alto
  (até ~5% do volume) em processo mal controlado.
- **Tinta**: consumida por área impressa × cobertura, geralmente um custo
  menor comparado a papel/chapa num job típico.

**Fontes:**
- [Como fazer um orçamento de impressão offset — Calcme](https://www.calcme.com.br/blog/fazer-um-orcamento-de-impressao-offset-grafica/)
- [Calculadora de Custos de Impressão Offset](https://mestredocalculo.com.br/impressao/calculadora-de-custos-de-impressao-offset)
- [7 dificuldades da empresa gráfica — Nomus](https://www.nomus.com.br/blog-industrial/dificuldades-da-empresa-grafica/)

### 2.2 Imposição / aproveitamento de folha (nesting)

Processo de organizar quantas peças (ou páginas) cabem numa folha/chapa
física, minimizando desperdício — determina o "nUp" (quantas cópias por
folha) que entra direto no custo por peça (custo da folha ÷ nUp).
Softwares dedicados (AGFA Impose, Kodak Preps, Signa Station, Ultimate
Impostrip) resolvem isso automaticamente por algoritmos de bin-packing
(ex. MaxRects, com rotação de 90°) — o mesmo problema de nesting que corte
de chapa CNC resolve.

**Fontes:**
- [O que é Imposição na Produção Gráfica — Maxi Gráfica](https://maxigrafica.com.br/o-que-e-imposicao/)
- [Nesting de chapa online — Token Engenharia](https://tokenengenharia.com.br/ferramentas/nesting-de-chapa/)

### 2.3 Digital

Componentes: **custo por clique/página + papel + desgaste do
equipamento + eletricidade**.

- Custo do papel = preço do pacote ÷ número de folhas.
- Desgaste do equipamento: valor fixo pequeno por folha (ordem de
  centavos), derivado de depreciação do equipamento.
- Cobertura de tinta/toner afeta o custo por clique (fabricantes calibram
  "páginas por cartucho" numa % de cobertura padrão — cobertura real
  maior ou menor desvia do custo teórico).
- Eletricidade: geralmente marginal, mas somada pra fechar o custo real.

**Fontes:**
- [Como calcular meu custo de impressão — Art Printer](https://artprinter.com.br/como-calcular-meu-custo-de-impressao-passo-a-passo-planilha-gratis/)
- [Calcular custo de impressão — Helyo](https://helyo.com.br/blog/calcular-custo-de-impressao/)

### 2.4 Flexografia

Impressão em bobina contínua (rótulos, embalagem flexível, sacolas
plásticas) — custo por milheiro varia com **eficiência da máquina,
material usado e complexidade do design** (nº de cores/clichês).
Controle inadequado de variáveis de processo (pressão, anilox, ganho de
ponto) pode gerar até 30% de variação de cor entre lotes — motivo pelo
qual clichê/setup por cor entra como custo fixo relevante, igual ao
offset.

**Fonte:**
- [O que define o custo por milheiro na flexográfica — Galpão das Máquinas](https://galpaodasmaquinas.com.br/blog/grafica/impressora-flexografica/impressora-flexografica-e-custo-por-milheiro/)

### 2.5 Serigrafia / Silk-screen

Custo dominado por **matriz/tela (setup fixo por cor/arte) + tempo de
máquina**, não pelo substrato. Por isso o preço unitário CAI fortemente
com o aumento de quantidade — a matriz é diluída entre mais peças. Em
lotes pequenos, o setup pode dominar o preço total mais que o produto em
si.

**Fonte:**
- [Custo por unidade — camisetas em grande quantidade](https://camisetasem12h.com.br/custo-por-unidade-para-estampar-camisetas-personalizadas-em-grande-quantidade-serigrafia-dtg-bordado-100-500-1000/)

### 2.6 Bordado

Precificado por **milheiro de pontos** (não por peça nem por área):

```
Custo = (Total de Pontos ÷ 1.000) × Taxa por 1.000 pontos
```

Referência de mercado (BR): ~R$0,75 a cada 1.000 pontos (varia por
complexidade/máquina). Setup de matriz de bordado é caro e demorado —
outro caso, como a serigrafia, onde o preço unitário cai muito com
volume porque o setup se dilui.

**Fontes:**
- [Embroidery Pricing Mastery — HoopTalent](https://www.hooptalent.com/pt/blogs/news/embroidery-pricing-mastery-calculate-costs-and-set-profitable-rates)
- [Tabela de Preços de Bordados](http://macramebordados.blogspot.com/2015/05/tabela-de-precos-de-bordados.html)

### 2.7 DTF (Direct to Film)

Precificado **por metro linear de filme consumido**, faturamento pelo
consumo REAL (fracionado, não arredondado pra metro inteiro — se a
imposição der 1,72m, cobra 1,72m). Referências de mercado: ~R$4,60/metro
linear (filme 20×100cm, BR) até ~€7/metro (filme 55cm de largura útil,
mercado europeu). Insumos: tinta DTF (~US$50-70/litro, cobre ~70-90m²) e
pó adesivo (~US$15-25/kg, cobre ~100-150m lineares) — os dois entram no
custo por metro consumido, escalando com a área real impressa, não com a
quantidade de peças.

**Fontes:**
- [DTF ao metro — SR DTF](https://srdtf.com/pt/dtf-ao-metro/)
- [A impressão DTF é cara? — A Good Printer](https://www.agoodprinter.com/pt/blog/is-dtf-printing-expensive-learn-how-to-calculate-its-true-cost.html)

## 3. Unidades de precificação — por que "por milheiro" existe

Pra produtos de alto volume e baixo valor unitário (etiquetas, cartões de
visita, panfletos), o mercado brasileiro cota **"preço por milheiro"**
(a cada 1.000 unidades), não preço por peça isolada — justamente porque
um preço por peça de fração de centavo (ex. R$0,068/unidade) não é um
número natural de trabalhar nem de exibir; R$68,00/milheiro é.

Isso conecta direto com um princípio geral de sistemas de precificação/ERP
(não específico de gráfica, mas universalmente aplicável): **a precisão do
preço UNITÁRIO deve ser sempre maior ou igual à precisão do preço
TOTAL** — practice comum é preço unitário com 4 a 6 casas decimais e preço
total (o que efetivamente aparece na nota) com 2. Fazer o inverso (unitário
com a MESMA precisão do total) causa exatamente o problema que a auditoria
do motor GrafPro encontrou: perda de precisão sistemática em produtos de
alto volume, porque o preço unitário arredondado não representa fielmente
o preço real por peça.

**Fontes:**
- [Tabela de preços gráfica — Calcme](https://www.calcme.com.br/blog/tabela-de-precos-design-grafico/)
- [Price precision and rounding — IBM Order Management](https://www.ibm.com/docs/en/order-management?topic=rounding-price-precision)
- [Pricing Digits in Dynamics 365 — Encore Business Solutions](https://www.encorebusiness.com/blog/pricing-digits-dynamics-365-finance-operations/)

## 4. Custos indiretos (overhead)

Custos fixos do negócio (aluguel, energia, manutenção de máquina, parte da
folha de pagamento) que não são atribuíveis a um pedido específico, mas
precisam ser recuperados pelo preço — "mesmo não estando diretamente
ligados ao trabalho do cliente, eles existem e precisam ser rateados".
O método comum é um percentual aplicado sobre o custo direto (rateio
simples), não uma alocação por pedido individual — tentar ratear custo
fixo (como folha de pagamento) proporcionalmente ao número de pedidos de
um período específico é uma prática arriscada: pode distorcer muito a
margem aparente de pedidos individuais em meses de baixo volume (poucos
pedidos absorvendo o custo fixo inteiro do mês), mesmo que a margem
AGREGADA do período continue correta.

**Fonte:**
- [Como fazer um orçamento de impressão offset — Calcme](https://www.calcme.com.br/blog/fazer-um-orcamento-de-impressao-offset-grafica/)

## 5. Impostos — Simples Nacional (regime dominante em gráficas PME no Brasil)

Gráfica que TRANSFORMA material (imprime, fabrica o produto físico) se
enquadra tipicamente no **Anexo II (Indústria)** do Simples Nacional,
alíquota inicial de 4,5%, escalando com o faturamento acumulado dos
últimos 12 meses (RBT12) via fórmula de alíquota efetiva:

```
Alíquota efetiva = [(RBT12 × alíquota nominal) − parcela a deduzir] ÷ RBT12
```

Serviços gráficos puros (sem industrialização, ex. só design) podem cair
no Anexo III. Teto de faturamento pra permanecer no Simples: R$4,8
milhões/ano (2026).

**Fontes:**
- [Anexo II — indústria — tabela completa](https://www.contaagil.com/contabilidade-digital/tabelas-completas-do-simples-nacional-2026-com-aliquotas-e-anexos/)
- [Tabela Simples Nacional 2026 completa — Contabilizei](https://www.contabilizei.com.br/contabilidade-online/tabela-simples-nacional-completa/)

## 6. Resumo — o que o motor de um sistema de precificação de gráfica precisa cobrir

| Componente | Cobertura esperada |
|---|---|
| Custo de material (papel/substrato) por área ou peso | Sim, por processo |
| Perda/quebra de material (%) | Sim, com perda parametrizável, não fixa |
| Imposição/nesting (aproveitamento de folha) | Sim, pros processos que usam folha/bobina |
| Chapas/clichê (setup fixo por cor) | Sim, offset/flexo/etiqueta |
| Custo por clique (digital) | Sim |
| Setup por peça (serigrafia/bordado/DTF/etc — diluído por quantidade) | Sim |
| Preço por milheiro de pontos (bordado) | Sim |
| Preço por metro linear de consumo real (DTF) | Sim |
| Overhead (custo fixo rateado) | Sim, como % sobre custo direto |
| Impostos (Simples Nacional ou equivalente) | Sim, parametrizável por regime |
| Comissão de vendedor | Sim |
| Taxa financeira (cartão/boleto) | Sim |
| Margem de lucro | Sim, sobre o PREÇO final (markup divisor), não sobre custo |
| Pedido mínimo | Sim, aplicado uma vez por pedido, não por item |
| Precisão de preço unitário ≥ precisão de preço total | **Ponto de atenção — ver auditoria** |
| Alocação de custo fixo (overhead) NUNCA dividida ingenuamente por contagem de pedidos do período | **Ponto de atenção — ver auditoria de dados reais da Assus Graphics** |
