// FILE: api/admin/auth.js
// Handles FMJ admin staff login and session verification via Supabase auth

// api/admin/auth.js — uses fetch directly, no npm packages needed
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  try {
    // Step 1: Sign in via Supabase Auth REST API
    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY
      },
      body: JSON.stringify({ email, password })
    });

    const authData = await authRes.json();
    if (!authRes.ok || !authData.access_token) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Step 2: Check user is in fmj_staff table using service key
    const staffRes = await fetch(
      `${SUPABASE_URL}/rest/v1/fmj_staff?auth_user_id=eq.${authData.user.id}&is_active=eq.true&select=id,name,role`,
      {
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
        }
      }
    );

    const staffData = await staffRes.json();
    if (!staffData || staffData.length === 0) {
      return res.status(403).json({ error: 'Access denied — not an FMJ staff account' });
    }

    const staff = staffData[0];
    return res.status(200).json({
      ok: true,
      session: authData,
      user: {
        id: staff.id,
        name: staff.name,
        role: staff.role,
        email: authData.user.email
      }
    });
  } catch(e) {
    console.error('Auth error:', e.message);
    return res.status(500).json({ error: 'Authentication failed: ' + e.message });
  }
}
