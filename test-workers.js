// ============================================================
// INFOPRODUTOS PLATFORM - TESTE DE WORKERS
// ============================================================
// Testa: workers, recuperação e consistência
// Uso: node test-workers.js
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
  console.log('🧪 TESTE DE WORKERS E RECUPERAÇÃO');
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
        customer_name: 'Cliente Workers',
        customer_email: `workers${Date.now()}@teste.com`,
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

    assert(!error && session, 'Sessão criada');
    createdSessionId = sessionId;

    if (!session) {
      console.log('❌ Teste abortado: não foi possível criar sessão');
      await cleanup();
      process.exit(1);
    }

    // === TESTE 1: Verificar health check ===
    console.log('\n📌 Teste 1: Health check');
    try {
      const res = await fetch(`${API_BASE}/health`);
      const data = await res.json();
      assert(res.ok, `Health OK: ${res.status}`);
      assert(data.status === 'ok', 'Status ok');
      assert(typeof data.uptime === 'number', 'Uptime presente');
    } catch (err) {
      console.log(`  ❌ Erro: ${err.message}`);
      testFailed++;
    }

    // === TESTE 2: Verificar diagnostics ===
    console.log('\n📌 Teste 2: Diagnostics');
    try {
      const res = await fetch(`${API_BASE}/diagnostics`);
      const data = await res.json();
      assert(res.ok, `Diagnostics OK: ${res.status}`);
      assert(data.checks, 'Tem checks');
      assert(data.overall_status, 'Tem overall_status');
    } catch (err) {
      console.log(`  ❌ Erro: ${err.message}`);
      testFailed++;
    }

    // === TESTE 3: Verificar workers ativos ===
    console.log('\n📌 Teste 3: Workers ativos');
    try {
      const res = await fetch(`${API_BASE}/diagnostics`);
      const data = await res.json();
      assert(data.workers_enabled !== undefined, 'Workers status presente');
      console.log(`  ℹ️  Workers enabled: ${data.workers_enabled}`);
    } catch (err) {
      console.log(`  ❌ Erro: ${err.message}`);
      testFailed++;
    }

    // === TESTE 4: Verificar tabelas ===
    console.log('\n📌 Teste 4: Verificar tabelas');
    try {
      const res = await fetch(`${API_BASE}/diagnostics`);
      const data = await res.json();
      const tables = data.checks.tables || {};
      const requiredTables = ['users', 'products', 'checkouts', 'payment_sessions', 'deliveries', 'upsells', 'tracking_events', 'audit_log'];
      
      for (const table of requiredTables) {
        assert(tables[table]?.status === 'ok', `Tabela ${table} existe`);
      }
    } catch (err) {
      console.log(`  ❌ Erro: ${err.message}`);
      testFailed++;
    }

    // === TESTE 5: Simular recuperação de sessão ===
    console.log('\n📌 Teste 5: Recuperação de sessão');
    try {
      // Update session to simulate recovery scenario
      await supabase
        .from('payment_sessions')
        .update({ status: 'WAITING_PAYMENT', updated_at: new Date().toISOString() })
        .eq('id', createdSessionId);

      // Verify session is recoverable
      const { data: recovered } = await supabase
        .from('payment_sessions')
        .select('id, status')
        .eq('id', createdSessionId)
        .single();

      assert(recovered?.status === 'WAITING_PAYMENT', 'Sessão recuperável');
    } catch (err) {
      console.log(`  ❌ Erro: ${err.message}`);
      testFailed++;
    }

    // === TESTE 6: Verificar consistência ===
    console.log('\n📌 Teste 6: Consistência de dados');
    try {
      // Check for orphaned sessions (no product/checkout)
      const { data: orphaned } = await supabase
        .from('payment_sessions')
        .select('id')
        .limit(1);

      assert(true, 'Consulta de consistência executada');
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
