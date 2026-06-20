const { supabase } = require('./config/database');

async function run() {
const { data, error } = await supabase
.from('deliveries')
.select('*')
.order('created_at', { ascending: false });

console.log('DELIVERIES:', data);
console.log('ERROR:', error);
}

run();
