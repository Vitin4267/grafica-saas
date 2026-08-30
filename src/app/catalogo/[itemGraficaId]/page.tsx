import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import {
  podeVerMeuNegocio,
  exigirVerModulo,
  obterModulosVisiveis,
} from "@/lib/auth/permissoes";
import { UserNav } from "@/components/UserNav";
import { Card } from "@/components/ui/Card";
import { ArrowLeftIcon } from "@/components/icons";
import { ConfiguracaoProdutoForm } from "./ConfiguracaoProdutoForm";
import { ConfiguracaoAcabamentoForm } from "./ConfiguracaoAcabamentoForm";
import { ConfiguracaoClicheEtiquetaForm } from "./ConfiguracaoClicheEtiquetaForm";
import { ConfiguracaoEmendaForm } from "./ConfiguracaoEmendaForm";
import { FichaTecnicaForm } from "./FichaTecnicaForm";
import { TabelaGramaturaForm } from "./TabelaGramaturaForm";
import { VariantesMateriaPrimaForm } from "./VariantesMateriaPrimaForm";
import { NcmForm } from "./NcmForm";
import { LancarMovimentacaoForm } from "./LancarMovimentacaoForm";
import { QuantidadePorEmbalagemForm } from "./QuantidadePorEmbalagemForm";
import { ROTULOS_TIPO_MOVIMENTACAO } from "@/lib/estoque-manual";
import { rotuloUnidade } from "@/lib/unidade";
import { formatoMoeda } from "@/lib/moeda";
import { formatoInstanteRealComHora } from "@/lib/data";
import { indexarManutencoesAtivasPorMaquina } from "@/lib/manutencao-maquina";
import type { TipoMovimentacao } from "@/generated/prisma/enums";

const LIMITE_HISTORICO_MOVIMENTACAO = 100;

const formatoQuantidadeAbs = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4 });

// SAIDA_PRODUCAO/SAIDA_MANUAL sempre gravam `quantidade` positiva (magnitude
// da baixa) — o sinal exibido vem do TIPO, não do valor no banco.
// ESTORNO_CANCELAMENTO/ENTRADA_COMPRA idem, na direção contrária.
// AJUSTE_INVENTARIO é o único que já grava um delta com sinal (ver
// calcularDeltaAjusteInventario) — nesse caso o sinal exibido é o do valor.
const TIPOS_SAIDA: TipoMovimentacao[] = ["SAIDA_PRODUCAO", "SAIDA_MANUAL"];
const TIPOS_ENTRADA: TipoMovimentacao[] = ["ESTORNO_CANCELAMENTO", "ENTRADA_COMPRA"];

function formatarQuantidadeMovimentacao(tipo: TipoMovimentacao, valor: unknown): string {
  const texto = formatoQuantidadeAbs.format(Math.abs(Number(valor)));
  if (TIPOS_SAIDA.includes(tipo)) return `-${texto}`;
  if (TIPOS_ENTRADA.includes(tipo)) return `+${texto}`;
  return Number(valor) < 0 ? `-${texto}` : `+${texto}`;
}

function formatarCustoUnitario(valor: unknown): string {
  return valor === null || valor === undefined ? "—" : formatoMoeda.format(Number(valor));
}

