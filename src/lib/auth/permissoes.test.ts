import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  podeVerMeuNegocio,
  resolverPermissaoOperador,
  podeVerModulo,
  podeEditarModulo,
} from "./permissoes";

describe("podeVerMeuNegocio", () => {
  it("DONO sempre vê, mesmo sem compartilhamento nem acesso individual", () => {
    expect(
      podeVerMeuNegocio({
        papel: "DONO",
        acessoMeuNegocio: false,
        grafica: { compartilharMeuNegocio: false },
      })
    ).toBe(true);
  });

  it("não-DONO só vê com compartilhamento da gráfica E acesso individual", () => {
    expect(
      podeVerMeuNegocio({
        papel: "OPERADOR",
        acessoMeuNegocio: true,
        grafica: { compartilharMeuNegocio: true },
      })
    ).toBe(true);
  });

  it("não-DONO com acesso individual mas SEM compartilhamento geral não vê", () => {
    expect(
      podeVerMeuNegocio({
        papel: "OPERADOR",
        acessoMeuNegocio: true,
        grafica: { compartilharMeuNegocio: false },
      })
    ).toBe(false);
  });

  it("não-DONO com compartilhamento geral mas SEM acesso individual não vê", () => {
    expect(
      podeVerMeuNegocio({
        papel: "ADMIN",
        acessoMeuNegocio: false,
        grafica: { compartilharMeuNegocio: true },
      })
    ).toBe(false);
  });

  it("não-DONO sem nenhum dos dois não vê", () => {
    expect(
      podeVerMeuNegocio({
        papel: "OPERADOR",
        acessoMeuNegocio: false,
        grafica: { compartilharMeuNegocio: false },
      })
    ).toBe(false);
  });
});

// Achado A5 da auditoria de abrangência (Parte 6/Configurações,
// pesquisa-abrangencia-modulos.md, 2026-08-27) — PerfilAcesso/PermissaoPerfil.
// Feature "multi-cargo" (2026-09-06): um usuário pode ter N cargos ao mesmo
// tempo (PerfilUsuario, N:N) — resolverPermissaoOperador é a função PURA que
// decide a resolução (override individual > UNIÃO entre todos os cargos >
// sem acesso) — testada isoladamente do banco aqui; os testes de integração
// logo abaixo cobrem o caminho completo (buscar no Postgres + resolver) via
// podeVerModulo/podeEditarModulo.
describe("resolverPermissaoOperador", () => {
  it("sem override individual e sem nenhum cargo: sem acesso (ausência = sem acesso)", () => {
    expect(resolverPermissaoOperador(null, [])).toEqual({ podeVer: false, podeEditar: false });
  });

  it("só um cargo (sem override individual): usa o cargo", () => {
    expect(resolverPermissaoOperador(null, [{ podeVer: true, podeEditar: false }])).toEqual({
      podeVer: true,
      podeEditar: false,
    });
  });

  it("só override individual (sem nenhum cargo): usa o individual", () => {
    expect(resolverPermissaoOperador({ podeVer: true, podeEditar: true }, [])).toEqual({
      podeVer: true,
      podeEditar: true,
    });
  });

  it("override individual E cargo: o individual vence, mesmo positivo diferente do cargo", () => {
    expect(
      resolverPermissaoOperador(
        { podeVer: true, podeEditar: true },
        [{ podeVer: false, podeEditar: false }]
      )
    ).toEqual({ podeVer: true, podeEditar: true });
  });

  it("override individual explicitamente negativo vence o cargo positivo — presença da linha é o que importa, não só o valor", () => {
    expect(
      resolverPermissaoOperador(
        { podeVer: false, podeEditar: false },
        [{ podeVer: true, podeEditar: true }]
      )
    ).toEqual({ podeVer: false, podeEditar: false });
  });

  // Multi-cargo (2026-09-06): 2+ cargos somam por UNIÃO (OR) — o mais
  // permissivo de qualquer um vence, resolvido independentemente pra
  // podeVer/podeEditar.
  it("2 cargos: união entre os dois — o mais permissivo de cada campo vence", () => {
    expect(
      resolverPermissaoOperador(null, [
        { podeVer: true, podeEditar: false }, // ex: cargo Vendedor em ORCAMENTO
        { podeVer: true, podeEditar: true }, // ex: cargo Administrativo em ORCAMENTO
      ])
    ).toEqual({ podeVer: true, podeEditar: true });
  });

  it("2 cargos, nenhum concede o módulo: continua negado", () => {
    expect(
      resolverPermissaoOperador(null, [
        { podeVer: false, podeEditar: false },
        { podeVer: false, podeEditar: false },
      ])
    ).toEqual({ podeVer: false, podeEditar: false });
  });

  it("2 cargos + override individual: override sempre vence a união", () => {
    expect(
      resolverPermissaoOperador({ podeVer: false, podeEditar: false }, [
        { podeVer: true, podeEditar: true },
        { podeVer: true, podeEditar: true },
      ])
    ).toEqual({ podeVer: false, podeEditar: false });
  });
});

