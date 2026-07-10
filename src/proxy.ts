import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";

// Camada rápida (sem acesso a banco) só para redirecionar cedo quando não há
// cookie de sessão nenhum. A validação de verdade (token existe, não expirou,
// pertence à gráfica certa) acontece sempre no servidor em exigirUsuarioAutenticado().
const ROTAS_PROTEGIDAS = ["/orcamento"];
const ROTAS_SOMENTE_DESLOGADO = ["/login", "/registro"];

export function proxy(request: NextRequest) {
  const temSessao = Boolean(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  const { pathname } = request.nextUrl;

  if (!temSessao && ROTAS_PROTEGIDAS.some((r) => pathname.startsWith(r))) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (temSessao && ROTAS_SOMENTE_DESLOGADO.some((r) => pathname.startsWith(r))) {
    return NextResponse.redirect(new URL("/orcamento", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/orcamento/:path*", "/login", "/registro"],
};
