// FILE: api/explorer-auth.js
// Sends a magic link to a returning Explorer so they can log back in without a password

async function supabaseGet(path, env) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    headers: { 'apikey': env.SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}` }
  });
  return res.ok ? res.json() : null;
}

async function supabasePost(path, body, env) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: {
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(body)
  });
  return res.ok ? res.json() : null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required' });

  const env = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY
  };
  const SITE_URL = process.env.SITE_URL || 'https://findmyjourney.com.au';
  const RESEND_KEY = process.env.RESEND_API_KEY;

  try {
    // Check account exists and has credits
    const accounts = await supabaseGet(
      `explorer_accounts?email=eq.${encodeURIComponent(email)}&select=id,credits_remaining`,
      env
    );

    if (!accounts || accounts.length === 0) {
      // Don't reveal whether account exists — generic response
      return res.status(200).json({ ok: true, message: 'If an account exists for this email, a link has been sent.' });
    }

    const account = accounts[0];

    // Generate magic link token
    const crypto = await import('crypto');
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 minutes

    await supabasePost('explorer_magic_links', {
      email,
      token,
      expires_at: expires
    }, env);

    const magicLink = `${SITE_URL}/assessment?token=${token}&email=${encodeURIComponent(email)}`;
    const hasCredits = account.credits_remaining > 0;

    // Send magic link email
    if (RESEND_KEY) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Find My Journey <onboarding@findmyjourney.com.au>',
          to: email,
          subject: 'Your Find My Journey sign-in link',
          html: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Sign in to Find My Journey</title></head>
<body style="margin:0;padding:0;background:#FAF7F2;font-family:Arial,sans-serif">
<div style="max-width:560px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(44,36,34,.08)">
  <div style="background:#2C2422;padding:28px 36px">
    <div style="font-family:Georgia,serif;font-size:20px;font-weight:300;color:#fff">Find My <strong>Journey</strong></div>
  </div>
  <div style="padding:36px">
    <h1 style="font-family:Georgia,serif;font-size:24px;font-weight:300;color:#2C2422;margin:0 0 12px">Here&rsquo;s your sign-in link.</h1>
    <p style="font-size:14px;color:#6B6058;line-height:1.6;margin:0 0 8px">Click below to sign in to your Find My Journey account${hasCredits ? ' — you have <strong>' + account.credits_remaining + ' credit' + (account.credits_remaining !== 1 ? 's' : '') + '</strong> remaining' : ''}.</p>
    <p style="font-size:12px;color:#9A8E84;margin:0 0 24px">This link expires in 30 minutes. If you didn&rsquo;t request this, you can ignore it safely.</p>
    <a href="${magicLink}" style="display:inline-block;background:#C4714A;color:#fff;border-radius:50px;padding:14px 32px;font-size:15px;font-weight:600;text-decoration:none;margin-bottom:24px">Sign in &rarr;</a>
    <p style="font-size:12px;color:#C8BFB5">Questions? <a href="mailto:hello@findmyjourney.com.au" style="color:#C4714A">hello@findmyjourney.com.au</a></p>
  </div>
  <div style="background:#F5F0E8;padding:16px 36px;font-size:11px;color:#9A8E84">Find My Journey &nbsp;&middot;&nbsp; findmyjourney.com.au</div>
</div>
</body>
</html>`
        })
      });
    }

    return res.status(200).json({ ok: true, message: 'Sign-in link sent. Check your email.' });

  } catch(e) {
    console.error('explorer-auth error:', e.message);
    return res.status(500).json({ error: 'Failed to send sign-in link. Please try again.' });
  }
}
