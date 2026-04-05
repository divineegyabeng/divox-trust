import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

module.exports.config = { maxDuration: 25 };

/* ── Fallback result shape ── */
function errorResult(summary) {
  return JSON.stringify({
    score: 0,
    label: 'ERROR',
    riskClass: 'risk-safe',
    summary,
    flags: [],
    actions: [{ title: 'Try again', detail: 'Please try again in a moment.' }],
    verdict: 'An error occurred.'
  });
}

/* ── Attempt to salvage truncated/malformed JSON ── */
function extractJSON(raw) {
  raw = raw.replace(/```json|```/gi, '').trim();

  const start = raw.indexOf('{');
  if (start === -1) return null;
  raw = raw.slice(start);

  try { return JSON.parse(raw); } catch (_) {}

  for (let i = raw.length - 1; i >= 0; i--) {
    if (raw[i] === '}') {
      try { return JSON.parse(raw.slice(0, i + 1)); } catch (_) {}
    }
  }

  let attempt = raw;
  let openBraces = 0, openBrackets = 0, inString = false, escape = false;

  for (const ch of attempt) {
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') openBraces++;
    if (ch === '}') openBraces--;
    if (ch === '[') openBrackets++;
    if (ch === ']') openBrackets--;
  }

  if (inString) attempt += '"';
  attempt += ']'.repeat(Math.max(0, openBrackets));
  attempt += '}'.repeat(Math.max(0, openBraces));

  attempt = attempt.replace(/,\s*([}\]])/g, '$1');

  try { return JSON.parse(attempt); } catch (_) {}

  return null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    const { messages, system } = req.body;

    /* ── Server-side rate limit ── */
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
              {
                headers: {
                  'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_KEY,
                  'apikey': process.env.SUPABASE_SERVICE_KEY,
                  'Prefer': 'count=exact'
                }
              }
            );

            const countHeader = countRes.headers.get('content-range');
            const count = countHeader ? parseInt(countHeader.split('/')[1]) : 0;

            if (count >= 5) {
              return res.status(429).json({ error: 'Daily scan limit reached.' });
            }
          }
        }
      } catch (e) {}
    }

    /* ── Build input ── */
    const userMsg = messages[0].content;
    let aiContent = [];

    if (Array.isArray(userMsg)) {
      for (const block of userMsg) {
        if (block.type === 'text') {
          let text = block.text;

          text = text.replace(/ignore (previous|all|above|prior) instructions?/gi, '[removed]');
          text = text.replace(/you are now|act as|pretend (to be|you are)/gi, '[removed]');
          text = text.replace(/disregard|override|bypass/gi, '[removed]');

          aiContent.push({ type: 'text', text });
        }

        if (block.type === 'image') {
          const base64 = block.source.data;

          // SAFE SIZE CHECK
          if (base64 && base64.length > 2_000_000) {
            aiContent.push({
              type: 'text',
              text: '[Image too large to analyze. Please upload a smaller screenshot.]'
            });
          } else {
            aiContent.push({
              type: 'input_image',
              image_url: `data:${block.source.media_type};base64,${base64}`
            });
          }
        }
      }
    } else {
      let text = String(userMsg);

      text = text.replace(/ignore (previous|all|above|prior) instructions?/gi, '[removed]');
      text = text.replace(/you are now|act as|pretend (to be|you are)/gi, '[removed]');
      text = text.replace(/disregard|override|bypass/gi, '[removed]');

      aiContent = [{ type: 'text', text }];
    }

    /* ── OpenAI call ── */
    let raw = null;
    let lastError = null;

    try {
      const response = await openai.responses.create({
        model: "gpt-4.1-mini",
        input: [
          { role: "system", content: system },
          { role: "user", content: aiContent }
        ],
        temperature: 0.3,
        max_output_tokens: 1000
      });

      raw = response.output[0].content[0].text;

    } catch (err) {
      lastError = err;
    }

    if (!raw) {
      return res.status(200).json({
        content: [{ text: errorResult('Model failed. ' + (lastError?.message || 'Unknown error')) }]
      });
    }

    /* ── Parse JSON ── */
    const parsed = extractJSON(raw);

    if (!parsed) {
      return res.status(200).json({
        content: [{ text: errorResult('Could not parse model response. Please try again.') }]
      });
    }

    const safe = {
      score: typeof parsed.score === 'number' ? parsed.score : 0,
      label: parsed.label || 'UNKNOWN',
      riskClass: parsed.riskClass || 'risk-safe',
      summary: parsed.summary || 'No summary available.',
      flags: Array.isArray(parsed.flags) ? parsed.flags : [],
      actions: Array.isArray(parsed.actions) ? parsed.actions : [],
      verdict: parsed.verdict || ''
    };

    return res.status(200).json({
      content: [{ text: JSON.stringify(safe) }]
    });

  } catch (err) {
    return res.status(200).json({
      content: [{ text: errorResult('Server error: ' + err.message) }]
    });
  }
};
