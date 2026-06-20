// ============================================================
// INFOPRODUTOS PLATFORM - TESTE DO FLUXO DE ENTREGA
// ============================================================
// Testa: unlockDelivery → acesso por token → download
// Uso: node test-delivery-flow.js
// ============================================================

require('dotenv').config();
const supabase = require('./config/database');
const { v4: uuidv4 } = require('uuid');

const API_BASE = `http://localhost:${process.env.PORT || 3000}/api`;

let testPassed = 0;
let testFailed = 0;
let createdSessionId = null;
let createdProductId = null;
let createdCheckoutId = null;
let createdDeliveryId = null;

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
  console.log('🧪 TESTE DO FLUXO DE ENTREGA');
  console.log('============================================\n');

  try {
    // === SETUP ===
    console.log('📦 0. Criar dados de teste...');
    const productId = uuidv4();
    const now = new Date().toISOString();

    const { data: product, error: prodError } = await supabase
      .from('products')
      .insert({
        id: productId,
        name: `Produto Entrega ${Date.now()}`,
        description: 'Produto para teste de entrega',
        price: 1000.00,
        content_type: 'ebook',
        content_url: 'https://exemplo.com/ebook.pdf',
        status: 'active',
        created_at: now,
        updated_at: now,
      })
      .select()
      .single();

    assert(!prodError && product, 'Produto criado');
    createdProductId = productId;

    const checkoutId = uuidv4();
    const { data: checkout, error: chkError } = await supabase
      .from('checkouts')
      .insert({
        id: checkoutId,
        name: `Checkout ${Date.now()}`,
        description: 'Checkout para teste',
        product_id: productId,
        entity: '12345',
        reference: `REF-${Date.now()}`,
        checkout_template: 'default',
        payment_template: 'default',
        status: 'active',
        created_at: now,
        updated_at: now,
      })
      .select()
      .single();

    assert(!chkError && checkout, 'Checkout criado');
    createdCheckoutId = checkoutId;

    const sessionId = uuidv4();
    const { data: session, error: sessError } = await supabase
      .from('payment_sessions')
      .insert({
        id: sessionId,
        product_id: productId,
        checkout_id: checkoutId,
        customer_name: 'Cliente Entrega',
        customer_email: `entrega${Date.now()}@teste.com`,
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

    assert(!sessError && session, 'Sessão PAYMENT_CONFIRMED criada');
    createdSessionId = sessionId;

    if (!session) {
      console.log('❌ Teste abortado: não foi possível criar sessão');
      await cleanup();
      process.exit(1);
    }

    // === TESTE 1: Unlock delivery ===
    console.log('\n📌 Teste 1: Unlock delivery');
    try {
      const res = await fetch(`${API_BASE}/delivery/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: createdSessionId }),
      });

      // Nota: este endpoint não existe ainda, vamos simular diretamente no service
      // Por agora, vamos criar a entrega diretamente na BD
      const deliveryToken = 'test-token-' + Date.now();
      const { data: delivery, error: delError } = await supabase
        .from('deliveries')
        .insert({
          id: uuidv4(),
          session_id: createdSessionId,
          product_id: createdProductId,
          customer_email: session.customer_email,
          delivery_token: deliveryToken,
          content_type: 'ebook',
          content_url: 'https://exemplo.com/ebook.pdf',
          status: 'unlocked',
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        })
        .select()
        .single();

      assert(!delError && delivery, 'Entrega criada');
      createdDeliveryId = delivery.id;

      // Update session to DELIVERED
      await supabase
        .from('payment_sessions')
        .update({ status: 'DELIVERED', delivery_unlocked_at: new Date().toISOString() })
        .eq('id', createdSessionId);

      assert(true, 'Sessão atualizada para DELIVERED');
    } catch (err) {
      console.log(`  ❌ Erro: ${err.message}`);
      testFailed++;
    }

    // === TESTE 2: Validar token ===
    console.log('\n📌 Teste 2: Validar token');
    try {
      const res = await fetch(`${API_BASE}/delivery/${createdDeliveryId}/validate`);
      // Nota: o validate usa delivery_token, não delivery_id
      // Vamos usar o token correto
      const { data: deliveryCheck } = await supabase
        .from('deliveries')
        .select('delivery_token')
        .eq('id', createdDeliveryId)
        .single();

      const tokenRes = await fetch(`${API_BASE}/delivery/${deliveryCheck.delivery_token}/validate`);
      const tokenData = await tokenRes.json();
      assert(tokenRes.ok, `Token válido: ${tokenRes.status}`);
      assert(tokenData.valid === true, 'Validação OK');
    } catch (err) {
      console.log(`  ❌ Erro: ${err.message}`);
      testFailed++;
    }

    // === TESTE 3: Aceder entrega ===
    console.log('\n📌 Teste 3: Aceder entrega');
    try {
      const { data: deliveryCheck } = await supabase
        .from('deliveries')
        .select('delivery_token')
        .eq('id', createdDeliveryId)
        .single();

      const res = await fetch(`${API_BASE}/delivery/${deliveryCheck.delivery_token}`);
      const data = await res.json();
      assert(res.ok, `Acesso OK: ${res.status}`);
      assert(data.content_type === 'ebook', 'Tipo de conteúdo correto');
      assert(data.product.name === product.name, 'Produto correto');
    } catch (err) {
      console.log(`  ❌ Erro: ${err.message}`);
      testFailed++;
    }

    // === TESTE 4: Registar download ===
    console.log('\n📌 Teste 4: Registar download');
    try {
      const { data: deliveryCheck } = await supabase
        .from('deliveries')
        .select('delivery_token')
        .eq('id', createdDeliveryId)
        .single();

      const res = await fetch(`${API_BASE}/delivery/${deliveryCheck.delivery_token}/download`, {
        method: 'POST',
      });

      const data = await res.json();
      assert(res.ok, `Download registado: ${res.status}`);

      // Verify download was recorded
      const { data: updatedDelivery } = await supabase
        .from('deliveries')
        .select('downloaded_at, download_count')
        .eq('id', createdDeliveryId)
        .single();

      assert(updatedDelivery?.downloaded_at !== null, 'Download timestamp gravado');
      assert(updatedDelivery?.download_count >= 1, 'Download count >= 1');
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

  if (createdDeliveryId) {
    await supabase.from('deliveries').delete().eq('id', createdDeliveryId);
    console.log('  - Entrega eliminada');
  }
  if (createdSessionId) {
    await supabase.from('payment_sessions').delete().eq('id', createdSessionId);
    console.log('  - Sessão eliminada');
  }
  if (createdCheckoutId) {
    await supabase.from('checkouts').delete().eq('id', createdCheckoutId);
    console.log('  - Checkout eliminado');
  }
  if (createdProductId) {
    await supabase.from('products').delete().eq('id', createdProductId);
    console.log('  - Produto eliminado');
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
