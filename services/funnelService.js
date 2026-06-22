const { supabase } = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const { applicationLogger, errorsLogger } = require('../config/logger');

class FunnelService {
  normalizeIds(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.filter(Boolean);
    return [value].filter(Boolean);
  }

  async syncSteps(funnelId, data) {
    await supabase
      .from('funnel_steps')
      .delete()
      .eq('funnel_id', funnelId);

    const steps = [];
    let index = 0;

    steps.push({
      id: uuidv4(),
      funnel_id: funnelId,
      step_type: 'checkout',
      product_id: data.main_product_id,
      order_index: index++,
      is_active: true,
    });

    for (const productId of this.normalizeIds(data.upsell_product_ids)) {
      steps.push({
        id: uuidv4(),
        funnel_id: funnelId,
        step_type: 'upsell',
        product_id: productId,
        order_index: index++,
        is_active: true,
      });
    }

    for (const productId of this.normalizeIds(data.downsell_product_ids)) {
      steps.push({
        id: uuidv4(),
        funnel_id: funnelId,
        step_type: 'downsell',
        product_id: productId,
        order_index: index++,
        is_active: true,
      });
    }

    if (data.recovery_url) {
      steps.push({
        id: uuidv4(),
        funnel_id: funnelId,
        step_type: 'recovery',
        url: data.recovery_url,
        order_index: index++,
        is_active: true,
      });
    }

    steps.push({
      id: uuidv4(),
      funnel_id: funnelId,
      step_type: 'delivery',
      product_id: data.main_product_id,
      order_index: index,
      is_active: true,
    });

    const { error } = await supabase
      .from('funnel_steps')
      .insert(steps);

    if (error) throw error;
  }

  async syncOfferRules(data) {
    const mainProductId = data.main_product_id;
    const upsells = this.normalizeIds(data.upsell_product_ids);
    const downsells = this.normalizeIds(data.downsell_product_ids);

    await supabase
      .from('product_upsells')
      .delete()
      .eq('main_product_id', mainProductId);

    if (upsells.length) {
      const rows = upsells.map((productId, index) => ({
        id: uuidv4(),
        main_product_id: mainProductId,
        upsell_product_id: productId,
        is_active: true,
        order_index: index,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));

      const { error } = await supabase
        .from('product_upsells')
        .insert(rows);

      if (error) throw error;
    }

    await supabase
      .from('product_downsells')
      .delete()
      .eq('main_product_id', mainProductId);

    if (downsells.length) {
      const rows = downsells.map((productId, index) => ({
        id: uuidv4(),
        main_product_id: mainProductId,
        downsell_product_id: productId,
        is_active: true,
        order_index: index,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));

      const { error } = await supabase
        .from('product_downsells')
        .insert(rows);

      if (error) throw error;
    }
  }

  selectQuery() {
    return `
      *,
      products:main_product_id(id, name, price),
      checkouts:checkout_id(id, name),
      funnel_steps(*, products:product_id(id, name, price))
    `;
  }

  shape(funnel) {
    const steps = (funnel.funnel_steps || []).sort((a, b) => a.order_index - b.order_index);
    return {
      ...funnel,
      steps,
      upsell_product_ids: steps.filter(s => s.step_type === 'upsell').map(s => s.product_id),
      downsell_product_ids: steps.filter(s => s.step_type === 'downsell').map(s => s.product_id),
    };
  }

  async list() {
    const { data, error } = await supabase
      .from('funnels')
      .select(this.selectQuery())
      .neq('status', 'deleted')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []).map(f => this.shape(f));
  }

  async getById(id) {
    const { data, error } = await supabase
      .from('funnels')
      .select(this.selectQuery())
      .eq('id', id)
      .single();

    if (error) return null;
    return this.shape(data);
  }

  async create(data) {
    try {
      const funnel = {
        id: uuidv4(),
        name: data.name,
        description: data.description || '',
        main_product_id: data.main_product_id,
        checkout_id: data.checkout_id || null,
        recovery_url: data.recovery_url || null,
        status: data.status || 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const { data: result, error } = await supabase
        .from('funnels')
        .insert(funnel)
        .select()
        .single();

      if (error) throw error;

      await this.syncSteps(result.id, data);
      await this.syncOfferRules(data);

      applicationLogger.info('Funnel created', {
        funnelId: result.id,
        mainProductId: data.main_product_id,
      });

      return this.getById(result.id);
    } catch (err) {
      errorsLogger.error('FunnelService.create failed', { error: err.message, data });
      throw err;
    }
  }

  async update(id, data) {
    try {
      const updates = {
        name: data.name,
        description: data.description || '',
        main_product_id: data.main_product_id,
        checkout_id: data.checkout_id || null,
        recovery_url: data.recovery_url || null,
        status: data.status || 'active',
        updated_at: new Date().toISOString(),
      };

      const { data: result, error } = await supabase
        .from('funnels')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      await this.syncSteps(id, data);
      await this.syncOfferRules(data);

      return this.getById(result.id);
    } catch (err) {
      errorsLogger.error('FunnelService.update failed', { error: err.message, id });
      throw err;
    }
  }

  async delete(id) {
    const { error } = await supabase
      .from('funnels')
      .update({ status: 'deleted', updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw error;
    return true;
  }
}

module.exports = new FunnelService();
