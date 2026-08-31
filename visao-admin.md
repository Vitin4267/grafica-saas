# Visão de ADM — GrafPro

> Documento pra você (dono do produto), não pra mim. Escrito em 2026-08-31.
> Resume onde as coisas estão SEM precisar caçar em conversa antiga. Vou
> tentar manter atualizado, mas se estiver decidindo algo importante em cima
> de um número aqui, vale conferir comigo antes ("isso ainda tá assim?").

---

## 0. PENDÊNCIAS — leia isto primeiro

Tudo que precisa de uma ação (sua ou minha) num lugar só. Categorizado por
quem trava a próxima ação. Detalhe de cada item nas seções abaixo.

### 🔴 URGENTE — marcado por você em 2026-08-31
- [ ] **Criar os 6 Prices no Stripe pros intervalos semestral/anual** — o
      código já está pronto (2026-08-31), só falta você criar os Price
      objects no dashboard do Stripe (semestral com -15%, anual com -20%
      sobre o mensal de cada plano) e colar os IDs nas env vars
      `STRIPE_PRICE_ID_<PLANO>_SEMESTRAL`/`_ANUAL` na Vercel. Sem isso, o
      toggle de intervalo simplesmente não aparece pra ninguém — não
      quebra nada, só fica invisível até você configurar. (seção 2)

### Trava em VOCÊ decidir (eu não posso avançar sozinho)
- [ ] **Preço de plano pro/empresarial** — só o básico (R$749,90) está
      fechado. (seção 2)
- [ ] **Qual eixo diferencia os planos** — faturamento e nº de prensas
      sozinho já foram testados e descartados; falta fechar o critério
      combinado (máquinas/usuários/orçamentos). (seção 2)
- [ ] **Prensa fantasma "[Exemplo] Prensa Offset"** na conta real da Assus
      — resíduo de dado de exemplo, nunca confirmou se quer que eu apague.
      (seção 7)

### Backlog técnico rastreado (sem decisão pendente, só fila de prioridade)
- [ ] Configurar Dependabot (scan de dependência automatizado)
- [ ] Criptografia de campo pra token sensível (`focusNfeToken`)
- [ ] RLS (trava extra de isolamento direto no banco)
- [ ] Role de banco de dados com permissão restrita (hoje usa acesso total)
- [ ] 121 achados catalogados de abrangência de produto — 18 dos 33 da
      Parte 7 já construídos (rodadas 17-19, 2026-08-31), 15 pendentes.
      Parte 6 A9 (roteamento de notificação) também fechado. **68 achados
      pendentes no total têm custo estimado** — 13 baratos, 29 médios, 26
      caros. Os baratos são os candidatos naturais pra próxima rodada de
      construção (ver "Resumo de custo" no fim de
      `pesquisa-abrangencia-modulos.md`).

**O item 🔴 acima é o único marcado como urgente** (por você, não por mim —
é ação manual no dashboard do Stripe, eu não tenho acesso pra fazer). O
resto não é furo de segurança ativo nem bloqueia cliente pagando agora — é
o que fica pendente entre uma sessão e outra, listado pra não se perder.

---

## 1. O que é o GrafPro, em 1 parágrafo

SaaS multi-tenant pra gráficas brasileiras (catálogo, motor de precificação,
orçamento, produção, financeiro, compras, clientes, fiscal). Nasceu
resolvendo o problema real da Assus Graphics (rótulos/etiquetas, gráfica do
seu pai) — ela é o cliente-piloto, com dados reais importados (clientes,
catálogo, 247 pedidos históricos). O objetivo declarado é vender pra
centenas de gráficas de perfis bem diferentes, não só o perfil da Assus.

**Stack:** Next.js 16 + Prisma 7 + Postgres (Neon) + Vercel + Stripe.
Integração opcional com n8n (assistente de IA + webhook de automação, cada
gráfica trazendo a própria conta).

---

## 2. Modelo de negócio e preço — o que já foi DECIDIDO

