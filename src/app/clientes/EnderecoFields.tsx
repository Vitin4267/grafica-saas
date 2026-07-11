"use client";

import { useState } from "react";
import { Input } from "@/components/ui/Input";

export type ValoresEndereco = {
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  municipio: string;
  uf: string;
  codigoIbge: string;
};

export const ENDERECO_VAZIO: ValoresEndereco = {
  cep: "",
  logradouro: "",
  numero: "",
  complemento: "",
  bairro: "",
  municipio: "",
  uf: "",
  codigoIbge: "",
};

// Mantém formato 00000-000 enquanto digita — nunca converte pra number (CEP
// começa com 0 em várias regiões do país, "01310-100" viraria 1310100).
function formatarCep(valor: string): string {
  const digitos = valor.replace(/\D/g, "").slice(0, 8);
  if (digitos.length <= 5) return digitos;
  return `${digitos.slice(0, 5)}-${digitos.slice(5)}`;
}

type RespostaViaCep = {
  erro?: boolean;
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  ibge?: string;
};

// Endereço completo é opcional pro cadastro comum, mas vira obrigatório na
// hora de emitir nota fiscal (ver NotaFiscalCard) — por isso o autopreenchimento
// por CEP aqui: ninguém gosta de digitar endereço à mão, e sem isso a fricção
// far a maioria nunca preencher até precisar emitir uma nota às pressas.
export function EnderecoFields({
  valoresIniciais,
}: {
  valoresIniciais: ValoresEndereco;
}) {
  const [endereco, setEndereco] = useState(valoresIniciais);
  const [buscandoCep, setBuscandoCep] = useState(false);

  const definirCampo = (campo: keyof ValoresEndereco) => (valor: string) =>
    setEndereco((atual) => ({ ...atual, [campo]: valor }));

  async function buscarPorCep(cepDigitado: string) {
    const cepLimpo = cepDigitado.replace(/\D/g, "");
    if (cepLimpo.length !== 8) return;

    setBuscandoCep(true);
    try {
      const resposta = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`);
      const dados: RespostaViaCep = await resposta.json();
      if (!dados.erro) {
        setEndereco((atual) => ({
          ...atual,
          logradouro: dados.logradouro || atual.logradouro,
          bairro: dados.bairro || atual.bairro,
          municipio: dados.localidade || atual.municipio,
          uf: dados.uf || atual.uf,
          codigoIbge: dados.ibge || atual.codigoIbge,
        }));
      }
    } catch {
      // CEP inválido ou ViaCEP fora do ar — usuário ainda preenche à mão.
    } finally {
      setBuscandoCep(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <input type="hidden" name="enderecoCodigoIbge" value={endereco.codigoIbge} />
      <Input
        label="CEP"
        name="enderecoCep"
        value={endereco.cep}
        onChange={(e) => definirCampo("cep")(formatarCep(e.target.value))}
        onBlur={(e) => buscarPorCep(e.target.value)}
        placeholder="00000-000"
        inputMode="numeric"
        maxLength={9}
        // Desligado de propósito: o navegador às vezes "adivinha" errado e
        // enfia o nome da rua salva aqui dentro. A busca por CEP (ViaCEP)
        // já cobre o autopreenchimento de forma confiável.
        autoComplete="off"
        hint={buscandoCep ? "Buscando endereço..." : undefined}
      />
      <Input
        label="Número"
        name="enderecoNumero"
        value={endereco.numero}
        onChange={(e) => definirCampo("numero")(e.target.value)}
        autoComplete="off"
      />
      <Input
        label="Logradouro"
        name="enderecoLogradouro"
        value={endereco.logradouro}
        onChange={(e) => definirCampo("logradouro")(e.target.value)}
        autoComplete="off"
      />
      <Input
        label="Complemento"
        name="enderecoComplemento"
        value={endereco.complemento}
        onChange={(e) => definirCampo("complemento")(e.target.value)}
        autoComplete="off"
      />
      <Input
        label="Bairro"
        name="enderecoBairro"
        value={endereco.bairro}
        onChange={(e) => definirCampo("bairro")(e.target.value)}
        autoComplete="off"
      />
      <Input
        label="Município"
        name="enderecoMunicipio"
        value={endereco.municipio}
        onChange={(e) => definirCampo("municipio")(e.target.value)}
        autoComplete="off"
      />
      <Input
        label="UF"
        name="enderecoUf"
        value={endereco.uf}
        onChange={(e) => definirCampo("uf")(e.target.value.toUpperCase())}
        maxLength={2}
        autoComplete="off"
      />
    </div>
  );
}
