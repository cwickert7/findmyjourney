// FILE: api/admin/campuses.js
// POST create an additional campus for an existing institution

// api/admin/campuses.js — fetch only, no npm packages
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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const staff = await verifyFMJStaff(token);
  if (!staff) return res.status(401).json({ error: 'Unauthorised' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const headers = {
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };

  const {
    institution_id, campus_name, address_street, address_suburb,
    address_state, address_postcode, phone, monthly_cap, status
  } = req.body;

  if (!institution_id || !campus_name) {
    return res.status(400).json({ error: 'institution_id and campus_name required' });
  }

  // Verify institution exists
  const instRes = await fetch(
    `${SUPABASE_URL}/rest/v1/institutions?id=eq.${institution_id}&select=id,name`,
    { headers }
  );
  const instData = await instRes.json();
  if (!instData || instData.length === 0) return res.status(404).json({ error: 'Institution not found' });

  const campRes = await fetch(`${SUPABASE_URL}/rest/v1/campuses`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      institution_id, campus_name,
      address_street, address_suburb, address_state,
      address_postcode, phone,
      monthly_cap: monthly_cap || 1000,
      status: status || 'trial'
    })
  });

  const campData = await campRes.json();
  if (!campRes.ok) return res.status(500).json({ error: campData.message || 'Failed to create campus' });
  const campus = Array.isArray(campData) ? campData[0] : campData;

  return res.status(201).json({ ok: true, campus_id: campus.id });
}
