export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold ${className}`}>
      {/* Só o ícone (papéis CMYK dobrados) do logotipo novo — o "GrafPro" da
          arte original é texto BRANCO fixo (pensado pra fundo escuro), então
          continuamos desenhando o texto em código ao lado, que já se adapta
          a claro/escuro (ver span abaixo) em vez de usar o texto embutido na
          imagem, que ficaria ilegível no cabeçalho em modo claro. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- ícone fixo de
          32px, next/image não traz ganho real aqui. */}
      <img src="/logo-icon.png" alt="" className="h-8 w-8 object-contain" />
      <span className="text-slate-900 dark:text-slate-50">
        Graf<span className="text-teal-600">Pro</span>
      </span>
    </span>
  );
}
