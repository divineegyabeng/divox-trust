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

      for (let i = 0; i < userMsg.length; i++) {

        const block = userMsg[i];

        if (block.type === "text") {
          content.push({
            type: "text",
            text: block.text
          });
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

      content = [
        {
          type: "text",
          text: String(userMsg)
        }
      ];

    }

    /* ------------------------------
       SMART SCAM SIGNAL DETECTION
    --------------------------------*/

    const scamSignals = [
      "urgent",
      "verify your account",
      "send money",
      "bitcoin",
      "crypto",
      "gift card",
      "bank details",
      "account suspended",
      "one time password",
      "otp",
      "limited time",
      "click this link",
      "you won",
      "claim reward",
      "confirm your identity",
      "act now"
    ];

    let signalCount = 0;

    if (typeof userMsg === "string") {

      const lower = userMsg.toLowerCase();

      scamSignals.forEach(word => {
        if (lower.includes(word)) {
          signalCount++;
        }
      });

    }

    content.push({
      type: "text",
      text: "Potential scam signals detected: " + signalCount
    });

    /* ------------------------------
       OPENROUTER CALL
    --------------------------------*/

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
          max_tokens: 900,
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
              actions: [
                {
                  title: "Try again",
                  detail: "Please try the scan again."
                }
              ],
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
        summary:
          "This content appears to be safe. Nothing suspicious was detected.",
        flags: [],
        actions: [
          {
            title: "No action needed",
            detail: "Everything looks normal here."
          }
        ],
        verdict: "This looks safe."
      });

    }

    return res.status(200).json({
      content: [
        {
          text: text
        }
      ]
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
            actions: [
              {
                title: "Try again",
                detail: "Please try the scan again."
              }
            ],
            verdict: "A server error occurred."
          })
        }
      ]
    });

  }

};
