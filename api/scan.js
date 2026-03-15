module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    const body = req.body;
    const messages = body.messages;
    const system = body.system;
    const userMsg = messages[0].content;

    let parts = [];
    if (Array.isArray(userMsg)) {
      for (let i = 0; i < userMsg.length; i++) {
        const block = userMsg[i];
        if (block.type === 'text') parts.push({ text: block.text });
        if (block.type === 'image') parts.push({ inlineData: { mimeType: block.source.media_type, data: block.source.data } });
      }
    } else {
      parts.push({ text: String(userMsg) });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + apiKey;

    const geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ parts: parts }],
        generationConfig: { maxOutputTokens: 800, temperature: 0.3 }
      })
    });

    const data = await geminiRes.json();

    if (data.error) {
      return res.status(200).json({ content: [{ text: JSON.stringify({
        score: 0, label: "ERROR", riskClass: "risk-safe",
        summary: "API error: " + data.error.message,
        flags: [], actions: [{ title: "Try again", detail: "Please try again." }],
        verdict: "An error occurred."
      }) }] });
    }

    let text = data.candidates[0].content.parts[0].text;
    text = text.replace(/```json/g, '').replace(/```/g, '').trim();
    return res.status(200).json({ content: [{ text: text }] });

  } catch(err) {
    return res.status(200).json({ content: [{ text: JSON.stringify({
      score: 0, label: "ERROR", riskClass: "risk-safe",
      summary: "Server error: " + err.message,
      flags: [], actions: [{ title: "Try again", detail: "Please try again." }],
      verdict: "An error occurred."
    }) }] });
  }
}
