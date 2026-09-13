import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

// Achado da auditoria de segurança (2026-09-13) — isolamento entre gráficas
// era 100% disciplina de código (`where: { graficaId }` escrito à mão em
// cada query): um `where` esquecido vazava dado de outro tenant em
// silêncio. Este módulo é a Fase A da correção — trava fail-closed na
// APLICAÇÃO, não RLS de verdade no Postgres (Fase B, rodada própria — ver
// justificativa completa no plano de segurança: 49 dos 106 models não têm
// `graficaId` diretamente, o app conecta como dono da tabela que ignora
// RLS, e existem ~14 rotas sem sessão de usuário).
//
// AsyncLocalStorage guarda o estado de tenant do request atual.
// src/lib/prisma-tenant-guard.ts (ver src/lib/prisma.ts) lê daqui pra:
// (a) exigir graficaId PRESENTE só em create/createMany contra os 58 models
//     multi-tenant (uma linha nova SEMPRE sabe de qual tenant é — ver
//     comentário completo do porquê em prisma-tenant-guard.ts, inclusive
//     por que leitura em massa NÃO tem esta exigência: o idioma dominante
//     do repo pra ler é escopar pelo id do PAI já validado, não repetir
//     graficaId toda vez);
// (b) quando o valor de graficaId aparece EM QUALQUER operação E há um
//     tenant ativo, conferir que os dois BATEM — pega quem passou o
//     graficaId ERRADO (bug de copiar/colar, variável trocada); esta é a
//     checagem que carrega o peso real do isolamento neste guard.
export type EstadoTenant = { tipo: "tenant"; graficaId: string } | { tipo: "isento"; motivo: string };

const contextoTenant = new AsyncLocalStorage<EstadoTenant>();

// Chamado por exigirUsuarioAutenticado logo após resolver a sessão. Usa
// `enterWith` (não `run`) DE PROPÓSITO: o padrão do repo inteiro é
// imperativo —
//   const usuario = await exigirUsuarioAutenticado();
//   // resto da action/página, com dezenas de prisma.xxx() depois
// — nunca um callback que englobe "o resto da execução" (o que `run()`
// exigiria de todo call site, impraticável em centenas de arquivos).
// `enterWith` entra no contexto pro RESTO da cadeia assíncrona atual sem
// precisar de callback — o encaixe certo aqui. Funciona porque Next.js já
// estabelece um contexto assíncrono por request ANTES do código da
// aplicação rodar (mesmo mecanismo por trás de cookies()/headers()
// funcionarem por request sem passar contexto explícito) — entrar aqui,
// logo no início de cada action/página, herda e estende esse mesmo
// contexto, nunca vaza entre requests concorrentes.
export function definirTenantAtual(graficaId: string): void {
  contextoTenant.enterWith({ tipo: "tenant", graficaId });
}

// Escape hatch AUDITÁVEL pra código genuinamente cross-tenant: os crons de
// backup/lifecycle (varrem TODOS os tenants de propósito), o webhook do
// Stripe (identifica o tenant pelo metadata, não por sessão), e qualquer
// outro caminho sem sessão de usuário. `motivo` é obrigatório e serve de
// documentação — todo uso de semTenant é grep-ável
// (`grep -rn "semTenant("`) e precisa justificar por que aquele bypass é
// seguro, nunca "o teste falhou então isento aqui".
//
// `.run()` (não `enterWith`) É o encaixe certo aqui — diferente de
// definirTenantAtual, aqui a gente TEM o callback que representa
// exatamente o trecho isento (fn), então `run()` escopa a isenção só a
// ele e reverte automaticamente ao sair, mesmo em chamada aninhada.
export function semTenant<T>(motivo: string, fn: () => Promise<T>): Promise<T> {
  return contextoTenant.run({ tipo: "isento", motivo }, fn);
}

// undefined = nenhum contexto de tenant foi estabelecido neste ponto da
// execução (nem definirTenantAtual nem semTenant rodaram ainda na cadeia
// atual — ex: um teste unitário chamando uma função de src/lib direto,
// sem passar por exigirUsuarioAutenticado, ou um script solto). O guard
// trata isso como "nada pra conferir o VALOR contra", mas ainda exige
// PRESENÇA de graficaId nas operações que a cobrem — mesma disciplina que
// as fixtures de teste já seguem hoje.
export function tenantAtual(): EstadoTenant | undefined {
  return contextoTenant.getStore();
}
