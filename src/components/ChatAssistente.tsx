"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { SparklesIcon, XIcon } from "@/components/icons";
import { LINKS } from "@/components/UserNav";
import { verificarAssistenteDisponivel, enviarPerguntaAssistente } from "./ChatAssistente.actions";

type Mensagem = { autor: "usuario" | "assistente"; texto: string; erro?: boolean };

function rotularPagina(pathname: string): string {
  const link = LINKS.find((l) => pathname === l.href || pathname.startsWith(`${l.href}/`));
  return link?.label ?? pathname;
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

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {aberto ? (
        <Card className="flex h-[28rem] w-80 max-w-[calc(100vw-2rem)] flex-col p-0">
          <div className="flex items-center justify-between border-b border-slate-100 p-4 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <SparklesIcon className="h-4 w-4 text-teal-600 dark:text-teal-400" />
              <p className="text-sm font-semibold text-slate-900 dark:text-white">
                Assistente
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAberto(false)}
              aria-label="Fechar assistente"
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              <XIcon className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {mensagens.length === 0 && (
              <p className="text-sm text-slate-500">
                Pergunte como usar qualquer funcionalidade do site — não tenho
                acesso a orçamentos, clientes ou valores, só ajudo a navegar.
              </p>
            )}
            {mensagens.map((m, i) => (
              <div
                key={i}
                className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                  m.autor === "usuario"
                    ? "ml-auto bg-teal-600 text-white"
                    : m.erro
                      ? "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300"
                      : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                }`}
              >
                {m.texto}
              </div>
            ))}
            {enviando && (
              <div className="max-w-[85%] rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-400 dark:bg-slate-800">
                Digitando...
              </div>
            )}
            <div ref={fimDaListaRef} />
          </div>

          <form onSubmit={handleEnviar} className="flex gap-2 border-t border-slate-100 p-3 dark:border-slate-800">
            <input
              value={pergunta}
              onChange={(e) => setPergunta(e.target.value)}
              placeholder="Digite sua pergunta..."
              aria-label="Pergunta pro assistente"
              maxLength={500}
              disabled={enviando}
              className="w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-500 focus:ring-4 focus:ring-teal-500/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
            <Button type="submit" loading={enviando} className="!px-3 !py-2 text-xs">
              Enviar
            </Button>
          </form>
        </Card>
      ) : (
        <button
          type="button"
          onClick={() => setAberto(true)}
          aria-label="Abrir assistente"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-teal-600 text-white shadow-lg shadow-teal-600/30 transition-colors hover:bg-teal-700"
        >
          <SparklesIcon className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}
