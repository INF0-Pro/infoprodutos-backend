const { supabase } = require('./config/database');

async function run() {
  const { data: product } = await supabase
    .from('products')
    .select('*')
    .limit(1)
    .single();

  const { data: checkout } = await supabase
    .from('checkouts')
    .select('*')
    .eq('product_id', product.id)
    .limit(1)
    .single();

  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); 
  // ⬆️ expira em 10 minutos

  const { data, error } = await supabase
    .from('payment_sessions')
    .insert([
      {
        product_id: product.id,
        checkout_id: checkout.id,

        customer_name: "Teste Cliente",
        customer_email: "teste@demo.com",

        expected_amount: product.price,
        status: "CREATED",

        expires_at: expiresAt   // 🔥 FIX FINAL
      }
    ])
    .select();

  console.log("SESSION:", data);
  console.log("ERROR:", error);
}

run();