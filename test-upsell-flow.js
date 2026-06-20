// ============================================================
// INFOPRODUTOS PLATFORM - TESTE DO FLUXO DE UPSELL
// ============================================================
// Testa: PAYMENT_CONFIRMED → UPSELL_PENDING → UPSELL_ACCEPTED/DECLINED → DELIVERED
// Uso: node test-upsell-flow.js
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
let createdUpsellId = null;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    testPassed++;
  } else {
    console.log(`  ❌ ${message}`);
    testFailed++;
  }
}

async function createTestProduct() {
  const productId = uuidv4();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('products')
    .insert({
      id: productId,
      name: `Produto Principal ${Date.now()}`,
      description: 'Produto principal para teste de upsell',
      price: 1000.00,
      content_type: 'ebook',
      content_url: 'https://exemplo.com/principal.pdf',
      status: 'active',
      created_at: now,
      updated_at: now,
    })
    .select()
    .single();

  if (error) {
    console.log(`  ⚠️  Erro ao criar produto principal: ${error.message}`);
    return null;
  }

  createdProductId = productId;
  return data;
}

async function createTestUpsellProduct() {
  const productId = uuidv4();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('products')
    .insert({
      id: productId,
      name: `Upsell Produto ${Date.now()}`,
      description: 'Produto de upsell',
      price: 1500.00,
      content_type: 'ebook',
      content_url: 'https://exemplo.com/upsell.pdf',
      status: 'active',
      created_at: now,
      updated_at: now,
    })
    .select()
    .single();

  if (error) {
    console.log(`  ⚠️  Erro ao criar produto upsell: ${error.message}`);
    return null;
  }

  return data;
}

async function createTestCheckout(productId) {
  const checkoutId = uuidv4();
  const now = new Date().toISOString();

  const { data, error } = await supabase
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

  if (error) {
    console.log(`  ⚠️  Erro ao criar checkout: ${error.message}`);
    return null;
  }

  createdCheckoutId = checkoutId;
  return data;
}

async function createTestUpsell(mainProductId, upsellProductId) {
  const upsellId = uuidv4();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('upsells')
    .insert({
      id: upsellId,
      main_product_id: mainProductId,
      upsell_product_id: upsellProductId,
      is_active: true,
      created_at: now,
      updated_at: now,
    })
    .select()
    .single();

  if (error) {
    console.log(`  ⚠️  Erro ao criar upsell: ${error.message}`);
    return null;
  }

  createdUpsellId = upsellId;
  return data;
}

async function createTestSession(productId, checkoutId) {
  const sessionId = uuidv4();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('payment_sessions')
    .insert({
      id: sessionId,
      product_id: productId,
      checkout_id: checkoutId,
      customer_name: 'Cliente Upsell',
      customer_email: `upsell${Date.now()}@teste.com`,
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

  if (error) {
    console.log(`  ⚠️  Erro ao criar sessão: ${error.message}`);
    return null;
  }

  createdSessionId = sessionId;
  return data;
}

async function runTests() {
  console.log('\n============================================');
  console.log('🧪 TESTE DO FLUXO DE UPSELL');
  console.log('============================================\n');

  try {
    // === SETUP ===
    console.log('📦 0. Criar dados de teste...');
    const mainProduct = await createTestProduct();
    assert(mainProduct !== null, 'Produto principal criado');

    if (!mainProduct) {
      console.log('❌ Teste abortado: não foi possível criar produto principal');
      printResults();
      await cleanup();
      process.exit(1);
    }

    const upsellProduct = await createTestUpsellProduct();
    assert(upsellProduct !== null, 'Produto de upsell criado');

    const checkout = await createTestCheckout(mainProduct.id);
    assert(checkout !== null, 'Checkout criado');

    const upsell = await createTestUpsell(mainProduct.id, upsellProduct.id);
    assert(upsell !== null, 'Upsell criado');

    const session = await createTestSession(mainProduct.id, checkout.id);
    assert(session !== null, 'Sessão PAYMENT_CONFIRMED criada');

    if (!session) {
      console.log('❌ Teste abortado: não foi possível criar sessão');
      await cleanup();
      process.exit(1);
    }

    // === TESTE 1: Obter oferta de upsell ===
    console.log('\n📌 Teste 1: Obter oferta de upsell');
    try {
      const res = await fetch(`${API_BASE}/upsell/offer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: createdSessionId }),
      });

      const data = await res.json();
      assert(res.ok, `Oferta obtida: ${res.status}`);
      assert(data.upsells && data.upsells.length > 0, 'Upsell oferecido');
      assert(data.expires_at, 'Expiração definida (30min)');

      // Verify session transitioned to UPSELL_PENDING
      const { data: sessionCheck } = await supabase
        .from('payment_sessions')
        .select('status, upsell_status')
        .eq('id', createdSessionId)
        .single();

      assert(sessionCheck?.status === 'UPSELL_PENDING', `Status: ${sessionCheck?.status}`);
      assert(sessionCheck?.upsell_status === 'pending', `Upsell status: ${sessionCheck?.upsell_status}`);
    } catch (err) {
      console.log(`  ❌ Erro: ${err.message}`);
      testFailed++;
    }

    // === TESTE 2: Aceitar upsell ===
    console.log('\n📌 Teste 2: Aceitar upsell');
    try {
      const res = await fetch(`${API_BASE}/upsell/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: createdSessionId, action: 'accept' }),
      });

      const data = await res.json();
      assert(res.ok, `Resposta aceite: ${res.status}`);
      assert(data.status === 'UPSELL_ACCEPTED', `Status: ${data.status}`);
      assert(data.delivery_token, 'Delivery token gerado');

      // Verify session transitioned to UPSELL_ACCEPTED
      const { data: sessionCheck } = await supabase
        .from('payment_sessions')
        .select('status, upsell_status, delivery_unlocked_at')
        .eq('id', createdSessionId)
        .single();

      assert(sessionCheck?.status === 'UPSELL_ACCEPTED', `Status: ${sessionCheck?.status}`);
      assert(sessionCheck?.upsell_status === 'accepted', `Upsell status: ${sessionCheck?.upsell_status}`);
      assert(sessionCheck?.delivery_unlocked_at !== null, 'Entrega liberada');
    } catch (err) {
      console.log(`  ❌ Erro: ${err.message}`);
      testFailed++;
    }

    // === TESTE 3: Verificar status do upsell ===
    console.log('\n📌 Teste 3: Verificar status do upsell');
    try {
      const res = await fetch(`${API_BASE}/upsell/status/${createdSessionId}`);
      const data = await res.json();
      assert(res.ok, `Status obtido: ${res.status}`);
      assert(data.status === 'UPSELL_ACCEPTED', `Status correto: ${data.status}`);
      assert(data.upsell_status === 'accepted', `Upsell status: ${data.upsell_status}`);
      assert(data.payment_confirmed === true, 'Pagamento confirmado');
      assert(data.delivery_unlocked === true, 'Entrega liberada');
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

  if (createdUpsellId) {
    await supabase.from('upsells').delete().eq('id', createdUpsellId);
    console.log('  - Upsell eliminado');
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
    console.log('  - Produto principal eliminado');
  }
  // Also delete upsell product (find by price 1500)
  const { data: upsellProds } = await supabase
    .from('products')
    .select('id')
    .eq('price', 1500.00)
    .eq('content_type', 'ebook');
  
  if (upsellProds && upsellProds.length > 0) {
    for (const p of upsellProds) {
      await supabase.from('products').delete().eq('id', p.id);
    }
    console.log('  - Produto upsell eliminado');
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
