// ============================================================
// INFOPRODUTOS PLATFORM - TESTE DE FLUXO COMPLETO
// ============================================================
// Testa: Produto → Checkout → Payment Session → Transições
// Uso: node test-fluxo-completo.js
// ============================================================

require('dotenv').config();
const supabase = require('./config/database');
const { v4: uuidv4 } = require('uuid');
const { applicationLogger } = require('./config/logger');

const API_BASE = `http://localhost:${process.env.PORT || 3000}/api`;
let createdProductId = null;
let createdCheckoutId = null;
let createdSessionId = null;
let testPassed = 0;
let testFailed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    testPassed++;
  } else {
    console.log(`  ❌ ${message}`);
    testFailed++;
  }
}

async function runTest() {
  console.log('\n============================================');
  console.log('🧪 INFOPRODUTOS PLATFORM - TESTE DE FLUXO');
  console.log('============================================\n');

  try {
    // === 1. VERIFICAR CONEXÃO SUPABASE ===
    console.log('📡 1. Verificar conexão Supabase...');
    const { data, error } = await supabase.from('users').select('count', { count: 'exact', head: true });
    assert(!error, `Conexão Supabase: ${error ? error.message : 'OK'}`);
    if (error) {
      console.log('\n❌ Teste abortado: Sem conexão com Supabase');
      printResults();
      process.exit(1);
    }

    // === 2. CRIAR PRODUTO ===
    console.log('\n📦 2. Criar Produto...');
    const productData = {
      id: uuidv4(),
      name: `Produto Teste ${Date.now()}`,
      description: 'Produto criado pelo teste de fluxo completo',
      price: 1500.00,
      content_type: 'ebook',
      content_url: 'https://exemplo.com/ebook.pdf',
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data: product, error: prodError } = await supabase
      .from('products')
      .insert(productData)
      .select()
      .single();

    assert(!prodError && product, `Criar produto: ${prodError ? prodError.message : product.name}`);
    if (prodError || !product) {
      console.log('  ⚠️  Tentando com campos alternativos...');
      // Fallback: tentar sem content_type se o schema não tiver
      const { data: product2, error: prodError2 } = await supabase
        .from('products')
        .insert({
          id: uuidv4(),
          name: `Produto Teste ${Date.now()}`,
          price: 1500.00,
          status: 'active',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();
      
      assert(!prodError2, `Criar produto (fallback): ${prodError2 ? prodError2.message : 'OK'}`);
      if (prodError2) {
        console.log('\n❌ Teste abortado: Não foi possível criar produto');
        printResults();
        process.exit(1);
      }
      createdProductId = product2.id;
    } else {
      createdProductId = product.id;
    }

    // === 3. CRIAR CHECKOUT ===
    console.log('\n🛒 3. Criar Checkout...');
    const checkoutData = {
      id: uuidv4(),
      name: `Checkout Teste ${Date.now()}`,
      description: 'Checkout criado pelo teste de fluxo',
      product_id: createdProductId,
      entity: '12345',
      reference: `REF-${Date.now()}`,
      checkout_template: 'default',
      payment_template: 'default',
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data: checkout, error: chkError } = await supabase
      .from('checkouts')
      .insert(checkoutData)
      .select()
      .single();

    assert(!chkError && checkout, `Criar checkout: ${chkError ? chkError.message : checkout.name}`);
    if (chkError || !checkout) {
      console.log('\n❌ Teste abortado: Não foi possível criar checkout');
      printResults();
      process.exit(1);
    }
    createdCheckoutId = checkout.id;

    // === 4. CRIAR PAYMENT SESSION ===
    console.log('\n💳 4. Criar Payment Session...');
    const sessionData = {
      id: uuidv4(),
      product_id: createdProductId,
      checkout_id: createdCheckoutId,
      customer_name: 'Cliente Teste',
      customer_email: `cliente${Date.now()}@teste.com`,
      customer_phone: '+244900000000',
      expected_amount: 1500.00,
      selected_order_bumps: [],
      status: 'CREATED',
      score: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      last_activity_at: new Date().toISOString(),
      copied_entity: checkout.entity,
      copied_reference: checkout.reference,
      copied_value: null,
      upsell_status: 'none',
    };

    const { data: session, error: sessError } = await supabase
      .from('payment_sessions')
      .insert(sessionData)
      .select()
      .single();

    assert(!sessError && session, `Criar payment session: ${sessError ? sessError.message : session.id}`);
    if (sessError || !session) {
      console.log('\n❌ Teste abortado: Não foi possível criar payment session');
      printResults();
      process.exit(1);
    }
    createdSessionId = session.id;

    // === 5. VERIFICAR TRANSIÇÕES DE ESTADO (FSM) ===
    console.log('\n🔄 5. Testar transições de estado (FSM)...');

    // 5.1 CREATED → CHECKOUT_OPEN
    const { data: s1, error: e1 } = await supabase
      .from('payment_sessions')
      .update({ status: 'CHECKOUT_OPEN', updated_at: new Date().toISOString(), last_activity_at: new Date().toISOString() })
      .eq('id', createdSessionId)
      .select()
      .single();

    assert(!e1 && s1?.status === 'CHECKOUT_OPEN', `CREATED → CHECKOUT_OPEN: ${e1 ? e1.message : 'OK'}`);

    // 5.2 CHECKOUT_OPEN → PAYMENT_SESSION_CREATED
    const { data: s2, error: e2 } = await supabase
      .from('payment_sessions')
      .update({ status: 'PAYMENT_SESSION_CREATED', updated_at: new Date().toISOString(), last_activity_at: new Date().toISOString() })
      .eq('id', createdSessionId)
      .select()
      .single();

    assert(!e2 && s2?.status === 'PAYMENT_SESSION_CREATED', `CHECKOUT_OPEN → PAYMENT_SESSION_CREATED: ${e2 ? e2.message : 'OK'}`);

    // 5.3 PAYMENT_SESSION_CREATED → WAITING_PAYMENT
    const { data: s3, error: e3 } = await supabase
      .from('payment_sessions')
      .update({ status: 'WAITING_PAYMENT', updated_at: new Date().toISOString(), last_activity_at: new Date().toISOString() })
      .eq('id', createdSessionId)
      .select()
      .single();

    assert(!e3 && s3?.status === 'WAITING_PAYMENT', `PAYMENT_SESSION_CREATED → WAITING_PAYMENT: ${e3 ? e3.message : 'OK'}`);

    // 5.4 WAITING_PAYMENT → PAYMENT_CONFIRMED
    const { data: s4, error: e4 } = await supabase
      .from('payment_sessions')
      .update({
        status: 'PAYMENT_CONFIRMED',
        payment_confirmed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
      })
      .eq('id', createdSessionId)
      .select()
      .single();

    assert(!e4 && s4?.status === 'PAYMENT_CONFIRMED', `WAITING_PAYMENT → PAYMENT_CONFIRMED: ${e4 ? e4.message : 'OK'}`);

    // 5.5 PAYMENT_CONFIRMED → UPSELL_PENDING
    const { data: s5, error: e5 } = await supabase
      .from('payment_sessions')
      .update({ status: 'UPSELL_PENDING', updated_at: new Date().toISOString(), last_activity_at: new Date().toISOString() })
      .eq('id', createdSessionId)
      .select()
      .single();

    assert(!e5 && s5?.status === 'UPSELL_PENDING', `PAYMENT_CONFIRMED → UPSELL_PENDING: ${e5 ? e5.message : 'OK'}`);

    // 5.6 UPSELL_PENDING → UPSELL_DECLINED
    const { data: s6, error: e6 } = await supabase
      .from('payment_sessions')
      .update({ status: 'UPSELL_DECLINED', upsell_status: 'declined', updated_at: new Date().toISOString(), last_activity_at: new Date().toISOString() })
      .eq('id', createdSessionId)
      .select()
      .single();

    assert(!e6 && s6?.status === 'UPSELL_DECLINED', `UPSELL_PENDING → UPSELL_DECLINED: ${e6 ? e6.message : 'OK'}`);

    // 5.7 UPSELL_DECLINED → DELIVERED
    const { data: s7, error: e7 } = await supabase
      .from('payment_sessions')
      .update({
        status: 'DELIVERED',
        delivery_unlocked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
      })
      .eq('id', createdSessionId)
      .select()
      .single();

    assert(!e7 && s7?.status === 'DELIVERED', `UPSELL_DECLINED → DELIVERED: ${e7 ? e7.message : 'OK'}`);

    // === 6. VERIFICAR PRODUTO CRIADO ===
    console.log('\n🔍 6. Verificar dados persistidos...');
    const { data: prodCheck } = await supabase.from('products').select('*').eq('id', createdProductId).single();
    assert(prodCheck?.name, `Produto persistido: ${prodCheck?.name}`);

    const { data: chkCheck } = await supabase.from('checkouts').select('*, products:product_id(name)').eq('id', createdCheckoutId).single();
    assert(chkCheck?.products?.name, `Checkout com produto associado: ${chkCheck?.products?.name}`);

    const { data: sessCheck } = await supabase.from('payment_sessions').select('*, products:product_id(name), checkouts:checkout_id(name)').eq('id', createdSessionId).single();
    assert(sessCheck?.status === 'DELIVERED', `Session com estado final DELIVERED: ${sessCheck?.status}`);
    assert(sessCheck?.products?.name, `Session com produto: ${sessCheck?.products?.name}`);
    assert(sessCheck?.checkouts?.name, `Session com checkout: ${sessCheck?.checkouts?.name}`);

  } catch (err) {
    console.log(`\n  ❌ Erro inesperado: ${err.message}`);
    testFailed++;
  }

  // === RESULTADOS ===
  printResults();

  // === LIMPEZA ===
  await cleanupTestData();
}

async function cleanupTestData() {
  console.log('\n🧹 7. Limpeza de dados de teste...');
  
  if (createdSessionId) {
    await supabase.from('payment_sessions').delete().eq('id', createdSessionId);
    console.log('  - Payment session eliminada');
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
  console.log('📊 RESULTADOS DO TESTE');
  console.log('============================================');
  console.log(`  Total: ${total}`);
  console.log(`  ✅ Passaram: ${testPassed}`);
  console.log(`  ❌ Falharam: ${testFailed}`);
  console.log(`  📈 Taxa de sucesso: ${total > 0 ? Math.round((testPassed / total) * 100) : 0}%`);
  console.log('============================================\n');
}

runTest();
