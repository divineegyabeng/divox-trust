module.exports = async function handler(req, res) {

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {

    const body = req.body;
    const messages = body.messages || [];
    const system = body.system || "";

    let userMsg = "";
    let content = [];

    if (messages.length > 0) {
      userMsg = messages[0].content;
    }

    if (Array.isArray(userMsg)) {

      for (let block of userMsg) {

        if (block.type === "text") {
          content.push({ type: "text", text: block.text });
        }

        if (block.type === "image") {
          content.push({
            type: "image_url",
            image_url: {
              url:
                "data:" +
                block.source.media_type +
                ";base64," +
                block.source.data
            }
          });
        }

      }

    } else {

      content = [{ type: "text", text: String(userMsg) }];

    }

    /* -----------------------
       SMART INTENT DETECTOR
    ----------------------- */

    let intent = "scan";

    if (typeof userMsg === "string") {

      const msg = userMsg.toLowerCase().trim();

      const greetings = [
        "hello",
        "hi",
        "hey",
        "good morning",
        "good afternoon",
        "good evening"
      ];

      if (greetings.some(g => msg.startsWith(g))) {
        intent = "greeting";
      }

      if (msg.includes("hack you") || msg.includes("i will hack")) {
        intent = "threat";
      }

      if (msg.length < 10) {
        intent = "conversation";
      }

    }

    /* -----------------------
       URL DETECTION
    ----------------------- */

    const urlRegex = /(https?:\/\/[^\s]+)/g;
    let detectedUrls = [];

    if (typeof userMsg === "string") {
      detectedUrls = userMsg.match(urlRegex) || [];
    }

    /* -----------------------
       PHISHING DOMAIN CHECK
    ----------------------- */

    const suspiciousDomains = [
      "bit.ly",
      "tinyurl",
      "paypaI.com",
      "faceboook",
      "secure-login",
      "verify-account",
      "wallet-connect",
      "free-gift",
      "airdrop",
      "claim-reward"
    ];

    let phishingScore = 0;

    detectedUrls.forEach(url => {

      const lower = url.toLowerCase();

      suspiciousDomains.forEach(domain => {
        if (lower.includes(domain)) phishingScore++;
      });

      if (url.length > 60) phishingScore++;

      if (url.includes("@")) phishingScore++;

    });

    /* -----------------------
       SCAM SIGNAL DETECTOR
    ----------------------- */

    const scamSignals = [
      "urgent",
      "verify your account",
      "send money",
      "bitcoin",
      "crypto",
      "gift card",
      "bank details",
      "account suspended",
      "otp",
      "click this link",
      "you won",
      "claim reward"
    ];

    let signalCount = 0;

    if (typeof userMsg === "string") {

      const lower = userMsg.toLowerCase();

      scamSignals.forEach(word => {
        if (lower.includes(word)) signalCount++;
      });

    }

    content.push({
      type: "text",
      text: `
Intent: ${intent}
Scam signals detected: ${signalCount}
URLs detected: ${detectedUrls.length}
Phishing indicators: ${phishingScore}
`
    });

    /* -----------------------
       OPENROUTER API
    ----------------------- */

    const apiKey = process.env.OPENROUTER_API_KEY;

    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + apiKey,
          "HTTP-Referer": "https://divoxtrust.vercel.app",
          "X-Title": "DivoX Trust"
        },
        body: JSON.stringify({
          model: "openrouter/auto",
          messages: [
            { role: "system", content: system },
            { role: "user", content: content }
          ],
          max_tokens: 1200,
          temperature: 0.2
        })
      }
    );

    const data = await response.json();

    if (data.error) {

      return res.status(200).json({
        content: [
          {
            text: JSON.stringify({
              score: 0,
              label: "ERROR",
              riskClass: "risk-safe",
              summary: "API error: " + data.error.message,
              flags: [],
              actions: [{ title: "Try again", detail: "Please try again." }],
              verdict: "An error occurred."
            })
          }
        ]
      });

    }

    let raw =
      data?.choices?.[0]?.message?.content || "{}";

    let text = raw
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    if (!text || text === "{}") {

      text = JSON.stringify({
        score: 5,
        label: "SAFE",
        riskClass: "risk-safe",
        summary: "This content appears safe.",
        flags: [],
        actions: [
          {
            title: "No action needed",
            detail: "Everything looks normal."
          }
        ],
        verdict: "You are safe."
      });

    }

    return res.status(200).json({
      content: [{ text }]
    });

  } catch (err) {

    return res.status(200).json({
      content: [
        {
          text: JSON.stringify({
            score: 0,
            label: "ERROR",
            riskClass: "risk-safe",
            summary: "Server error: " + err.message,
            flags: [],
            actions: [{ title: "Try again", detail: "Please try again." }],
            verdict: "A server error occurred."
          })
        }
      ]
    });

  }

};
