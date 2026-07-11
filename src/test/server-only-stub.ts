// O pacote real "server-only" lança erro sempre que importado fora do
// bundling do Next.js (ele depende do webpack do Next pra saber se está num
// componente servidor ou cliente — fora desse contexto, sempre lança). O
// Vitest roda em Node puro, sem esse bundling, então esse stub vazio faz as
// vezes dele só pros testes (aliasado em vitest.config.ts).
export {};
