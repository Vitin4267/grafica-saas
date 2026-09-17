import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "@/generated/prisma/client";
import { conferirIsolamentoTenant, MODELOS_COM_RLS_ATIVO } from "@/lib/prisma-tenant-guard";
import {
  tenantAtual,
  transacaoJaConfigurada,
  marcarTransacaoConfigurada,
  type EstadoTenant,
} from "@/lib/tenant-context";

// Achado da auditoria de segurança (2026-09-17) — Fase B (RLS real no
// Postgres, ver plano em ~/.claude/plans/deep-zooming-parasol.md). Runtime
// parameter que as policies de RLS leem via `current_setting('app.xxx',
// TRUE)`. `TRUE` no 3º argumento de `set_config` = `is_local`: o valor
// autoreverte no fim da transação atual, nunca vaza pra outra requisição
// que reuse a mesma conexão do pool do `pg.Pool` dentro de
// `@prisma/adapter-pg` — é exatamente por isso que cada chamada precisa
// rodar DENTRO de uma transação (ver os dois pontos de uso abaixo).
function construirSetConfigRaw(
  client: { $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Prisma.PrismaPromise<number> },
  estado: EstadoTenant
) {
  return estado.tipo === "tenant"
    ? client.$executeRaw`SELECT set_config('app.grafica_id', ${estado.graficaId}, TRUE)`
    : client.$executeRaw`SELECT set_config('app.bypass_rls', ${"on"}, TRUE)`;
}

// Exportado (achado da auditoria de segurança 2026-09-17, testando RLS de
// verdade em CI): src/lib/rls.test.ts precisa de um client à parte,
// plugado direto no role restrito de teste (RLS_TEST_DATABASE_URL), sem
// depender do DATABASE_URL global do resto da suíte — senão testar RLS de
// verdade exigiria trocar o DATABASE_URL de TODO o `npm test`, o que quebra
// as ~86 fixtures de teste que criam Cliente/Pedido/etc. sem estabelecer
// contexto de tenant (a maioria mocka autenticação). Parametrizado por
// connectionString com fallback pro comportamento de sempre.
export function criarClient(connectionString: string | undefined = process.env.DATABASE_URL) {
  const adapter = new PrismaPg({ connectionString });

  // Timeouts default do Prisma pra transações interativas ($transaction com
  // callback) são maxWait: 2000ms e timeout: 5000ms — curtos demais aqui:
  // maxWait conta até o tempo de acordar a conexão com o Neon depois de
  // cold start, e o timeout de 5s pode estourar numa transição de status de
  // pedido GRANDE (baixa de estoque de muitos itens) mesmo sem cold start.
  // Valores mais generosos evitam falso positivo de timeout nesses casos
  // legítimos, sem comprometer a detecção de conflito de serialização real
  // (que independe desses timeouts). prisma.config.ts não define nada
  // equivalente — datasource/migrations só, sem transactionOptions.
  const base = new PrismaClient({
    adapter,
    transactionOptions: {
      maxWait: 5000,
      timeout: 15000,
    },
  });

  // Achado da auditoria de segurança (2026-09-13) — Fase A do isolamento à
  // prova de falhas (ver src/lib/prisma-tenant-guard.ts pro porquê/escopo
  // exato). `$extends` se aplica também DENTRO de `$transaction` (a `tx`
  // que os call sites recebem já é extendida) — confirmado empiricamente
  // antes de aceitar isso como verdade, não só documentação do Prisma.
  return base.$extends({
    name: "isolamento-tenant",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          conferirIsolamentoTenant({ model, operation, args });

          // Fase B (RLS, 2026-09-17) — ver construirSetConfigRaw acima.
          // Só embrulha numa transação nova quando: (a) o model desta
          // operação está em MODELOS_COM_RLS_ATIVO (nunca paga o custo
          // extra de round-trip pros ~100 models que não têm RLS ligado
          // ainda — o piloto de 5 tabelas fica isolado de propósito); (b)
          // existe contexto de tenant estabelecido (definirTenantAtual/
          // semTenant já rodou); E (c) esta operação NÃO está rodando
          // dentro de uma transação interativa que o próprio código do app
          // já abriu e configurou via transacaoComTenant (ver abaixo) —
          // nesse caso o set_config já foi aplicado UMA vez pra transação
          // inteira, e embrulhar de novo aqui abriria uma transação
          // SEPARADA (uma conexão diferente do pool), o que não afetaria a
          // conexão real que o resto da transação está usando. Pesquisei
          // explicitamente se o Prisma 7 expõe algum sinal nativo de
          // "operação já está dentro de transação" pro hook
          // $allOperations (ver node_modules/@prisma/client/runtime/client.d.ts,
          // QueryOptionsCbArgs) — não expõe, por isso o sinal vem de
          // transacaoJaConfigurada() (AsyncLocalStorage própria).
          const estado = tenantAtual();
          if (!estado || !model || !MODELOS_COM_RLS_ATIVO.has(model) || transacaoJaConfigurada()) {
            return query(args);
          }
          console.log("DEBUG $allOperations wrap:", { model, operation, estadoTipo: estado.tipo });
          const [setConfigResult, resultado] = await base.$transaction([
            construirSetConfigRaw(base, estado),
            query(args),
          ]);
          console.log("DEBUG $allOperations resultado:", {
            model,
            operation,
            setConfigResult,
            resultadoLength: Array.isArray(resultado) ? resultado.length : "n/a",
          });
          return resultado;
        },
      },
    },
  });
}

type PrismaClientExtendido = ReturnType<typeof criarClient>;

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClientExtendido | undefined;
};

export const prisma: PrismaClientExtendido = globalForPrisma.prisma ?? criarClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// Achado da auditoria de segurança (2026-09-13) — o `tx` que
// `prisma.$transaction(async (tx) => ...)` entrega depois do `$extends`
// acima NÃO é estruturalmente igual a `Prisma.TransactionClient` (o tipo
// gerado, baseado no client SEM extensão) — TypeScript recusa a
// atribuição em qualquer função tipada como `tx: Prisma.TransactionClient`
// (padrão usado em ~17 arquivos deste repo pra composição dentro de
// transação). Esta é a correção documentada do próprio Prisma pra client
// estendido: derivar o tipo do `$transaction` REAL em vez de usar o tipo
// genérico — toda função que recebia `Prisma.TransactionClient` passa a
// receber este `PrismaTransactionClient`.
export type PrismaTransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

// Fase B (RLS, 2026-09-17) — substituto de `prisma.$transaction(async (tx)
// => {...})` pros call sites que tocam uma tabela com RLS ligado. Só troca
// a chamada de entrada (`prisma.$transaction(` vira
// `transacaoComTenant(`), o corpo do callback fica idêntico. Preferido a
// sobrescrever `client.$transaction` via extensão do Prisma (que
// resolveria isso de forma invisível, sem tocar nenhum call site) porque
// essa técnica NÃO é documentada oficialmente — só encontrei exemplo de
// terceiro, nunca na doc oficial da Prisma (verificado antes de decidir).
// Preferi uma função exportada comum, só usando API pública/documentada
// (`$executeRaw`, `$transaction`), mesmo custando tocar nos call sites que
// afetam tabela com RLS.
export function transacaoComTenant<T>(fn: (tx: PrismaTransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const estado = tenantAtual();
    if (!estado) {
      return fn(tx);
    }
    return marcarTransacaoConfigurada(async () => {
      await construirSetConfigRaw(tx, estado);
      return fn(tx);
    });
  });
}
