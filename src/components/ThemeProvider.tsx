"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

// attribute="class" liga no .dark que globals.css usa via @custom-variant
// dark. disableTransitionOnChange evita um flash de cores "transicionando"
// no instante em que o usuário troca de tema (troca instantânea, sem CSS
// transition rodando nesse momento específico).
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </NextThemesProvider>
  );
}
