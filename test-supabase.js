const { supabase } = require('./config/database');

async function test() {
  const { data, error } = await supabase
    .from('products')
    .select('*');

  console.log("DATA:", data);
  console.log("ERROR:", error);
}

test();
