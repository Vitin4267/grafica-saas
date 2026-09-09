import { z } from "zod";
import { normalizarDocumento, validarCpf, validarCnpj } from "@/lib/documento";

const opcional = z.string().trim().max(160).optional().or(z.literal(""));

// Achado A2/Parte 5-Fiscal da auditoria de abrangência ("Fase A") — CPF/CNPJ
// do cliente, validado por dígito verificador de verdade (src/lib/documento.ts
// cobre CNPJ numérico E alfanumérico, padrão Serpro vigente desde
// 31/07/2026). Normaliza SEMPRE em silêncio (nunca rejeita só por
// pontuação) e só rejeita quando o dígito verificador não bate — mensagem
// única cobre os dois casos (tamanho errado nem chega a ser CPF/CNPJ
// possível, então cai na mesma rejeição). Campo continua opcional: sem
// documento (string vazia) é sempre aceito, mesmo comportamento de sempre.
//
// Cuidado com cadastro legado: esta validação roda toda vez que `documento`
// é passado pro schema. src/app/clientes/actions.ts (atualizarCliente) evita
// travar a edição de um cliente com documento sujo já salvo (sem DV válido)
// omitindo a chave `documento` do objeto passado a este schema quando o
// campo não foi de fato alterado no formulário — ver comentário lá.
const documentoOpcional = z
  .string()
  .trim()
  .max(40)
  .optional()
  .or(z.literal(""))
  .transform((valor) => (valor ? normalizarDocumento(valor) : valor))
  .refine(
    (valor) => {
      if (!valor) return true;
      if (valor.length === 11) return validarCpf(valor);
      if (valor.length === 14) return validarCnpj(valor);
      return false;
    },
    {
      message:
        "CPF/CNPJ inválido — confira o número digitado (CPF tem 11 dígitos, CNPJ tem 14 posições).",
    }
  );

// Texto livre mais longo — observacoes/preferenciasProducao (achado A11 da
// auditoria de abrangência) são notas/parágrafos, não um campo de linha
// única como telefone/email. Mesmo teto de Orcamento.observacoes
// (src/app/orcamento/actions.ts, campoTexto("observacoes", 2000)).
const textoLongoOpcional = z.string().trim().max(2000).optional().or(z.literal(""));

// Aceita "00000-000" ou só os 8 dígitos — nunca number (CEP começa com 0 em
// várias regiões do país, então precisa continuar texto o tempo todo).
const cepOpcional = z
  .string()
  .trim()
  .regex(/^\d{5}-?\d{3}$/, "CEP inválido — use o formato 00000-000")
  .optional()
  .or(z.literal(""));

export const clienteSchema = z.object({
  nome: z.string().trim().min(2, "Nome muito curto").max(120),
  email: z.union([z.string().trim().toLowerCase().email("E-mail inválido"), z.literal("")]).optional(),
  telefone: opcional,
  documento: documentoOpcional,
  enderecoCep: cepOpcional,
  enderecoLogradouro: opcional,
  enderecoNumero: opcional,
  enderecoComplemento: opcional,
  enderecoBairro: opcional,
  enderecoMunicipio: opcional,
  enderecoCodigoIbge: opcional,
  enderecoUf: opcional,
  // observacoes/preferenciasProducao/origem/origemOutro: achado A11.
  // origem chega como o valor bruto do enum OrigemCliente (form manual, ver
  // ClienteForm.tsx) ou como texto livre vindo da planilha de importação
  // (ver src/lib/importacao/escritor-clientes.ts, que normaliza pra um
  // valor válido antes de gravar) — por isso fica como string solta aqui,
  // não z.nativeEnum: a validação "é um valor conhecido do enum" acontece
  // em src/app/clientes/actions.ts (validarOrigem), mesmo padrão de
  // validarCategoria em configuracoes/maquinas/equipamentos/actions.ts.
  observacoes: textoLongoOpcional,
  preferenciasProducao: textoLongoOpcional,
  // Achado A6 da Parte 5 da auditoria de abrangência — nota financeira livre
  // (COMO cobrar este cliente), mesmo teto/tratamento de observacoes acima,
  // mas campo distinto (ver comentário em Cliente.observacaoFinanceira no
  // schema pra por que não é reaproveitado).
  observacaoFinanceira: textoLongoOpcional,
  origem: opcional,
  origemOutro: opcional,
  // segmento/segmentoOutro: achado A7 da auditoria de abrangência — mesmo
  // motivo de origem/origemOutro acima (string solta aqui, validação "é um
  // valor conhecido do enum" em src/app/clientes/actions.ts, validarSegmento).
  segmento: opcional,
  segmentoOutro: opcional,
  // tipoPessoa/indicadorInscricaoEstadual: achado A1 da auditoria de
  // abrangência — mesmo padrão de segmento/origem acima (string solta aqui,
  // validação "é um valor conhecido do enum" em src/app/clientes/actions.ts,
  // validarTipoPessoa/validarIndicadorInscricaoEstadual).
  tipoPessoa: opcional,
  razaoSocial: opcional,
  nomeFantasia: opcional,
  inscricaoEstadual: opcional,
  indicadorInscricaoEstadual: opcional,
  inscricaoMunicipal: opcional,
});
