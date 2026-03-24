const { createClient } = require('@supabase/supabase-js');

module.exports.config = { maxDuration: 25 };

const errorJSON = (msg) => ({
  content: [{ text: JSON.stringify({
    score: 0,
    label: 'ERROR',
    riskClass: 'risk-safe',
    summary: msg,
    flags: [],
    actions: [{ title: 'Try again', detail: 'Please try your scan again in a moment.' }],
    verdict: 'Something went wrong. Please try again.'
  })}]
});

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

    /* ── Call OpenRouter ── */
    let response;
    try {
      response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
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
    } catch (fetchErr) {
      console.error('OpenRouter fetch failed:', fetchErr.message);
      return res.status(200).json(errorJSON('Could not reach the analysis service. Please check your connection and try again.'));
    }

    /* ── Safely parse the response ── */
    let data;
    const rawText = await response.text(); // always read as text first

    try {
      data = JSON.parse(rawText);
    } catch (parseErr) {
      // Response was not JSON — likely an HTML error page from OpenRouter or Vercel
      console.error('OpenRouter non-JSON response:', rawText.substring(0, 200));
      return res.status(200).json(errorJSON('The analysis service returned an unexpected response. Please try again in a moment.'));
    }

    /* ── Handle API-level errors ── */
    if (data.error) {
      const msg = data.error.message || 'Unknown API error';
      console.error('OpenRouter API error:', msg);

      // Rate limit or quota error
      if (data.error.code === 429 || msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('quota')) {
        return res.status(429).json({ error: 'Analysis service is busy. Please try again in a moment.' });
      }

      return res.status(200).json(errorJSON('The analysis service is temporarily unavailable. Please try again shortly.'));
    }

    /* ── Extract and validate the model output ── */
    const raw = (data.choices?.[0]?.message?.content || '').replace(/```json|```/g, '').trim();

    if (!raw) {
      return res.status(200).json(errorJSON('The AI returned an empty response. Please try again.'));
    }

    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      console.error('No JSON object in model output:', raw.substring(0, 200));
      return res.status(200).json(errorJSON('Could not parse the analysis result. Please try again.'));
    }

    let parsed;
    try {
      parsed = JSON.parse(match[0]);
    } catch (jsonErr) {
      console.error('Failed to parse model JSON:', match[0].substring(0, 200));
      return res.status(200).json(errorJSON('The analysis result was malformed. Please try again.'));
    }

    return res.status(200).json({ content: [{ text: JSON.stringify(parsed) }] });

  } catch (err) {
    console.error('Unhandled error in /api/scan:', err.message);
    return res.status(200).json(errorJSON('An unexpected error occurred. Please try again.'));
  }
}
