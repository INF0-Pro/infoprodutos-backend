const { supabase } = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const { applicationLogger, errorsLogger } = require('../config/logger');

class CheckoutService {

  /**
   * Criar checkout
   */
  async create(data) {
    try {
      const checkout = {
        id: uuidv4(),
        name: data.name,
        description: data.description || '',
        product_id: data.product_id,
        entity: data.entity,
        reference: data.reference,
        checkout_template: data.checkout_template || 'default',
        payment_template: data.payment_template || 'default',
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const { data: result, error } = await supabase
        .from('checkouts')
        .insert(checkout)
        .select()
        .single();

      if (error) throw error;

      applicationLogger.info('Checkout created', {
        checkoutId: result.id,
        name: result.name,
      });

      return result;

    } catch (err) {
      errorsLogger.error('CheckoutService.create failed', {
        error: err.message,
      });
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
        .select('*, products:product_id(name, price)')
        .order('created_at', { ascending: false });

      if (error) throw error;

      return data || [];
    } catch (err) {
      errorsLogger.error('CheckoutService.list failed', {
        error: err.message,
      });
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
        .select('*, products:product_id(*)')
        .eq('id', id)
        .single();

      if (error) return null;

      return data;
    } catch (err) {
      errorsLogger.error('CheckoutService.getById failed', {
        error: err.message,
      });
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
        product_id: data.product_id,
        entity: data.entity,
        reference: data.reference,
        checkout_template: data.checkout_template || 'default',
        payment_template: data.payment_template || 'default',
        updated_at: new Date().toISOString(),
      };

      const { data: result, error } = await supabase
        .from('checkouts')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      return result;
    } catch (err) {
      errorsLogger.error('CheckoutService.update failed', {
        error: err.message,
      });
      throw err;
    }
  }

  /**
   * Soft delete
   */
  async delete(id) {
    try {
      const { error } = await supabase
        .from('checkouts')
        .update({
          status: 'deleted',
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (error) throw error;

      return true;
    } catch (err) {
      errorsLogger.error('CheckoutService.delete failed', {
        error: err.message,
      });
      throw err;
    }
  }
}

module.exports = new CheckoutService();