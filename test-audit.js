// ============================================================
// INFOPRODUTOS PLATFORM - TESTE DE AUDITORIA
// ============================================================
// Testa: audit log → consulta → exportação CSV
// Uso: node test-audit.js
// ============================================================

require('dotenv').config();
const supabase = require('./config/database');
const { v4: uuidv4 } = require('uuid');

const API_BASE = `http://localhost:${process.env.PORT || 3000}/api`;

let testPassed = 0;
let testFailed = 0;
let createdSessionId = null;
let createdAuditIds = [];

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
  console.log('🧪 TESTE DE AUDITORIA FORENSE');
  console.log('============================================\n');

  try {
    // === SETUP ===
    console.log('📦 0. Criar sessão e logs de auditoria...');
    const sessionId = uuidv4();
    const now = new Date().toISOString();

    const { data: session, error } = await supabase
      .from('payment_sessions')
      .insert({
        id: sessionId,
        product_id: '00000000-0000-0000-0000-000000000001',
        checkout_id: '00000000-0000-0000-0000-000000000002',
        customer_name: 'Cliente Auditoria',
        customer_email: `audit${Date.now()}@teste.com`,
        customer_phone: '+244900000000',
        expected_amount: 1000.00,
        selected_order_bumps: [],
        status: 'PAYMENT_CONFIRMED',
        score: 100,
        created_at: now,
        updated_at: now,
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        last_activity_at: now,
        copied_entity: '12345',
        copied_reference: `REF-${Date.now()}`,
        copied_value: '1000',
        payment_confirmed_at: now,
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

    // Create audit logs
    const auditLogs = [
      { action: 'payment_decision', details: { matched: true, score: 100, chosen_session: sessionId, rejected: [] } },
      { action: 'state_transition', details: { from: 'WAITING_PAYMENT', to: 'PAYMENT_CONFIRMED' } },
      { action: 'delivery_unlocked', details: { delivery_token: 'test-token-123' } },
    ];

    for (const log of auditLogs) {
      const { data: audit, error: auditError } = await supabase
        .from('audit_log')
        .insert({
          id: uuidv4(),
          session_id: sessionId,
          action: log.action,
          details: log.details,
          ip_address: '127.0.0.1',
          user_agent: 'test-script',
          created_at: new Date().toISOString(),
        })
        .select()
        .single();

      assert(!auditError, `Audit log "${log.action}" criado`);
      if (audit) createdAuditIds.push(audit.id);
    }

    // === TESTE 1: Consultar audit logs ===
    console.log('\n📌 Teste 1: Consultar audit logs');
    try {
      const res = await fetch(`${API_BASE}/diagnostics/audit?session_id=${sessionId}`);
      const data = await res.json();
      assert(res.ok, `Audit logs obtidos: ${res.status}`);
      assert(data.data.length >= 3, `Logs encontrados: ${data.data.length}`);
      assert(data.total >= 3, `Total count: ${data.total}`);
    } catch (err) {
      console.log(`  ❌ Erro: ${err.message}`);
      testFailed++;
    }

    // === TESTE 2: Filtrar por ação ===
    console.log('\n📌 Teste 2: Filtrar audit logs por ação');
    try {
      const res = await fetch(`${API_BASE}/diagnostics/audit?action=payment_decision`);
      const data = await res.json();
      assert(res.ok, `Filtro por ação: ${res.status}`);
      assert(data.data.every(l => l.action === 'payment_decision'), 'Todos são payment_decision');
    } catch (err) {
      console.log(`  ❌ Erro: ${err.message}`);
      testFailed++;
    }

    // === TESTE 3: Exportar CSV ===
    console.log('\n📌 Teste 3: Exportar audit logs como CSV');
    try {
      const res = await fetch(`${API_BASE}/diagnostics/audit/export?start_date=${new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()}`);
      assert(res.ok, `Export CSV: ${res.status}`);
      const text = await res.text();
      assert(text.includes('Action,Details'), 'CSV tem headers');
      assert(text.includes('payment_decision'), 'CSV tem dados');
    } catch (err) {
      console.log(`  ❌ Erro: ${err.message}`);
      testFailed++;
    }

    // === TESTE 4: Verificar detalhes do log ===
    console.log('\n📌 Teste 4: Verificar estrutura dos logs');
    try {
      const res = await fetch(`${API_BASE}/diagnostics/audit?session_id=${sessionId}&limit=1`);
      const data = await res.json();
      const log = data.data[0];
      assert(log.id, 'Tem ID');
      assert(log.session_id, 'Tem session_id');
      assert(log.action, 'Tem action');
      assert(log.details, 'Tem details');
      assert(log.ip_address, 'Tem ip_address');
      assert(log.created_at, 'Tem created_at');
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

  // Delete audit logs
  for (const id of createdAuditIds) {
    await supabase.from('audit_log').delete().eq('id', id);
  }
  if (createdAuditIds.length > 0) {
    console.log(`  - ${createdAuditIds.length} audit logs eliminados`);
  }

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
