# Gráfica+

Multi-tenant quoting and management SaaS for Brazilian print shops (gráficas) — pricing, catalog, production, finance, and subscription billing, all in one product.

**🔗 Live:** [grafica-saas-peach.vercel.app](https://grafica-saas-peach.vercel.app/)

[![Tests](https://github.com/Vitin4267/grafica-saas/actions/workflows/test.yml/badge.svg)](https://github.com/Vitin4267/grafica-saas/actions/workflows/test.yml)

## What the product does

A print shop signs up, configures its catalog (simple products, offset printing, raw-material pricing tables by weight), and builds quotes with automatically calculated pricing. An approved quote becomes a production order, with inventory control, salesperson commission, invoice issuance, and recurring billing via Stripe. True multi-tenancy: each shop only ever sees its own data, with multiple users and granular per-module permissions.

## Stack

- **Next.js 16** (App Router, Server Actions, Turbopack) + **TypeScript**
- **Prisma 7** + **PostgreSQL** (Neon, serverless)
- **Stripe** — subscription billing (3 plans, trial, webhook-driven)
- **Tailwind CSS 4**
- **n8n** (self-hosted) — transactional email, AI assistant, and webhook automation
- **Cloudflare Turnstile** — bot protection on login
- Deploy: **Vercel** (app) + **Oracle Cloud** (n8n)

## Some engineering details

- **Custom pricing engine** — three calculation models (simple unit, m², offset with sheet/plate/run imposition), each independently validated and tested.
- **Audited multi-tenant isolation** — every authenticated query is scoped by `graficaId`; a dedicated code audit confirmed no mutation escapes that pattern.
- **Resilient billing** — subscription state synced via idempotent Stripe webhooks, guarded against concurrent double-subscription, plus a manual courtesy override that no billing event can overwrite.
- **Layered security** — per-IP/email rate limiting across the entire auth flow, argon2id hashing, constant-time comparison against user enumeration, CSP/HSTS, and Origin-checked Server Actions (CSRF). A full whitebox security audit (Jul 2026) covering multi-tenant isolation, auth, authorization, billing, and injection surfaces found and fixed several real issues — including a genuine concurrency gap in the brute-force counter that an earlier fix had only partially closed — each one verified with real concurrency tests against the database and a passive OWASP ZAP scan, not just code review.
- **213 automated tests**: pure business logic (pricing, permissions, validation, status) plus targeted integration tests against a real database for the concurrency-sensitive paths (rate limiting, checkout deduplication, tenant isolation).

## Running locally

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL at minimum
npx prisma migrate deploy
npm run dev
```

## About the development process

This project was built with **Claude (Anthropic)** as a pairing partner — but the direction is mine: architecture, product priorities, security decisions, and all business design (pricing engine, billing model, onboarding flow) were guided by me, with Claude implementing, testing, and being reviewed at every step. I use AI as a leverage tool, not autopilot — I review and validate every change before it ships to production.
