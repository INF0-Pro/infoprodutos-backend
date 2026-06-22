const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function createAdmin() {
  try {
    const email = 'admin@system.com';
    const password = 'Admin@12345';

    // 1. gerar hash da password
    const password_hash = await bcrypt.hash(password, 12);

    // 2. inserir no Supabase
    const { data, error } = await supabase
      .from('users')
      .insert([
        {
          email,
          password_hash,
          role: 'admin',
          is_active: true,
        },
      ])
      .select()
      .single();

    if (error) throw error;

    console.log('✅ Admin criado com sucesso:');
    console.log('Email:', email);
    console.log('Password:', password);
    console.log('ID:', data.id);

  } catch (err) {
    console.error('❌ Erro ao criar admin:', err.message);
  }
}

createAdmin();