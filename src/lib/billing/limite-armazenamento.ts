// Puro (sem "server-only", sem Prisma, sem @vercel/blob) — testável isolado,
// mesmo padrão de src/lib/billing/limite-uso.ts. Sem "server-only" de
// propósito: cabeNoLimite precisa ser importável de um client component
// (pré-checagem no onChange do input de arquivo, mesmo padrão de
// validarArquivoArte em src/lib/upload-validacao.ts).
import type { StatusAssinatura } from "@/generated/prisma/enums";

export const LIMITE_ARMAZENAMENTO_TRIAL_MB = 250;
// Teto pra cortesia (sem stripePriceId, custo já avaliado na origem por
// quem concede) e pra price desconhecido/grandfathered — nunca "sem limite"
// de verdade (armazenamento tem custo direto, ao contrário de orçamentos).
export const LIMITE_ARMAZENAMENTO_SEM_PLANO_MB = 100 * 1024;

export function mbParaBytes(mb: number): number {
  return mb * 1024 * 1024;
}

// pt-BR, vírgula decimal. Arredonda ANTES de decidir a unidade — sem isso,
// um valor como 1023,96 KB vira "1024,0 KB" (deveria subir pra "1,0 MB").
export function formatarBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`;

  const unidades = ["KB", "MB", "GB", "TB"] as const;
  let valor = bytes / 1024;
  let indice = 0;
  while (indice < unidades.length - 1) {
    const arredondado = Number(valor.toFixed(1));
    if (arredondado < 1024) break;
    valor /= 1024;
    indice++;
  }
  return `${valor.toFixed(1).replace(".", ",")} ${unidades[indice]}`;
}

// Resolve o teto de armazenamento (em MB) aplicável — chamado com o plano já
// resolvido a partir do stripePriceId (mesmo padrão de recursos-pagos.ts).
// Ordem das regras importa: cortesia > sem plano (por status) > plano.
export function resolverLimiteArmazenamentoMb(contexto: {
  status: StatusAssinatura | null;
  cortesia: boolean;
  plano: { limiteArmazenamentoMb: number } | null;
}): number {
  if (contexto.cortesia) return LIMITE_ARMAZENAMENTO_SEM_PLANO_MB;
  if (!contexto.plano) {
    // Trial sem plano nenhum (caso normal: ninguém assinou ainda) usa o teto
    // de trial. Qualquer outro status sem plano (inadimplente/cancelada/
    // grandfathered) cai no teto alto — na prática nem chega a fazer upload,
    // porque exigirAssinaturaAtiva já bloqueou a navegação antes disso.
    return contexto.status === "TRIALING" ? LIMITE_ARMAZENAMENTO_TRIAL_MB : LIMITE_ARMAZENAMENTO_SEM_PLANO_MB;
  }
  return contexto.plano.limiteArmazenamentoMb;
}

// bytesLiberados = bytes do arquivo que está sendo SUBSTITUÍDO nesta mesma
// operação (a linha antiga só é removida do razão depois que a nova for
// confirmada — ver reservarEspaco/confirmarArquivo em armazenamento.ts).
// Sem isso, um tenant a 100% da cota nunca conseguiria trocar uma arte por
// outra do mesmo tamanho — ficaria travado mesmo fazendo a coisa certa.
export function cabeNoLimite(input: {
  usadoBytes: number;
  bytesLiberados: number;
  arquivoBytes: number;
  limiteBytes: number;
}): boolean {
  return input.usadoBytes - input.bytesLiberados + input.arquivoBytes <= input.limiteBytes;
}

export function espacoDisponivelBytes(input: { usadoBytes: number; limiteBytes: number }): number {
  return Math.max(0, input.limiteBytes - input.usadoBytes);
}

export function percentualUsado(input: { usadoBytes: number; limiteBytes: number }): number {
  if (input.limiteBytes <= 0) return 100;
  return Math.min(100, Math.max(0, (input.usadoBytes / input.limiteBytes) * 100));
}

export function mensagemEspacoInsuficiente(input: {
  usadoBytes: number;
  limiteBytes: number;
  nomePlano: string;
  ehTrial: boolean;
}): string {
  const usado = formatarBytes(input.usadoBytes);
  const limite = formatarBytes(input.limiteBytes);
  return input.ehTrial
    ? `Seu espaço acabou — o teste gratuito inclui ${limite} e você já usou ${usado}. Apague uma arte antiga ou assine um plano pra liberar mais espaço.`
    : `Espaço cheio — o plano ${input.nomePlano} inclui ${limite} e você já usou ${usado}. Apague artes de pedidos antigos ou faça upgrade em Configurações › Assinatura.`;
}
