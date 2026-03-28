module.exports.config = { maxDuration: 25 };

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    const { messages, system } = req.body;

    /* ── Server-side rate limit for free users ── */
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '');
      try {
        const userRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
          headers: {
            'Authorization': 'Bearer ' + token,
            'apikey': process.env.SUPABASE_SERVICE_KEY
          }
        });
        const userData = await userRes.json();
        if (userData && userData.id) {
          const profileRes = await fetch(
            `${process.env.SUPABASE_URL}/rest/v1/profiles?id=eq.${userData.id}&select=plan`,
            { headers: { 'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_KEY, 'apikey': process.env.SUPABASE_SERVICE_KEY } }
          );
          const profiles = await profileRes.json();
          const plan = profiles?.[0]?.plan || 'free';
          if (plan === 'free') {
            const today = new Date().toISOString().split('T')[0];
            const countRes = await fetch(
              `${process.env.SUPABASE_URL}/rest/v1/scans?user_id=eq.${userData.id}&created_at=gte.${today}T00:00:00&select=id`,
              { headers: { 'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_KEY, 'apikey': process.env.SUPABASE_SERVICE_KEY, 'Prefer': 'count=exact' } }
            );
            const countHeader = countRes.headers.get('content-range');
            const count = countHeader ? parseInt(countHeader.split('/')[1]) : 0;
            if (count >= 5) {
              return res.status(429).json({ error: 'Daily scan limit reached.' });
            }
          }
        }
      } catch(e) { /* continue if rate limit check fails */ }
    }

    /* ── Build content ── */
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

    /* ── Model fallback list ── */
    const MODELS = [
      'meta-llama/llama-3.3-70b-instruct:free',  // Primary: capable 70B free model
      'openrouter/free',                           // Fallback: auto-selects best available free model
    ];

    /* ── Call OpenRouter with fallback ── */
    async function callOpenRouter(model) {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + process.env.OPENROUTER_API_KEY,
          'HTTP-Referer': 'https://divoxtrust.vercel.app',
          'X-Title': 'DivoX Trust'
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: openRouterContent }
          ],
          max_tokens: 800,
          temperature: 0.3
        })
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error.message || 'OpenRouter error');
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error('Empty response from model');
      return content;
    }

    let raw = null;
    let lastError = null;

    for (const model of MODELS) {
      try {
        raw = await callOpenRouter(model);
        break; // success — stop trying
      } catch (err) {
        lastError = err;
        // try next model
      }
    }

    if (!raw) {
      return res.status(200).json({ content: [{ text: JSON.stringify({
        score: 0, label: 'ERROR', riskClass: 'risk-safe',
        summary: 'All models failed. Last error: ' + (lastError?.message || 'Unknown error'),
        flags: [], actions: [{ title: 'Try again', detail: 'Please try again in a moment.' }],
        verdict: 'An error occurred.'
      }) }] });
    }

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
