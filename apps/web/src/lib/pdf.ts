import { jsPDF } from 'jspdf';

type QuoteAddress = {
  cep?: string;
  rua?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
};

export interface QuotePdfData {
  numero: number;
  status: string;
  tipo?: string;
  valor_total: string | number;
  validade?: string | null;
  condicoes_pagamento?: string | null;
  prazo_entrega?: string | null;
  observacoes?: string | null;
  created_at?: string;
  cliente_nome: string;
  cliente_documento?: string | null;
  cliente_email?: string | null;
  cliente_telefone?: string | null;
  cliente_endereco?: QuoteAddress | string | null;
  empresa_nome?: string | null;
  empresa_razao?: string | null;
  empresa_cnpj?: string | null;
  token_publico?: string | null;
  itens: Array<{
    produto_nome: string;
    unidade?: string | null;
    quantidade: string | number;
    valor_unitario: string | number;
    desconto?: string | number;
    total: string | number;
    medidas?: Array<{
      unidade: string;
      quantidade: string | number;
      valor_unitario: string | number;
    }>;
  }>;
}

const formatCurrency = (value: string | number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);

const UNIT_LABELS: Record<string, string> = {
  UN: 'un',
  KG: 'kg',
  M: 'm',
};

function formatQuantityWithUnit(quantidade: string | number, unidade?: string | null) {
  const num = Number(quantidade);
  const formattedQty = Number.isFinite(num)
    ? new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(num)
    : String(quantidade);
  const unitKey = String(unidade || 'UN').toUpperCase();
  const unitLabel = UNIT_LABELS[unitKey] ?? unitKey.toLowerCase();
  return `${formattedQty} ${unitLabel}`;
}

function formatItemQuantity(item: QuotePdfData['itens'][number]) {
  if (Array.isArray(item.medidas) && item.medidas.length > 0) {
    return item.medidas.map(m => formatQuantityWithUnit(m.quantidade, m.unidade)).join(' + ');
  }
  return formatQuantityWithUnit(item.quantidade, item.unidade);
}

function getItemSubtotal(item: QuotePdfData['itens'][number]) {
  if (Array.isArray(item.medidas) && item.medidas.length > 0) {
    return item.medidas.reduce((acc, m) => acc + Number(m.quantidade) * Number(m.valor_unitario), 0);
  }
  return Number(item.quantidade) * Number(item.valor_unitario);
}

function formatDate(value?: string | null) {
  if (!value) return '';
  if (value.length > 10) return new Date(value).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const dateOnly = value.slice(0, 10);
  const [year, month, day] = dateOnly.split('-');
  return year && month && day ? `${day}/${month}/${year}` : new Date(value).toLocaleDateString('pt-BR');
}

function getClientAddress(value?: QuotePdfData['cliente_endereco']) {
  if (!value) return '';
  let address: QuoteAddress;
  try {
    address = typeof value === 'string' ? JSON.parse(value) as QuoteAddress : value;
  } catch {
    return typeof value === 'string' ? value : '';
  }
  return [
    [address.rua || address.logradouro, address.numero, address.complemento].filter(Boolean).join(', '),
    address.bairro,
    [address.cidade, address.uf].filter(Boolean).join(' - '),
    address.cep ? `CEP ${address.cep}` : '',
  ].filter(Boolean).join(' · ');
}

