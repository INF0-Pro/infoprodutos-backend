const { supabase } = require('./config/database');

async function run() {
  // 1. buscar produto
  const { data: products } = await supabase
    .from('products')
    .select('*')
    .limit(1)
    .single();

  console.log("Produto:", products);

  // 2. criar checkout
  const { data, error } = await supabase
    .from('checkouts')
    .insert([
      {
        name: 'Checkout Teste',
        product_id: products.id,
        entity: '12345',
        reference: 'REF-TESTE-001',
        status: 'active'
      }
    ])
    .select();

  console.log("CHECKOUT:", data);
  console.log("ERROR:", error);
}

run();