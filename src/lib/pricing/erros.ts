export type CodigoErroPrecificacao =
  | "QUANTIDADE_INVALIDA"
  | "DIMENSAO_INVALIDA"
  | "PECA_EXCEDE_BOBINA"
  | "PECA_EXCEDE_FOLHA"
  | "PECA_EXCEDE_SUPORTE"
  | "MATERIAL_SEM_BOBINA"
  | "MATERIAL_SEM_FOLHA"
  | "PRENSA_NAO_CONFIGURADA"
  | "PAPEL_NAO_CONFIGURADO"
  | "PAPEL_SEM_TABELA_PRECO"
  | "CUSTO_INVALIDO"
  | "GRAMATURA_INVALIDA"
  | "ENCARGOS_INVALIDOS"
  | "PRECO_ABAIXO_DO_CUSTO"
  | "ETIQUETA_SEM_PAPEL"
  | "PAPEL_INVALIDO";

// Erro estruturado: o motor nunca retorna NaN ou um preço silenciosamente errado —
// sempre um código + mensagem + detalhes que a UI pode mostrar de forma útil.
export class ErroPrecificacao extends Error {
  constructor(
    public readonly codigo: CodigoErroPrecificacao,
    mensagem: string,
    public readonly detalhes?: Record<string, unknown>
  ) {
    super(mensagem);
    this.name = "ErroPrecificacao";
  }
}