// Prova OFFLINE (sem tocar banco) de que a MIGRAÇÃO DE DADOS
// (20260906190000_perfil_usuario_multi_cargo) preserva 100% o acesso de
// quem já tinha Usuario.perfilAcessoId preenchido antes dela: a migration
// transforma cada linha "perfilAcessoId != null" em EXATAMENTE UMA linha de
// PerfilUsuario — o cenário de N=1 cargo é matematicamente idêntico à
// resolução antiga de 3 níveis (individual ?? doPerfil). Esta função replica
// literalmente o algoritmo ANTIGO (pré-migração, era resolverPermissaoOperador
// até 2026-09-06) e compara contra o NOVO pra qualquer combinação possível de
// grid de permissão — se as duas nunca divergirem no caso de 1 cargo, nenhum
// usuário migrado perde ou ganha acesso só por causa da migração.
function resolverPermissaoOperadorAntigoPreMigracao(
  individual: { podeVer: boolean; podeEditar: boolean } | null,
  doPerfilUnico: { podeVer: boolean; podeEditar: boolean } | null
): { podeVer: boolean; podeEditar: boolean } {
  const linha = individual ?? doPerfilUnico;
  return { podeVer: linha?.podeVer ?? false, podeEditar: linha?.podeEditar ?? false };
}

describe("migração de dados (achado crítico) — usuário com 1 perfil legado mantém EXATAMENTE o mesmo acesso", () => {
  const linhasPossiveis: ({ podeVer: boolean; podeEditar: boolean } | null)[] = [
    null,
    { podeVer: false, podeEditar: false },
    { podeVer: true, podeEditar: false },
    { podeVer: true, podeEditar: true },
  ];

  it("resolverPermissaoOperador(individual, [doPerfil]) bate 100% com o algoritmo antigo (individual, doPerfil), pra toda combinação", () => {
    for (const individual of linhasPossiveis) {
      for (const doPerfil of linhasPossiveis) {
        const antigo = resolverPermissaoOperadorAntigoPreMigracao(individual, doPerfil);
        // N=1 cargo — exatamente o que a migração produz pra cada usuário
        // que tinha perfilAcessoId preenchido (1 linha em PerfilUsuario).
        const novo = resolverPermissaoOperador(individual, doPerfil ? [doPerfil] : []);
        expect(novo).toEqual(antigo);
      }
    }
  });
});

