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

const contextoTenant = new AsyncLocalStorage<EstadoTenant | undefined>();

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
//
// PEGADINHA REAL (achada depurando rls.test.ts em CI, 2026-09-17):
// `PrismaPromise` é preguiçosa — só dispara a query de verdade quando
// alguém dá `await`/`.then()` nela. Se `fn` fosse só repassado direto pra
// `.run()` e o CALLER passasse uma arrow síncrona tipo `() =>
// prisma.cliente.findMany(...)` (sem await interno), a arrow só CRIARIA a
// promise e devolveria — `.run()` já teria retornado e o AsyncLocalStorage
// já teria revertido o contexto ANTES da query disparar de verdade (o
// `await semTenant(...)` do CALLER dispara ela DEPOIS, já fora do escopo).
// `$allOperations` (src/lib/prisma.ts) veria `tenantAtual() === undefined`
// em vez do isento esperado — RLS bloquearia tudo, bypass nunca
// aconteceria, silenciosamente. Por isso `fn` roda aqui dentro de um
// wrapper `async` PRÓPRIO com `await` explícito — a garantia fica na
// implementação, não depende do CALLER lembrar de escrever `async () =>
// await ...` certinho toda vez.
export function semTenant<T>(motivo: string, fn: () => Promise<T>): Promise<T> {
  return contextoTenant.run({ tipo: "isento", motivo }, async () => await fn());
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

// Só pra teste que chama definirTenantAtual/semTenant DIRETO (não
// mockado, ex: src/lib/rls.test.ts) — achado rodando esse teste em CI
// (2026-09-17): `enterWith` não tem reset natural, então o contexto
// definido por um `it()` vazava pro próximo teste que rodasse na MESMA
// worker do Vitest, mesmo em arquivo sem nenhuma ligação com tenant —
// contaminou 2 suítes inteiras que rodaram depois. `.run()` (não
// `enterWith`) escopa de verdade: reverte sozinho ao sair, mesmo se `fn`
// lançar. Todo teste que chama definirTenantAtual/semTenant direto deve
// envolver o corpo inteiro nisto. `async () => await fn()` — mesma
// blindagem contra a pegadinha de Promise preguiçosa documentada em
// semTenant() acima.
export function comContextoIsolado<T>(fn: () => Promise<T>): Promise<T> {
  return contextoTenant.run(undefined, async () => await fn());
}

// Segunda AsyncLocalStorage, independente da de identidade do tenant acima
// — Fase B (RLS real, 2026-09-17). Marca que a transação Postgres ATUAL já
// teve o runtime parameter (`app.grafica_id`/`app.bypass_rls`) setado via
// `set_config(..., TRUE)` (ver o component `client.$transaction` em
// src/lib/prisma.ts). Sem isso, cada operação individual dentro de uma
// `prisma.$transaction(async (tx) => ...)` já aberta (este repo usa isso
// pesado pra CAS de status — status-transicao.ts, entrega-transicao.ts,
// checkout-reserva.ts) tentaria abrir uma transação ANINHADA nova só pra
// setar de novo — Postgres/Prisma não suporta isso. O Prisma 7 instalado
// não expõe nenhum sinal nativo de "esta operação já está dentro de uma
// transação" pro hook `query.$allOperations` (confirmado contra
// node_modules/@prisma/client/runtime/client.d.ts, tipo
// `QueryOptionsCbArgs` — só tem `model`/`operation`/`args`/`query`), por
// isso esse sinal precisa vir de um estado próprio, no mesmo espírito do
// `EstadoTenant` acima.
const dentroDeTransacaoConfigurada = new AsyncLocalStorage<true>();

export function transacaoJaConfigurada(): boolean {
  return dentroDeTransacaoConfigurada.getStore() === true;
}

// `.run()` — mesmo raciocínio de semTenant(): quem chama (transacaoComTenant,
// em src/lib/prisma.ts) TEM o callback que representa exatamente a
// transação (fn), então escopa a marcação só a ela, revertendo sozinho ao
// sair (inclusive se `fn` lançar). `async () => await fn()` — mesma
// blindagem de semTenant() contra a pegadinha de Promise preguiçosa.
export function marcarTransacaoConfigurada<T>(fn: () => Promise<T>): Promise<T> {
  return dentroDeTransacaoConfigurada.run(true, async () => await fn());
}

// Terceira AsyncLocalStorage — fecha a última lacuna da Fase B (achada
// 2026-09-21): transação em forma CALLBACK (`prisma.$transaction(async tx
// => ...)`) cujo `tenantAtual()` vem undefined (enterWith perdido) rodava
// sem NENHUM set_config — seguro (atômica, cai tudo junto), mas
// indisponível à toa quando o graficaId está bem ali nos args de alguma
// operação lá dentro (o mesmo fallback que já existe pra escrita solta e
// pra transação em ARRAY, ver derivarEstadoDeOperacoesArray em
// src/lib/prisma.ts). Diferente dos outros dois casos, aqui não dá pra
// derivar TUDO de uma vez antes de abrir a transação — o corpo do callback
// só se conhece rodando. Solução: guarda uma referência MUTÁVEL pro `tx` e
// um flag `configurado`, e $allOperations (prisma.ts) tenta derivar da
// PRIMEIRA operação RLS-ativa que carregar um graficaId localizável nos
// seus próprios args — como `set_config(..., TRUE)` vale pra transação
// INTEIRA (não só a operação que disparou), uma vez achado, protege
// automaticamente toda operação seguinte da mesma transação, mesmo as que
// não carregam graficaId (ex: update por id já validado).
export type TxComExecutorRaw = {
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): unknown;
};
type EstadoTxPendente = { tx: TxComExecutorRaw; configurado: boolean };
const txPendenteDeConfigRls = new AsyncLocalStorage<EstadoTxPendente>();

export function txPendenteAtual(): EstadoTxPendente | undefined {
  return txPendenteDeConfigRls.getStore();
}

// `jaConfigurado` = true quando quem chamou já aplicou set_config por fora
// (tenantAtual() estava disponível) — $allOperations então nem tenta
// derivar de novo, só segue o fluxo normal. `.run()` pelo mesmo motivo de
// sempre: escopa à transação exata, reverte sozinho ao sair.
export function comTxPendenteDeConfig<T>(tx: TxComExecutorRaw, jaConfigurado: boolean, fn: () => Promise<T>): Promise<T> {
  return txPendenteDeConfigRls.run({ tx, configurado: jaConfigurado }, async () => await fn());
}
