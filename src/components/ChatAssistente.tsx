"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { SparklesIcon, XIcon, ArrowRightIcon } from "@/components/icons";
import { verificarAssistenteDisponivel, enviarPerguntaAssistente } from "./ChatAssistente.actions";

type Mensagem = { autor: "usuario" | "assistente"; texto: string; erro?: boolean };

// Rótulo de área enviado no campo `pagina` do webhook do Assistente
// (ver webhook-assistente.ts) — usado do lado do n8n pra rotear a pergunta
// pro prompt de sistema certo (um por área), em vez de um prompt único
// tentando cobrir o site inteiro. Cobre TODAS as rotas autenticadas, não só
// o menu principal (LINKS, de UserNav.tsx) — Configurações e Financeiro têm
// sub-áreas com prompt próprio (Filiais/Fiscal e Importador saíram de
// "Configurações" de propósito, ver árvore de decisão da divisão em áreas).
// Ordem importa: prefixos mais específicos (`/configuracoes/filiais`) vêm
// antes do prefixo genérico (`/configuracoes`) que ele venceria por engano.
const AREAS_ASSISTENTE: { prefixo: string; area: string }[] = [
  { prefixo: "/orcamento", area: "Orçamento" },
  { prefixo: "/clientes", area: "Clientes" },
  { prefixo: "/catalogo", area: "Catálogo" },
  { prefixo: "/producao", area: "Produção" },
  { prefixo: "/financeiro", area: "Financeiro" },
  { prefixo: "/meu-negocio", area: "Meu Negócio" },
  { prefixo: "/importar", area: "Importador" },
  { prefixo: "/usuarios", area: "Usuários" },
  { prefixo: "/configuracoes/assinatura", area: "Assinatura" },
  { prefixo: "/configuracoes/filiais", area: "Filiais" },
  { prefixo: "/configuracoes/fiscal", area: "Filiais" },
  { prefixo: "/configuracoes", area: "Configurações" },
];

function rotularPagina(pathname: string): string {
  const encontrada = AREAS_ASSISTENTE.find(
    ({ prefixo }) => pathname === prefixo || pathname.startsWith(`${prefixo}/`)
  );
  return encontrada?.area ?? pathname;
}

