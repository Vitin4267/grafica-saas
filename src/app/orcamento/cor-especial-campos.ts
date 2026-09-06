// Tipos + funções PURAS de conversão pra CamposCorEspecial (achado F8 da
// auditoria de abrangência) — mesmo motivo de etiqueta-campos.ts existir à
// parte de CamposEtiquetaOrcamento.tsx ("use client"): page.tsx (Server
// Component) precisa chamar corEspecialParaCampos() direto, e React Server
// Components proíbe invocar função vinda de um módulo "use client".
import { gerarChave } from "@/lib/chave-local";

// Uma linha de cor especial editada no formulário — corEspecialId vazio
// ("") = nome digitado sem estar na biblioteca do cliente ainda (texto
// livre); preenchido = escolhida da biblioteca (ver CamposCorEspecialOrcamento.tsx).
// salvarNaBiblioteca só faz sentido junto de corEspecialId vazio.
export type CamposCorEspecial = {
  chave: string;
  corEspecialId: string;
  nomeDeclarado: string;
  salvarNaBiblioteca: boolean;
};

export function corEspecialLinhaInicial(): CamposCorEspecial {
  return { chave: gerarChave(), corEspecialId: "", nomeDeclarado: "", salvarNaBiblioteca: false };
}

// Inverso — carrega as linhas já salvas (OrcamentoItemCor, vindas do banco)
// pro formato controlado que CamposCorEspecialOrcamento.tsx edita. Chamado
// tanto no servidor (page.tsx, pra montar valoresIniciais) quanto no cliente
// (EditarOrcamentoForm.tsx).
export function coresEspeciaisParaCampos(
  linhas: { corEspecialId: string | null; nomeDeclarado: string }[]
): CamposCorEspecial[] {
  return linhas.map((c) => ({
    chave: gerarChave(),
    corEspecialId: c.corEspecialId ?? "",
    nomeDeclarado: c.nomeDeclarado,
    // Já está salva (é uma linha existente) — nunca marca pra salvar de novo.
    salvarNaBiblioteca: false,
  }));
}
