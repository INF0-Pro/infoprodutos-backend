const { supabase } = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const { applicationLogger, errorsLogger } = require('../config/logger');

class TrackingService {
  /**
   * Track an event
   */
  async trackEvent(eventName, data = {}) {
    try {
      const event = {
        id: uuidv4(),
        event_name: eventName,
        session_id: data.session_id || null,
        customer_email: data.customer_email || null,
        product_id: data.product_id || null,
        funnel_id: data.funnel_id || null,
        metadata: data.metadata || {},
        ip_address: data.ip_address || null,
        user_agent: data.user_agent || null,
        created_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from('tracking_events')
        .insert(event);

      if (error) throw error;

      applicationLogger.debug('Event tracked', { eventName, sessionId: data.session_id });
    } catch (err) {
      errorsLogger.error('Failed to track event', { error: err.message, eventName, data });
    }
  }

  /**
   * Get events for a session
   */
  async getSessionEvents(sessionId) {
    const { data, error } = await supabase
      .from('tracking_events')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return data || [];
  }

  /**
   * Get events by type with filters
   */
  async getEventsByType(eventName, filters = {}) {
    let query = supabase
      .from('tracking_events')
      .select('*', { count: 'exact' })
      .eq('event_name', eventName);

    if (filters.start_date) query = query.gte('created_at', filters.start_date);
    if (filters.end_date) query = query.lte('created_at', filters.end_date);
    if (filters.product_id) query = query.eq('product_id', filters.product_id);

    query = query.order('created_at', { ascending: false });

    if (filters.limit) query = query.limit(filters.limit);
    if (filters.offset) query = query.range(filters.offset, filters.offset + (filters.limit || 50) - 1);

    const { data, error, count } = await query;
    if (error) throw error;
    return { data, count };
  }

  /**
   * Get event statistics
   */
  async getEventStats(startDate, endDate) {
    const { data, error } = await supabase
      .from('tracking_events')
      .select('event_name, count')
      .gte('created_at', startDate)
      .lte('created_at', endDate);

    if (error) throw error;

    // Aggregate counts by event name
    const stats = {};
    for (const row of data || []) {
      stats[row.event_name] = (stats[row.event_name] || 0) + 1;
    }

    return stats;
  }

  /**
   * Get events with filters
   */
  async getEvents(filters = {}) {
    let query = supabase
      .from('tracking_events')
      .select('*', { count: 'exact' });

    if (filters.event_name) query = query.eq('event_name', filters.event_name);
    if (filters.session_id) query = query.eq('session_id', filters.session_id);
    if (filters.customer_email) query = query.eq('customer_email', filters.customer_email);
    if (filters.product_id) query = query.eq('product_id', filters.product_id);
    if (filters.start_date) query = query.gte('created_at', filters.start_date);
    if (filters.end_date) query = query.lte('created_at', filters.end_date);

    query = query.order('created_at', { ascending: false });

    if (filters.limit) query = query.limit(filters.limit);
    if (filters.offset) query = query.range(filters.offset, filters.offset + (filters.limit || 20) - 1);

    const { data, error, count } = await query;
    if (error) throw error;
    return { data, count };
  }

  /**
   * Get funnel stats
   */
  async getFunnelStats(startDate, endDate) {
    try {
      // Get all events in date range
      const { data: events, error } = await supabase
        .from('tracking_events')
        .select('event_name, session_id, created_at')
        .gte('created_at', startDate)
        .lte('created_at', endDate)
        .order('created_at', { ascending: true });

      if (error) throw error;

      // Calculate funnel metrics
      const stats = {
        total_sessions: new Set(events.map(e => e.session_id)).size,
        checkout_opened: 0,
        form_started: 0,
        form_completed: 0,
        payment_session_created: 0,
        waiting_payment: 0,
        payment_confirmed: 0,
        upsell_viewed: 0,
        upsell_accepted: 0,
        upsell_declined: 0,
        delivery_opened: 0,
        product_downloaded: 0,
      };

      const sessionEvents = {};
      events.forEach(event => {
        if (!sessionEvents[event.session_id]) {
          sessionEvents[event.session_id] = [];
        }
        sessionEvents[event.session_id].push(event);
      });

      Object.values(sessionEvents).forEach(sessionEventList => {
        sessionEventList.forEach(event => {
          switch (event.event_name) {
            case 'checkout_opened':
              stats.checkout_opened++;
              break;
            case 'form_started':
              stats.form_started++;
              break;
            case 'form_completed':
              stats.form_completed++;
              break;
            case 'payment_session_created':
              stats.payment_session_created++;
              break;
            case 'payment_page_opened':
              stats.waiting_payment++;
              break;
            case 'payment_confirmed':
              stats.payment_confirmed++;
              break;
            case 'upsell_viewed':
              stats.upsell_viewed++;
              break;
            case 'upsell_accepted':
              stats.upsell_accepted++;
              break;
            case 'upsell_declined':
              stats.upsell_declined++;
              break;
            case 'delivery_opened':
              stats.delivery_opened++;
              break;
            case 'product_downloaded':
              stats.product_downloaded++;
              break;
          }
        });
      });

      // Calculate conversion rates
      stats.checkout_conversion = stats.total_sessions > 0 ? (stats.checkout_opened / stats.total_sessions) * 100 : 0;
      stats.payment_conversion = stats.checkout_opened > 0 ? (stats.payment_confirmed / stats.checkout_opened) * 100 : 0;
      stats.upsell_conversion = stats.upsell_viewed > 0 ? (stats.upsell_accepted / stats.upsell_viewed) * 100 : 0;
      stats.delivery_conversion = stats.payment_confirmed > 0 ? (stats.delivery_opened / stats.payment_confirmed) * 100 : 0;
      stats.checkout_abandonment = stats.checkout_opened > 0 ? ((stats.checkout_opened - stats.payment_session_created) / stats.checkout_opened) * 100 : 0;
      stats.upsell_abandonment = stats.upsell_viewed > 0 ? ((stats.upsell_viewed - stats.upsell_accepted - stats.upsell_declined) / stats.upsell_viewed) * 100 : 0;

      return stats;
    } catch (err) {
      errorsLogger.error('Failed to get funnel stats', { error: err.message });
      throw err;
    }
  }
}

module.exports = new TrackingService();
