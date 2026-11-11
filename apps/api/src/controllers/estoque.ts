import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { withTenant, type Database } from '../db/client.js';
import { auth, HttpError, requireRole } from '../middlewares/auth.js';
import { pageQuery, pageResult } from '../lib/pagination.js';

type XmlItemInput = {
  nome: string;
  sku?: string | null;
  ean?: string | null;
  ncm?: string | null;
  unidade?: string;
  quantidade: number;
  custo_unitario: number;
  preco_venda?: number;
};

function extractTagValue(xmlBlock: string, tag: string): string | null {
  const regex = new RegExp(`<(?:[a-zA-Z0-9_]+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_]+:)?${tag}>`, 'i');
  const match = xmlBlock.match(regex);
  return match ? match[1].trim() : null;
}

function parseNfeXmlServer(xmlContent: string): { numero_nf: string | null; fornecedor: string | null; itens: XmlItemInput[] } {
  const ideBlock = extractTagValue(xmlContent, 'ide') ?? xmlContent;
  const emitBlock = extractTagValue(xmlContent, 'emit') ?? xmlContent;
  const numero_nf = extractTagValue(ideBlock, 'nNF');
  const fornecedor = extractTagValue(emitBlock, 'xNome') ?? extractTagValue(emitBlock, 'xFant');

  const itens: XmlItemInput[] = [];
  const detRegex = /<(?:[a-zA-Z0-9_]+:)?det\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_]+:)?det>/gi;
  let match: RegExpExecArray | null;

  while ((match = detRegex.exec(xmlContent)) !== null) {
    const detBlock = match[1];
    const prodBlock = extractTagValue(detBlock, 'prod') ?? detBlock;
    const nome = extractTagValue(prodBlock, 'xProd') ?? extractTagValue(prodBlock, 'nome');
    if (!nome) continue;

    const sku = extractTagValue(prodBlock, 'cProd') ?? extractTagValue(prodBlock, 'sku');
    const rawEan = extractTagValue(prodBlock, 'cEAN') ?? extractTagValue(prodBlock, 'cEANTrib') ?? extractTagValue(prodBlock, 'ean');
    const ean = rawEan && rawEan.toUpperCase() !== 'SEM GTIN' ? rawEan : null;
    const ncm = extractTagValue(prodBlock, 'NCM') ?? extractTagValue(prodBlock, 'ncm');
    const rawUnidade = (extractTagValue(prodBlock, 'uCom') ?? extractTagValue(prodBlock, 'uTrib') ?? extractTagValue(prodBlock, 'unidade') ?? 'UN').toUpperCase();
    const unidade = ['UN', 'KG', 'M', 'CX', 'L'].includes(rawUnidade) ? rawUnidade : 'UN';
    const quantidade = Number((extractTagValue(prodBlock, 'qCom') ?? extractTagValue(prodBlock, 'qTrib') ?? extractTagValue(prodBlock, 'quantidade') ?? '1').replace(',', '.')) || 1;
    const custo_unitario = Number((extractTagValue(prodBlock, 'vUnCom') ?? extractTagValue(prodBlock, 'vUnTrib') ?? extractTagValue(prodBlock, 'custo_unitario') ?? '0').replace(',', '.')) || 0;

    itens.push({
      nome,
      sku: sku || null,
      ean,
      ncm: ncm || null,
      unidade,
      quantidade: Math.max(0.001, quantidade),
      custo_unitario: Math.max(0, custo_unitario),
      preco_venda: Number((custo_unitario * 1.35).toFixed(2)),
    });
  }

  // Fallback para XML genérico de produtos (<produto> ou <item>)
  if (itens.length === 0) {
    const prodRegex = /<(?:produto|item)\b[^>]*>([\s\S]*?)<\/(?:produto|item)>/gi;
    while ((match = prodRegex.exec(xmlContent)) !== null) {
      const block = match[1];
      const nome = extractTagValue(block, 'nome') ?? extractTagValue(block, 'xProd') ?? extractTagValue(block, 'descricao');
      if (!nome) continue;
      const sku = extractTagValue(block, 'sku') ?? extractTagValue(block, 'cProd') ?? extractTagValue(block, 'codigo');
      const ean = extractTagValue(block, 'ean') ?? extractTagValue(block, 'cEAN');
      const ncm = extractTagValue(block, 'ncm') ?? extractTagValue(block, 'NCM');
      const rawUnidade = (extractTagValue(block, 'unidade') ?? extractTagValue(block, 'uCom') ?? 'UN').toUpperCase();
      const unidade = ['UN', 'KG', 'M', 'CX', 'L'].includes(rawUnidade) ? rawUnidade : 'UN';
      const quantidade = Number((extractTagValue(block, 'quantidade') ?? extractTagValue(block, 'estoque_atual') ?? extractTagValue(block, 'qCom') ?? '1').replace(',', '.')) || 1;
      const custo_unitario = Number((extractTagValue(block, 'custo_medio') ?? extractTagValue(block, 'custo_unitario') ?? extractTagValue(block, 'vUnCom') ?? '0').replace(',', '.')) || 0;
      const preco_venda = Number((extractTagValue(block, 'preco_venda') ?? String(custo_unitario * 1.35)).replace(',', '.')) || 0;

      itens.push({
        nome,
        sku: sku || null,
        ean: ean && ean.toUpperCase() !== 'SEM GTIN' ? ean : null,
        ncm: ncm || null,
        unidade,
        quantidade: Math.max(0.001, quantidade),
        custo_unitario: Math.max(0, custo_unitario),
        preco_venda: Math.max(0, preco_venda),
      });
    }
  }

  return { numero_nf, fornecedor, itens };
}

