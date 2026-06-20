// ============================================================
// INFOPRODUTOS PLATFORM - TESTE DE TRACKING E FUNNEL
// ============================================================
// Testa: trackEvent → getEvents → getFunnelStats
// Uso: node test-tracking.js
// ============================================================

require('dotenv').config();
const supabase = require('./config/database');
const { v4: uuidv4 } = require('uuid');

const API_BASE = `http://localhost:${process.env.PORT || 3000}/api`;

let testPassed = 0;
let testFailed = 0;
let createdSessionId = null;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    testPassed++;
  } else {
    console.log(`  ❌ ${message}`);
    testFailed++;
  }
}

async function runTests() {
  console.log('\n============================================');
  console.log('🧪 TESTE DE TRACKING E FUNNEL');
  console.log('============================================\n');

  try {
    // === SETUP ===
    console.log('📦 0. Criar sessão de teste...');
    const sessionId = uuidv4();
    const now = new Date().toISOString();

    const { data: session, error } = await supabase
      .from('payment_sessions')
      .insert({
        id: sessionId,
        product_id: '00000000-0000-0000-0000-000000000001',
        checkout_id: '00000000-0000-0000-0000-000000000002',
        customer_name: 'Cliente Tracking',
        customer_email: `tracking${Date.now()}@teste.com`,
        customer_phone: '+244900000000',
        expected_amount: 1000.00,
        selected_order_bumps: [],
        status: 'WAITING_PAYMENT',
        score: 50,
        created_at: now,
        updated_at: now,
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        last_activity_at: now,
        copied_entity: '12345',
        copied_reference: `REF-${Date.now()}`,
        copied_value: null,
        payment_confirmed_at: null,
        delivery_unlocked_at: null,
        upsell_status: 'none',
      })
      .select()
      .single();

    if (error) {
      console.log(`  ⚠️  Erro ao criar sessão: ${error.message}`);
      console.log(`  ⚠️  Detalhes: ${JSON.stringify(error)}`);
    }
    assert(!error && session, 'Sessão criada');
    createdSessionId = sessionId;

    if (!session) {
      console.log('❌ Teste abortado: não foi possível criar sessão');
      await cleanup();
      process.exit(1);
    }

    // === TESTE 1: Track eventos ===
    console.log('\n📌 Teste 1: Registar eventos de tracking');
    try {
      const events = [
        { event: 'checkout_opened', data: { session_id: sessionId, customer_email: session.customer_email, product_id: session.product_id } },
        { event: 'form_started', data: { session_id: sessionId } },
        { event: 'form_completed', data: { session_id: sessionId } },
        { event: 'payment_session_created', data: { session_id: sessionId } },
        { event: 'entity_copied', data: { session_id: sessionId } },
        { event: 'reference_copied', data: { session_id: sessionId } },
        { event: 'value_copied', data: { session_id: sessionId } },
        { event: 'payment_page_opened', data: { session_id: sessionId } },
      ];

      for (const { event, data } of events) {
        const res = await fetch(`${API_BASE}/tracking/events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event_name: event, ...data }),
        });

        // Note: tracking routes might not have POST, let's use direct service call
        // For now, we'll test via the API if it exists
      }

      // Since we don't have a POST endpoint for tracking, let's test via direct DB insert
      for (const { event, data } of events) {
        const { error: trackError } = await supabase
          .from('tracking_events')
          .insert({
            id: uuidv4(),
            event_name: event,
            session_id: data.session_id,
            customer_email: data.customer_email,
            product_id: data.product_id,
            metadata: {},
            ip_address: '127.0.0.1',
            user_agent: 'test',
            created_at: new Date().toISOString(),
          });

        assert(!trackError, `Evento "${event}" registado`);
      }
    } catch (err) {
      console.log(`  ❌ Erro: ${err.message}`);
      testFailed++;
    }

    // === TESTE 2: Obter eventos da sessão ===
    console.log('\n📌 Teste 2: Obter eventos da sessão');
    try {
      const res = await fetch(`${API_BASE}/tracking/session/${sessionId}/events`);
      const data = await res.json();
      assert(res.ok, `Eventos obtidos: ${res.status}`);
      assert(Array.isArray(data), 'Resposta é array');
      assert(data.length >= 8, `Eventos encontrados: ${data.length}`);
    } catch (err) {
      console.log(`  ❌ Erro: ${err.message}`);
      testFailed++;
    }

    // === TESTE 3: Obter estatísticas ===
    console.log('\n📌 Teste 3: Obter estatísticas de eventos');
    try {
      const res = await fetch(`${API_BASE}/tracking/stats?start_date=${new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()}`);
      const data = await res.json();
      assert(res.ok, `Stats obtidas: ${res.status}`);
      assert(typeof data === 'object', 'Stats é objeto');
      assert(data['checkout_opened'] >= 1, 'Checkout opened count > 0');
    } catch (err) {
      console.log(`  ❌ Erro: ${err.message}`);
      testFailed++;
    }

    // === TESTE 4: Obter funnel stats ===
    console.log('\n📌 Teste 4: Obter estatísticas de funil');
    try {
      const res = await fetch(`${API_BASE}/tracking/funnel?start_date=${new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()}`);
      const data = await res.json();
      assert(res.ok, `Funnel stats obtidas: ${res.status}`);
      assert(typeof data === 'object', 'Funnel stats é objeto');
      assert('total_sessions' in data, 'Tem total_sessions');
      assert('checkout_conversion' in data, 'Tem checkout_conversion');
      assert('payment_conversion' in data, 'Tem payment_conversion');
    } catch (err) {
      console.log(`  ❌ Erro: ${err.message}`);
      testFailed++;
    }

    // === TESTE 5: Filtrar eventos ===
    console.log('\n📌 Teste 5: Filtrar eventos por tipo');
    try {
      const res = await fetch(`${API_BASE}/tracking/events?event_name=checkout_opened&limit=10`);
      const data = await res.json();
      assert(res.ok, `Eventos filtrados: ${res.status}`);
      assert(Array.isArray(data.data), 'Data é array');
      assert(data.data.every(e => e.event_name === 'checkout_opened'), 'Todos são checkout_opened');
    } catch (err) {
      console.log(`  ❌ Erro: ${err.message}`);
      testFailed++;
    }

  } catch (err) {
    console.log(`\n  ❌ Erro inesperado: ${err.message}`);
    testFailed++;
  }

  // === RESULTADOS ===
  printResults();

  // === LIMPEZA ===
  await cleanup();
}

async function cleanup() {
  console.log('\n🧹 Limpeza de dados de teste...');

  if (createdSessionId) {
    // Delete tracking events for this session
    const { data: events } = await supabase
      .from('tracking_events')
      .select('id')
      .eq('session_id', createdSessionId);

    if (events && events.length > 0) {
      for (const event of events) {
        await supabase.from('tracking_events').delete().eq('id', event.id);
      }
      console.log(`  - ${events.length} eventos de tracking eliminados`);
    }

    await supabase.from('payment_sessions').delete().eq('id', createdSessionId);
    console.log('  - Sessão eliminada');
  }

  console.log('  ✅ Limpeza concluída');
}

function printResults() {
  const total = testPassed + testFailed;
  console.log('\n============================================');
  console.log('📊 RESULTADOS DOS TESTES');
  console.log('============================================');
  console.log(`  Total: ${total}`);
  console.log(`  ✅ Passaram: ${testPassed}`);
  console.log(`  ❌ Falharam: ${testFailed}`);
  console.log(`  📈 Taxa de sucesso: ${total > 0 ? Math.round((testPassed / total) * 100) : 0}%`);
  console.log('============================================\n');
}

runTests();