// Testes de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de src/app/compras/cotacao-fornecedor.test.ts) — cobrem o
// caminho completo de podeVerModulo/podeEditarModulo contra as tabelas
// permissoes_usuario/perfis_acesso/permissoes_perfil/perfis_usuario reais.
// Cobre explicitamente os cenários exigidos pela missão: (a) regressão zero
// sem cargo nem override, (b) override individual vence mesmo com cargo(s),
// (c) 1 cargo concede quando não há override, (d) 2 cargos somam por união,
// (e) DONO/ADMIN sempre bypassam.
//
// SÓ RODAM DE VERDADE depois que a migration
// prisma/migrations/20260906190000_perfil_usuario_multi_cargo/migration.sql
// tiver sido aplicada no banco (a tabela perfis_usuario ainda não existe até
// lá) — mesmo aviso de src/app/compras/origem-solicitacao-compra.test.ts.
describe("podeVerModulo/podeEditarModulo — resolução com multi-cargo (integração)", () => {
  const TIMEOUT_MS = 30_000;
  const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const graficaIdsParaLimpar: string[] = [];

  type FixtureOperador = { graficaId: string; usuarioId: string };

  async function criarOperador(): Promise<FixtureOperador> {
    const s = sufixo();
    const grafica = await prisma.grafica.create({
      data: { nome: `Teste Permissao ${s}`, slug: `teste-permissao-${s}` },
    });
    const usuario = await prisma.usuario.create({
      data: {
        graficaId: grafica.id,
        nome: `Operador ${s}`,
        email: `teste-permissao-${s}@example.com`,
        senhaHash: "x",
        papel: "OPERADOR",
      },
    });
    graficaIdsParaLimpar.push(grafica.id);
    return { graficaId: grafica.id, usuarioId: usuario.id };
  }

  async function criarPerfil(graficaId: string, nome: string): Promise<string> {
    const perfil = await prisma.perfilAcesso.create({ data: { graficaId, nome } });
    return perfil.id;
  }

  // Atribui um cargo (PerfilAcesso) a um usuário — feature "multi-cargo",
  // substitui o antigo `prisma.usuario.update({ data: { perfilAcessoId } })`.
  async function atribuirCargo(usuarioId: string, perfilAcessoId: string): Promise<void> {
    await prisma.perfilUsuario.create({ data: { usuarioId, perfilAcessoId } });
  }

  afterEach(async () => {
    for (const graficaId of graficaIdsParaLimpar) {
      await prisma.permissaoUsuario.deleteMany({ where: { usuario: { graficaId } } });
      await prisma.perfilUsuario.deleteMany({ where: { usuario: { graficaId } } });
      await prisma.usuario.deleteMany({ where: { graficaId } });
      await prisma.permissaoPerfil.deleteMany({ where: { perfil: { graficaId } } });
      await prisma.perfilAcesso.deleteMany({ where: { graficaId } });
      await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
    }
    graficaIdsParaLimpar.length = 0;
  }, TIMEOUT_MS);

  it(
    "(a) OPERADOR sem nenhum cargo e sem NENHUMA PermissaoUsuario continua sem acesso a módulo nenhum — regressão zero",
    async () => {
      const { usuarioId } = await criarOperador();
      const usuario = await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } });

      for (const modulo of [
        "ORCAMENTO",
        "CLIENTES",
        "CATALOGO",
        "PRODUCAO",
        "FINANCEIRO",
        "CONFIGURACOES",
        "CUSTOS",
        "COMPRAS",
      ] as const) {
        expect(await podeVerModulo(usuario, modulo)).toBe(false);
        expect(await podeEditarModulo(usuario, modulo)).toBe(false);
      }
    },
    TIMEOUT_MS
  );

  it(
    "(b) PermissaoUsuario individual continua tendo prioridade mesmo com um cargo setado — override funciona",
    async () => {
      const { graficaId, usuarioId } = await criarOperador();
      const perfilId = await criarPerfil(graficaId, "Acabamento");

      // Cargo concede ORCAMENTO (ver/editar) — mas o override individual do
      // usuário nega explicitamente. O override deve vencer.
      await prisma.permissaoPerfil.create({
        data: { perfilId, modulo: "ORCAMENTO", podeVer: true, podeEditar: true },
      });
      await prisma.permissaoUsuario.create({
        data: { usuarioId, modulo: "ORCAMENTO", podeVer: false, podeEditar: false },
      });
      await atribuirCargo(usuarioId, perfilId);

      const usuario = await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } });
      expect(await podeVerModulo(usuario, "ORCAMENTO")).toBe(false);
      expect(await podeEditarModulo(usuario, "ORCAMENTO")).toBe(false);

      // E o inverso também: override individual concedendo vence um cargo
      // que (hipoteticamente) negaria — aqui o cargo nem tem linha pro
      // módulo CLIENTES, só o individual concede.
      await prisma.permissaoUsuario.create({
        data: { usuarioId, modulo: "CLIENTES", podeVer: true, podeEditar: false },
      });
      const usuarioDepois = await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } });
      expect(await podeVerModulo(usuarioDepois, "CLIENTES")).toBe(true);
      expect(await podeEditarModulo(usuarioDepois, "CLIENTES")).toBe(false);
    },
    TIMEOUT_MS
  );

  it(
    "(c) 1 cargo concede acesso quando não há override individual pro módulo",
    async () => {
      const { graficaId, usuarioId } = await criarOperador();
      const perfilId = await criarPerfil(graficaId, "Impressor");
      await prisma.permissaoPerfil.create({
        data: { perfilId, modulo: "PRODUCAO", podeVer: true, podeEditar: true },
      });
      await prisma.permissaoPerfil.create({
        data: { perfilId, modulo: "FINANCEIRO", podeVer: true, podeEditar: false },
      });
      await atribuirCargo(usuarioId, perfilId);

      const usuario = await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } });
      expect(await podeVerModulo(usuario, "PRODUCAO")).toBe(true);
      expect(await podeEditarModulo(usuario, "PRODUCAO")).toBe(true);
      expect(await podeVerModulo(usuario, "FINANCEIRO")).toBe(true);
      expect(await podeEditarModulo(usuario, "FINANCEIRO")).toBe(false);
      // Módulo que o cargo não cobre continua sem acesso.
      expect(await podeVerModulo(usuario, "COMPRAS")).toBe(false);
    },
    TIMEOUT_MS
  );

  it(
    "(d) 2 cargos ao mesmo tempo: permissão é a UNIÃO (OR) — o mais permissivo de qualquer um vence",
    async () => {
      const { graficaId, usuarioId } = await criarOperador();
      // Cargo 1 (ex: "Vendedor"): ORCAMENTO ver+editar, CLIENTES só ver.
      const perfilVendedor = await criarPerfil(graficaId, "Vendedor");
      await prisma.permissaoPerfil.create({
        data: { perfilId: perfilVendedor, modulo: "ORCAMENTO", podeVer: true, podeEditar: true },
      });
      await prisma.permissaoPerfil.create({
        data: { perfilId: perfilVendedor, modulo: "CLIENTES", podeVer: true, podeEditar: false },
      });
      // Cargo 2 (ex: "Financeiro"): FINANCEIRO ver+editar, CLIENTES só ver
      // também (mesmo módulo que o cargo 1 já cobre, sem conflito).
      const perfilFinanceiro = await criarPerfil(graficaId, "Financeiro");
      await prisma.permissaoPerfil.create({
        data: { perfilId: perfilFinanceiro, modulo: "FINANCEIRO", podeVer: true, podeEditar: true },
      });
      await prisma.permissaoPerfil.create({
        data: { perfilId: perfilFinanceiro, modulo: "CLIENTES", podeVer: true, podeEditar: false },
      });

      await atribuirCargo(usuarioId, perfilVendedor);
      await atribuirCargo(usuarioId, perfilFinanceiro);

      const usuario = await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } });
      // União: usuário com os 2 cargos enxerga a soma de ambos.
      expect(await podeVerModulo(usuario, "ORCAMENTO")).toBe(true);
      expect(await podeEditarModulo(usuario, "ORCAMENTO")).toBe(true);
      expect(await podeVerModulo(usuario, "FINANCEIRO")).toBe(true);
      expect(await podeEditarModulo(usuario, "FINANCEIRO")).toBe(true);
      expect(await podeVerModulo(usuario, "CLIENTES")).toBe(true);
      expect(await podeEditarModulo(usuario, "CLIENTES")).toBe(false);
      // Nenhum dos 2 cargos cobre COMPRAS.
      expect(await podeVerModulo(usuario, "COMPRAS")).toBe(false);
    },
    TIMEOUT_MS
  );

  it(
    "(e) DONO e ADMIN continuam bypassando tudo, mesmo sem cargo e sem PermissaoUsuario nenhuma",
    async () => {
      const s = sufixo();
      const grafica = await prisma.grafica.create({
        data: { nome: `Teste Permissao Bypass ${s}`, slug: `teste-permissao-bypass-${s}` },
      });
      graficaIdsParaLimpar.push(grafica.id);
      const dono = await prisma.usuario.create({
        data: {
          graficaId: grafica.id,
          nome: `Dono ${s}`,
          email: `teste-permissao-dono-${s}@example.com`,
          senhaHash: "x",
          papel: "DONO",
        },
      });
      const admin = await prisma.usuario.create({
        data: {
          graficaId: grafica.id,
          nome: `Admin ${s}`,
          email: `teste-permissao-admin-${s}@example.com`,
          senhaHash: "x",
          papel: "ADMIN",
        },
      });

      for (const usuario of [dono, admin]) {
        for (const modulo of ["ORCAMENTO", "CONFIGURACOES", "FINANCEIRO", "COMPRAS"] as const) {
          expect(await podeVerModulo(usuario, modulo)).toBe(true);
          expect(await podeEditarModulo(usuario, modulo)).toBe(true);
        }
      }
    },
    TIMEOUT_MS
  );
});
