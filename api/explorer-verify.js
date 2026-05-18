// FILE: api/explorer-verify.js
// Verifies a magic link token OR an access code — returns explorer session if valid

async function supabaseGet(path, env) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    headers: { 'apikey': env.SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}` }
  });
  return res.ok ? res.json() : null;
}

async function supabasePatch(path, body, env) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  return res.ok;
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

  const { token, email, code } = req.body;
  const env = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY
  };

  // ── Path 1: Magic link token verification ──
  if (token && email) {
    try {
      // Find token
      const links = await supabaseGet(
        `explorer_magic_links?token=eq.${encodeURIComponent(token)}&email=eq.${encodeURIComponent(email)}&used=eq.false&select=id,email,expires_at`,
        env
      );

      if (!links || links.length === 0) {
        return res.status(401).json({ error: 'Invalid or expired sign-in link. Please request a new one.' });
      }

      const link = links[0];
      if (new Date(link.expires_at) < new Date()) {
        return res.status(401).json({ error: 'This sign-in link has expired. Please request a new one.' });
      }

      // Mark token as used
      await supabasePatch(`explorer_magic_links?id=eq.${link.id}`, { used: true }, env);

      // Get or create explorer account
      let accounts = await supabaseGet(
        `explorer_accounts?email=eq.${encodeURIComponent(email)}&select=id,email,credits_remaining`,
        env
      );

      let account;
      if (accounts && accounts.length > 0) {
        account = accounts[0];
        await supabasePatch(`explorer_accounts?id=eq.${account.id}`, { last_active_at: new Date().toISOString() }, env);
      } else {
        // Account may have been deleted — create fresh with 0 credits
        const created = await supabasePost('explorer_accounts', { email, credits_remaining: 0, credits_purchased: 0 }, env);
        account = created?.[0];
      }

      return res.status(200).json({
        ok: true,
        type: 'magic_link',
        email: account.email,
        credits: account.credits_remaining || 0,
        accountId: account.id
      });

    } catch(e) {
      console.error('magic-link verify error:', e.message);
      return res.status(500).json({ error: 'Verification failed. Please try again.' });
    }
  }

  // ── Path 2: Access code verification ──
  if (code) {
    try {
      const codes = await supabaseGet(
        `access_codes?code=eq.${encodeURIComponent(code.toUpperCase())}&is_active=eq.true&select=id,code,code_type,campus_id,institution_id,label,credits_per_use,max_uses,uses_count,expires_at`,
        env
      );

      if (!codes || codes.length === 0) {
        return res.status(401).json({ error: 'Invalid access code. Please check and try again.' });
      }

      const accessCode = codes[0];

      // Check expiry
      if (accessCode.expires_at && new Date(accessCode.expires_at) < new Date()) {
        return res.status(401).json({ error: 'This access code has expired.' });
      }

      // Check max uses
      if (accessCode.max_uses !== null && accessCode.uses_count >= accessCode.max_uses) {
        return res.status(401).json({ error: 'This access code has reached its maximum uses.' });
      }

      // Increment uses count
      await supabasePatch(
        `access_codes?id=eq.${accessCode.id}`,
        { uses_count: accessCode.uses_count + 1 },
        env
      );

      // Log use
      await supabasePost('access_code_uses', {
        code_id: accessCode.id,
        email: email || null
      }, env);

      return res.status(200).json({
        ok: true,
        type: 'access_code',
        codeType: accessCode.code_type,
        campusId: accessCode.campus_id,
        institutionId: accessCode.institution_id,
        label: accessCode.label,
        credits: accessCode.credits_per_use,
        codeId: accessCode.id,
        // For institution codes — pass through for result tagging
        source: accessCode.code_type === 'institution' ? 'access_code' : 'access_code'
      });

    } catch(e) {
      console.error('access-code verify error:', e.message);
      return res.status(500).json({ error: 'Code verification failed. Please try again.' });
    }
  }

  return res.status(400).json({ error: 'Provide either a magic link token or an access code.' });
}
