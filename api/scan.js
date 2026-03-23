const { createClient } = require('@supabase/supabase-js');

module.exports.config = { maxDuration: 25 };

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    const { messages, system } = req.body;

    /* ── Rate limit free users server-side ── */
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '');
      const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
      const { data: { user } } = await sb.auth.getUser(token);
      if (user) {
        const { data: profile } = await sb.from('profiles').select('plan').eq('id', user.id).single();
        if (!profile || profile.plan === 'free') {
          const today = new Date().toISOString().split('T')[0];
          const { count } = await sb.from('scans')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .gte('created_at', today + 'T00:00:00');
          if (count >= 5) {
            return res.status(429).json({ error: 'Daily scan limit reached. Upgrade to Pro for unlimited scans.' });
          }
        }
      }
    }

    /* ── Build message content ── */
    const userMsg = messages[0].content;
    let openRouterContent = [];

    if (Array.isArray(userMsg)) {
      for (const block of userMsg) {
        if (block.type === 'text') {
          let text = block.text;
          text = text.replace(/ignore (previous|all|above|prior) instructions?/gi, '[removed]');
          text = text.replace(/you are now|act as|pretend (to be|you are)/gi, '[removed]');
          text = text.replace(/disregard|override|bypass/gi, '[removed]');
          openRouterContent.push({ type: 'text', text });
        }
        if (block.type === 'image') {
          openRouterContent.push({
            type: 'image_url',
            image_url: { url: 'data:' + block.source.media_type + ';base64,' + block.source.data }
          });
        }
      }
    } else {
      let text = String(userMsg);
      text = text.replace(/ignore (previous|all|above|prior) instructions?/gi, '[removed]');
      text = text.replace(/you are now|act as|pretend (to be|you are)/gi, '[removed]');
      text = text.replace(/disregard|override|bypass/gi, '[removed]');
      openRouterContent = [{ type: 'text', text }];
    }

    /* ── Call OpenRouter with fast model ── */
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + process.env.OPENROUTER_API_KEY,
        'HTTP-Referer': 'https://divoxtrust.vercel.app',
        'X-Title': 'DivoX Trust'
      },
      body: JSON.stringify({
        model: 'meta-llama/llama-3.1-8b-instruct:free',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: openRouterContent }
        ],
        max_tokens: 800,
        temperature: 0.3
      })
    });

    const data = await response.json();

    if (data.error) {
      return res.status(200).json({ content: [{ text: JSON.stringify({
        score: 0, label: 'ERROR', riskClass: 'risk-safe',
        summary: 'API error: ' + data.error.message,
        flags: [], actions: [{ title: 'Try again', detail: 'Please try again.' }],
        verdict: 'An error occurred.'
      }) }] });
    }

    let raw = data.choices?.[0]?.message?.content || '{}';
    raw = raw.replace(/```json|```/g, '').trim();
    const match = raw.match(/\{[\s\S]*\}/);
    const text = match ? match[0] : JSON.stringify({
      score: 0, label: 'ERROR', riskClass: 'risk-safe',
      summary: 'Could not parse response. Please try again.',
      flags: [], actions: [], verdict: 'Please try again.'
    });

    return res.status(200).json({ content: [{ text }] });

  } catch (err) {
    return res.status(200).json({ content: [{ text: JSON.stringify({
      score: 0, label: 'ERROR', riskClass: 'risk-safe',
      summary: 'Server error: ' + err.message,
      flags: [], actions: [{ title: 'Try again', detail: 'Please try again.' }],
      verdict: 'An error occurred.'
    }) }] });
  }
}
