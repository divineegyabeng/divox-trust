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
      const sb = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_KEY
      );
      const { data: { user } } = await sb.auth.getUser(token);
      if (user) {
        const { data: profile } = await sb.from('profiles').select('plan').eq('id', user.id).single();
        if (!profile || profile.plan === 'free') {
          const today = new Date().toISOString().split('T')[0];
          const { count } = await sb.from('scans')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .gte('created_at', today + 'T00:00:00');
          if (count >= 3) {
            return res.status(429).json({ error: 'Daily scan limit reached. Upgrade to Pro for unlimited scans.' });
          }
        }
      }
    }

    /* ── Sanitise input — strip prompt injection attempts ── */
    const userMsg = messages[0].content;
    let parts = [];
    if (Array.isArray(userMsg)) {
      for (let i = 0; i < userMsg.length; i++) {
        const block = userMsg[i];
        if (block.type === 'text') {
          let text = block.text;
          /* Remove common prompt injection patterns */
          text = text.replace(/ignore (previous|all|above|prior) instructions?/gi, '[removed]');
          text = text.replace(/you are now|act as|pretend (to be|you are)/gi, '[removed]');
          text = text.replace(/disregard|forget|override|bypass/gi, '[removed]');
          parts.push({ text });
        }
        if (block.type === 'image') {
          parts.push({ inlineData: { mimeType: block.source.media_type, data: block.source.data } });
        }
      }
    } else {
      let text = String(userMsg);
      text = text.replace(/ignore (previous|all|above|prior) instructions?/gi, '[removed]');
      text = text.replace(/you are now|act as|pretend (to be|you are)/gi, '[removed]');
      text = text.replace(/disregard|forget|override|bypass/gi, '[removed]');
      parts = [{ text }];
    }

    /* ── Call OpenRouter ── */
    const apiKey = process.env.OPENROUTER_API_KEY;
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'HTTP-Referer': 'https://divoxtrust.vercel.app',
        'X-Title': 'DivoX Trust'
      },
      body: JSON.stringify({
        model: 'openrouter/auto',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: parts.map(p => p.text || '').join('\n') }
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

    const raw = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content)
      ? data.choices[0].message.content : '{}';
    let text = raw.replace(/```json|```/g, '').trim();

    /* Validate it is actually JSON before returning */
    try { JSON.parse(text); } catch(e) {
      const match = text.match(/\{[\s\S]*\}/);
      text = match ? match[0] : JSON.stringify({
        score: 0, label: 'ERROR', riskClass: 'risk-safe',
        summary: 'Could not parse response. Please try again.',
        flags: [], actions: [], verdict: 'Please try again.'
      });
    }

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
