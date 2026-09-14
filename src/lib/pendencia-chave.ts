import type { PendenciaConfiguracao } from "./pendencias-configuracao";

// Função PURA (sem "server-only", sem Prisma) — de propósito num módulo à
// parte de pendencias-configuracao.ts (que é server-only) pra poder ser
// importada tanto no servidor (filtrar o que já foi dispensado, ver
// listarPendenciasConfiguracao) quanto no client component (montar a chave
// que vai pra dispensarPendencia ao clicar "Depois"). Só o TYPE de
// PendenciaConfiguracao é importado (import type é apagado em tempo de
// build, nunca puxa o runtime do módulo server-only junto).
//
// Chave por pendência (não um boolean único de "dispensei tudo") — assim
// uma pendência NOVA continua aparecendo mesmo que outras já tenham sido
// dispensadas na mesma sessão: cada tipo usa o identificador mais estável
// que tem (itemGraficaId pros tipos que apontam pra um produto, maquinaId
// pra bordado, faixaIndice pra alíquota — se o RBT12 cruzar de faixa do
// Simples, é situação nova o bastante pra valer reaparecer antes do login
// seguinte).
export function chaveDaPendencia(pendencia: PendenciaConfiguracao): string {
  switch (pendencia.tipo) {
    case "BOBINA_ETIQUETA_FALTANDO":
    case "PAPEL_MATERIA_PRIMA_FALTANDO":
    case "MAQUINA_NAO_VINCULADA":
    case "ACABAMENTO_SEM_CUSTO":
      return `${pendencia.tipo}:${pendencia.itemGraficaId}`;
    case "MAQUINA_BORDADO_SEM_VELOCIDADE":
      return `${pendencia.tipo}:${pendencia.maquinaId}`;
    case "ALIQUOTA_SIMPLES_ACIMA_DO_CONFIGURADO":
      return `${pendencia.tipo}:${pendencia.faixaIndice}`;
  }
}
