const { supabase } = require('./config/database');

async function run() {
const { data: session } = await supabase
.from('payment_sessions')
.select('*')
.order('created_at', { ascending: false })
.limit(1)
.single();

console.log('SESSION ENCONTRADA:', session?.id);

const { data, error } = await supabase
.from('payment_sessions')
.update({
status: 'PAYMENT_CONFIRMED',
payment_confirmed_at: new Date().toISOString()
})
.eq('id', session.id)
.select();

console.log('RESULTADO:', data);
console.log('ERRO:', error);
}

run();