// Widget autossuficiente, sem props: verifica sozinho (via Server Action) se
// a gráfica logada tem o assistente configurado, e só então mostra o botão
// flutuante — evita ter que passar uma prop nova em ~15 páginas que já
// renderizam <UserNav>. Ver plano em C:\Users\ferra\.claude\plans (contexto
// completo da decisão de design).
export function ChatAssistente() {
  const pathname = usePathname();
  const [disponivel, setDisponivel] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [pergunta, setPergunta] = useState("");
  const [enviando, setEnviando] = useState(false);
  const fimDaListaRef = useRef<HTMLDivElement>(null);
  // Um por montagem do widget (reseta ao recarregar a página) — dá memória
  // de conversa pro workflow n8n sem precisar persistir nada no navegador.
  // A gráfica é adicionada na frente disso no servidor, nunca aqui (ver
  // ChatAssistente.actions.ts) — este valor sozinho não tem significado de
  // tenant nenhum.
  const [sessaoId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    verificarAssistenteDisponivel().then(setDisponivel);
  }, []);

  useEffect(() => {
    fimDaListaRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensagens]);

  if (!disponivel) return null;

  async function handleEnviar(e: React.FormEvent) {
    e.preventDefault();
    const texto = pergunta.trim();
    if (!texto || enviando) return;

    setMensagens((atual) => [...atual, { autor: "usuario", texto }]);
    setPergunta("");
    setEnviando(true);

    const resultado = await enviarPerguntaAssistente(texto, rotularPagina(pathname ?? ""), sessaoId);

    setMensagens((atual) => [
      ...atual,
      resultado.ok
        ? { autor: "assistente", texto: resultado.resposta }
        : { autor: "assistente", texto: resultado.mensagem, erro: true },
    ]);
    setEnviando(false);
  }

  // Portal pro <body>: o widget é montado dentro de <header> (ver UserNav.tsx),
  // e esse header tem backdrop-blur — que, junto com transform/filter, cria um
  // novo "containing block" pra descendentes fixed, fazendo o "fixed bottom-4
  // right-4" virar relativo ao header (bem pequeno, no topo da página) em vez
  // da tela inteira. Portal evita depender de nenhum ancestral não ter essas
  // propriedades, hoje ou no futuro.
  return createPortal(
    <div className="fixed bottom-5 right-5 z-50">
      {aberto ? (
        <div
          className="flex h-[38rem] w-[26rem] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-[28px] border border-white/60 bg-white/95 shadow-[0_25px_70px_-15px_rgba(13,148,136,0.4)] backdrop-blur-xl motion-safe:animate-[assistente-pop_0.25s_ease-out] dark:border-white/10 dark:bg-slate-900/95 dark:shadow-[0_25px_70px_-15px_rgba(0,0,0,0.7)]"
        >
          <div className="flex items-center justify-between bg-gradient-to-r from-teal-600 via-teal-600 to-emerald-600 px-5 py-4 dark:from-teal-500 dark:via-teal-600 dark:to-emerald-700">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/25 backdrop-blur">
                <SparklesIcon className="h-4.5 w-4.5 text-white" />
              </div>
              <div>
                <p className="text-[15px] font-semibold tracking-tight text-white">
                  Assistente IA
                </p>
                <div className="flex items-center gap-1.5">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-300 motion-safe:animate-ping" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-300" />
                  </span>
                  <p className="text-[10.5px] font-medium uppercase tracking-widest text-white/75">
                    Online agora
                  </p>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setAberto(false)}
              aria-label="Fechar assistente"
              className="rounded-full p-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            >
              <XIcon className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto p-5">
            {mensagens.length === 0 && (
              <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-teal-200 bg-teal-50/50 px-4 py-6 text-center dark:border-teal-900 dark:bg-teal-950/20">
                <SparklesIcon className="h-5 w-5 text-teal-500 dark:text-teal-400" />
                <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                  Pergunte como usar qualquer funcionalidade do site — não
                  tenho acesso a orçamentos, clientes ou valores, só ajudo a
                  navegar.
                </p>
              </div>
            )}
            {mensagens.map((m, i) => (
              <div
                key={i}
                className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm ${
                  m.autor === "usuario"
                    ? "ml-auto bg-gradient-to-br from-teal-500 to-emerald-600 text-white shadow-teal-600/25"
                    : m.erro
                      ? "border border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300"
                      : "border border-slate-200/70 bg-slate-50/80 text-slate-700 backdrop-blur dark:border-slate-700/60 dark:bg-slate-800/80 dark:text-slate-200"
                }`}
              >
                {m.texto}
              </div>
            ))}
            {enviando && (
              <div className="flex max-w-[85%] items-center gap-1.5 rounded-2xl border border-slate-200/70 bg-slate-50/80 px-4 py-3 dark:border-slate-700/60 dark:bg-slate-800/80">
                <span className="h-1.5 w-1.5 rounded-full bg-teal-400 motion-safe:animate-bounce [animation-delay:-0.3s]" />
                <span className="h-1.5 w-1.5 rounded-full bg-teal-400 motion-safe:animate-bounce [animation-delay:-0.15s]" />
                <span className="h-1.5 w-1.5 rounded-full bg-teal-400 motion-safe:animate-bounce" />
              </div>
            )}
            <div ref={fimDaListaRef} />
          </div>

          <form
            onSubmit={handleEnviar}
            className="flex items-center gap-2 border-t border-slate-100 p-3.5 dark:border-slate-800"
          >
            <input
              value={pergunta}
              onChange={(e) => setPergunta(e.target.value)}
              placeholder="Digite sua pergunta..."
              aria-label="Pergunta pro assistente"
              maxLength={500}
              disabled={enviando}
              className="w-full min-w-0 rounded-full border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-500 focus:bg-white focus:ring-4 focus:ring-teal-500/15 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100 dark:focus:bg-slate-900"
            />
            <button
              type="submit"
              disabled={enviando}
              aria-label="Enviar pergunta"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-500 to-emerald-600 text-white shadow-md shadow-teal-600/30 transition-all hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {enviando ? (
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" />
                  <path
                    className="opacity-90"
                    d="M21 12a9 9 0 0 0-9-9"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                  />
                </svg>
              ) : (
                <ArrowRightIcon className="h-4.5 w-4.5" />
              )}
            </button>
          </form>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAberto(true)}
          aria-label="Abrir assistente"
          className="group relative flex h-16 w-16 items-center justify-center"
        >
          <span className="absolute inset-0 rounded-full bg-gradient-to-br from-teal-400 to-emerald-500 opacity-60 blur-lg motion-safe:animate-[assistente-glow_3s_ease-in-out_infinite]" />
          <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-teal-400 via-teal-500 to-emerald-600 text-white shadow-[0_10px_35px_-8px_rgba(13,148,136,0.65)] ring-1 ring-white/40 transition-transform duration-200 group-hover:scale-105 group-active:scale-95">
            <SparklesIcon className="h-7 w-7" />
          </span>
        </button>
      )}
    </div>,
    document.body
  );
}
