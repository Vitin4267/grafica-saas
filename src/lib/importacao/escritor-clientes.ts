import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { OrigemCliente } from "@/generated/prisma/enums";
import { clienteSchema } from "@/lib/clientes";
// import type: escritores.ts importa a FUNÇÃO deste arquivo — um import de
// valor aqui criaria dependência circular em runtime; tipo é apagado na
// compilação, então não tem esse problema.
import type { ResultadoEscritaLinha } from "./escritores";

// Fuzzy-match de texto livre pro enum OrigemCliente — nunca falha (mesmo
// espírito de normalizarUnidade/normalizarTipoItem em escritor-catalogo.ts):
// planilha sem coluna "origem" cai em undefined (não força nada), e um valor
// que não bate com nenhuma regra conhecida vira OUTRO + o texto original
// (mesmo padrão de unidadeOutro), nunca rejeita a linha inteira.
const REGRAS_ORIGEM: { testa: (v: string) => boolean; origem: OrigemCliente }[] = [
  { testa: (v) => /indica/.test(v), origem: "INDICACAO" },
  { testa: (v) => /instagram|facebook|whatsapp|rede\s*social|redes\s*sociais/.test(v), origem: "REDES_SOCIAIS" },
  { testa: (v) => /google|site|busca/.test(v), origem: "BUSCA_GOOGLE" },
  { testa: (v) => /an[uú]ncio|propaganda|\bads\b/.test(v), origem: "ANUNCIO" },
  { testa: (v) => /feira|evento/.test(v), origem: "FEIRA_EVENTO" },
  { testa: (v) => /prospec/.test(v), origem: "PROSPECCAO_ATIVA" },
  { testa: (v) => /antigo|voltou/.test(v), origem: "CLIENTE_ANTIGO" },
];

function normalizarOrigemCliente(
  valor: string | undefined
): { origem: OrigemCliente | undefined; origemOutro: string | undefined } {
  const texto = valor?.trim();
  if (!texto) return { origem: undefined, origemOutro: undefined };
  const minusculo = texto.toLowerCase();
  const regra = REGRAS_ORIGEM.find((r) => r.testa(minusculo));
  if (regra) return { origem: regra.origem, origemOutro: undefined };
  return { origem: "OUTRO", origemOutro: texto.slice(0, 160) };
}

// Grava UMA linha já mapeada de uma planilha de Clientes — reusa clienteSchema
// byte-a-byte (mesma validação do cadastro manual em src/app/clientes/actions.ts,
// já que `linha` chega com as mesmas chaves que CAMPOS_CLIENTES declara) e o
// mesmo padrão de campo-vazio-vira-null + catch de P2002 daquela action.
export async function escreverLinhaCliente(
  tx: Prisma.TransactionClient,
  graficaId: string,
  linha: Record<string, string>
): Promise<ResultadoEscritaLinha> {
  const parsed = clienteSchema.safeParse(linha);
  if (!parsed.success) {
    return { ok: false, mensagem: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const {
    nome,
    email,
    telefone,
    documento,
    enderecoCep,
    enderecoLogradouro,
    enderecoNumero,
    enderecoComplemento,
    enderecoBairro,
    enderecoMunicipio,
    enderecoCodigoIbge,
    enderecoUf,
    observacoes,
    preferenciasProducao,
  } = parsed.data;

  // origem chega como texto livre da planilha (não a chave exata do enum,
  // diferente do <select> do cadastro manual) — normalizarOrigemCliente faz
  // o fuzzy-match, mesmo raciocínio de normalizarUnidade pro catálogo.
  const { origem, origemOutro } = normalizarOrigemCliente(parsed.data.origem);

  try {
    await tx.cliente.create({
      data: {
        graficaId,
        nome,
        email: email || null,
        telefone: telefone || null,
        documento: documento || null,
        enderecoCep: enderecoCep || null,
        enderecoLogradouro: enderecoLogradouro || null,
        enderecoNumero: enderecoNumero || null,
        enderecoComplemento: enderecoComplemento || null,
        enderecoBairro: enderecoBairro || null,
        enderecoMunicipio: enderecoMunicipio || null,
        enderecoCodigoIbge: enderecoCodigoIbge || null,
        enderecoUf: enderecoUf || null,
        observacoes: observacoes || null,
        preferenciasProducao: preferenciasProducao || null,
        origem: origem ?? null,
        origemOutro: origemOutro ?? null,
      },
    });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      return { ok: false, mensagem: "Já existe um cliente com esse CPF/CNPJ." };
    }
    throw erro;
  }

  return { ok: true };
}
