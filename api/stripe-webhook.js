// FILE: api/stripe-webhook.js
// Handles Stripe webhook events — on successful payment, creates explorer account and sends email

export const config = { api: { bodyParser: false } };

async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

async function supabaseRequest(path, method, body, env) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return res.ok ? res.json() : null;
}

function creditsForPrice(priceId, env) {
  if (priceId === env.STRIPE_PRICE_3_CREDITS) return 3;
  if (priceId === env.STRIPE_PRICE_1_CREDIT) return 1;
  return 1; // safe default
}

async function sendConfirmationEmail(email, name, credits, accessLink, resendKey) {
  const subject = credits === 1
    ? 'Your Find My Journey credit is ready'
    : `Your ${credits} Find My Journey credits are ready`;

  const body = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#FAF7F2;font-family:'DM Sans',Arial,sans-serif">
<div style="max-width:560px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(44,36,34,.08)">
  <div style="background:#2C2422;padding:28px 36px;display:flex;align-items:center;gap:12px">
    <div style="font-family:Georgia,serif;font-size:20px;font-weight:300;color:#fff;letter-spacing:-.01em">Find My <strong style="font-weight:400">Journey</strong></div>
  </div>
  <div style="padding:36px">
    <h1 style="font-family:Georgia,serif;font-size:26px;font-weight:300;color:#2C2422;margin:0 0 12px">You&rsquo;re all set${name ? ', ' + name : ''}.</h1>
    <p style="font-size:15px;color:#6B6058;line-height:1.6;margin:0 0 24px">Your payment was successful. You have <strong>${credits} credit${credits !== 1 ? 's' : ''}</strong> ready to use &mdash; each credit gives you one full assessment and access to the CV Builder.</p>
    <a href="${accessLink}" style="display:inline-block;background:#C4714A;color:#fff;border-radius:50px;padding:14px 32px;font-size:15px;font-weight:600;text-decoration:none;margin-bottom:24px">Begin my journey &rarr;</a>
    <p style="font-size:13px;color:#9A8E84;line-height:1.6;margin:0 0 8px">Or copy this link to use later:</p>
    <div style="background:#FAF7F2;border:1px solid #E8DFD0;border-radius:8px;padding:10px 14px;font-size:12px;color:#6B6058;word-break:break-all;margin-bottom:24px">${accessLink}</div>
    <p style="font-size:12px;color:#C8BFB5;line-height:1.6;margin:0">Your credits don&rsquo;t expire. Questions? Email us at <a href="mailto:hello@findmyjourney.com.au" style="color:#C4714A">hello@findmyjourney.com.au</a></p>
  </div>
  <div style="background:#F5F0E8;padding:16px 36px;font-size:11px;color:#9A8E84">Find My Journey &nbsp;&middot;&nbsp; findmyjourney.com.au &nbsp;&middot;&nbsp; ABN 94 672 651 253</div>
</div>
</body>
</html>`;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Find My Journey <onboarding@findmyjourney.com.au>',
      to: email,
      subject,
      html: body
    })
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
  const SITE_URL = process.env.SITE_URL || 'https://findmyjourney.com.au';
  const env = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
    STRIPE_PRICE_3_CREDITS: process.env.STRIPE_PRICE_3_CREDITS,
    STRIPE_PRICE_1_CREDIT: process.env.STRIPE_PRICE_1_CREDIT
  };

  // ── Verify Stripe signature ──
  const rawBody = await buffer(req);
  const signature = req.headers['stripe-signature'];

  let event;
  try {
    // Manual signature verification without stripe-node SDK
    const crypto = await import('crypto');
    const parts = signature.split(',');
    const timestamp = parts.find(p => p.startsWith('t=')).split('=')[1];
    const sigHash = parts.find(p => p.startsWith('v1=')).split('=').slice(1).join('=');
    const payload = `${timestamp}.${rawBody.toString()}`;
    const expected = crypto.createHmac('sha256', STRIPE_WEBHOOK_SECRET).update(payload).digest('hex');
    if (expected !== sigHash) {
      return res.status(400).json({ error: 'Invalid signature' });
    }
    event = JSON.parse(rawBody.toString());
  } catch(e) {
    console.error('Webhook signature error:', e.message);
    return res.status(400).json({ error: 'Webhook verification failed' });
  }

  // ── Handle checkout.session.completed ──
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.customer_details?.email || session.customer_email;
    if (!email) {
      console.error('No email in Stripe session');
      return res.status(200).end();
    }

    // Get price ID from line items
    let priceId = null;
    try {
      const lineItemsRes = await fetch(
        `https://api.stripe.com/v1/checkout/sessions/${session.id}/line_items`,
        { headers: { 'Authorization': `Bearer ${STRIPE_SECRET_KEY}` } }
      );
      const lineItems = await lineItemsRes.json();
      priceId = lineItems.data?.[0]?.price?.id;
    } catch(e) {
      console.error('Could not fetch line items:', e.message);
    }

    const credits = creditsForPrice(priceId, env);
    const customerName = session.customer_details?.name || '';

    try {
      // ── Upsert explorer account ──
      // Check if account exists
      const existing = await fetch(
        `${env.SUPABASE_URL}/rest/v1/explorer_accounts?email=eq.${encodeURIComponent(email)}&select=id,credits_remaining,credits_purchased`,
        { headers: { 'apikey': env.SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}` } }
      ).then(r => r.json());

      let accountId;
      if (existing && existing.length > 0) {
        // Update existing account — add credits
        const acct = existing[0];
        accountId = acct.id;
        await supabaseRequest(
          `explorer_accounts?id=eq.${accountId}`,
          'PATCH',
          {
            credits_remaining: (acct.credits_remaining || 0) + credits,
            credits_purchased: (acct.credits_purchased || 0) + credits,
            stripe_customer_id: session.customer || null,
            last_active_at: new Date().toISOString()
          },
          env
        );
      } else {
        // Create new account
        const created = await supabaseRequest('explorer_accounts', 'POST', {
          email,
          credits_remaining: credits,
          credits_purchased: credits,
          stripe_customer_id: session.customer || null,
          stripe_payment_intent: session.payment_intent || null
        }, env);
        accountId = created?.[0]?.id;
      }

      // ── Build access link (email-based magic link) ──
      // Generate a magic token that pre-authenticates them
      const token = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map(b => b.toString(16).padStart(2, '0')).join('');

      // Store magic link (valid 30 days from purchase)
      const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      await supabaseRequest('explorer_magic_links', 'POST', {
        email,
        token,
        expires_at: expires
      }, env);

      const accessLink = `${SITE_URL}/assessment?token=${token}&email=${encodeURIComponent(email)}`;

      // ── Send confirmation email ──
      const resendKey = process.env.RESEND_API_KEY;
      if (resendKey) {
        await sendConfirmationEmail(email, customerName, credits, accessLink, resendKey);
      }

      console.log(`Explorer account created/updated for ${email} — ${credits} credits added`);

    } catch(e) {
      console.error('Account creation error:', e.message);
      // Don't return error — Stripe will retry. Log and continue.
    }
  }

  return res.status(200).json({ received: true });
}
