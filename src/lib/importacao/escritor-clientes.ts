import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { clienteSchema } from "@/lib/clientes";
// import type: escritores.ts importa a FUNÇÃO deste arquivo — um import de
// valor aqui criaria dependência circular em runtime; tipo é apagado na
// compilação, então não tem esse problema.
import type { ResultadoEscritaLinha } from "./escritores";

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
  } = parsed.data;

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
