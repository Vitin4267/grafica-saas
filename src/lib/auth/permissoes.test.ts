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
// resolverPermissaoOperador é a função PURA que decide a resolução de 3
// níveis (individual > perfil > sem acesso) — testada isoladamente do banco
// aqui; os testes de integração logo abaixo cobrem o caminho completo
// (buscar no Postgres + resolver) via podeVerModulo/podeEditarModulo.
describe("resolverPermissaoOperador", () => {
  it("sem override individual e sem perfil: sem acesso (ausência = sem acesso)", () => {
    expect(resolverPermissaoOperador(null, null)).toEqual({ podeVer: false, podeEditar: false });
  });

  it("só perfil (sem override individual): usa o perfil", () => {
    expect(resolverPermissaoOperador(null, { podeVer: true, podeEditar: false })).toEqual({
      podeVer: true,
      podeEditar: false,
    });
  });

  it("só override individual (sem perfil): usa o individual", () => {
    expect(resolverPermissaoOperador({ podeVer: true, podeEditar: true }, null)).toEqual({
      podeVer: true,
      podeEditar: true,
    });
  });

  it("override individual E perfil: o individual vence, mesmo positivo diferente do perfil", () => {
    expect(
      resolverPermissaoOperador({ podeVer: true, podeEditar: true }, { podeVer: false, podeEditar: false })
    ).toEqual({ podeVer: true, podeEditar: true });
  });

  it("override individual explicitamente negativo vence o perfil positivo — presença da linha é o que importa, não só o valor", () => {
    expect(
      resolverPermissaoOperador({ podeVer: false, podeEditar: false }, { podeVer: true, podeEditar: true })
    ).toEqual({ podeVer: false, podeEditar: false });
  });
});

// Testes de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de src/app/compras/cotacao-fornecedor.test.ts) — cobrem o
// caminho completo de podeVerModulo/podeEditarModulo contra as tabelas
// permissoes_usuario/perfis_acesso/permissoes_perfil reais. Cobre
// explicitamente os 4 cenários exigidos pela missão: (a) regressão zero sem
// perfil nem override, (b) override individual vence mesmo com perfil, (c)
// perfil concede quando não há override, (d) DONO/ADMIN sempre bypassam.
//
// SÓ RODAM DE VERDADE depois que a migration
// prisma/migrations/20260902100000_perfil_acesso/migration.sql tiver sido
// aplicada no banco (a coluna usuarios.perfilAcessoId e as tabelas
// perfis_acesso/permissoes_perfil ainda não existem até lá) — mesmo aviso
// de src/app/compras/origem-solicitacao-compra.test.ts.
describe("podeVerModulo/podeEditarModulo — resolução de 3 níveis (integração)", () => {
  const TIMEOUT_MS = 30_000;
  const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const graficaIdsParaLimpar: string[] = [];

  type FixtureOperador = { graficaId: string; usuarioId: string };

  async function criarOperador(opts?: { perfilAcessoId?: string }): Promise<FixtureOperador> {
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
        perfilAcessoId: opts?.perfilAcessoId,
      },
    });
    graficaIdsParaLimpar.push(grafica.id);
    return { graficaId: grafica.id, usuarioId: usuario.id };
  }

  async function criarPerfil(graficaId: string, nome: string): Promise<string> {
    const perfil = await prisma.perfilAcesso.create({ data: { graficaId, nome } });
    return perfil.id;
  }

  afterEach(async () => {
    for (const graficaId of graficaIdsParaLimpar) {
      await prisma.permissaoUsuario.deleteMany({ where: { usuario: { graficaId } } });
      await prisma.usuario.deleteMany({ where: { graficaId } });
      await prisma.permissaoPerfil.deleteMany({ where: { perfil: { graficaId } } });
      await prisma.perfilAcesso.deleteMany({ where: { graficaId } });
      await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
    }
    graficaIdsParaLimpar.length = 0;
  }, TIMEOUT_MS);

  it(
    "(a) OPERADOR sem perfilAcessoId e sem NENHUMA PermissaoUsuario continua sem acesso a módulo nenhum — regressão zero",
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
    "(b) PermissaoUsuario individual continua tendo prioridade mesmo com um perfil setado — override funciona",
    async () => {
      const { graficaId, usuarioId } = await criarOperador();
      const perfilId = await criarPerfil(graficaId, "Acabamento");

      // Perfil concede ORCAMENTO (ver/editar) — mas o override individual do
      // usuário nega explicitamente. O override deve vencer.
      await prisma.permissaoPerfil.create({
        data: { perfilId, modulo: "ORCAMENTO", podeVer: true, podeEditar: true },
      });
      await prisma.permissaoUsuario.create({
        data: { usuarioId, modulo: "ORCAMENTO", podeVer: false, podeEditar: false },
      });
      await prisma.usuario.update({ where: { id: usuarioId }, data: { perfilAcessoId: perfilId } });

      const usuario = await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } });
      expect(await podeVerModulo(usuario, "ORCAMENTO")).toBe(false);
      expect(await podeEditarModulo(usuario, "ORCAMENTO")).toBe(false);

      // E o inverso também: override individual concedendo vence um perfil
      // que (hipoteticamente) negaria — aqui o perfil nem tem linha pro
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
    "(c) perfil concede acesso quando não há override individual pro módulo",
    async () => {
      const { graficaId, usuarioId } = await criarOperador();
      const perfilId = await criarPerfil(graficaId, "Impressor");
      await prisma.permissaoPerfil.create({
        data: { perfilId, modulo: "PRODUCAO", podeVer: true, podeEditar: true },
      });
      await prisma.permissaoPerfil.create({
        data: { perfilId, modulo: "FINANCEIRO", podeVer: true, podeEditar: false },
      });
      await prisma.usuario.update({ where: { id: usuarioId }, data: { perfilAcessoId: perfilId } });

      const usuario = await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } });
      expect(await podeVerModulo(usuario, "PRODUCAO")).toBe(true);
      expect(await podeEditarModulo(usuario, "PRODUCAO")).toBe(true);
      expect(await podeVerModulo(usuario, "FINANCEIRO")).toBe(true);
      expect(await podeEditarModulo(usuario, "FINANCEIRO")).toBe(false);
      // Módulo que o perfil não cobre continua sem acesso.
      expect(await podeVerModulo(usuario, "COMPRAS")).toBe(false);
    },
    TIMEOUT_MS
  );

  it(
    "(d) DONO e ADMIN continuam bypassando tudo, mesmo sem perfil e sem PermissaoUsuario nenhuma",
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
