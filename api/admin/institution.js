// api/admin/institution.js — fetch only, no npm packages
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
  const headers = {
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Campus ID required' });

  // ── GET campus + institution + all campuses ──
  if (req.method === 'GET') {
    const campRes = await fetch(
      `${SUPABASE_URL}/rest/v1/campuses?id=eq.${id}&select=id,institution_id,campus_name,address_street,address_suburb,address_state,address_postcode,phone,monthly_cap,status,created_at`,
      { headers }
    );
    const campData = await campRes.json();
    if (!campData || campData.length === 0) return res.status(404).json({ error: 'Campus not found' });
    const campus = campData[0];

    const instRes = await fetch(
      `${SUPABASE_URL}/rest/v1/institutions?id=eq.${campus.institution_id}&select=*`,
      { headers }
    );
    const instData = await instRes.json();
    if (!instData || instData.length === 0) return res.status(404).json({ error: 'Institution not found' });
    const institution = instData[0];

    const allCampRes = await fetch(
      `${SUPABASE_URL}/rest/v1/campuses?institution_id=eq.${campus.institution_id}&select=id,campus_name,address_state,address_suburb,monthly_cap,status&order=created_at`,
      { headers }
    );
    const allCampuses = await allCampRes.json();

    const statsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/campus_stats?campus_id=eq.${id}&select=*`,
      { headers }
    );
    const stats = await statsRes.json();
    campus.campus_stats = stats || [];

    return res.status(200).json({ campus, institution, all_campuses: allCampuses || [] });
  }

  // ── PATCH update status or cap ──
  if (req.method === 'PATCH') {
    const { field, value } = req.body;
    if (!['status', 'monthly_cap'].includes(field)) {
      return res.status(400).json({ error: 'Invalid field' });
    }

    const patchRes = await fetch(
      `${SUPABASE_URL}/rest/v1/campuses?id=eq.${id}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ [field]: value })
      }
    );
    if (!patchRes.ok) return res.status(500).json({ error: 'Failed to update' });

    // If status change, also update parent institution
    if (field === 'status') {
      const campRes = await fetch(
        `${SUPABASE_URL}/rest/v1/campuses?id=eq.${id}&select=institution_id`,
        { headers }
      );
      const campData = await campRes.json();
      if (campData && campData[0]) {
        await fetch(
          `${SUPABASE_URL}/rest/v1/institutions?id=eq.${campData[0].institution_id}`,
          { method: 'PATCH', headers, body: JSON.stringify({ status: value }) }
        );
      }
    }

    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
