// Contrato de fornecimento com preço fixo por período — achado A9 da
// auditoria de abrangência (Parte 3/Compras, 2026-08-30). Ver comentário do
// model ContratoFornecimento no schema pro raciocínio completo (por que
// precoUnitario é sempre por unidade de ESTOQUE, por que unidadeCompra é só
// informativo, por que itemGraficaId/varianteId são opcionais).
//
// Lógica pura aqui (SEM Prisma) — obrigatório, já que NovaSolicitacaoForm
// (Client Component) importa `contratosAplicaveis`/`ContratoAtivoResumo`
// daqui: qualquer import de "@/lib/prisma" neste arquivo vazaria o driver
// `pg` pro bundle do navegador (quebra o build, "Module not found:
// util/types" — mesmo motivo pelo qual src/lib/dias-uteis.ts foi separado
// de data.ts). A consulta que TOCA o banco (listarContratosProximosDoLimite)
// fica em contrato-fornecimento-db.ts, mesma separação de
// src/lib/comparativo-fornecedores.ts / comparativo-fornecedores-db.ts.

// Resumo serializável de um contrato ATIVO e dentro da vigência, pronto pra
// passar do Server Component pro Client Component (datas em ISO, Decimal
// já convertido pra number) — ver NovaSolicitacaoForm.
export type ContratoAtivoResumo = {
  id: string;
  fornecedorId: string;
  fornecedorNome: string;
  itemGraficaId: string | null;
  varianteId: string | null;
  precoUnitario: number;
  unidadeCompra: string;
  unidadeCompraOutro: string | null;
  vigenciaFim: string; // ISO
};

// Contratos que se aplicam a uma seleção de matéria-prima/variante — usado
// pelo formulário de nova solicitação de compra pra mostrar "Contrato ativo:
// R$X/unidade até DD/MM" e oferecer "usar este contrato". Contrato
// específico (mesmo itemGraficaId, e mesma varianteId OU contrato sem
// variante própria cobrindo qualquer uma) entra sempre; contrato "coringa"
// (itemGraficaId null, cobre qualquer item deste fornecedor) também entra.
// Mais barato primeiro — não é uma decisão de negócio forte, só uma ordem
// determinística e útil (quem for escolher vê a opção mais vantajosa antes).
export function contratosAplicaveis(
  contratos: ContratoAtivoResumo[],
  itemGraficaId: string,
  varianteId: string | null
): ContratoAtivoResumo[] {
  return contratos
    .filter((c) => {
      if (c.itemGraficaId === null) return true; // coringa: qualquer item do fornecedor
      if (c.itemGraficaId !== itemGraficaId) return false;
      if (c.varianteId === null) return true; // cobre qualquer variante deste item
      return c.varianteId === varianteId;
    })
    .sort((a, b) => a.precoUnitario - b.precoUnitario);
}

// Limiares do alerta de "contrato esgotando" — fixos por ora (não
// configuráveis por gráfica, ao contrário de outros limiares do sistema como
// ParametrosGrafica.alertaPrazoLimiar1Dias). Decisão de escopo: não há ainda
// uso real validado que justifique um campo de configuração por tenant pra
// isto (ver princípio "configurabilidade em vez de hardcode" — só vale a
// pena depois que uma gráfica de verdade pedir um valor diferente).
export const DIAS_ALERTA_VIGENCIA_CONTRATO = 30;
export const PERCENTUAL_ALERTA_QUANTIDADE_CONTRATO = 0.9; // 90%

export type ContratoParaAlerta = {
  id: string;
  quantidadeContratada: number | null;
  quantidadeConsumida: number;
  vigenciaFim: Date;
};

export type AlertaContrato = {
  diasRestantesVigencia: number;
  vigenciaProxima: boolean;
  percentualConsumido: number | null;
  quantidadeProxima: boolean;
};

// Calcula os dois motivos de alerta (vigência perto do fim OU quantidade
// perto do teto) pra UM contrato — função pura, testável sem banco.
// diasRestantesVigencia negativo = contrato já passou da vigenciaFim mas
// ainda está ativo=true (não foi desativado) — conta como "esgotando" (na
// prática, "já esgotou e ninguém desligou ainda"), decisão deliberada de
// tratar os dois casos com o mesmo alerta em vez de um terceiro estado.
export function calcularAlertaContrato(contrato: ContratoParaAlerta, agora: Date = new Date()): AlertaContrato {
  const MS_POR_DIA = 24 * 60 * 60 * 1000;
  const diasRestantesVigencia = Math.ceil((contrato.vigenciaFim.getTime() - agora.getTime()) / MS_POR_DIA);
  const vigenciaProxima = diasRestantesVigencia <= DIAS_ALERTA_VIGENCIA_CONTRATO;

  const percentualConsumido =
    contrato.quantidadeContratada !== null && contrato.quantidadeContratada > 0
      ? contrato.quantidadeConsumida / contrato.quantidadeContratada
      : null;
  const quantidadeProxima = percentualConsumido !== null && percentualConsumido >= PERCENTUAL_ALERTA_QUANTIDADE_CONTRATO;

  return { diasRestantesVigencia, vigenciaProxima, percentualConsumido, quantidadeProxima };
}

export type ContratoProximoDoLimite = {
  id: string;
  fornecedorNome: string;
  itemNome: string | null;
  vigenciaFim: Date;
  quantidadeContratada: number | null;
  quantidadeConsumida: number;
} & AlertaContrato;