function addContinuationPage(doc: jsPDF, quote: QuotePdfData, firstIndex: number) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 15;
  const rowHeight = 9;
  const rowsPerPage = 20;
  const items = quote.itens.slice(firstIndex, firstIndex + rowsPerPage);

  doc.addPage();
  doc.setTextColor(20, 20, 20);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.text('ART STEEL - ORÇAMENTO', margin, 20);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Orçamento Nº ${String(quote.numero).padStart(4, '0')} · Continuação`, margin, 28);
  doc.text(`Cliente: ${quote.cliente_nome}`, margin, 35);

  let y = 44;
  const columns = { number: margin + 3, description: margin + 14, quantity: 137, unit: 169, total: pageWidth - margin - 4 };
  doc.setFillColor(25, 25, 25);
  doc.rect(margin, y, pageWidth - margin * 2, 8, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('ITEM', columns.number, y + 5.5);
  doc.text('DESCRIÇÃO DO ITEM / SERVIÇO', columns.description, y + 5.5);
  doc.text('QTD.', columns.quantity, y + 5.5, { align: 'center' });
  doc.text('VALOR UNITÁRIO', columns.unit, y + 5.5, { align: 'right' });
  doc.text('TOTAL', columns.total, y + 5.5, { align: 'right' });
  y += 8;

  items.forEach((item, index) => {
    const itemIndex = firstIndex + index;
    doc.setDrawColor(205, 205, 205);
    doc.rect(margin, y, pageWidth - margin * 2, rowHeight);
    doc.setTextColor(30, 30, 30);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(String(itemIndex + 1).padStart(2, '0'), columns.number, y + 6);
    const descriptionWidth = doc.getTextWidth(item.produto_nome);
    if (descriptionWidth > 99) doc.setFontSize(Math.max(3.5, 8 * 99 / descriptionWidth));
    doc.text(item.produto_nome, columns.description, y + 6);
    doc.setFontSize(8);
    doc.text(formatItemQuantity(item), columns.quantity, y + 6, { align: 'center' });
    doc.text(formatCurrency(item.valor_unitario), columns.unit, y + 6, { align: 'right' });
    doc.text(formatCurrency(item.total), columns.total, y + 6, { align: 'right' });
    y += rowHeight;
  });
}

function drawSegmentedDate(doc: jsPDF, formattedDate: string, xCenters: [number, number, number], y: number) {
  if (!formattedDate) return;
  const parts = formattedDate.split('/');
  if (parts.length === 3) {
    doc.text(parts[0], xCenters[0], y, { align: 'center' });
    doc.text(parts[1], xCenters[1], y, { align: 'center' });
    doc.text(parts[2], xCenters[2], y, { align: 'center' });
  } else {
    doc.text(formattedDate, xCenters[0] - 3, y, { maxWidth: 34 });
  }
}

export function createQuotePdf(quote: QuotePdfData, templateImage: Uint8Array) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  const pageWidth = doc.internal.pageSize.getWidth();

  // Usa a própria arte enviada como fundo, preservando logo, tipografia, linhas e proporções.
  doc.addImage(templateImage, 'PNG', 0, 0, pageWidth, doc.internal.pageSize.getHeight(), undefined, 'FAST');
  doc.setTextColor(20, 20, 20);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);

  const number = String(quote.numero).padStart(4, '0');
  const now = new Date();
  const today = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(number, 156, 23.3, { maxWidth: 43 });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  drawSegmentedDate(doc, formatDate(quote.created_at) || today, [167.4, 178.5, 193.0], 32.1);
  drawSegmentedDate(doc, formatDate(quote.validade), [168.2, 179.0, 193.1], 38.9);

  doc.setFontSize(8.5);
  doc.text(quote.cliente_nome || '', 54.5, 94.3, { maxWidth: 143.5 });
  doc.text(quote.cliente_documento || '', 35, 101.0, { maxWidth: 83 });
  doc.text(quote.cliente_telefone || '', 134, 101.0, { maxWidth: 64 });
  doc.text(quote.cliente_email || '', 27.5, 107.7, { maxWidth: 170.5 });
  doc.text(getClientAddress(quote.cliente_endereco), 35, 114.3, { maxWidth: 163 });

  const subtotal = quote.itens.reduce((sum, item) => sum + getItemSubtotal(item), 0);
  const discountAmount = Math.max(0, subtotal - Number(quote.valor_total));
  const discountPct = subtotal > 0 ? Math.round((discountAmount / subtotal) * 10000) / 100 : 0;
  const discountText = discountAmount > 0
    ? `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(discountPct)}% (${formatCurrency(discountAmount)})`
    : '0%';
  const firstPageItems = quote.itens.slice(0, 10);
  firstPageItems.forEach((item, index) => {
    const y = 145.55 + index * 6.19;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    const descriptionWidth = doc.getTextWidth(item.produto_nome);
    if (descriptionWidth > 88) doc.setFontSize(Math.max(3.5, 8 * 88 / descriptionWidth));
    doc.text(item.produto_nome, 25.5, y);
    doc.setFontSize(8);
    doc.text(formatItemQuantity(item), 127.2, y, { align: 'center' });
    doc.text(formatCurrency(item.valor_unitario), 167.7, y, { align: 'right' });
    doc.text(formatCurrency(item.total), 200.3, y, { align: 'right' });
  });

  doc.setFontSize(8.5);
  doc.text(quote.condicoes_pagamento || '', 53.5, 223.9, { maxWidth: 63 });
  doc.text(quote.prazo_entrega || '', 47.5, 230.5, { maxWidth: 69 });
  doc.text(formatCurrency(subtotal), 198.0, 212.2, { align: 'right' });
  doc.text(discountText, 198.0, 218.6, { align: 'right' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.text(formatCurrency(quote.valor_total), 198.0, 230.1, { align: 'right' });

  const observationLines = quote.observacoes ? doc.splitTextToSize(quote.observacoes, 186) as string[] : [];
  if (observationLines.length) {
    const observationY = [252.6, 258.2, 264.0];
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(20, 20, 20);
    observationLines.slice(0, 3).forEach((line, index) => doc.text(line, 12, observationY[index]));
  }

  for (let index = 10; index < quote.itens.length; index += 20) {
    addContinuationPage(doc, quote, index);
  }

  if (observationLines.length > 3) {
    doc.addPage();
    doc.setTextColor(20, 20, 20);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text(`OBSERVAÇÕES - ORÇAMENTO Nº ${number}`, 15, 20);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(`Cliente: ${quote.cliente_nome}`, 15, 29);
    doc.setFontSize(9);
    observationLines.slice(3).forEach((line, index) => doc.text(line, 15, 42 + index * 5));
  }

  return doc;
}

export async function downloadQuotePdf(quote: QuotePdfData) {
  const response = await fetch('/orcamento-template.png');
  if (!response.ok) throw new Error('Não foi possível carregar o modelo de orçamento.');
  const templateImage = new Uint8Array(await response.arrayBuffer());
  const doc = createQuotePdf(quote, templateImage);
  const safeClient = (quote.cliente_nome || 'cliente').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  doc.save(`Orcamento_${quote.numero}_${safeClient || 'cliente'}.pdf`);
}

export interface ContractClause {
  id: string;
  titulo: string;
  conteudo: string;
}

export interface ContractData {
  titulo_principal: string;
  subtitulo: string;
  contratante_nome: string;
  contratante_estado_civil: string;
  contratante_profissao: string;
  contratante_documento: string;
  contratante_endereco: string;
  contratante_contato: string;
  contratado_nome_assinatura: string;
  contratado_qualificacao: string;
  objeto_resumo: string;
  prazo_execucao: string;
  valor_total: string;
  valor_extenso: string;
  parcelas_texto: string;
  dados_bancarios: string;
  foro_comarca: string;
  cidade_assinatura: string;
  data_assinatura: string;
  clausulas: ContractClause[];
}

const UNIDADES = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'];
const DEZ_A_DEZENOVE = ['dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CENTENAS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

function trioPorExtenso(n: number): string {
  if (n === 0) return '';
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100);
  const resto = n % 100;
  const d = Math.floor(resto / 10);
  const u = resto % 10;
  const partes: string[] = [];
  if (c > 0) partes.push(CENTENAS[c]);
  if (resto >= 10 && resto <= 19) {
    partes.push(DEZ_A_DEZENOVE[resto - 10]);
  } else {
    if (d > 0) partes.push(DEZENAS[d]);
    if (u > 0) partes.push(UNIDADES[u]);
  }
  return partes.join(' e ');
}

export function numeroPorExtensoReais(valor: number | string): string {
  const num = Number(valor);
  if (!Number.isFinite(num) || num <= 0) return '';
  const inteiro = Math.floor(num);
  const centavos = Math.round((num - inteiro) * 100);

  const partesInteiro: string[] = [];
  const milhoes = Math.floor(inteiro / 1_000_000);
  const milhares = Math.floor((inteiro % 1_000_000) / 1_000);
  const centenas = inteiro % 1_000;

  if (milhoes > 0) {
    partesInteiro.push(milhoes === 1 ? 'um milhão' : `${trioPorExtenso(milhoes)} milhões`);
  }
  if (milhares > 0) {
    partesInteiro.push(milhares === 1 ? 'mil' : `${trioPorExtenso(milhares)} mil`);
  }
  if (centenas > 0) {
    partesInteiro.push(trioPorExtenso(centenas));
  }

  let resultado = '';
  if (inteiro > 0) {
    const conector = partesInteiro.length > 1 && (centenas > 0 && (centenas < 100 || centenas % 100 === 0)) ? ' e ' : ', ';
    const textoInteiro = partesInteiro.length <= 2
      ? partesInteiro.join(centenas > 0 && (centenas < 100 || centenas % 100 === 0) ? ' e ' : ' ')
      : `${partesInteiro.slice(0, -1).join(', ')}${conector}${partesInteiro[partesInteiro.length - 1]}`;
    resultado = `${textoInteiro} ${inteiro === 1 ? 'real' : 'reais'}`;
  }

  if (centavos > 0) {
    const textoCentavos = `${trioPorExtenso(centavos)} ${centavos === 1 ? 'centavo' : 'centavos'}`;
    resultado = resultado ? `${resultado} e ${textoCentavos}` : textoCentavos;
  }

  return resultado;
}

export function buildClause4Text(params: {
  valor_total: string | number;
  valor_extenso: string;
  parcelas_texto: string;
  dados_bancarios: string;
}): string {
  const valorFormatado = formatCurrency(params.valor_total || 0);
  const extenso = params.valor_extenso?.trim() ? ` (${params.valor_extenso.trim()})` : '';
  const blocos = [
    `O valor total do presente contrato é de **${valorFormatado}${extenso}**, pagos da seguinte forma:`,
  ];
  if (params.parcelas_texto?.trim()) {
    blocos.push(params.parcelas_texto.trim());
  }
  if (params.dados_bancarios?.trim()) {
    blocos.push(params.dados_bancarios.trim());
  }
  return blocos.join('\n\n');
}

export function buildDefaultContractData(quote?: Partial<QuotePdfData> & { prazo_entrega?: string | null; condicoes_pagamento?: string | null; aprovado_em?: string | null }): ContractData {
  const valorNum = Number(quote?.valor_total) || 0;
  const metadeFormatada = formatCurrency(valorNum / 2);
  const valorExtenso = numeroPorExtensoReais(valorNum);
  const itensDesc = Array.isArray(quote?.itens) && quote!.itens.length > 0
    ? quote!.itens.map(i => i.produto_nome).filter(Boolean).join(', ')
    : '';
  const objetoResumo = itensDesc
    ? `O presente contrato tem por objeto a produção e instalação de ${itensDesc}.`
    : 'O presente contrato tem por objeto a produção e instalação conforme orçamento aprovado.';
  const prazoExecucao = quote?.prazo_entrega?.trim() || '30 dias após a assinatura do contrato';
  const parcelasTexto = [
    `**1ª parcela (entrada, 50%):** ${metadeFormatada}, pagos no ato da assinatura do contrato;`,
    `**2ª parcela (50%):** ${metadeFormatada}, pagos na conclusão do serviço;`,
  ].join('\n\n');
  const dadosBancarios =
    'O pagamento dos valores previstos neste contrato será realizado por meio de transferência bancária ou PIX para a conta de titularidade de **Filomeno Serviços Ltda**, inscrita no CNPJ sob nº **51.972.840/0001-57** junto ao **Banco do Brasil S. A**, agência **3401-0**, conta **21697-6**, ou através da chave PIX **51.972.840/0001-57**.';
  const foroComarca = 'Timóteo/MG';
  const hoje = formatDate(quote?.aprovado_em || new Date().toISOString());
  const enderecoCliente = getClientAddress(quote?.cliente_endereco);
  const contatos = [quote?.cliente_email, quote?.cliente_telefone].filter(Boolean).join(' - ');

  const clausulas: ContractClause[] = [
    {
      id: 'clausula-1',
      titulo: 'CLÁUSULA 1 – OBJETO DO CONTRATO',
      conteudo: objetoResumo,
    },
    {
      id: 'clausula-2',
      titulo: 'CLÁUSULA 2 – OBRIGAÇÕES DO CONTRATANTE',
      conteudo: [
        'a) Fornecer o local a ser executado o serviço em condições viáveis;',
        'b) Comunicar previamente qualquer alteração desejada;',
        'c) Fornecer energia elétrica e ponto de água, quando necessário;',
        'd) Efetuar o pagamento de acordo com os valores e datas estabelecidas nesse contrato;',
      ].join('\n\n'),
    },
    {
      id: 'clausula-3',
      titulo: 'CLÁUSULA 3 – OBRIGAÇÕES DO CONTRATADO',
      conteudo: [
        'a) Fornecer toda mão de obra necessária para a execução;',
        'b) Fornecer todo o material necessário para a execução;',
        'c) Fornecer todas as ferramentas e equipamentos necessários para a execução, como andaimes, maquinas de solda, lixadeiras...',
        'd) Fornecimento de equipamentos de segurança;',
        `e) Executar o serviço até ${prazoExecucao};`,
      ].join('\n\n'),
    },
    {
      id: 'clausula-4',
      titulo: 'CLÁUSULA 4 – VALOR E FORMA DE PAGAMENTO',
      conteudo: buildClause4Text({
        valor_total: valorNum,
        valor_extenso: valorExtenso,
        parcelas_texto: parcelasTexto,
        dados_bancarios: dadosBancarios,
      }),
    },
    {
      id: 'clausula-5',
      titulo: 'CLÁUSULA 5 – DISPOSIÇÕES GERAIS',
      conteudo: [
        'a) O não cumprimento de qualquer cláusula prevista neste contrato poderá ensejar sua rescisão imediata, com apuração das responsabilidades;',
        `b) As partes elegem o foro da comarca de ${foroComarca} para dirimir quaisquer dúvidas oriundas deste contrato, com renúncia expressa a qualquer outro, por mais privilegiado que seja;`,
        'E por estarem assim justos e contratados, firmam o presente instrumento em duas vias de igual teor e forma, para um só efeito, juntamente com duas testemunhas abaixo assinadas.',
      ].join('\n\n'),
    },
  ];

  return {
    titulo_principal: 'CONTRATO DE PRESTAÇÃO DE SERVIÇOS',
    subtitulo: 'SERRALHERIA ARTSTEEL',
    contratante_nome: quote?.cliente_nome || '',
    contratante_estado_civil: '',
    contratante_profissao: '',
    contratante_documento: quote?.cliente_documento || '',
    contratante_endereco: enderecoCliente || '',
    contratante_contato: contatos || '',
    contratado_nome_assinatura: 'FILOMENO SERVICOS LTDA (Filomeno Pereira Neto)',
    contratado_qualificacao:
      'FILOMENO SERVICOS LTDA, empresa portadora do CNPJ nº 51.972.840/0001-57, endereçada na Avenida Castelo Branco, nº52, São José, Timóteo-MG, representada por, Filomeno Pereira Neto, Brasileiro, Casado, Serralheiro, portador do CPF nº 049.685.376-70 e RG nº M 7.901.975, residente e domiciliado à Avenida Castelo Branco, 52, Bairro São José, Timóteo-MG;',
    objeto_resumo: objetoResumo,
    prazo_execucao: prazoExecucao,
    valor_total: String(valorNum),
    valor_extenso: valorExtenso,
    parcelas_texto: parcelasTexto,
    dados_bancarios: dadosBancarios,
    foro_comarca: foroComarca,
    cidade_assinatura: 'Timóteo -MG',
    data_assinatura: hoje,
    clausulas,
  };
}

export function buildContratanteQualification(data: ContractData): string {
  const qualificadores = [
    data.contratante_nome?.trim(),
    data.contratante_estado_civil?.trim(),
    data.contratante_profissao?.trim(),
    data.contratante_documento?.trim() ? `portador(a) do CPF/CNPJ ${data.contratante_documento.trim()}` : '',
    data.contratante_endereco?.trim() ? `residente e domiciliado(a) no endereço ${data.contratante_endereco.trim()}` : '',
  ].filter(Boolean);

  let texto = qualificadores.join(', ');
  if (texto && !texto.endsWith('.')) texto += '.';
  if (data.contratante_contato?.trim()) {
    texto += `${texto ? ' ' : ''}Informações para contato: ${data.contratante_contato.trim()}`;
  }
  return texto;
}

type StyledToken = { text: string; bold: boolean };

function tokenizeBoldSegments(paragraph: string): StyledToken[] {
  const parts = paragraph.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  const tokens: StyledToken[] = [];
  for (const part of parts) {
    const isBold = part.startsWith('**') && part.endsWith('**') && part.length > 4;
    const content = isBold ? part.slice(2, -2) : part;
    const words = content.split(/(\s+)/).filter(Boolean);
    for (const word of words) {
      tokens.push({ text: word, bold: isBold });
    }
  }
  return tokens;
}

function drawRichParagraph(
  doc: jsPDF,
  paragraph: string,
  marginX: number,
  maxWidth: number,
  startY: number,
  lineHeight: number,
  pageBottom: number,
  topMargin: number
): number {
  let y = startY;
  const lines = paragraph.split('\n');

  for (const rawLine of lines) {
    const trimmedLine = rawLine.trim();
    if (!trimmedLine) {
      y += lineHeight * 0.75;
      continue;
    }

    const tokens = tokenizeBoldSegments(trimmedLine);
    let currentLine: StyledToken[] = [];
    let currentWidth = 0;

    const flushLine = (lineTokens: StyledToken[]) => {
      if (lineTokens.length === 0) return;
      if (y > pageBottom) {
        doc.addPage();
        y = topMargin;
      }
      let cursorX = marginX;
      for (const token of lineTokens) {
        doc.setFont('times', token.bold ? 'bold' : 'normal');
        doc.setFontSize(11);
        doc.setTextColor(25, 25, 25);
        doc.text(token.text, cursorX, y);
        cursorX += doc.getTextWidth(token.text);
      }
      y += lineHeight;
    };

    for (const token of tokens) {
      if (/^\s+$/.test(token.text) && currentLine.length === 0) {
        continue;
      }
      doc.setFont('times', token.bold ? 'bold' : 'normal');
      doc.setFontSize(11);
      const tokenWidth = doc.getTextWidth(token.text);
      if (currentLine.length > 0 && currentWidth + tokenWidth > maxWidth) {
        while (currentLine.length > 0 && /^\s+$/.test(currentLine[currentLine.length - 1].text)) {
          currentLine.pop();
        }
        flushLine(currentLine);
        currentLine = /^\s+$/.test(token.text) ? [] : [token];
        currentWidth = /^\s+$/.test(token.text) ? 0 : tokenWidth;
      } else {
        currentLine.push(token);
        currentWidth += tokenWidth;
      }
    }

    if (currentLine.length > 0) {
      flushLine(currentLine);
    }
  }

  return y;
}

export function createContractPdf(contract: ContractData) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 25;
  const maxWidth = pageWidth - marginX * 2;
  const topMargin = 26;
  const pageBottom = pageHeight - 48;
  const lineHeight = 5.5;

  const drawSignaturesBlock = (startY: number) => {
    let sigY = startY;
    doc.setFont('times', 'normal');
    doc.setFontSize(10.5);
    doc.setTextColor(25, 25, 25);
    doc.text('CONTRATANTE: __________________________________________________', marginX, sigY);
    sigY += 5.5;
    if (contract.contratante_nome?.trim()) {
      doc.text(contract.contratante_nome.trim(), marginX, sigY);
    }
    sigY += 14;

    doc.text('CONTRATADO: ___________________________________________________', marginX, sigY);
    sigY += 5.5;
    if (contract.contratado_nome_assinatura?.trim()) {
      doc.text(contract.contratado_nome_assinatura.trim(), marginX, sigY);
    }
  };

  let y = 30;

  // Cabeçalho no estilo exato do modelo enviado
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(20);
  doc.setTextColor(22, 23, 26);
  doc.text((contract.titulo_principal || 'CONTRATO DE PRESTAÇÃO DE SERVIÇOS').toUpperCase(), marginX, y);
  y += 9;
  doc.text((contract.subtitulo || 'SERRALHERIA ARTSTEEL').toUpperCase(), marginX, y);
  y += 4;

  doc.setDrawColor(148, 154, 166);
  doc.setLineWidth(0.4);
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 14;

  // Qualificação CONTRATANTE
  const contratanteTexto = buildContratanteQualification(contract);
  if (contratanteTexto) {
    y = drawRichParagraph(
      doc,
      `**CONTRATANTE:** ${contratanteTexto}`,
      marginX,
      maxWidth,
      y,
      lineHeight,
      pageBottom,
      topMargin
    );
    y += 6;
  }

  // Qualificação CONTRATADO
  if (contract.contratado_qualificacao?.trim()) {
    y = drawRichParagraph(
      doc,
      `**CONTRATADO:** ${contract.contratado_qualificacao.trim()}`,
      marginX,
      maxWidth,
      y,
      lineHeight,
      pageBottom,
      topMargin
    );
    y += 8;
  }

  // Cláusulas
  for (const clausula of contract.clausulas) {
    if (!clausula.titulo?.trim() && !clausula.conteudo?.trim()) continue;
    if (y + 16 > pageBottom) {
      doc.addPage();
      y = topMargin;
    }
    if (clausula.titulo?.trim()) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(55, 60, 68);
      doc.text(clausula.titulo.trim().toUpperCase(), marginX, y);
      y += 6.5;
    }
    if (clausula.conteudo?.trim()) {
      y = drawRichParagraph(
        doc,
        clausula.conteudo.trim(),
        marginX,
        maxWidth,
        y,
        lineHeight,
        pageBottom,
        topMargin
      );
      y += 6;
    }
  }

  // Local e Data + Assinaturas na última página
  if (y + 47 > pageHeight - 16) {
    doc.addPage();
    y = topMargin;
  }

  y += 4;
  const localData = [contract.cidade_assinatura?.trim(), contract.data_assinatura?.trim()].filter(Boolean).join(', ');
  if (localData) {
    doc.setFont('times', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(25, 25, 25);
    doc.text(localData, marginX, y);
    y += 18;
  } else {
    y += 12;
  }

  drawSignaturesBlock(y);

  // Garante local de assinatura em TODAS as páginas anteriores e numeração de página em todas
  const totalPages = doc.getNumberOfPages();
  for (let page = 1; page <= totalPages; page++) {
    doc.setPage(page);
    if (page < totalPages) {
      doc.setDrawColor(210, 215, 220);
      doc.setLineWidth(0.25);
      doc.line(marginX, pageHeight - 43, pageWidth - marginX, pageHeight - 43);
      drawSignaturesBlock(pageHeight - 36);
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(130, 130, 130);
    doc.text(`Página ${page} de ${totalPages}`, pageWidth - marginX, pageHeight - 8, { align: 'right' });
  }

  return doc;
}

export function downloadContractPdf(contract: ContractData, numero?: number) {
  const doc = createContractPdf(contract);
  const safeClient = (contract.contratante_nome || 'cliente')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  const prefix = numero ? `Contrato_${String(numero).padStart(4, '0')}_` : 'Contrato_';
  doc.save(`${prefix}${safeClient || 'cliente'}.pdf`);
}

