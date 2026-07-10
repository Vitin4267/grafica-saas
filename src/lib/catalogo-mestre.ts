export type TipoItemCatalogo = "PRODUTO" | "MATERIA_PRIMA" | "SERVICO";

export type UnidadeMedida =
  | "FOLHA"
  | "METRO_QUADRADO"
  | "METRO_LINEAR"
  | "UNIDADE"
  | "LITRO"
  | "KG"
  | "ROLO"
  | "PACOTE"
  | "CENTO"
  | "HORA";

export type ItemCatalogoSeed = {
  tipo: TipoItemCatalogo;
  categoria: string;
  nome: string;
  unidade?: UnidadeMedida;
};

// Catálogo mestre e fixo, compartilhado por todas as gráficas. Cada gráfica escolhe
// (em /catalogo) o que ela realmente oferece/usa e define seus próprios preços —
// esta lista aqui nunca muda por tenant, só cresce com o tempo para todo mundo.
export const CATALOGO_MESTRE: ItemCatalogoSeed[] = [
  // ---------- PRODUTOS ----------
  // Papelaria e Impressos
  { tipo: "PRODUTO", categoria: "Papelaria e Impressos", nome: "Cartão de Visita" },
  { tipo: "PRODUTO", categoria: "Papelaria e Impressos", nome: "Panfleto / Flyer" },
  { tipo: "PRODUTO", categoria: "Papelaria e Impressos", nome: "Folder" },
  { tipo: "PRODUTO", categoria: "Papelaria e Impressos", nome: "Papel Timbrado" },
  { tipo: "PRODUTO", categoria: "Papelaria e Impressos", nome: "Envelope Personalizado" },
  { tipo: "PRODUTO", categoria: "Papelaria e Impressos", nome: "Bloco de Notas" },
  { tipo: "PRODUTO", categoria: "Papelaria e Impressos", nome: "Talão de Notas" },
  { tipo: "PRODUTO", categoria: "Papelaria e Impressos", nome: "Convite" },
  { tipo: "PRODUTO", categoria: "Papelaria e Impressos", nome: "Cardápio" },
  { tipo: "PRODUTO", categoria: "Papelaria e Impressos", nome: "Etiqueta Adesiva" },
  { tipo: "PRODUTO", categoria: "Papelaria e Impressos", nome: "Crachá" },
  { tipo: "PRODUTO", categoria: "Papelaria e Impressos", nome: "Ingresso" },
  { tipo: "PRODUTO", categoria: "Papelaria e Impressos", nome: "Calendário de Mesa" },
  { tipo: "PRODUTO", categoria: "Papelaria e Impressos", nome: "Calendário de Parede" },
  { tipo: "PRODUTO", categoria: "Papelaria e Impressos", nome: "Agenda Personalizada" },

  // Comunicação Visual
  { tipo: "PRODUTO", categoria: "Comunicação Visual", nome: "Banner em Lona" },
  { tipo: "PRODUTO", categoria: "Comunicação Visual", nome: "Faixa" },
  { tipo: "PRODUTO", categoria: "Comunicação Visual", nome: "Adesivo de Fachada" },
  { tipo: "PRODUTO", categoria: "Comunicação Visual", nome: "Placa em PVC" },
  { tipo: "PRODUTO", categoria: "Comunicação Visual", nome: "Placa em ACM" },
  { tipo: "PRODUTO", categoria: "Comunicação Visual", nome: "Totem" },
  { tipo: "PRODUTO", categoria: "Comunicação Visual", nome: "Backdrop" },
  { tipo: "PRODUTO", categoria: "Comunicação Visual", nome: "Wind Banner (Fly Banner)" },
  { tipo: "PRODUTO", categoria: "Comunicação Visual", nome: "Adesivo para Vidro" },
  { tipo: "PRODUTO", categoria: "Comunicação Visual", nome: "Envelopamento de Veículo" },
  { tipo: "PRODUTO", categoria: "Comunicação Visual", nome: "Letra Caixa" },
  { tipo: "PRODUTO", categoria: "Comunicação Visual", nome: "Outdoor" },
  { tipo: "PRODUTO", categoria: "Comunicação Visual", nome: "Painel para Evento" },

  // Editorial e Encadernação
  { tipo: "PRODUTO", categoria: "Editorial e Encadernação", nome: "Revista" },
  { tipo: "PRODUTO", categoria: "Editorial e Encadernação", nome: "Catálogo" },
  { tipo: "PRODUTO", categoria: "Editorial e Encadernação", nome: "Livro Brochura" },
  { tipo: "PRODUTO", categoria: "Editorial e Encadernação", nome: "Livro Capa Dura" },
  { tipo: "PRODUTO", categoria: "Editorial e Encadernação", nome: "Apostila" },
  { tipo: "PRODUTO", categoria: "Editorial e Encadernação", nome: "Encadernação em Espiral" },
  { tipo: "PRODUTO", categoria: "Editorial e Encadernação", nome: "Encadernação em Wire-o" },

  // Vestuário e Sublimação
  { tipo: "PRODUTO", categoria: "Vestuário e Sublimação", nome: "Camiseta Personalizada" },
  { tipo: "PRODUTO", categoria: "Vestuário e Sublimação", nome: "Boné Personalizado" },
  { tipo: "PRODUTO", categoria: "Vestuário e Sublimação", nome: "Caneca Personalizada" },
  { tipo: "PRODUTO", categoria: "Vestuário e Sublimação", nome: "Squeeze Personalizado" },
  { tipo: "PRODUTO", categoria: "Vestuário e Sublimação", nome: "Almofada Personalizada" },
  { tipo: "PRODUTO", categoria: "Vestuário e Sublimação", nome: "Chaveiro Personalizado" },

  // Brindes e Personalizados
  { tipo: "PRODUTO", categoria: "Brindes e Personalizados", nome: "Ímã de Geladeira" },
  { tipo: "PRODUTO", categoria: "Brindes e Personalizados", nome: "Botton / Button" },
  { tipo: "PRODUTO", categoria: "Brindes e Personalizados", nome: "Caneta Personalizada" },
  { tipo: "PRODUTO", categoria: "Brindes e Personalizados", nome: "Copo Personalizado" },
  { tipo: "PRODUTO", categoria: "Brindes e Personalizados", nome: "Sacola Personalizada" },

  // Adesivos e Etiquetas
  { tipo: "PRODUTO", categoria: "Adesivos e Etiquetas", nome: "Adesivo Recortado" },
  { tipo: "PRODUTO", categoria: "Adesivos e Etiquetas", nome: "Adesivo Quadrado/Retangular" },
  { tipo: "PRODUTO", categoria: "Adesivos e Etiquetas", nome: "Etiqueta para Produto" },
  { tipo: "PRODUTO", categoria: "Adesivos e Etiquetas", nome: "Rótulo Personalizado" },

  // ---------- MATÉRIAS-PRIMAS ----------
  // Papéis
  { tipo: "MATERIA_PRIMA", categoria: "Papéis", nome: "Papel Couché 90g", unidade: "FOLHA" },
  { tipo: "MATERIA_PRIMA", categoria: "Papéis", nome: "Papel Couché 115g", unidade: "FOLHA" },
  { tipo: "MATERIA_PRIMA", categoria: "Papéis", nome: "Papel Couché 150g", unidade: "FOLHA" },
  { tipo: "MATERIA_PRIMA", categoria: "Papéis", nome: "Papel Couché 170g", unidade: "FOLHA" },
  { tipo: "MATERIA_PRIMA", categoria: "Papéis", nome: "Papel Couché 250g", unidade: "FOLHA" },
  { tipo: "MATERIA_PRIMA", categoria: "Papéis", nome: "Papel Couché 300g", unidade: "FOLHA" },
  { tipo: "MATERIA_PRIMA", categoria: "Papéis", nome: "Papel Offset (Sulfite) 75g", unidade: "FOLHA" },
  { tipo: "MATERIA_PRIMA", categoria: "Papéis", nome: "Papel Offset (Sulfite) 90g", unidade: "FOLHA" },
  { tipo: "MATERIA_PRIMA", categoria: "Papéis", nome: "Papel Offset (Sulfite) 120g", unidade: "FOLHA" },
  { tipo: "MATERIA_PRIMA", categoria: "Papéis", nome: "Papel Reciclado 75g", unidade: "FOLHA" },
  { tipo: "MATERIA_PRIMA", categoria: "Papéis", nome: "Papel Kraft", unidade: "FOLHA" },
  { tipo: "MATERIA_PRIMA", categoria: "Papéis", nome: "Papel Fotográfico", unidade: "FOLHA" },
  { tipo: "MATERIA_PRIMA", categoria: "Papéis", nome: "Papel Vergê", unidade: "FOLHA" },
  { tipo: "MATERIA_PRIMA", categoria: "Papéis", nome: "Papel Cartão / Supremo 250g", unidade: "FOLHA" },
  { tipo: "MATERIA_PRIMA", categoria: "Papéis", nome: "Papel Cartão / Supremo 300g", unidade: "FOLHA" },

  // Lonas e Vinis
  { tipo: "MATERIA_PRIMA", categoria: "Lonas e Vinis", nome: "Lona 440g", unidade: "METRO_QUADRADO" },
  { tipo: "MATERIA_PRIMA", categoria: "Lonas e Vinis", nome: "Lona Backlight", unidade: "METRO_QUADRADO" },
  { tipo: "MATERIA_PRIMA", categoria: "Lonas e Vinis", nome: "Vinil Adesivo Brilho", unidade: "METRO_QUADRADO" },
  { tipo: "MATERIA_PRIMA", categoria: "Lonas e Vinis", nome: "Vinil Adesivo Fosco", unidade: "METRO_QUADRADO" },
  { tipo: "MATERIA_PRIMA", categoria: "Lonas e Vinis", nome: "Vinil Perfurado (One Way)", unidade: "METRO_QUADRADO" },
  { tipo: "MATERIA_PRIMA", categoria: "Lonas e Vinis", nome: "Vinil para Envelopamento", unidade: "METRO_QUADRADO" },

  // Placas e Chapas
  { tipo: "MATERIA_PRIMA", categoria: "Placas e Chapas", nome: "Chapa de PVC 2mm", unidade: "UNIDADE" },
  { tipo: "MATERIA_PRIMA", categoria: "Placas e Chapas", nome: "Chapa de PVC 3mm", unidade: "UNIDADE" },
  { tipo: "MATERIA_PRIMA", categoria: "Placas e Chapas", nome: "Chapa de PVC 5mm", unidade: "UNIDADE" },
  { tipo: "MATERIA_PRIMA", categoria: "Placas e Chapas", nome: "Chapa de ACM", unidade: "UNIDADE" },
  { tipo: "MATERIA_PRIMA", categoria: "Placas e Chapas", nome: "Chapa de MDF", unidade: "UNIDADE" },
  { tipo: "MATERIA_PRIMA", categoria: "Placas e Chapas", nome: "Papelão Paraná", unidade: "UNIDADE" },

  // Tintas e Consumíveis
  { tipo: "MATERIA_PRIMA", categoria: "Tintas e Consumíveis", nome: "Tinta CMYK para Offset", unidade: "LITRO" },
  { tipo: "MATERIA_PRIMA", categoria: "Tintas e Consumíveis", nome: "Toner Preto", unidade: "UNIDADE" },
  { tipo: "MATERIA_PRIMA", categoria: "Tintas e Consumíveis", nome: "Toner Colorido", unidade: "UNIDADE" },
  { tipo: "MATERIA_PRIMA", categoria: "Tintas e Consumíveis", nome: "Tinta Solvente", unidade: "LITRO" },
  { tipo: "MATERIA_PRIMA", categoria: "Tintas e Consumíveis", nome: "Tinta Sublimática", unidade: "LITRO" },
  { tipo: "MATERIA_PRIMA", categoria: "Tintas e Consumíveis", nome: "Tinta UV", unidade: "LITRO" },
  { tipo: "MATERIA_PRIMA", categoria: "Tintas e Consumíveis", nome: "Cartucho de Tinta", unidade: "UNIDADE" },

  // Laminação e Acabamento
  { tipo: "MATERIA_PRIMA", categoria: "Laminação e Acabamento", nome: "Laminação BOPP Fosca", unidade: "ROLO" },
  { tipo: "MATERIA_PRIMA", categoria: "Laminação e Acabamento", nome: "Laminação BOPP Brilho", unidade: "ROLO" },
  { tipo: "MATERIA_PRIMA", categoria: "Laminação e Acabamento", nome: "Verniz UV Localizado", unidade: "LITRO" },
  { tipo: "MATERIA_PRIMA", categoria: "Laminação e Acabamento", nome: "Ilhós", unidade: "UNIDADE" },
  { tipo: "MATERIA_PRIMA", categoria: "Laminação e Acabamento", nome: "Cola Quente", unidade: "KG" },
  { tipo: "MATERIA_PRIMA", categoria: "Laminação e Acabamento", nome: "Fita Dupla Face", unidade: "ROLO" },

  // Insumos para Sublimação e Vestuário
  { tipo: "MATERIA_PRIMA", categoria: "Sublimação e Vestuário", nome: "Camiseta Branca (Malha PV)", unidade: "UNIDADE" },
  { tipo: "MATERIA_PRIMA", categoria: "Sublimação e Vestuário", nome: "Caneca Branca de Cerâmica", unidade: "UNIDADE" },
  { tipo: "MATERIA_PRIMA", categoria: "Sublimação e Vestuário", nome: "Boné em Branco", unidade: "UNIDADE" },
  { tipo: "MATERIA_PRIMA", categoria: "Sublimação e Vestuário", nome: "Papel Transfer Sublimático", unidade: "FOLHA" },

  // Encadernação
  { tipo: "MATERIA_PRIMA", categoria: "Encadernação", nome: "Espiral Plástico", unidade: "UNIDADE" },
  { tipo: "MATERIA_PRIMA", categoria: "Encadernação", nome: "Wire-o", unidade: "UNIDADE" },
  { tipo: "MATERIA_PRIMA", categoria: "Encadernação", nome: "Capa para Encadernação", unidade: "UNIDADE" },

  // ---------- SERVIÇOS ----------
  // Impressão
  { tipo: "SERVICO", categoria: "Impressão", nome: "Impressão Digital Colorida", unidade: "UNIDADE" },
  { tipo: "SERVICO", categoria: "Impressão", nome: "Impressão Digital Preto e Branco", unidade: "UNIDADE" },
  { tipo: "SERVICO", categoria: "Impressão", nome: "Impressão Offset", unidade: "UNIDADE" },
  { tipo: "SERVICO", categoria: "Impressão", nome: "Plotagem", unidade: "METRO_QUADRADO" },

  // Acabamento
  { tipo: "SERVICO", categoria: "Acabamento", nome: "Laminação Fosca", unidade: "METRO_QUADRADO" },
  { tipo: "SERVICO", categoria: "Acabamento", nome: "Laminação Brilho", unidade: "METRO_QUADRADO" },
  { tipo: "SERVICO", categoria: "Acabamento", nome: "Corte Reto", unidade: "UNIDADE" },
  { tipo: "SERVICO", categoria: "Acabamento", nome: "Corte Especial (Faca)", unidade: "UNIDADE" },
  { tipo: "SERVICO", categoria: "Acabamento", nome: "Vinco / Dobra", unidade: "UNIDADE" },
  { tipo: "SERVICO", categoria: "Acabamento", nome: "Grampeamento", unidade: "UNIDADE" },
  { tipo: "SERVICO", categoria: "Acabamento", nome: "Encadernação em Espiral", unidade: "UNIDADE" },
  { tipo: "SERVICO", categoria: "Acabamento", nome: "Encadernação em Wire-o", unidade: "UNIDADE" },
  { tipo: "SERVICO", categoria: "Acabamento", nome: "Encadernação Capa Dura", unidade: "UNIDADE" },

  // Personalização
  { tipo: "SERVICO", categoria: "Personalização", nome: "Sublimação", unidade: "UNIDADE" },
  { tipo: "SERVICO", categoria: "Personalização", nome: "DTF (Direct to Film)", unidade: "UNIDADE" },
  { tipo: "SERVICO", categoria: "Personalização", nome: "Silk-Screen", unidade: "UNIDADE" },
  { tipo: "SERVICO", categoria: "Personalização", nome: "Bordado", unidade: "UNIDADE" },
  { tipo: "SERVICO", categoria: "Personalização", nome: "Hot Stamping", unidade: "UNIDADE" },

  // Comunicação Visual (serviços)
  { tipo: "SERVICO", categoria: "Comunicação Visual", nome: "Instalação de Placa", unidade: "UNIDADE" },
  { tipo: "SERVICO", categoria: "Comunicação Visual", nome: "Aplicação de Adesivo", unidade: "UNIDADE" },
  { tipo: "SERVICO", categoria: "Comunicação Visual", nome: "Instalação de Envelopamento", unidade: "UNIDADE" },

  // Outros Serviços
  { tipo: "SERVICO", categoria: "Outros Serviços", nome: "Criação de Arte / Design Gráfico", unidade: "HORA" },
  { tipo: "SERVICO", categoria: "Outros Serviços", nome: "Revisão de Arte", unidade: "UNIDADE" },
  { tipo: "SERVICO", categoria: "Outros Serviços", nome: "Entrega / Frete", unidade: "UNIDADE" },
];
