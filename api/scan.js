const { createClient } = require('@supabase/supabase-js');

module.exports.config = { maxDuration: 25 };

// استاندard response format (ALWAYS this structure)
const errorJSON = (msg) => ({
  content: [{
    text: JSON.stringify({
      score: 0,
      label: 'ERROR',
      riskClass: 'risk-safe',
      summary: msg,
      flags: [],
      actions: [
        { title: 'Try again', detail: 'Please try your scan again in a moment.' }
      ],
      verdict: 'Something went wrong. Please try again.'
    })
  }]
});

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { messages, system } = req.body || {};

    if (!messages || !messages[0]) {
      return res.status(200).json(errorJSON('Invalid request input.'));
    }

    /* ── Rate limit (FREE users) ── */
    try {
      const authHeader = req.headers['authorization'];

      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.replace('Bearer ', '');

        const sb = createClient(
          process.env.SUPABASE_URL,
          process.env.SUPABASE_SERVICE_KEY
        );

        const { data: { user } = {} } = await sb.auth.getUser(token);

        if (user) {
          const { data: profile } = await sb
            .from('profiles')
            .select('plan')
            .eq('id', user.id)
            .single();

          if (!profile || profile.plan === 'free') {
            const today = new Date().toISOString().split('T')[0];

            const { count } = await sb
              .from('scans')
              .select('*', { count: 'exact', head: true })
              .eq('user_id', user.id)
              .gte('created_at', today + 'T00:00:00');

            if (count >= 5) {
              return res.status(200).json(
                errorJSON('Daily scan limit reached. Upgrade to Pro for unlimited scans.')
              );
            }
          }
        }
      }
    } catch (rateErr) {
      console.error('Rate limit check failed:', rateErr.message);
    }

    /* ── Build safe message ── */
    const userMsg = messages[0].content;

    const cleanText = (text) => {
      return String(text)
        .replace(/ignore (previous|all|above|prior) instructions?/gi, '[removed]')
        .replace(/you are now|act as|pretend (to be|you are)/gi, '[removed]')
        .replace(/disregard|override|bypass/gi, '[removed]');
    };

    let openRouterContent = [];

    if (Array.isArray(userMsg)) {
      for (const block of userMsg) {
        if (block.type === 'text') {
          openRouterContent.push({
            type: 'text',
            text: cleanText(block.text)
          });
        }

        if (block.type === 'image') {
          openRouterContent.push({
            type: 'image_url',
            image_url: {
              url: `data:${block.source.media_type};base64,${block.source.data}`
            }
          });
        }
      }
    } else {
      openRouterContent = [{
        type: 'text',
        text: cleanText(userMsg)
      }];
    }

    /* ── Call OpenRouter ── */
    let response;

    try {
      response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
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
    } catch (err) {
      console.error('Fetch failed:', err.message);
      return res.status(200).json(
        errorJSON('Could not reach analysis service. Check your connection.')
      );
    }

    /* ── Read response safely ── */
    const rawText = await response.text();

    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      console.error('Non-JSON response:', rawText.slice(0, 200));
      return res.status(200).json(
        errorJSON('Analysis service returned an invalid response.')
      );
    }

    /* ── Handle API errors ── */
    if (data.error) {
      const msg = data.error.message || 'Unknown API error';
      console.error('API error:', msg);

      return res.status(200).json(
        errorJSON('Analysis service is temporarily unavailable.')
      );
    }

    /* ── Extract model output ── */
    const raw = (data.choices?.[0]?.message?.content || '')
      .replace(/```json|```/g, '')
      .trim();

    if (!raw) {
      return res.status(200).json(
        errorJSON('Empty response from AI.')
      );
    }

    const match = raw.match(/\{[\s\S]*\}/);

    if (!match) {
      return res.status(200).json(
        errorJSON('Could not parse analysis result.')
      );
    }

    let parsed;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return res.status(200).json(
        errorJSON('Malformed AI response.')
      );
    }

    /* ── SUCCESS ── */
    return res.status(200).json({
      content: [{
        text: JSON.stringify(parsed)
      }]
    });

  } catch (err) {
    console.error('Unhandled error:', err.message);

    return res.status(200).json(
      errorJSON('Unexpected server error. Please try again.')
    );
  }
};
