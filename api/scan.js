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

    let content = [];
    if (Array.isArray(userMsg)) {
      for (let i = 0; i < userMsg.length; i++) {
        const block = userMsg[i];
        if (block.type === 'text') content.push({ type: 'text', text: block.text });
        if (block.type === 'image') content.push({ type: 'image_url', image_url: { url: 'data:' + block.source.media_type + ';base64,' + block.source.data } });
      }
    } else {
      content = String(userMsg);
    }

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
        model: 'mistralai/mistral-7b-instruct:free',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: content }
        ],
        max_tokens: 800,
        temperature: 0.3
      })
    });

    const data = await response.json();

    if (data.error) {
      return res.status(200).json({ content: [{ text: JSON.stringify({
        score: 0, label: "ERROR", riskClass: "risk-safe",
        summary: "API error: " + data.error.message,
        flags: [], actions: [{ title: "Try again", detail: "Please try again." }],
        verdict: "An error occurred."
      }) }] });
    }

    let text = data.choices[0].message.content;
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