- **Plano básico: R$749,90/mês**, fixo. Ponto de partida da régua.
- **Intervalos novos** (semestral -15%, anual -20%) — decidido, **código
  pronto desde 2026-08-31**. Falta só você criar os 6 Prices no Stripe e
  colar os IDs nas env vars da Vercel (ver seção 0) pra ativar de verdade.
- **Desconto de "cliente fundador"**: os 10 primeiros que ASSINAREM plano
  pago (não quando só criam conta) ganham **30% de desconto permanente**,
  mesmo se cancelar e voltar depois. Aplicado manualmente como cupom no
  Stripe — não precisa de código, o sistema já lê o valor cobrado direto do
  Stripe.

### Ainda em ABERTO (precisa de você decidir)
- **Preço de pro/empresarial** — só o básico está fechado.
- **Qual eixo diferencia os planos.** Já testamos e DESCARTAMOS: faturamento
  declarado (dá incentivo a sonegar/sub-declarar) e número de prensas
  sozinho (a própria Assus fica no plano mais barato por esse critério,
  mesmo faturando R$552 mil — prensa não é bom proxy de tamanho). Direção
  que ficou pra decidir: combinar critérios (máquinas OU usuários OU
  orçamentos/mês — o que for maior decide o plano).

---

## 3. Quando vale gastar mais com infraestrutura

**Regra combinada com você:** não fazer upgrade de infra recorrente
(ex: Neon Launch, pra matar o cold-start de ~10-20s) até o **primeiro
cliente pagante de verdade assinar**. Motivo: seu orçamento pessoal é
apertado (~R$1.000/mês) e já uma fatia relevante disso vai pra ferramentas
de IA do projeto. Sua frase: *"se eu tiver 1 cliente pagando 159 reais, eu
assino"* — o gatilho é receita real, não expectativa.

Quando isso acontecer: dá pra considerar só a parte de backup/PITR do Neon
Launch primeiro (mais barata, cobrada por armazenamento) antes do "always
on" completo (compute contínuo, sai por ~R$105-115/mês).

---

## 4. Segurança — status real (não é "confia em mim", foi auditado várias vezes)

Você pediu auditoria de segurança de forma proativa e recorrente: 10/07,
14/07, 23/07, 16/08, 17/08 de 2026. Achados reais e sérios apareceram e
foram corrigidos — o mais grave foi o backup do banco (com hash de senha)
indo pro Vercel Blob **público** por engano; corrigido no mesmo dia que foi
achado (`access: private` desde 23/07, blobs antigos não existem mais).

### O que já está protegido
- Senha com argon2id, rate limit de login/registro/reset por e-mail e IP.
- Isolamento entre gráficas (multi-tenant) auditado várias vezes — nunca
  achou vazamento de dado entre tenants.
- RBAC por módulo (Orçamento/Clientes/Catálogo/Produção/Financeiro/Config).
- Headers de segurança (CSP, HSTS, X-Frame-Options), sem XSS/SQLi óbvio
  (zero uso de `dangerouslySetInnerHTML`/SQL cru).
- Cloudflare Turnstile no login, honeypot + rate limit no cadastro.
- Upload de arquivo validado (magic bytes, tamanho, isolamento por tenant).

### O que FALTA (registrado em 2026-08-29, ninguém esqueceu, só não foi feito ainda)
1. **Scan de dependência automatizado** — não tem Dependabot nem Snyk
   configurado, só `npm audit` manual de vez em quando. Mais barato de
   resolver: 1 arquivo de config.
2. **Criptografia de campo** — token sensível (ex: `focusNfeToken`) fica em
   texto plano no banco, só protegido pela criptografia de disco do Neon.
3. **RLS (Row Level Security)** — não usa. A separação entre gráficas é só
   em nível de código (bem auditada), sem trava adicional no banco.
4. **Role de banco restrito** — usa a connection string padrão do Neon
   (acesso total), não um usuário de aplicação com permissão mínima.

Nenhum desses é furo ativo hoje — são camadas extras de proteção
("defesa em profundidade"), mais importantes conforme a base de clientes
reais crescer. Não é urgência, é fila.

---

## 5. Auditoria de abrangência — o "isso serve pra outras gráficas, não só a Assus?"

