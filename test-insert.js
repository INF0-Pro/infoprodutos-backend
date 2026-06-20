const { supabase } = require('./config/database');

async function run() {
  const { data, error } = await supabase
    .from('products')
    .insert([
      {
        name: 'Produto Teste',
        description: 'Teste real do sistema',
        price: 1000,
        content_type: 'link',
        content_url: 'https://exemplo.com'
      }
    ])
    .select();

  console.log('DATA:', data);
  console.log('ERROR:', error);
}

run();