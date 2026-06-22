const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { supabase } = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../middleware/auth');
const { validateProduct } = require('../middleware/validation');
const { applicationLogger, errorsLogger } = require('../config/logger');

const uploadsRoot = path.join(__dirname, '..', '..', 'uploads');
const productUploads = path.join(uploadsRoot, 'products');
const coverUploads = path.join(uploadsRoot, 'covers');

function ensureUploadDirs() {
  fs.mkdirSync(productUploads, { recursive: true });
  fs.mkdirSync(coverUploads, { recursive: true });
}

function sanitizeExt(fileName = '', fallback = '.bin') {
  const ext = path.extname(fileName).toLowerCase();
  if (/^\.[a-z0-9]{1,8}$/.test(ext)) return ext;
  return fallback;
}

function publicUploadUrl(folder, fileName) {
  return `/uploads/${folder}/${fileName}`;
}

function normalizeIds(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return [value].filter(Boolean);
}

async function syncProductCheckouts(productId, checkoutIds = [], defaultCheckoutId = null) {
  const ids = normalizeIds(checkoutIds);
  if (defaultCheckoutId && !ids.includes(defaultCheckoutId)) ids.unshift(defaultCheckoutId);

  await supabase
    .from('product_checkouts')
    .delete()
    .eq('product_id', productId);

  if (!ids.length) return;

  const rows = ids.map(checkoutId => ({
    id: uuidv4(),
    product_id: productId,
    checkout_id: checkoutId,
    is_default: checkoutId === (defaultCheckoutId || ids[0]),
    created_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from('product_checkouts')
    .insert(rows);

  if (error) throw error;
}

async function syncProductOfferRules(productId, body) {
  const configs = [
    {
      table: 'product_upsells',
      column: 'upsell_product_id',
      ids: normalizeIds(body.upsell_product_ids),
    },
    {
      table: 'product_downsells',
      column: 'downsell_product_id',
      ids: normalizeIds(body.downsell_product_ids),
    },
    {
      table: 'product_order_bumps',
      column: 'bump_product_id',
      ids: normalizeIds(body.order_bump_product_ids),
    },
  ];

  for (const config of configs) {
    if (!Array.isArray(config.ids)) continue;

    await supabase
      .from(config.table)
      .delete()
      .eq('main_product_id', productId);

    if (!config.ids.length) continue;

    const rows = config.ids.map((relatedProductId, index) => ({
      id: uuidv4(),
      main_product_id: productId,
      [config.column]: relatedProductId,
      checkout_id: config.table === 'product_order_bumps' ? body.default_checkout_id || null : undefined,
      is_active: true,
      order_index: config.table === 'product_order_bumps' ? undefined : index,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

    const { error } = await supabase
      .from(config.table)
      .insert(rows);

    if (error) throw error;
  }
}

function productSelect() {
  return `
    *,
    default_checkout:default_checkout_id(id, name, entity, reference),
    product_checkouts(checkout_id, is_default, checkouts:checkout_id(id, name, entity, reference, status)),
    product_upsells(upsell_product_id, products:upsell_product_id(id, name, price)),
    product_downsells(downsell_product_id, products:downsell_product_id(id, name, price)),
    product_order_bumps(bump_product_id, products:bump_product_id(id, name, price))
  `;
}

function shapeProduct(product) {
  return {
    ...product,
    checkout_ids: (product.product_checkouts || []).map(link => link.checkout_id),
    checkouts: (product.product_checkouts || []).map(link => ({
      ...link.checkouts,
      is_default: link.is_default,
    })),
    upsell_product_ids: (product.product_upsells || []).map(link => link.upsell_product_id),
    downsell_product_ids: (product.product_downsells || []).map(link => link.downsell_product_id),
    order_bump_product_ids: (product.product_order_bumps || []).map(link => link.bump_product_id),
  };
}

/**
 * GET /api/products
 * Lista produtos nao eliminados
 */
router.get('/', async (req, res) => {
  try {
    const status = req.query.status || 'active';
    let query = supabase
      .from('products')
      .select(productSelect())
      .neq('status', 'deleted')
      .order('created_at', { ascending: false });

    if (status !== 'all') {
      query = query.eq('status', status);
    }

    const { data, error } = await query;
    if (error) throw error;

    return res.json((data || []).map(shapeProduct));
  } catch (err) {
    errorsLogger.error('Failed to list products', { error: err.message });
    return res.status(500).json({ error: 'Failed to list products' });
  }
});

/**
 * GET /api/products/:id
 */
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('products')
      .select(productSelect())
      .eq('id', req.params.id)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Product not found' });
    }

    return res.json(shapeProduct(data));
  } catch (err) {
    errorsLogger.error('Failed to get product', { error: err.message });
    return res.status(500).json({ error: 'Failed to get product' });
  }
});

/**
 * POST /api/products
 */
router.post('/', authenticateToken, validateProduct, async (req, res) => {
  try {
    const productId = uuidv4();
    const product = {
      id: productId,
      name: req.body.name,
      description: req.body.description || '',
      price: req.body.price,
      content_type: req.body.content_type,
      content_url: req.body.content_url || null,
      cover_url: req.body.cover_url || null,
      default_checkout_id: req.body.default_checkout_id || null,
      status: req.body.status || 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('products')
      .insert(product)
      .select()
      .single();

    if (error) throw error;

    await syncProductCheckouts(productId, req.body.checkout_ids, req.body.default_checkout_id);
    await syncProductOfferRules(productId, req.body);

    applicationLogger.info('Product created', { productId: data.id, name: data.name });

    const { data: full } = await supabase
      .from('products')
      .select(productSelect())
      .eq('id', data.id)
      .single();

    return res.status(201).json(shapeProduct(full || data));
  } catch (err) {
    errorsLogger.error('Failed to create product', { error: err.message });
    return res.status(500).json({ error: 'Failed to create product' });
  }
});

/**
 * PUT /api/products/:id
 */
router.put('/:id', authenticateToken, validateProduct, async (req, res) => {
  try {
    const updates = {
      name: req.body.name,
      description: req.body.description || '',
      price: req.body.price,
      content_type: req.body.content_type,
      content_url: req.body.content_url || null,
      cover_url: req.body.cover_url || null,
      default_checkout_id: req.body.default_checkout_id || null,
      status: req.body.status || 'active',
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('products')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .maybeSingle();

    if (error || !data) {
      return res.status(404).json({ error: 'Product not found' });
    }

    await syncProductCheckouts(req.params.id, req.body.checkout_ids, req.body.default_checkout_id);
    await syncProductOfferRules(req.params.id, req.body);

    const { data: full } = await supabase
      .from('products')
      .select(productSelect())
      .eq('id', req.params.id)
      .single();

    return res.json(shapeProduct(full || data));
  } catch (err) {
    errorsLogger.error('Failed to update product', { error: err.message });
    return res.status(500).json({ error: 'Failed to update product' });
  }
});

router.post(
  '/:id/upload/content',
  authenticateToken,
  express.raw({ type: ['application/pdf', 'application/octet-stream'], limit: '80mb' }),
  async (req, res) => {
    try {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: 'File body required' });
      }

      ensureUploadDirs();
      const fileName = `${req.params.id}-${Date.now()}${sanitizeExt(req.get('x-file-name'), '.pdf')}`;
      const filePath = path.join(productUploads, fileName);
      fs.writeFileSync(filePath, req.body);

      const contentUrl = publicUploadUrl('products', fileName);
      const { data, error } = await supabase
        .from('products')
        .update({
          content_url: contentUrl,
          content_type: req.get('content-type') === 'application/pdf' ? 'ebook' : 'download',
          updated_at: new Date().toISOString(),
        })
        .eq('id', req.params.id)
        .select()
        .single();

      if (error) throw error;
      return res.json(data);
    } catch (err) {
      errorsLogger.error('Product content upload failed', { error: err.message, productId: req.params.id });
      return res.status(500).json({ error: 'Failed to upload product file' });
    }
  }
);

router.post(
  '/:id/upload/cover',
  authenticateToken,
  express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '10mb' }),
  async (req, res) => {
    try {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: 'Image body required' });
      }

      ensureUploadDirs();
      const fallback = req.get('content-type') === 'image/png' ? '.png' : '.jpg';
      const fileName = `${req.params.id}-${Date.now()}${sanitizeExt(req.get('x-file-name'), fallback)}`;
      const filePath = path.join(coverUploads, fileName);
      fs.writeFileSync(filePath, req.body);

      const coverUrl = publicUploadUrl('covers', fileName);
      const { data, error } = await supabase
        .from('products')
        .update({ cover_url: coverUrl, updated_at: new Date().toISOString() })
        .eq('id', req.params.id)
        .select()
        .single();

      if (error) throw error;
      return res.json(data);
    } catch (err) {
      errorsLogger.error('Product cover upload failed', { error: err.message, productId: req.params.id });
      return res.status(500).json({ error: 'Failed to upload product cover' });
    }
  }
);

/**
 * DELETE /api/products/:id
 */
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('products')
      .update({
        status: 'deleted',
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Product not found' });
    }

    return res.json({ message: 'Product deleted', product: data });
  } catch (err) {
    errorsLogger.error('Failed to delete product', { error: err.message });
    return res.status(500).json({ error: 'Failed to delete product' });
  }
});

module.exports = router;
