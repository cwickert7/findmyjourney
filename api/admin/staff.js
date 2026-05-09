// FILE: api/admin/staff.js
// GET all FMJ staff, POST add new staff, PATCH update role or active status

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

  // Only super_admin can manage staff
  if (staff.role !== 'super_admin' && req.method !== 'GET') {
    return res.status(403).json({ error: 'Super admin access required' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const headers = {
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };

  // GET — list all staff
  if (req.method === 'GET') {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/fmj_staff?select=id,name,email,role,is_active,created_at&order=created_at.asc`,
      { headers }
    );
    const data = await r.json();
    if (!r.ok) return res.status(500).json({ error: data.message || 'Failed to load staff' });
    return res.status(200).json({ staff: data });
  }

  // POST — add new staff member
  if (req.method === 'POST') {
    const { name, email, role, auth_user_id } = req.body;
    if (!name || !email || !auth_user_id) return res.status(400).json({ error: 'Missing required fields' });
    if (!['super_admin', 'staff'].includes(role)) return res.status(400).json({ error: 'Invalid role' });

    const r = await fetch(`${SUPABASE_URL}/rest/v1/fmj_staff`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name, email, role: role || 'staff', auth_user_id, is_active: true })
    });
    const data = await r.json();
    if (!r.ok) return res.status(500).json({ error: data.message || 'Failed to add staff member' });
    return res.status(201).json({ ok: true });
  }

  // PATCH — update role or active status
  if (req.method === 'PATCH') {
    const { id, role, is_active } = req.body;
    if (!id) return res.status(400).json({ error: 'Staff ID required' });

    const updates = {};
    if (role !== undefined) {
      if (!['super_admin', 'staff'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
      updates.role = role;
    }
    if (is_active !== undefined) updates.is_active = is_active;
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No fields to update' });

    const r = await fetch(`${SUPABASE_URL}/rest/v1/fmj_staff?id=eq.${id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(updates)
    });
    if (!r.ok) {
      const data = await r.json();
      return res.status(500).json({ error: data.message || 'Failed to update staff member' });
    }
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
