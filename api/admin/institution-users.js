// FILE: api/admin/institution-users.js
// GET, POST invite, and PATCH reset or deactivate institution portal users

async function verifyFMJStaff(token) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${token}` }
  });
  if (!userRes.ok) return null;
  const userData = await userRes.json();
  if (!userData.id) return null;
  const staffRes = await fetch(
    `${SUPABASE_URL}/rest/v1/fmj_staff?auth_user_id=eq.${userData.id}&is_active=eq.true&select=id,name,role`,
    { headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` } }
  );
  const staffData = await staffRes.json();
  return staffData && staffData.length > 0 ? staffData[0] : null;
}

export default async function handler(req, res) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const staff = await verifyFMJStaff(token);
  if (!staff) return res.status(401).json({ error: 'Unauthorised' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const dbHeaders = {
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };

  if (req.method === 'GET') {
    const { campus_id } = req.query;
    if (!campus_id) return res.status(400).json({ error: 'campus_id required' });

    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/institution_users?campus_id=eq.${campus_id}&select=id,name,email,role,role_label,is_active,last_login,created_at&order=created_at`,
      { headers: dbHeaders }
    );
    const users = await r.json();
    return res.status(200).json({ users: Array.isArray(users) ? users : [] });
  }

  if (req.method === 'POST') {
    const { campus_id, institution_id, name, email, role, role_label } = req.body;
    if (!campus_id || !institution_id || !name || !email || !role) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Step 1: Invite user via Supabase Auth Admin API
    const inviteRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email,
        email_confirm: true,
        user_metadata: { name, role, institution_user: true },
        // Send invite email
        invite: true,
        data: { name, role }
      })
    });

    const inviteData = await inviteRes.json();

    // If user already exists in auth, that's ok — get their ID
    let authUserId = inviteData.id;
    if (!inviteRes.ok && !authUserId) {
      // Try to find existing auth user
      const existingRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`, {
        headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` }
      });
      const existingData = await existingRes.json();
      if (existingData.users && existingData.users.length > 0) {
        authUserId = existingData.users[0].id;
      } else {
        return res.status(500).json({ error: inviteData.message || 'Failed to create user account' });
      }
    }

    // Step 2: Send invite email via Resend
    const institutionRes = await fetch(
      `${SUPABASE_URL}/rest/v1/institutions?id=eq.${institution_id}&select=name`,
      { headers: dbHeaders }
    );
    const instData = await institutionRes.json();
    const instName = instData && instData[0] ? instData[0].name : 'your institution';

    const portalUrl = `${process.env.SITE_URL || 'https://findmyjourney.com.au'}/portal/login.html`;

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from: 'Find My Journey <onboarding@resend.dev>',
        to: [email],
        subject: `You've been added to Find My Journey — ${instName}`,
        html: `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#F5F0E8;padding:32px">
          <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;border:1px solid #E8DFD0">
            <div style="font-family:Georgia,serif;font-size:20px;color:#2C2422;margin-bottom:4px">Find My Journey</div>
            <div style="font-size:11px;color:#9A8E84;letter-spacing:.1em;text-transform:uppercase;margin-bottom:24px">Institution Portal</div>
            <h1 style="font-family:Georgia,serif;font-size:26px;font-weight:400;color:#2C2422;margin:0 0 14px">Hi ${name},</h1>
            <p style="font-size:15px;color:#6B6058;line-height:1.7;margin:0 0 20px">You've been added as a <strong>${role_label || role}</strong> at <strong>${instName}</strong> on Find My Journey.</p>
            <p style="font-size:14px;color:#6B6058;line-height:1.7;margin:0 0 24px">Click below to set your password and access the institution portal, where you can manage students and view their career results.</p>
            <a href="${portalUrl}" style="display:inline-block;background:#C4714A;color:#fff;border-radius:50px;padding:14px 32px;font-size:15px;font-weight:600;text-decoration:none;margin-bottom:24px">Set up my account →</a>
            <p style="font-size:12px;color:#9A8E84;line-height:1.6;border-top:1px solid #E8DFD0;padding-top:16px;margin:0">
              If you weren't expecting this email, you can ignore it.<br>
              Questions? Contact us at hello@findmyjourney.com.au
            </p>
          </div>
        </body></html>`
      })
    });

    // Step 3: Create institution_users record
    const userRes = await fetch(`${SUPABASE_URL}/rest/v1/institution_users`, {
      method: 'POST',
      headers: dbHeaders,
      body: JSON.stringify({
        campus_id, institution_id, name, email, role,
        role_label: role_label || role,
        is_active: true,
        auth_user_id: authUserId || null,
        created_by: staff.id
      })
    });

    const userData = await userRes.json();
    if (!userRes.ok) return res.status(500).json({ error: userData.message || 'Failed to create user record' });

    return res.status(201).json({ ok: true });
  }

  if (req.method === 'PATCH') {
    const { action, email, user_id } = req.body;

    if (action === 'reset_password') {
      // Trigger password recovery email via Supabase
      const r = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email })
      });
      return res.status(200).json({ ok: true });
    }

    if (action === 'deactivate') {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/institution_users?id=eq.${user_id}`,
        { method: 'PATCH', headers: dbHeaders, body: JSON.stringify({ is_active: false }) }
      );
      return res.status(200).json({ ok: r.ok });
    }

    return res.status(400).json({ error: 'Invalid action' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
