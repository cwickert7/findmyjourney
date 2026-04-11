// api/send-results.js
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, name, nowJobs, careerJobs, tips, encouragement } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Invalid email' });

  const explorerName = name || 'Explorer';
  const allJobs = [...(nowJobs || []), ...(careerJobs || [])];

  // ── Store in Upstash (non-fatal) ──
  try {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (url && token) {
      const key = `cc_email_${Date.now()}`;
      const val = JSON.stringify({ email, name: explorerName, jobs: allJobs.map(j => j.title), ts: new Date().toISOString() });
      await fetch(`${url}/set/${encodeURIComponent(key)}/${encodeURIComponent(val)}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
    }
  } catch(e) { console.error('Upstash:', e.message); }

  // ── Helper: build a job card in HTML ──
  function jobCard(job, type) {
    const accentColor = type === 'now' ? '#3D6B4F' : '#C4714A';
    const badgeText = type === 'now' ? 'Start now' : 'Career path';
    const badgeBg = type === 'now' ? '#EFF7F2' : '#FEF3EC';
    const badgeColor = type === 'now' ? '#3D6B4F' : '#C4714A';
    const outlookIcon = job.outlook === 'growing' ? '↗' : job.outlook === 'declining' ? '↘' : '→';
    const outlookColor = job.outlook === 'growing' ? '#3D6B4F' : job.outlook === 'declining' ? '#C4514A' : '#6B6058';

    const salaryRow = (job.salaryEntry || job.salaryExperienced) ? `
      <table width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0;border:1px solid #E8DFD0;border-radius:8px;overflow:hidden">
        <tr>
          ${job.salaryEntry ? `<td style="padding:10px 14px;border-right:1px solid #E8DFD0;background:#FAFAF8">
            <div style="font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#9A8E84;margin-bottom:3px">Starting salary</div>
            <div style="font-size:14px;font-weight:600;color:#2C2422">${job.salaryEntry}</div>
          </td>` : ''}
          ${job.salaryExperienced ? `<td style="padding:10px 14px;border-right:1px solid #E8DFD0;background:#FAFAF8">
            <div style="font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#9A8E84;margin-bottom:3px">Experienced</div>
            <div style="font-size:14px;font-weight:600;color:#2C2422">${job.salaryExperienced}</div>
          </td>` : ''}
          ${job.outlook ? `<td style="padding:10px 14px;background:#FAFAF8">
            <div style="font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#9A8E84;margin-bottom:3px">Outlook</div>
            <div style="font-size:14px;font-weight:600;color:${outlookColor}">${outlookIcon} ${job.outlook.charAt(0).toUpperCase() + job.outlook.slice(1)}</div>
          </td>` : ''}
        </tr>
      </table>` : '';

    const whyYou = job.whyYou ? `
      <div style="background:#FAF7F2;border-left:3px solid ${accentColor};padding:10px 14px;border-radius:0 8px 8px 0;margin:12px 0;font-size:13px;color:#6B6058;line-height:1.6;font-style:italic">
        ${job.whyYou}
      </div>` : '';

    return `
    <div style="background:#fff;border:1.5px solid #E8DFD0;border-radius:12px;padding:20px;margin-bottom:14px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <h3 style="margin:0;font-family:Georgia,serif;font-size:18px;font-weight:400;color:#2C2422">${job.title}</h3>
        <span style="background:${badgeBg};color:${badgeColor};font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;white-space:nowrap;margin-left:10px">${badgeText}</span>
      </div>
      <p style="margin:0 0 10px;font-size:14px;color:#6B6058;line-height:1.6">${job.desc}</p>
      ${salaryRow}
      ${whyYou}
    </div>`;
  }

  // ── Build now jobs section ──
  const nowSection = nowJobs && nowJobs.length ? `
    <div style="margin-bottom:8px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
        <span style="font-size:18px">💵</span>
        <div>
          <div style="font-size:16px;font-weight:700;color:#2C2422">Jobs you can start now</div>
          <div style="font-size:12px;color:#9A8E84">Part-time and casual roles available right now</div>
        </div>
      </div>
      ${nowJobs.map(j => jobCard(j, 'now')).join('')}
    </div>` : '';

  // ── Build career jobs section ──
  const careerSection = careerJobs && careerJobs.length ? `
    <div style="margin-bottom:8px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;margin-top:${nowJobs && nowJobs.length ? '24px' : '0'}">
        <span style="font-size:18px">🚀</span>
        <div>
          <div style="font-size:16px;font-weight:700;color:#2C2422">Future career paths</div>
          <div style="font-size:12px;color:#9A8E84">Longer-term directions that fit who you are</div>
        </div>
      </div>
      ${careerJobs.map(j => jobCard(j, 'career')).join('')}
    </div>` : '';

  // ── Build tips section ──
  const tipsSection = tips && tips.length ? `
    <div style="background:#FAF7F2;border:1.5px solid #E8DFD0;border-radius:12px;padding:20px;margin-bottom:20px">
      <div style="font-size:14px;font-weight:700;color:#2C2422;margin-bottom:12px">✦ Your next steps</div>
      ${tips.map(tip => `
        <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:10px">
          <div style="width:6px;height:6px;border-radius:50%;background:#C4714A;flex-shrink:0;margin-top:6px"></div>
          <div style="font-size:14px;color:#6B6058;line-height:1.6">${tip}</div>
        </div>`).join('')}
    </div>` : '';

  // ── Build full email HTML ──
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Your Career Compass Results, ${explorerName}</title>
</head>
<body style="margin:0;padding:0;background:#F5F0E8;font-family:'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased">

  <!-- Wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F0E8;padding:32px 16px">
    <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

      <!-- Header -->
      <tr><td style="text-align:center;padding-bottom:24px">
        <div style="display:inline-flex;align-items:center;gap:8px">
          <div style="width:28px;height:28px;border:2px solid #C4714A;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:12px;color:#C4714A;line-height:1">◆</div>
          <span style="font-family:Georgia,serif;font-size:15px;letter-spacing:.06em;color:#2C2422">Career Compass</span>
        </div>
        <div style="margin-top:6px;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#9A8E84">Your personalised career results</div>
      </td></tr>

      <!-- Encouragement card -->
      <tr><td style="background:#fff;border-radius:16px;padding:28px;border:1.5px solid #E8DFD0;margin-bottom:16px;display:block;margin-bottom:14px">
        <h1 style="font-family:Georgia,serif;font-size:28px;font-weight:400;color:#2C2422;margin:0 0 14px">Hi ${explorerName} 👋</h1>
        <p style="font-size:15px;color:#6B6058;line-height:1.75;margin:0">${encouragement || 'Here are your Career Compass results. These are starting points — not limits. Your path is yours to shape.'}</p>
      </td></tr>

      <tr><td style="height:14px"></td></tr>

      <!-- Results -->
      <tr><td style="background:#fff;border-radius:16px;padding:28px;border:1.5px solid #E8DFD0;display:block">
        <div style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#C4714A;margin-bottom:20px;padding-bottom:14px;border-bottom:1px solid #E8DFD0">
          🎯 Your matches
        </div>
        ${nowSection}
        ${careerSection}
      </td></tr>

      <tr><td style="height:14px"></td></tr>

      <!-- Next steps -->
      ${tipsSection ? `<tr><td style="background:#fff;border-radius:16px;padding:28px;border:1.5px solid #E8DFD0;display:block">${tipsSection}</td></tr><tr><td style="height:14px"></td></tr>` : ''}

      <!-- CTA -->
      <tr><td style="background:#fff;border-radius:16px;padding:24px 28px;border:1.5px solid #E8DFD0;text-align:center;display:block">
        <p style="font-size:14px;color:#6B6058;margin:0 0 16px;line-height:1.6">Want to explore further? Take the assessment again at any time — your next session might reveal new directions as your thinking evolves. You can also use Career Compass to build a personalised CV.</p>
        <a href="https://career-compass-chris-wickerts-projects.vercel.app" style="display:inline-block;background:#C4714A;color:#fff;border-radius:50px;padding:14px 32px;font-size:15px;font-weight:700;text-decoration:none;letter-spacing:.02em">Back to Career Compass →</a>
      </td></tr>

      <tr><td style="height:28px"></td></tr>

      <!-- Footer -->
      <tr><td style="text-align:center;padding:0 20px">
        <p style="font-size:11px;color:#9A8E84;line-height:1.7;margin:0">
          ⚠️ For guidance only — not a substitute for professional career counselling.<br>
          🔒 Your email address was used only to send this message and is not shared with anyone.<br><br>
          <span style="color:#C8BFB5">© 2025 Career Compass · Free · Private · Australian</span>
        </p>
      </td></tr>

    </table>
    </td></tr>
  </table>

</body>
</html>`;

  // ── Send via Resend ──
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return res.status(500).json({ error: 'Email not configured' });

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resendKey}`
      },
      body: JSON.stringify({
        from: 'Career Compass <onboarding@resend.dev>',
        to: [email],
        subject: `Your Career Compass results, ${explorerName} 🧭`,
        html
      })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.message || 'Resend error');
    return res.status(200).json({ ok: true });
  } catch(e) {
    console.error('Resend error:', e.message);
    return res.status(500).json({ error: 'Failed to send' });
  }
}
