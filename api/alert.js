module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    const { email, name, score, label, summary, verdict, scanType } = req.body;
    if (!email || score < 61) { res.status(200).json({ sent: false }); return; }

    const RESEND_KEY = process.env.RESEND_API_KEY;

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:'Segoe UI',system-ui,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:2rem 1rem">
    <div style="background:#0d2e7a;border-radius:14px 14px 0 0;padding:1.4rem 1.8rem;display:flex;align-items:center;justify-content:space-between">
      <div style="color:#fff;font-size:1.2rem;font-weight:800">DivoX <span style="color:#f87171">Trust</span></div>
      <div style="background:#dc2626;color:#fff;font-size:0.72rem;font-weight:800;padding:4px 12px;border-radius:12px;text-transform:uppercase">${label}</div>
    </div>
    <div style="background:#fff;border-radius:0 0 14px 14px;padding:1.8rem;border:1px solid #e2e8f0;border-top:none">
      <p style="color:#475569;font-size:0.9rem;margin-bottom:1.2rem">Hi ${name || 'there'},</p>
      <p style="color:#1e293b;font-size:0.95rem;margin-bottom:1.4rem">DivoX Trust just detected a <strong style="color:#dc2626">high risk threat</strong> in your recent scan. Here is what we found:</p>
      <div style="background:#fef2f2;border-left:4px solid #dc2626;border-radius:8px;padding:1rem 1.2rem;margin-bottom:1.4rem">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <span style="font-size:0.75rem;font-weight:700;color:#94a3b8;text-transform:uppercase">${scanType} scan</span>
          <span style="font-size:1.4rem;font-weight:900;color:#dc2626">${score}%</span>
        </div>
        <p style="color:#1e293b;font-size:0.88rem;line-height:1.6;margin:0">${summary}</p>
      </div>
      ${verdict ? `<div style="background:#f8fafc;border-radius:8px;padding:0.9rem 1.1rem;margin-bottom:1.4rem"><p style="color:#1e293b;font-size:0.85rem;font-weight:600;margin:0">${verdict}</p></div>` : ''}
      <div style="text-align:center;margin-bottom:1.4rem">
        <a href="https://divoxtrust.vercel.app" style="background:#1a56db;color:#fff;text-decoration:none;padding:11px 28px;border-radius:9px;font-weight:700;font-size:0.9rem;display:inline-block">Open DivoX Trust</a>
      </div>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:1.2rem 0">
      <p style="color:#94a3b8;font-size:0.75rem;text-align:center;margin:0">You are receiving this because you are a DivoX Trust Pro member.<br>DivoX Trust — Protecting you from scams, one scan at a time.</p>
    </div>
  </div>
</body>
</html>`;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_KEY}`
      },
      body: JSON.stringify({
        from: 'DivoX Trust <onboarding@resend.dev>',
        to: [email],
        subject: `Alert: ${label} detected — ${score}% risk score`,
        html
      })
    });

    const data = await response.json();
    res.status(200).json({ sent: true, data });
  } catch (err) {
    res.status(200).json({ sent: false, error: err.message });
  }
}
