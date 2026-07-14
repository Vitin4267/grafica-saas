"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { XIcon } from "@/components/icons";

// Sempre roda só na primeira visita pós-cadastro (ver /bem-vindo — "Vamos
// começar" leva pra /comecar?tour=1). Como só existe pra um DONO recém-criado,
// que sempre tem acesso a tudo, a lista é fixa — não precisa replicar o filtro
// de módulos do UserNav aqui. Se um passo não existir na tela (defensivo, caso
// isso mude no futuro), ele é pulado automaticamente.
const PASSOS = [
  {
    href: "/meu-negocio",
    titulo: "Meu Negócio",
    texto: "O resumo geral: faturamento do mês, produção, estoque e seus melhores clientes.",
  },
  {
    href: "/orcamento",
    titulo: "Orçamento",
    texto: "Monte orçamentos em segundos — escolha o cliente e o produto, o preço sai calculado na hora.",
  },
  {
    href: "/clientes",
    titulo: "Clientes",
    texto: "Cadastre seus clientes uma vez e reaproveite em todos os orçamentos futuros.",
  },
  {
    href: "/producao",
    titulo: "Produção",
    texto: "Acompanhe os pedidos aprovados, da fila até a entrega.",
  },
  {
    href: "/catalogo",
    titulo: "Catálogo",
    texto: "Defina o que sua gráfica vende e os preços de cada produto ou serviço.",
  },
  {
    href: "/financeiro",
    titulo: "Financeiro",
    texto: "Controle contas a pagar, despesas recorrentes e o relatório pro contador.",
  },
  {
    href: "/configuracoes",
    titulo: "Configurações",
    texto: "Ajuste parâmetros de cálculo, prensas e dados fiscais da gráfica.",
  },
  {
    href: "/usuarios",
    titulo: "Usuários",
    texto: "Convide sua equipe e escolha o que cada pessoa pode ver e editar.",
  },
  {
    href: "/configuracoes/assinatura",
    titulo: "Assinatura",
    texto: "Veja seu plano atual, uso do mês e gerencie a cobrança da sua gráfica.",
  },
] as const;

type Retangulo = { top: number; left: number; width: number; height: number };

function medirAlvo(href: string): Retangulo | null {
  const elemento = document.querySelector<HTMLElement>(`[data-tour="${href}"]`);
  if (!elemento) return null;
  const rect = elemento.getBoundingClientRect();
  // `hidden sm:flex` no menu desktop deixa o elemento no DOM mas com
  // width/height zerados abaixo do breakpoint — trata como "não encontrado"
  // pra não iluminar um retângulo fantasma no canto da tela no celular (o
  // menu mobile é um painel separado, sem esses `data-tour`; ver UserNav).
  if (rect.width === 0 || rect.height === 0) return null;
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

export function TourAbas({ ativo }: { ativo: boolean }) {
  const router = useRouter();
  const [passo, setPasso] = useState(0);
  const [rodando, setRodando] = useState(ativo);
  const [alvo, setAlvo] = useState<Retangulo | null>(null);

  useEffect(() => {
    if (!rodando) return;

    function atualizarPosicao() {
      // Passo sem elemento correspondente na tela (defensivo) — pula direto
      // pro próximo em vez de travar o tour numa etapa fantasma.
      let indice = passo;
      let rect = medirAlvo(PASSOS[indice].href);
      while (!rect && indice < PASSOS.length - 1) {
        indice += 1;
        rect = medirAlvo(PASSOS[indice].href);
      }
      if (indice !== passo) {
        setPasso(indice);
        return;
      }
      setAlvo(rect);
    }

    atualizarPosicao();
    window.addEventListener("resize", atualizarPosicao);
    return () => window.removeEventListener("resize", atualizarPosicao);
  }, [passo, rodando]);

  useEffect(() => {
    if (!rodando) return;
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") encerrar();
    }
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rodando]);

  function encerrar() {
    setRodando(false);
    router.replace("/comecar");
  }

  if (!rodando || !alvo) return null;

  const ultimoPasso = passo === PASSOS.length - 1;
  const dados = PASSOS[passo];

  // Tooltip abaixo do alvo por padrão; se não couber (nav no rodapé da tela
  // em telas baixas), evita nascer fora da viewport clampando a distância do
  // topo — cenário raro (nav é sticky no topo), mas barato de cobrir.
  const topoTooltip = Math.min(alvo.top + alvo.height + 12, window.innerHeight - 220);
  const esquerdaTooltip = Math.min(Math.max(alvo.left, 16), window.innerWidth - 336);

  return (
    <div className="fixed inset-0 z-50">
      <div
        aria-hidden
        className="fixed rounded-xl transition-all duration-300 ease-out motion-reduce:transition-none"
        style={{
          top: alvo.top - 6,
          left: alvo.left - 8,
          width: alvo.width + 16,
          height: alvo.height + 12,
          boxShadow: "0 0 0 9999px rgba(15, 23, 42, 0.6)",
        }}
      />

      <div
        role="dialog"
        aria-label={`Guia rápido: ${dados.titulo}`}
        className="fixed w-80 rounded-2xl border border-slate-200 bg-white p-5 shadow-xl transition-all duration-300 ease-out motion-reduce:transition-none dark:border-slate-700 dark:bg-slate-900"
        style={{ top: topoTooltip, left: esquerdaTooltip }}
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <p className="text-xs font-medium text-teal-600 dark:text-teal-400">
              {passo + 1} de {PASSOS.length}
            </p>
            <h3 className="font-semibold text-slate-900 dark:text-white">{dados.titulo}</h3>
          </div>
          <button
            type="button"
            onClick={encerrar}
            aria-label="Fechar guia"
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-5 text-sm text-slate-600 dark:text-slate-400">{dados.texto}</p>

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={encerrar}
            className="text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
          >
            Pular
          </button>
          <div className="flex items-center gap-2">
            {passo > 0 && (
              <Button type="button" variant="outline" onClick={() => setPasso((p) => p - 1)}>
                Voltar
              </Button>
            )}
            <Button
              type="button"
              onClick={() => (ultimoPasso ? encerrar() : setPasso((p) => p + 1))}
            >
              {ultimoPasso ? "Concluir" : "Próximo"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
