export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    const { messages, system } = req.body;
    const userMsg = messages[0].content;

    let parts = [];
    if (Array.isArray(userMsg)) {
      for (const block of userMsg) {
        if (block.type === 'text') parts.push({ text: block.text });
        if (block.type === 'image') parts.push({ inlineData: { mimeType: block.source.media_type, data: block.source.data } });
      }
    } else {
      parts.push({ text: String(userMsg) });
    }

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system }] },
          contents: [{ parts }],
          generationConfig: { maxOutputTokens: 800, temperature: 0.3 }
        })
      }
    );

    const data = await geminiRes.json();

    if (data.error) {
      res.status(200).json({ content: [{ text: JSON.stringify({
        score: 0,
        label: "ERROR",
        riskClass: "risk-safe",
        summary: "Gemini error: " + data.error.message,
        flags: [],
        actions: [{ title: "Try again", detail: "Please try your scan again in a moment." }],
        verdict: "An error occurred. Please try again."
      }) }] });
      return;
    }

    let text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    text = text.replace(/```json|```/g, '').trim();
    res.status(200).json({ content: [{ text }] });

  } catch(err) {
    res.status(200).json({ content: [{ text: JSON.stringify({
      score: 0,
      label: "ERROR",
      riskClass: "risk-safe",
      summary: "Server error: " + err.message,
      flags: [],
      actions: [{ title: "Try again", detail: "Please try your scan again in a moment." }],
      verdict: "An error occurred. Please try again."
    }) }] });
  }
}
