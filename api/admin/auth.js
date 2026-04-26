// api/admin/auth.js
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, password, action } = req.body;
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );
  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  // Sign out
  if (action === 'signout') {
    return res.status(200).json({ ok: true });
  }

  // Sign in
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  try {
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email, password
    });
    if (authError) return res.status(401).json({ error: 'Invalid email or password' });

    // Check user is in fmj_staff table
    const { data: staffData, error: staffError } = await supabaseAdmin
      .from('fmj_staff')
      .select('id, name, role, is_active')
      .eq('auth_user_id', authData.user.id)
      .single();

    if (staffError || !staffData) {
      return res.status(403).json({ error: 'Access denied — not an FMJ staff account' });
    }
    if (!staffData.is_active) {
      return res.status(403).json({ error: 'This account has been deactivated' });
    }

    return res.status(200).json({
      ok: true,
      session: authData.session,
      user: {
        id: staffData.id,
        name: staffData.name,
        role: staffData.role,
        email: authData.user.email
      }
    });
  } catch(e) {
    console.error('Auth error:', e);
    return res.status(500).json({ error: 'Authentication failed' });
  }
}
