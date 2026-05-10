// FILE: api/portal/set-password.js
// Sets a new password for an institution portal user using their Supabase recovery access token

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { access_token, password } = req.body;
  if (!access_token || !password) return res.status(400).json({ error: 'Missing required fields' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  try {
    // Update the user's password using their recovery token
    const updateRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${access_token}`
      },
      body: JSON.stringify({ password })
    });

    const updateData = await updateRes.json();
    if (!updateRes.ok) {
      return res.status(400).json({ error: updateData.message || 'Failed to set password' });
    }

    // Now sign them in to get a full session
    const signInRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
      body: JSON.stringify({ email: updateData.email, password })
    });

    const signInData = await signInRes.json();
    if (!signInRes.ok || !signInData.access_token) {
      // Password set but auto sign-in failed — redirect to login
      return res.status(200).json({ ok: true, session: null });
    }

    // Verify they're in institution_users
    const userRes = await fetch(
      `${SUPABASE_URL}/rest/v1/institution_users?auth_user_id=eq.${signInData.user.id}&is_active=eq.true&select=id,name,email,role,role_label,campus_id,institution_id`,
      { headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` } }
    );
    const userData = await userRes.json();
    if (!userData || userData.length === 0) {
      return res.status(403).json({ error: 'No institution account found for this email.' });
    }
    const user = userData[0];

    // Get campus and institution
    const campusRes = await fetch(
      `${SUPABASE_URL}/rest/v1/campuses?id=eq.${user.campus_id}&select=id,campus_name,institution_id,monthly_cap,status`,
      { headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` } }
    );
    const campusData = await campusRes.json();
    const campus = campusData && campusData[0];

    const instRes = await fetch(
      `${SUPABASE_URL}/rest/v1/institutions?id=eq.${user.institution_id}&select=id,name,institution_type`,
      { headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` } }
    );
    const instData = await instRes.json();
    const institution = instData && instData[0];

    return res.status(200).json({
      ok: true,
      session: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          role_label: user.role_label || user.role,
          campus_id: user.campus_id,
          institution_id: user.institution_id,
          campus_name: campus ? campus.campus_name : '',
          institution_name: institution ? institution.name : '',
          institution_type: institution ? institution.institution_type : '',
          monthly_cap: campus ? campus.monthly_cap : 1000
        },
        access_token: signInData.access_token,
        refresh_token: signInData.refresh_token
      }
    });

  } catch(e) {
    console.error('Set password error:', e.message);
    return res.status(500).json({ error: 'Failed to set password. Please try again.' });
  }
}