Iniciativa contínua desde 2026-08-23: catalogar tudo que o sistema assume
implicitamente "toda gráfica é igual à Assus" e não é verdade pro mercado
brasileiro real (offset, digital, comunicação visual, estamparia, brindes,
embalagem, editorial, bordado, serigrafia, DTF, corte a laser...).

**Placar em 2026-08-31:**
- **121 achados catalogados** no total, em `pesquisa-abrangencia-modulos.md`
  (raiz do repo — esse arquivo é a fonte de verdade, este documento aqui é
  só o resumo executivo).
- Das Partes 1-6 (88 achados originais, sobre o motor de preço/orçamento/
  produção/financeiro/compras/clientes/config): **34 já construídos + 8
  parciais** — uns 39% resolvido (48% contando parcial).
- **Parte 7 é nova** (33 achados, adicionada 30-31/08/2026): pergunta
  diferente — não "o motor calcula certo?", e sim **"dá pra sequer
  CADASTRAR isso?"** (ex: seu próprio exemplo — falta de máquina pra
  cadastrar). **18 dos 33 já construídos**: rodada 17 — categorias de
  máquina pra bordado/corte-e-vinco/impressora-grande-formato/gofradeira, e
  19 itens novos de matéria-prima; rodada 18 — chave PIX da gráfica; rodada
  19 — materiais de bordado, acabamento de etiqueta (durabilidade de
  adesivo, laminação/verniz soft touch, efeito de hot stamping), 3ª
  dimensão/espessura no item de orçamento, e `SegmentoGrafica` ampliado (5
  segmentos novos + múltiplos segmentos por gráfica). 15 pendentes.

### Os achados mais importantes da Parte 7, pra você bater o olho
- ~~Chave PIX da própria gráfica não tem onde cadastrar~~ — **construído
  2026-08-31**: agora dá pra cadastrar em Configurações > Identidade, e
  aparece no PDF do orçamento e no link público depois de aprovado. Só
  exibição — sem validar a chave, sem confirmar pagamento automático.
- **Ferramental (faca, clichê, tela) não tem cadastro** — toda repetição de
  pedido recalcula o clichê como se fosse novo, mesmo já existindo.
- **Sistema só emite NF-e**, não NFS-e — gráfica que presta serviço
  (comunicação visual, design, personalização) não tem onde emitir.
- **Frete: falta o valor.** A modalidade existe, mas não o valor cobrado
  nem a transportadora — a nota sai com frete zerado.
- **Cor Pantone/especial não tem onde ficar registrada** — só a
  *quantidade* de cores é salva, nunca *qual* cor.

Esses 5 (e mais 4) vieram de uma pesquisa mais funda que autorizei rodar em
Opus (modelo mais caro, só pra essa passada específica) — ele também achou
**3 erros reais** em propostas que os agentes mais baratos tinham escrito
antes, e já corrigi isso no documento.

---

## 6. Estado do git — atenção aqui

**Tudo empurrado.** `172710f..df3426c` foi pro GitHub em 2026-08-31 —
rodada 19 da auditoria + os intervalos semestral/anual do Stripe, tudo
código real em produção agora. Migrations já estavam aplicadas no banco
de dev antes do push, schema bate certo. Sem pendência de git.

---

## 7. Pendência solta (baixa prioridade, mas ficou anotada)

Tem uma **"[Exemplo] Prensa Offset"** fantasma cadastrada na conta real da
Assus — resíduo de quando alguém carregou os dados de exemplo do
onboarding e nunca limpou. Perguntei se você queria que eu apagasse e a
conversa mudou de assunto antes de você responder. Se quiser, é rápido de
limpar.

---

## Como usar este documento

Sempre que quiser um resumo rápido de "onde as coisas estão" sem catar
memória, pede pra eu reler/atualizar este arquivo. Ele não substitui os
documentos técnicos (`pesquisa-abrangencia-modulos.md` pros achados,
`arquitetura-resumo.md` pro schema/código) — é o resumo pra VOCÊ, não pra
um agente de pesquisa.
