import "server-only";
import { headers } from "next/headers";

export async function obterIpRequisicao(): Promise<string> {
  const headerList = await headers();
  return headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "desconhecido";
}
