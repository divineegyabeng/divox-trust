const https = require('https');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).end(); return; }

  try {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    const crypto = require('crypto');
    const hash = crypto.createHmac('sha512', secret).update(JSON.stringify(req.body)).digest('hex');
    if (hash !== req.headers['x-paystack-signature']) {
      res.status(401).json({ error: 'Invalid signature' }); return;
    }

    const event = req.body;
    if (event.event === 'charge.success') {
      const email = event.data.customer.email;
      const { createClient } = require('@supabase/supabase-js');
      const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
      const { data: users } = await sb.auth.admin.listUsers();
      const user = users.users.find(u => u.email === email);
      if (user) {
        await sb.from('profiles').update({ plan: 'pro' }).eq('id', user.id);
      }
    }
    res.status(200).json({ received: true });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
}
