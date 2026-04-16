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

    /* ── Parse user message ── */
    const userMsg = messages[0].content;
    let textContent = '';
    let imageBase64 = null;
    let imageMediaType = 'image/jpeg';

    if (Array.isArray(userMsg)) {
      for (const block of userMsg) {
        if (block.type === 'text') {
          let text = block.text;
          text = text.replace(/ignore (previous|all|above|prior) instructions?/gi, '[removed]');
          text = text.replace(/you are now|act as|pretend (to be|you are)/gi, '[removed]');
          text = text.replace(/disregard|override|bypass/gi, '[removed]');
          textContent += text + ' ';
        }
        if (block.type === 'image') {
          imageBase64 = block.source.data;
          imageMediaType = block.source.media_type || 'image/jpeg';
        }
      }
      textContent = textContent.trim();
    } else {
      let text = String(userMsg);
      text = text.replace(/ignore (previous|all|above|prior) instructions?/gi, '[removed]');
      text = text.replace(/you are now|act as|pretend (to be|you are)/gi, '[removed]');
      text = text.replace(/disregard|override|bypass/gi, '[removed]');
      textContent = text;
    }

    let raw = '';

    if (imageBase64) {
      /* ── SCREENSHOT → Gemini Flash ── */
      const prompt = textContent || 'Analyse this screenshot for scam risk. Read every element carefully.';

      const geminiController = new AbortController();
      const geminiTimeout = setTimeout(() => geminiController.abort(), 18000);

      let geminiRes;
      try {
        geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: geminiController.signal,
            body: JSON.stringify({
              system_instruction: { parts: [{ text: system }] },
              contents: [{
                parts: [
                  { inline_data: { mime_type: imageMediaType, data: imageBase64 } },
                  { text: prompt }
                ]
              }],
              generationConfig: { maxOutputTokens: 500, temperature: 0.3 }
            })
          }
        );
      } catch (fetchErr) {
        clearTimeout(geminiTimeout);
        return res.status(200).json({ content: [{ text: JSON.stringify({
          score: 0, label: 'ERROR', riskClass: 'risk-safe',
          summary: fetchErr.name === 'AbortError'
            ? 'Vision analysis timed out. Please try again.'
            : 'Could not reach the vision API. Check your connection and try again.',
          flags: [], actions: [{ title: 'Try again', detail: 'Reload and submit again.' }],
          verdict: 'An error occurred — please try again.'
        }) }] });
      }
      clearTimeout(geminiTimeout);

      const geminiData = await geminiRes.json();

      if (geminiData.error) {
        return res.status(200).json({ content: [{ text: JSON.stringify({
          score: 0, label: 'ERROR', riskClass: 'risk-safe',
          summary: 'Vision API error: ' + geminiData.error.message,
          flags: [], actions: [{ title: 'Try again', detail: 'Please try again.' }],
          verdict: 'An error occurred.'
        }) }] });
      }

      raw = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '{}';

    } else {
      /* ── URL / MESSAGE → Groq ── */
      const groqController = new AbortController();
      const groqTimeout = setTimeout(() => groqController.abort(), 18000);

      let groqRes;
      try {
        groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + process.env.GROQ_API_KEY
          },
          signal: groqController.signal,
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: textContent }
            ],
            max_tokens: 500,
            temperature: 0.3
          })
        });
      } catch (fetchErr) {
        clearTimeout(groqTimeout);
        return res.status(200).json({ content: [{ text: JSON.stringify({
          score: 0, label: 'ERROR', riskClass: 'risk-safe',
          summary: fetchErr.name === 'AbortError'
            ? 'Analysis timed out. Groq API took too long to respond — please try again.'
            : 'Could not reach the analysis API. Check your internet connection and try again.',
          flags: [], actions: [{ title: 'Try again', detail: 'Reload and submit again.' }],
          verdict: 'An error occurred — please try again.'
        }) }] });
      }
      clearTimeout(groqTimeout);

      const groqData = await groqRes.json();

      if (groqData.error) {
        return res.status(200).json({ content: [{ text: JSON.stringify({
          score: 0, label: 'ERROR', riskClass: 'risk-safe',
          summary: 'API error: ' + groqData.error.message,
          flags: [], actions: [{ title: 'Try again', detail: 'Please try again.' }],
          verdict: 'An error occurred.'
        }) }] });
      }

      raw = groqData.choices?.[0]?.message?.content || '{}';
    }

    /* ── Parse and return ── */
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