export default async function ConfiguracaoItemPage({
  params,
}: {
  params: Promise<{ itemGraficaId: string }>;
}) {
  const { itemGraficaId } = await params;
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  await exigirVerModulo(usuario, "CATALOGO");

  const [
    itemGrafica,
    materiasPrimas,
    prensas,
    maquinasFlexografia,
    impressorasDigitais,
    maquinasSetupPorPeca,
    fornecedores,
    registrosAtivos,
  ] = await Promise.all([
      prisma.itemGrafica.findFirst({
        where: { id: itemGraficaId, graficaId: usuario.graficaId },
        include: {
          itemCatalogo: true,
          bobinas: { orderBy: { larguraNominal: "asc" } },
          formatosFolha: { orderBy: { nome: "asc" } },
          configuracaoAcabamento: true,
          configuracaoClicheEtiqueta: true,
          configuracaoEmenda: true,
          configuracaoClicheFlexografia: true,
          fichaTecnica: true,
          tabelaPrecoPapel: { orderBy: { gramatura: "asc" } },
          variantes: { where: { ativo: true }, orderBy: { rotulo: "asc" } },
          movimentacoes: {
            orderBy: { createdAt: "desc" },
            take: LIMITE_HISTORICO_MOVIMENTACAO,
            include: { variante: { select: { rotulo: true } }, fornecedor: { select: { nome: true } } },
          },
        },
      }),
      prisma.itemGrafica.findMany({
        where: {
          graficaId: usuario.graficaId,
          ativo: true,
          itemCatalogo: { tipo: "MATERIA_PRIMA" },
        },
        include: {
          itemCatalogo: true,
          tabelaPrecoPapel: true,
          variantes: { where: { ativo: true }, orderBy: { rotulo: "asc" } },
        },
        orderBy: { itemCatalogo: { nome: "asc" } },
      }),
      prisma.prensa.findMany({
        where: { graficaId: usuario.graficaId, ativa: true },
        orderBy: { nome: "asc" },
      }),
      prisma.maquinaFlexografia.findMany({
        where: { graficaId: usuario.graficaId, ativa: true },
        orderBy: { nome: "asc" },
      }),
      prisma.impressoraDigital.findMany({
        where: { graficaId: usuario.graficaId, ativa: true },
        orderBy: { nome: "asc" },
      }),
      prisma.maquinaSetupPorPeca.findMany({
        where: { graficaId: usuario.graficaId, ativa: true },
        orderBy: { nome: "asc" },
      }),
      prisma.fornecedor.findMany({
        where: { graficaId: usuario.graficaId, ativo: true },
        orderBy: { nome: "asc" },
        select: { id: true, nome: true },
      }),
      // Só pra avisar (não bloquear) na seleção de prensa/máquina abaixo se a
      // escolhida está com uma parada em andamento agora — ver
      // ManutencaoMaquinaAlerta em ConfiguracaoProdutoForm.
      prisma.registroManutencao.findMany({
        where: { graficaId: usuario.graficaId, dataFim: null },
        select: {
          prensaId: true,
          maquinaFlexografiaId: true,
          equipamentoId: true,
          impressoraDigitalId: true,
          maquinaSetupPorPecaId: true,
        },
      }),
    ]);

  if (!itemGrafica) {
    notFound();
  }

  const idsMaquinasEmManutencao = new Set(
    indexarManutencoesAtivasPorMaquina(registrosAtivos).keys()
  );

  // Resolve criadoPorId -> nome pro histórico de movimentação (a tabela não
  // tem relação direta com Usuario — ver comentário do campo no schema).
  // Batch numa única query, não uma por linha do histórico. null =
  // movimentação gerada pelo sistema, vira "Sistema" na tela.
  const idsCriadores = [
    ...new Set(itemGrafica.movimentacoes.map((m) => m.criadoPorId).filter((id): id is string => id !== null)),
  ];
  const criadores =
    idsCriadores.length > 0
      ? await prisma.usuario.findMany({
          where: { id: { in: idsCriadores }, graficaId: usuario.graficaId },
          select: { id: true, nome: true },
        })
      : [];
  const nomePorCriadorId = new Map(criadores.map((c) => [c.id, c.nome]));

  // Rótulo da unidade cadastrada (ex: "pacote") e a conversão pra unidades
  // individuais quando o fator de conversão está cadastrado — puramente
  // informativo, ver QuantidadePorEmbalagemForm.
  const unidadeRotulo = rotuloUnidade(
    itemGrafica.itemCatalogo.unidade,
    itemGrafica.itemCatalogo.unidadeOutro
  );
  const conversaoEmbalagem =
    itemGrafica.quantidadePorEmbalagem !== null && itemGrafica.estoqueAtual !== null
      ? Number(itemGrafica.estoqueAtual) * Number(itemGrafica.quantidadePorEmbalagem)
      : null;

  return (
    <div className="flex flex-1 flex-col">
      <UserNav
        nome={usuario.nome}
        graficaNome={usuario.grafica.nome}
        papel={usuario.papel}
        paginaAtual="/catalogo"
        mostrarMeuNegocio={podeVerMeuNegocio(usuario)}
        modulosVisiveis={await obterModulosVisiveis(usuario)}
      />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <Link
          href="/catalogo"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Voltar ao catálogo
        </Link>

        <div className="mb-8">
          <p className="text-sm font-medium text-teal-700 dark:text-teal-400">
            {itemGrafica.itemCatalogo.categoria}
          </p>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            {itemGrafica.itemCatalogo.nome}
          </h1>
          <p className="mt-1 text-slate-500">
            Configuração avançada de cálculo. Preço de compra e venda
            continuam editáveis em{" "}
            <Link href="/catalogo" className="underline">
              Catálogo
            </Link>
            .
          </p>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Card className="p-4">
            <p className="text-xs text-slate-500">Preço de compra</p>
            <p className="font-semibold text-slate-900 dark:text-white">
              {itemGrafica.precoCompra
                ? `R$ ${Number(itemGrafica.precoCompra).toFixed(2)}`
                : "—"}
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-slate-500">Preço de venda</p>
            <p className="font-semibold text-slate-900 dark:text-white">
              {itemGrafica.precoVenda
                ? `R$ ${Number(itemGrafica.precoVenda).toFixed(2)}`
                : "—"}
            </p>
          </Card>
        </div>

        {itemGrafica.itemCatalogo.tipo === "PRODUTO" ? (
          <div className="flex flex-col gap-6">
            <NcmForm
              itemCatalogoId={itemGrafica.itemCatalogoId}
              ncmAtual={itemGrafica.itemCatalogo.ncm ?? ""}
            />
            <ConfiguracaoProdutoForm
              itemGraficaId={itemGrafica.id}
              modeloCalculo={itemGrafica.modeloCalculo}
              viraFolha={itemGrafica.viraFolha}
              custoImpressaoM2={itemGrafica.custoImpressaoM2?.toString() ?? ""}
              areaMinimaFaturavel={itemGrafica.areaMinimaFaturavel?.toString() ?? ""}
              gramaturaGm2={itemGrafica.gramaturaGm2?.toString() ?? ""}
              papelId={itemGrafica.papelId ?? ""}
              papeis={materiasPrimas.map((m) => ({
                id: m.id,
                nome: m.itemCatalogo.nome,
                gramaturas: m.tabelaPrecoPapel.map((l) => l.gramatura).sort((a, b) => a - b),
              }))}
              prensaId={itemGrafica.prensaId ?? ""}
              prensas={prensas.map((p) => ({
                id: p.id,
                nome: p.nome,
                emManutencao: idsMaquinasEmManutencao.has(p.id),
              }))}
              bobinas={itemGrafica.bobinas.map((b) => ({
                larguraNominal: b.larguraNominal.toString(),
                refile: b.refile.toString(),
              }))}
              formatosFolha={itemGrafica.formatosFolha.map((f) => ({
                nome: f.nome,
                larguraFolha: f.larguraFolha.toString(),
                alturaFolha: f.alturaFolha.toString(),
              }))}
              unidadeContagem={itemGrafica.unidadeContagem ?? ""}
              fatorConversao={itemGrafica.fatorConversao?.toString() ?? ""}
              maquinaFlexografiaId={itemGrafica.maquinaFlexografiaId ?? ""}
              maquinasFlexografia={maquinasFlexografia.map((m) => ({
                id: m.id,
                nome: m.nome,
                emManutencao: idsMaquinasEmManutencao.has(m.id),
              }))}
              custoClichePorCm2Flexo={
                itemGrafica.configuracaoClicheFlexografia?.custoClichePorCm2.toString() ?? ""
              }
              impressoraDigitalId={itemGrafica.impressoraDigitalId ?? ""}
              impressorasDigitais={impressorasDigitais.map((i) => ({
                id: i.id,
                nome: i.nome,
                emManutencao: idsMaquinasEmManutencao.has(i.id),
              }))}
              maquinaSetupPorPecaId={itemGrafica.maquinaSetupPorPecaId ?? ""}
              maquinasSetupPorPeca={maquinasSetupPorPeca.map((m) => ({
                id: m.id,
                nome: m.nome,
                emManutencao: idsMaquinasEmManutencao.has(m.id),
                tipoProcesso: m.tipoProcesso,
              }))}
            />
            {itemGrafica.modeloCalculo === "M2" && (
              <ConfiguracaoClicheEtiquetaForm
                itemGraficaId={itemGrafica.id}
                configuracao={
                  itemGrafica.configuracaoClicheEtiqueta
                    ? {
                        custoClichePorCm2:
                          itemGrafica.configuracaoClicheEtiqueta.custoClichePorCm2.toString(),
                      }
                    : null
                }
              />
            )}
            {itemGrafica.modeloCalculo === "M2" && (
              <ConfiguracaoEmendaForm
                itemGraficaId={itemGrafica.id}
                configuracao={
                  itemGrafica.configuracaoEmenda
                    ? {
                        custoPorMetroLinear: itemGrafica.configuracaoEmenda.custoPorMetroLinear.toString(),
                        sobreposicaoM: itemGrafica.configuracaoEmenda.sobreposicaoM.toString(),
                      }
                    : null
                }
              />
            )}
            <FichaTecnicaForm
              itemGraficaId={itemGrafica.id}
              materiasPrimas={materiasPrimas.map((m) => ({
                id: m.id,
                nome: m.itemCatalogo.nome,
                unidade: m.itemCatalogo.unidade,
                unidadeOutro: m.itemCatalogo.unidadeOutro,
                variantes: m.variantes.map((v) => ({ id: v.id, rotulo: v.rotulo })),
              }))}
              fichaAtual={itemGrafica.fichaTecnica.map((f) => ({
                materiaPrimaId: f.materiaPrimaId,
                varianteId: f.varianteId ?? "",
                quantidadePorUnidade: f.quantidadePorUnidade.toString(),
              }))}
            />
          </div>
        ) : itemGrafica.itemCatalogo.tipo === "MATERIA_PRIMA" ? (
          <div className="flex flex-col gap-6">
            {itemGrafica.itemCatalogo.categoria === "Papéis" ? (
              <TabelaGramaturaForm
                itemGraficaId={itemGrafica.id}
                linhasIniciais={itemGrafica.tabelaPrecoPapel.map((l) => ({
                  gramatura: l.gramatura.toString(),
                  precoKg: l.precoKg.toString(),
                }))}
              />
            ) : (
              <VariantesMateriaPrimaForm
                itemGraficaId={itemGrafica.id}
                linhasIniciais={itemGrafica.variantes.map((v) => ({
                  id: v.id,
                  rotulo: v.rotulo,
                  precoCompra: v.precoCompra.toString(),
                  estoqueAtual: v.estoqueAtual?.toString() ?? "",
                  estoqueMinimo: v.estoqueMinimo?.toString() ?? "",
                  perdaFixaPadrao: v.perdaFixaPadrao?.toString() ?? "",
                }))}
              />
            )}

            <QuantidadePorEmbalagemForm
              itemGraficaId={itemGrafica.id}
              unidadeRotulo={unidadeRotulo}
              valorAtual={itemGrafica.quantidadePorEmbalagem?.toString() ?? ""}
            />
            {conversaoEmbalagem !== null && (
              <p className="-mt-3 text-sm text-slate-500">
                ≈ {formatoQuantidadeAbs.format(conversaoEmbalagem)} unidades em estoque
              </p>
            )}

            <LancarMovimentacaoForm
              itemGraficaId={itemGrafica.id}
              nomeItem={itemGrafica.itemCatalogo.nome}
              unidadeRotulo={unidadeRotulo}
              precoCompraAtual={itemGrafica.precoCompra?.toString() ?? ""}
              estoqueAtual={itemGrafica.estoqueAtual?.toString() ?? ""}
              variantes={itemGrafica.variantes.map((v) => ({
                id: v.id,
                rotulo: v.rotulo,
                precoCompra: v.precoCompra.toString(),
                estoqueAtual: v.estoqueAtual?.toString() ?? "",
              }))}
              fornecedores={fornecedores}
            />

            <Card className="flex flex-col gap-1 p-6">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                Histórico de movimentação
              </h2>
              <p className="mb-3 text-sm text-slate-500">
                Últimas {LIMITE_HISTORICO_MOVIMENTACAO} movimentações deste material, mais recente
                primeiro.
              </p>
              {itemGrafica.movimentacoes.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">
                  Nenhuma movimentação registrada ainda.
                </p>
              ) : (
                <div className="-mx-6 divide-y divide-slate-100 dark:divide-slate-800">
                  {itemGrafica.movimentacoes.map((m) => (
                    <div key={m.id} className="flex items-start justify-between gap-4 px-6 py-4">
                      <div>
                        <p className="text-sm text-slate-900 dark:text-white">
                          {ROTULOS_TIPO_MOVIMENTACAO[m.tipo]}
                          {m.variante ? ` · ${m.variante.rotulo}` : ""}
                          {m.fornecedor ? ` · ${m.fornecedor.nome}` : ""}
                          {m.motivo ? ` — ${m.motivo}` : ""}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {formatoInstanteRealComHora.format(m.createdAt)} ·{" "}
                          {m.criadoPorId ? (nomePorCriadorId.get(m.criadoPorId) ?? "Usuário removido") : "Sistema"}
                          {m.documento ? ` · NF ${m.documento}` : ""}
                          {m.pedidoId && (
                            <>
                              {" · "}
                              <Link href="/producao" className="underline">
                                Ver pedido
                              </Link>
                            </>
                          )}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-medium text-slate-900 dark:text-white">
                          {formatarQuantidadeMovimentacao(m.tipo, m.quantidade)}
                        </p>
                        <p className="text-xs text-slate-500">{formatarCustoUnitario(m.custoUnitario)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <ConfiguracaoAcabamentoForm
              itemGraficaId={itemGrafica.id}
              precoCompra={itemGrafica.precoCompra?.toString() ?? ""}
              configuracao={
                itemGrafica.configuracaoAcabamento
                  ? {
                      baseCobranca: itemGrafica.configuracaoAcabamento.baseCobranca,
                      estagio: itemGrafica.configuracaoAcabamento.estagio,
                      custoSetup: itemGrafica.configuracaoAcabamento.custoSetup.toString(),
                      custoMinimo: itemGrafica.configuracaoAcabamento.custoMinimo.toString(),
                      custoFerramental:
                        itemGrafica.configuracaoAcabamento.custoFerramental?.toString() ?? "",
                    }
                  : null
              }
            />
            {/* Ficha técnica de SERVIÇO (fase "custo real" — ver comentário no
                schema de FichaTecnicaItem): acabamentos que consomem material
                próprio (ex: BOPP na laminação) agora também podem declarar
                consumo, exatamente como um PRODUTO — mesmo componente, mesma
                Server Action. A baixa automática (status-transicao.ts) usa
                OrcamentoItemAcabamento.qtdBase como multiplicador em vez de
                item.quantidade. */}
            <FichaTecnicaForm
              itemGraficaId={itemGrafica.id}
              materiasPrimas={materiasPrimas.map((m) => ({
                id: m.id,
                nome: m.itemCatalogo.nome,
                unidade: m.itemCatalogo.unidade,
                unidadeOutro: m.itemCatalogo.unidadeOutro,
                variantes: m.variantes.map((v) => ({ id: v.id, rotulo: v.rotulo })),
              }))}
              fichaAtual={itemGrafica.fichaTecnica.map((f) => ({
                materiaPrimaId: f.materiaPrimaId,
                varianteId: f.varianteId ?? "",
                quantidadePorUnidade: f.quantidadePorUnidade.toString(),
              }))}
            />
          </div>
        )}
      </main>
    </div>
  );
}
