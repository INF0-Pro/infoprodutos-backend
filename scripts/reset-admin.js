require('dotenv').config();
const bcrypt = require('bcryptjs');
const { supabase } = require('../config/database');

async function run() {
  const newPassword = '123456';

  const hash = await bcrypt.hash(newPassword, 12);

  const { error } = await supabase
    .from('users')
    .update({
      password_hash: hash,
      is_active: true
    })
    .eq('email', 'admin@infoprodutos.com');

  if (error) {
    console.log('Erro:', error.message);
    return;
  }

  console.log('✅ Password resetada com sucesso');
  console.log('Email: admin@infoprodutos.com');
  console.log('Password: 123456');
}

run();