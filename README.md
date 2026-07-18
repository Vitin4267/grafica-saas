# Gráfica+

SaaS multi-tenant de orçamento e gestão para gráficas (print shops) brasileiras — cálculo de preço, catálogo, produção, financeiro e cobrança por assinatura, tudo em um só produto.

**🔗 Em produção:** [grafica-saas-peach.vercel.app](https://grafica-saas-peach.vercel.app/)

## O que o produto faz

Uma gráfica se cadastra, configura o catálogo (produtos simples, offset, matéria-prima com tabela de preço por gramatura), e monta orçamentos com preço calculado automaticamente — do orçamento aprovado nasce o pedido de produção, com controle de estoque, comissão de vendedor, emissão de nota fiscal e cobrança recorrente via Stripe. Multi-tenant de verdade: cada gráfica só enxerga os próprios dados, com múltiplos usuários e permissão granular por módulo.

## Stack

- **Next.js 16** (App Router, Server Actions, Turbopack) + **TypeScript**
- **Prisma 7** + **PostgreSQL** (Neon, serverless)
- **Stripe** — cobrança por assinatura (3 planos, trial, webhook-driven)
- **Tailwind CSS 4**
- **n8n** (self-hosted) — e-mail transacional, assistente de IA e automação por webhook
- **Cloudflare Turnstile** — proteção contra bot no login
- Deploy: **Vercel** (app) + **Oracle Cloud** (n8n)

## Alguns detalhes de engenharia

- **Motor de precificação próprio** — três modelos de cálculo (unidade simples, m², offset com imposição de folha/chapas/rodagem), cada um com sua própria validação e testado isoladamente.
- **Isolamento multi-tenant auditado** — toda query em contexto autenticado é escopada por `graficaId`; auditoria de código dedicada confirmou que nenhuma mutação escapa desse padrão.
- **Cobrança resiliente** — estado da assinatura sincronizado via webhook do Stripe com idempotência, guarda contra segunda assinatura concorrente, e um mecanismo de cortesia manual que nenhum evento de cobrança consegue sobrescrever.
- **Segurança em camadas** — rate limiting por IP/e-mail em todo fluxo de auth, hash argon2id, comparação com tempo constante contra enumeração de usuário, CSP, e uma correção de concorrência num contador de tentativas de força bruta (race condition real, corrigida com um `updateMany` atômico).
- **173 testes automatizados** cobrindo lógica de negócio pura (precificação, permissões, validação, status).

## Rodando localmente

```bash
npm install
cp .env.example .env   # preencher DATABASE_URL no mínimo
npx prisma migrate deploy
npm run dev
```

## Sobre o processo de desenvolvimento

Este projeto foi construído com o **Claude (Anthropic)** como par de programação — mas a direção é minha: arquitetura, prioridades de produto, decisões de segurança e todo o desenho de negócio (motor de precificação, modelo de cobrança, fluxo de onboarding) foram guiados por mim, com o Claude implementando, testando e sendo revisado a cada etapa. Uso IA como ferramenta de alavancagem, não como piloto automático — reviso e valido cada mudança antes de ir pra produção.
