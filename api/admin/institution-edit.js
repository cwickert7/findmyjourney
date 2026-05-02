// FILE: api/admin/institution-edit.js
// PATCH update institution fields such as name, contact details, website, ABN

// api/admin/institution-edit.js — PATCH institution fields
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
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const staff = await verifyFMJStaff(token);
  if (!staff) return res.status(401).json({ error: 'Unauthorised' });

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Institution ID required' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const headers = {
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };

  const {
    name, institution_type, abn, website, school_number,
    primary_contact_name, primary_contact_email, primary_contact_mobile,
    billing_email, notes
  } = req.body;

  const updateBody = {};
  if (name !== undefined) updateBody.name = name;
  if (institution_type !== undefined) updateBody.institution_type = institution_type;
  if (abn !== undefined) updateBody.abn = abn;
  if (website !== undefined) updateBody.website = website;
  if (school_number !== undefined) updateBody.school_number = school_number;
  if (primary_contact_name !== undefined) updateBody.primary_contact_name = primary_contact_name;
  if (primary_contact_email !== undefined) updateBody.primary_contact_email = primary_contact_email;
  if (primary_contact_mobile !== undefined) updateBody.primary_contact_mobile = primary_contact_mobile;
  if (billing_email !== undefined) updateBody.billing_email = billing_email;
  if (notes !== undefined) updateBody.notes = notes;

  const r = await fetch(`${SUPABASE_URL}/rest/v1/institutions?id=eq.${id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(updateBody)
  });

  if (!r.ok) {
    const err = await r.json();
    return res.status(500).json({ error: err.message || 'Failed to update institution' });
  }

  return res.status(200).json({ ok: true });
}
