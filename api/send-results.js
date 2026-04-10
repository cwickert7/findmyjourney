// api/send-results.js
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { email, name, jobs, encouragement } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Invalid email' });
  const explorerName = name || 'Explorer';
  const jobList = (jobs || []).slice(0, 4);

  // Store in Vercel KV (non-fatal if fails)
  try {
    const { KV_REST_API_URL: url, KV_REST_API_TOKEN: token } = process.env;
    if (url && token) {
      const key = `cc_email_${Date.now()}`;
      await fetch(`${url}/set/${key}/${encodeURIComponent(JSON.stringify({email,name:explorerName,jobs:jobList,ts:new Date().toISOString()}))}`,
        { headers: { Authorization: `Bearer ${token}` } });
    }
  } catch(e) { console.error('KV:', e.message); }

  // Build email
  const jobsHTML = jobList.map(j => `<li style="margin-bottom:6px;font-size:15px;color:#2C2422">${j}</li>`).join('');
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#FAF7F2;font-family:Arial,sans-serif">
<div style="max-width:600px;margin:0 auto;padding:40px 24px">
  <div style="text-align:center;margin-bottom:28px">
    <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#9A8E84">Career Compass</div>
  </div>
  <div style="background:#fff;border-radius:16px;padding:32px 28px;border:1.5px solid #E8DFD0;margin-bottom:20px">
    <h1 style="font-family:Georgia,serif;font-size:26px;font-weight:400;color:#2C2422;margin:0 0 8px">Hi ${explorerName} 👋</h1>
    <p style="font-size:15px;color:#6B6058;line-height:1.7;margin:0 0 20px">${encouragement || 'Here are your Career Compass results. These are starting points — not limits.'}</p>
    ${jobList.length ? `<div style="background:#FAF7F2;border-radius:10px;padding:18px 20px;border:1px solid #E8DFD0">
      <div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#C4714A;margin-bottom:8px">Your top matches</div>
      <ul style="padding-left:18px;margin:0">${jobsHTML}</ul></div>` : ''}
  </div>
  <div style="background:#fff;border-radius:16px;padding:24px 28px;border:1.5px solid #E8DFD0;margin-bottom:20px;text-align:center">
    <p style="font-size:14px;color:#6B6058;margin:0 0 16px">Ready to explore further?</p>
    <a href="https://career-compass-chris-wickerts-projects.vercel.app" style="display:inline-block;background:#C4714A;color:#fff;border-radius:50px;padding:13px 28px;font-size:15px;font-weight:600;text-decoration:none">Back to Career Compass →</a>
  </div>
  <p style="font-size:11px;color:#9A8E84;text-align:center;line-height:1.6;margin:0">
    ⚠️ For guidance only — not a substitute for professional career counselling.<br>
    🔒 Your email was used only to send this message.
  </p>
</div></body></html>`;

  // Send via Resend
  const key = process.env.RESEND_API_KEY;
  if (!key) return res.status(500).json({ error: 'Email not configured' });
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({ from: 'Career Compass <results@careercompass.com.au>', to: [email], subject: `Your Career Compass results, ${explorerName}`, html })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.message || 'Resend error');
    return res.status(200).json({ ok: true });
  } catch(e) {
    console.error('Resend error:', e.message);
    return res.status(500).json({ error: 'Failed to send' });
  }
}
