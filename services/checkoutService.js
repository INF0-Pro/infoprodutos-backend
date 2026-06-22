const { supabase } = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const { applicationLogger, errorsLogger } = require('../config/logger');

class CheckoutService {
  normalizeProductIds(data) {
    const ids = data.product_ids || data.products || [];
    if (Array.isArray(ids)) return ids.filter(Boolean);
    if (data.product_id) return [data.product_id];
    return [];
  }

  async syncProductLinks(checkoutId, productIds = [], defaultProductId = null) {
    try {
      await supabase
        .from('product_checkouts')
        .delete()
        .eq('checkout_id', checkoutId);

      if (!productIds.length) return;

      const links = productIds.map(productId => ({
        id: uuidv4(),
        product_id: productId,
        checkout_id: checkoutId,
        is_default: productId === (defaultProductId || productIds[0]),
        created_at: new Date().toISOString(),
      }));

      const { error } = await supabase
        .from('product_checkouts')
        .insert(links);

      if (error) throw error;

      for (const link of links.filter(l => l.is_default)) {
        await supabase
          .from('products')
          .update({ default_checkout_id: checkoutId })
          .eq('id', link.product_id);
      }
    } catch (err) {
      errorsLogger.error('syncProductLinks failed', {
        error: err.message,
        checkoutId,
      });
      throw err;
    }
  }

  /**
   * Criar checkout reutilizavel
   */
  async create(data) {
    try {
      const checkout = {
        id: uuidv4(),
        name: data.name,
        description: data.description || '',
        entity: data.entity,
        reference: data.reference,
        checkout_template: data.checkout_template || 'default',
        payment_template: data.payment_template || 'default',
        is_default: !!data.is_default,
        status: data.status || 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const { data: result, error } = await supabase
        .from('checkouts')
        .insert(checkout)
        .select()
        .single();

      if (error) throw error;

      await this.syncProductLinks(
        result.id,
        this.normalizeProductIds(data),
        data.default_product_id || data.product_id
      );

      applicationLogger.info('Checkout created', {
        checkoutId: result.id,
        name: result.name,
      });

      return this.getById(result.id);
    } catch (err) {
      errorsLogger.error('CheckoutService.create failed', { error: err.message });
      throw err;
    }
  }

  /**
   * Listar checkouts
   */
  async list() {
    try {
      const { data, error } = await supabase
        .from('checkouts')
        .select('*, product_checkouts(product_id, is_default, products:product_id(id, name, price))')
        .neq('status', 'deleted')
        .order('created_at', { ascending: false });

      if (error) throw error;

      return (data || []).map(c => ({
        ...c,
        products: (c.product_checkouts || []).map(link => ({
          ...link.products,
          is_default: link.is_default,
        })),
      }));
    } catch (err) {
      errorsLogger.error('CheckoutService.list failed', { error: err.message });
      throw err;
    }
  }

  /**
   * Buscar checkout por ID
   */
  async getById(id) {
    try {
      const { data, error } = await supabase
        .from('checkouts')
        .select('*, product_checkouts(product_id, is_default, products:product_id(id, name, price))')
        .eq('id', id)
        .single();

      if (error) return null;

      return {
        ...data,
        product_ids: (data.product_checkouts || []).map(link => link.product_id),
        products: (data.product_checkouts || []).map(link => ({
          ...link.products,
          is_default: link.is_default,
        })),
      };
    } catch (err) {
      errorsLogger.error('CheckoutService.getById failed', { error: err.message });
      return null;
    }
  }

  /**
   * Atualizar checkout
   */
  async update(id, data) {
    try {
      const updates = {
        name: data.name,
        description: data.description || '',
        entity: data.entity,
        reference: data.reference,
        checkout_template: data.checkout_template || 'default',
        payment_template: data.payment_template || 'default',
        is_default: !!data.is_default,
        status: data.status || 'active',
        updated_at: new Date().toISOString(),
      };

      const { data: result, error } = await supabase
        .from('checkouts')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      await this.syncProductLinks(
        id,
        this.normalizeProductIds(data),
        data.default_product_id || data.product_id
      );

      return this.getById(result.id);
    } catch (err) {
      errorsLogger.error('CheckoutService.update failed', { error: err.message });
      throw err;
    }
  }

  async setStatus(id, status) {
    if (!['active', 'inactive', 'deleted'].includes(status)) {
      throw new Error('Invalid checkout status');
    }

    const { data, error } = await supabase
      .from('checkouts')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async delete(id) {
    await this.setStatus(id, 'deleted');
    return true;
  }
}

module.exports = new CheckoutService();