export async function estoqueRoutes(app: FastifyInstance, db: Database) {
  app.addHook('preHandler', auth(db));
  app.addHook('preHandler', async req => {
    if (req.method !== 'GET') await requireRole(db, req, ['ADMIN', 'OPERADOR']);
  });

  // ==========================================
  // DASHBOARD DE ESTOQUE
  // ==========================================
  app.get('/estoque/dashboard', async req => {
    const tenantId = req.user.current_tenant_id;
    const rows = await withTenant(db, tenantId, tx =>
      tx.execute(sql`
        SELECT 
          COUNT(*) as total_produtos,
          SUM(estoque_atual * custo_medio) as valor_total_custo,
          SUM(estoque_atual * preco_venda) as valor_total_venda,
          COUNT(CASE WHEN estoque_atual <= estoque_minimo AND status = 'ATIVO' THEN 1 END) as produtos_baixo_estoque,
          COUNT(CASE WHEN estoque_atual = 0 AND status = 'ATIVO' THEN 1 END) as produtos_zerados,
          COALESCE((
            SELECT jsonb_agg(alerta)
            FROM (
              SELECT id,nome,sku,ean,ncm,unidade,custo_medio,preco_venda,estoque_atual,estoque_minimo,localizacao,status
              FROM produtos
              WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
                AND estoque_atual <= estoque_minimo
              ORDER BY estoque_atual ASC,nome ASC LIMIT 8
            ) alerta
          ),'[]'::jsonb) as itens_baixo_estoque
        FROM produtos
        WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
      `)
    );
    const data = rows[0] || {
      total_produtos: 0,
      valor_total_custo: 0,
      valor_total_venda: 0,
      produtos_baixo_estoque: 0,
      produtos_zerados: 0
    };

    return { success: true, data, error: null };
  });

  // ==========================================
  // PRODUTOS
  // ==========================================
  app.get('/estoque/produtos', async req => {
    const tenantId = req.user.current_tenant_id;
    const query = req.query as Record<string, unknown>;
    const paginated = ['page', 'limit', 'search', 'status'].some(key => key in query);
    if (!paginated) {
      const rows = await withTenant(db, tenantId, tx => tx.execute(sql`
        SELECT id,nome,sku,ean,ncm,unidade,custo_medio,preco_venda,estoque_atual,estoque_minimo,localizacao,status
        FROM produtos WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL ORDER BY nome ASC
      `));
      return { success: true, data: rows, error: null };
    }

    const page = pageQuery(query);
    const filter = page.status && page.status !== 'TODOS' ? page.status : null;
    const term = page.search ? `%${page.search}%` : null;
    const result = await withTenant(db, tenantId, async tx => {
      const [count] = await tx.execute(sql`
        SELECT count(*)::int total FROM produtos
        WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
          AND (${term}::text IS NULL OR nome ILIKE ${term} OR sku ILIKE ${term} OR ean ILIKE ${term})
          AND (${filter}::text IS NULL
            OR (${filter} = 'BAIXO_ESTOQUE' AND estoque_atual > 0 AND estoque_atual <= estoque_minimo)
            OR (${filter} = 'ZERADOS' AND estoque_atual <= 0)
            OR (${filter} = 'ATIVO' AND status = 'ATIVO')
            OR (${filter} = 'INATIVO' AND status = 'INATIVO'))
      `);
      const rows = await tx.execute(sql`
        SELECT id,nome,sku,ean,ncm,unidade,custo_medio,preco_venda,estoque_atual,estoque_minimo,localizacao,status
        FROM produtos
        WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
          AND (${term}::text IS NULL OR nome ILIKE ${term} OR sku ILIKE ${term} OR ean ILIKE ${term})
          AND (${filter}::text IS NULL
            OR (${filter} = 'BAIXO_ESTOQUE' AND estoque_atual > 0 AND estoque_atual <= estoque_minimo)
            OR (${filter} = 'ZERADOS' AND estoque_atual <= 0)
            OR (${filter} = 'ATIVO' AND status = 'ATIVO')
            OR (${filter} = 'INATIVO' AND status = 'INATIVO'))
        ORDER BY nome ASC LIMIT ${page.limit} OFFSET ${page.offset}
      `);
      return pageResult(rows, page.page, page.limit, Number(count.total));
    });
    return { success: true, data: result, error: null };
  });

  app.post('/estoque/produtos', async req => {
    const body = z.object({
      nome: z.string().min(1),
      sku: z.string().optional().nullable(),
      ean: z.string().optional().nullable(),
      ncm: z.string().optional().nullable(),
      unidade: z.string().default('UN'),
      custo_medio: z.number().default(0),
      preco_venda: z.number().default(0),
      estoque_atual: z.number().default(0),
      estoque_minimo: z.number().default(0),
      localizacao: z.string().optional().nullable(),
      status: z.string().default('ATIVO')
    }).parse(req.body);

    const tenantId = req.user.current_tenant_id;
    const rows = await withTenant(db, tenantId, tx =>
      tx.execute(sql`
        INSERT INTO produtos (
          tenant_id, nome, sku, ean, ncm, unidade, custo_medio, preco_venda, 
          estoque_atual, estoque_minimo, localizacao, status
        )
        VALUES (
          ${tenantId}::uuid, ${body.nome}, ${body.sku ?? null},
          ${body.ean ?? null}, ${body.ncm ?? null}, ${body.unidade}, 
          ${body.custo_medio}, ${body.preco_venda}, ${body.estoque_atual}, 
          ${body.estoque_minimo}, ${body.localizacao ?? null}, ${body.status}
        )
        RETURNING *
      `)
    );
    return { success: true, data: rows[0], error: null };
  });

  app.put('/estoque/produtos/:id', async req => {
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const body = z.object({
      nome: z.string().min(1).optional(),
      sku: z.string().optional().nullable(),
      ean: z.string().optional().nullable(),
      ncm: z.string().optional().nullable(),
      unidade: z.string().optional(),
      custo_medio: z.number().optional(),
      preco_venda: z.number().optional(),
      estoque_minimo: z.number().optional(),
      localizacao: z.string().optional().nullable(),
      status: z.string().optional()
    }).parse(req.body);

    const tenantId = req.user.current_tenant_id;
    const rows = await withTenant(db, tenantId, tx =>
      tx.execute(sql`
        UPDATE produtos SET 
          nome = COALESCE(${body.nome ?? null}, nome),
          sku = COALESCE(${body.sku ?? null}, sku),
          ean = COALESCE(${body.ean ?? null}, ean),
          ncm = COALESCE(${body.ncm ?? null}, ncm),
          unidade = COALESCE(${body.unidade ?? null}, unidade),
          custo_medio = COALESCE(${body.custo_medio ?? null}, custo_medio),
          preco_venda = COALESCE(${body.preco_venda ?? null}, preco_venda),
          estoque_minimo = COALESCE(${body.estoque_minimo ?? null}, estoque_minimo),
          localizacao = COALESCE(${body.localizacao ?? null}, localizacao),
          status = COALESCE(${body.status ?? null}, status)
        WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
        RETURNING *
      `)
    );
    if (!rows[0]) throw new HttpError(404, 'NOT_FOUND', 'Produto não encontrado.');
    return { success: true, data: rows[0], error: null };
  });

  app.delete('/estoque/produtos/:id', async req => {
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const tenantId = req.user.current_tenant_id;
    const rows = await withTenant(db, tenantId, tx =>
      tx.execute(sql`
        UPDATE produtos
        SET deleted_at = NOW()
        WHERE tenant_id = ${tenantId}::uuid
          AND id = ${id}::uuid
          AND deleted_at IS NULL
        RETURNING id
      `)
    );
    if (!rows[0]) throw new HttpError(404, 'NOT_FOUND', 'Produto não encontrado ou já removido nesta empresa.');
    return { success: true, data: rows[0], error: null };
  });

  // ==========================================
  // IMPORTAÇÃO DE XML (NF-e / Produtos)
  // ==========================================
  app.post('/estoque/importar-xml', async req => {
    const schema = z.object({
      xml: z.string().optional(),
      numero_nf: z.string().optional().nullable(),
      documento: z.string().optional().nullable(),
      fornecedor: z.string().optional().nullable(),
      itens: z.array(z.object({
        nome: z.string().trim().min(1),
        sku: z.string().optional().nullable(),
        ean: z.string().optional().nullable(),
        ncm: z.string().optional().nullable(),
        unidade: z.string().default('UN'),
        quantidade: z.number().positive(),
        custo_unitario: z.number().nonnegative().default(0),
        preco_venda: z.number().nonnegative().optional(),
      })).optional()
    });

    const parsed = schema.parse(req.body);
    let itens = parsed.itens ?? [];
    let numeroNf = parsed.numero_nf ?? parsed.documento ?? null;
    let fornecedor = parsed.fornecedor ?? null;

    if (itens.length === 0 && parsed.xml) {
      const extracted = parseNfeXmlServer(parsed.xml);
      itens = extracted.itens.map(i => ({ ...i, unidade: i.unidade ?? 'UN' }));
      numeroNf = numeroNf ?? extracted.numero_nf;
      fornecedor = fornecedor ?? extracted.fornecedor;
    }

    if (itens.length === 0) {
      throw new HttpError(400, 'INVALID_XML', 'Nenhum produto ou item de nota fiscal foi encontrado no arquivo XML.');
    }

    const tenantId = req.user.current_tenant_id;
    const result = await withTenant(db, tenantId, async tx => {
      let criados = 0;
      let atualizados = 0;
      const produtosProcessados = [];

      const docRef = numeroNf
        ? (/^nf/i.test(numeroNf.trim()) ? numeroNf.trim() : `NF-e ${numeroNf.trim()}`)
        : 'XML Importado';
      const motivoEntrada = fornecedor
        ? `Entrada via XML (${docRef} - ${fornecedor})`
        : `Entrada via importação de XML (${docRef})`;

      for (const item of itens) {
        const skuClean = item.sku?.trim() || null;
        const eanClean = item.ean?.trim() && item.ean.trim().toUpperCase() !== 'SEM GTIN' ? item.ean.trim() : null;
        const ncmClean = item.ncm?.trim() || null;
        const unidadeClean = ['UN', 'KG', 'M', 'CX', 'L'].includes(item.unidade.toUpperCase())
          ? item.unidade.toUpperCase()
          : 'UN';

        // Procura produto existente por SKU, EAN ou nome exato
        const existingRows = await tx.execute(sql`
          SELECT * FROM produtos
          WHERE tenant_id = ${tenantId}::uuid
            AND deleted_at IS NULL
            AND (
              (${skuClean}::text IS NOT NULL AND sku = ${skuClean})
              OR (${eanClean}::text IS NOT NULL AND ean = ${eanClean})
              OR lower(nome) = lower(${item.nome})
            )
          LIMIT 1
          FOR UPDATE
        `);

        let prodRow: Record<string, any>;

        if (existingRows[0]) {
          const current = existingRows[0];
          const estoqueAnterior = Math.max(0, Number(current.estoque_atual ?? 0));
          const custoAnterior = Math.max(0, Number(current.custo_medio ?? 0));
          const novoEstoque = estoqueAnterior + item.quantidade;
          const novoCustoMedio =
            novoEstoque > 0 && item.custo_unitario > 0
              ? Number(((estoqueAnterior * custoAnterior + item.quantidade * item.custo_unitario) / novoEstoque).toFixed(2))
              : custoAnterior || item.custo_unitario;

          const [updated] = await tx.execute(sql`
            UPDATE produtos
            SET
              estoque_atual = ${novoEstoque},
              custo_medio = ${novoCustoMedio},
              preco_venda = CASE
                WHEN preco_venda <= 0 AND ${item.preco_venda ?? 0} > 0 THEN ${item.preco_venda ?? 0}
                ELSE preco_venda
              END,
              sku = COALESCE(sku, ${skuClean}),
              ean = COALESCE(ean, ${eanClean}),
              ncm = COALESCE(ncm, ${ncmClean})
            WHERE id = ${current.id}::uuid AND tenant_id = ${tenantId}::uuid
            RETURNING *
          `);
          prodRow = updated;
          atualizados++;
        } else {
          const precoVenda = item.preco_venda && item.preco_venda > 0
            ? item.preco_venda
            : Number((item.custo_unitario * 1.35).toFixed(2));

          const [inserted] = await tx.execute(sql`
            INSERT INTO produtos (
              tenant_id, nome, sku, ean, ncm, unidade, custo_medio, preco_venda,
              estoque_atual, estoque_minimo, status
            ) VALUES (
              ${tenantId}::uuid,
              ${item.nome},
              ${skuClean},
              ${eanClean},
              ${ncmClean},
              ${unidadeClean},
              ${item.custo_unitario},
              ${precoVenda},
              ${item.quantidade},
              0,
              'ATIVO'
            )
            RETURNING *
          `);
          prodRow = inserted;
          criados++;
        }

        await tx.execute(sql`
          INSERT INTO movimentacoes_estoque (
            tenant_id, produto_id, tipo, quantidade, custo_unitario, motivo, documento
          ) VALUES (
            ${tenantId}::uuid,
            ${prodRow.id}::uuid,
            'ENTRADA',
            ${item.quantidade},
            ${item.custo_unitario},
            ${motivoEntrada},
            ${docRef}
          )
        `);

        produtosProcessados.push(prodRow);
      }

      return {
        criados,
        atualizados,
        total_itens: itens.length,
        numero_nf: numeroNf,
        fornecedor,
        produtos: produtosProcessados,
      };
    });

    return { success: true, data: result, error: null };
  });

  // ==========================================
  // MOVIMENTAÇÕES
  // ==========================================
  app.get('/estoque/movimentacoes', async req => {
    const tenantId = req.user.current_tenant_id;
    const query = req.query as Record<string, unknown>;
    const paginated = 'page' in query || 'limit' in query;
    const page = pageQuery(query);
    const result = await withTenant(db, tenantId, async tx => {
      const [count] = await tx.execute(sql`SELECT count(*)::int total FROM movimentacoes_estoque WHERE tenant_id = ${tenantId}::uuid`);
      const rows = await tx.execute(sql`
        SELECT m.id,m.produto_id,m.tipo,m.quantidade,m.custo_unitario,m.motivo,m.documento,m.created_at,
          p.nome as produto_nome,p.sku as produto_sku
        FROM movimentacoes_estoque m
        JOIN produtos p ON p.id = m.produto_id
        WHERE m.tenant_id = ${tenantId}::uuid
        ORDER BY m.created_at DESC LIMIT ${page.limit} OFFSET ${page.offset}
      `);
      return pageResult(rows, page.page, page.limit, Number(count.total));
    });
    return { success: true, data: paginated ? result : result.data, error: null };
  });

  app.post('/estoque/movimentacoes', async req => {
    const body = z.object({
      produto_id: z.string().uuid(),
      tipo: z.enum(['ENTRADA', 'SAIDA', 'AJUSTE', 'TRANSFERENCIA']),
      quantidade: z.number().nonnegative(),
      custo_unitario: z.number().nonnegative().default(0),
      motivo: z.string().trim().min(1).max(500),
      documento: z.string().optional().nullable()
    }).parse(req.body);

    const tenantId = req.user.current_tenant_id;
    const rows = await withTenant(db, tenantId, async tx => {
      const [produto] = await tx.execute(sql`
        SELECT id, nome, sku, estoque_atual
        FROM produtos
        WHERE id = ${body.produto_id}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
        FOR UPDATE
      `);
      if (!produto) throw new HttpError(404, 'NOT_FOUND', 'Produto não encontrado.');
      if (body.tipo !== 'AJUSTE' && body.quantidade <= 0) {
        throw new HttpError(400, 'INVALID_QUANTITY', 'A quantidade deve ser maior que zero.');
      }
      if (body.tipo === 'TRANSFERENCIA') {
        throw new HttpError(400, 'INVALID_MOVEMENT', 'Transferência exige um produto de origem e um produto de destino.');
      }

      let updatedProduct;
      if (body.tipo === 'ENTRADA') {
        [updatedProduct] = await tx.execute(sql`
          UPDATE produtos SET estoque_atual = estoque_atual + ${body.quantidade}
          WHERE id = ${body.produto_id}::uuid AND tenant_id = ${tenantId}::uuid RETURNING estoque_atual
        `);
      } else if (body.tipo === 'SAIDA') {
        [updatedProduct] = await tx.execute(sql`
          UPDATE produtos SET estoque_atual = estoque_atual - ${body.quantidade}
          WHERE id = ${body.produto_id}::uuid AND tenant_id = ${tenantId}::uuid AND estoque_atual >= ${body.quantidade}
          RETURNING estoque_atual
        `);
        if (!updatedProduct) throw new HttpError(409, 'INSUFFICIENT_STOCK', 'Saldo insuficiente para esta saída.');
      } else {
        [updatedProduct] = await tx.execute(sql`
          UPDATE produtos SET estoque_atual = ${body.quantidade}
          WHERE id = ${body.produto_id}::uuid AND tenant_id = ${tenantId}::uuid RETURNING estoque_atual
        `);
      }

      const [movement] = await tx.execute(sql`
        INSERT INTO movimentacoes_estoque (
          tenant_id, produto_id, tipo, quantidade, custo_unitario, motivo, documento
        ) VALUES (
          ${tenantId}::uuid, ${body.produto_id}::uuid, ${body.tipo},
          ${body.quantidade}, ${body.custo_unitario}, ${body.motivo}, ${body.documento ?? null}
        ) RETURNING *
      `);
      return { ...movement, produto_nome: produto.nome, produto_sku: produto.sku, estoque_atual: updatedProduct.estoque_atual };
    });

    return { success: true, data: rows, error: null };
  });
}
