// api/admin/institutions.js — fetch only, no npm packages
async function verifyFMJStaff(token) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  // Verify token with Supabase auth
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${token}`
    }
  });
  if (!userRes.ok) return null;
  const userData = await userRes.json();
  if (!userData.id) return null;

  // Check fmj_staff table
  const staffRes = await fetch(
    `${SUPABASE_URL}/rest/v1/fmj_staff?auth_user_id=eq.${userData.id}&is_active=eq.true&select=id,name,role`,
    {
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
      }
    }
  );
  const staffData = await staffRes.json();
  return staffData && staffData.length > 0 ? staffData[0] : null;
}

export default async function handler(req, res) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorised' });

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

  // ── GET all institutions ──
  if (req.method === 'GET') {
    const { search, type, status, state } = req.query;

    let instUrl = `${SUPABASE_URL}/rest/v1/institutions?select=id,name,institution_type,status,primary_contact_name,primary_contact_email,abn,school_number,created_at,created_by,notes,billing_email,website,primary_contact_mobile`;

    if (type) instUrl += `&institution_type=eq.${type}`;
    if (status) instUrl += `&status=eq.${status}`;
    if (search) instUrl += `&or=(name.ilike.*${search}*,primary_contact_email.ilike.*${search}*)`;
    instUrl += '&order=created_at.desc';

    const instRes = await fetch(instUrl, { headers });
    const institutions = await instRes.json();
    if (!instRes.ok) return res.status(500).json({ error: institutions.message || 'Failed to load institutions' });

    // Get campuses for each institution
    const campusRes = await fetch(
      `${SUPABASE_URL}/rest/v1/campuses?select=id,institution_id,campus_name,address_state,address_suburb,monthly_cap,status`,
      { headers }
    );
    const campuses = await campusRes.json();

    // Get campus stats
    const statsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/campus_stats?select=campus_id,total_completed,total_started,total_sent,total_not_sent,total_sep,completions_this_month`,
      { headers }
    );
    const stats = await statsRes.json();

    // Merge data
    const statsMap = {};
    (Array.isArray(stats) ? stats : []).forEach(s => { statsMap[s.campus_id] = s; });

    const campusMap = {};
    (Array.isArray(campuses) ? campuses : []).forEach(c => {
      if (!campusMap[c.institution_id]) campusMap[c.institution_id] = [];
      campusMap[c.institution_id].push({ ...c, campus_stats: statsMap[c.id] ? [statsMap[c.id]] : [] });
    });

    // Filter by state if needed
    let result = (Array.isArray(institutions) ? institutions : []).map(inst => ({
      ...inst,
      campuses: campusMap[inst.id] || []
    }));

    if (state) {
      result = result.filter(inst => inst.campuses.some(c => c.address_state === state));
    }

    return res.status(200).json({ institutions: result });
  }

  // ── POST create institution + first campus ──
  if (req.method === 'POST') {
    const {
      name, institution_type, abn, website, school_number,
      primary_contact_name, primary_contact_email, primary_contact_mobile,
      billing_email, notes, status,
      campus_name, address_street, address_suburb, address_state,
      address_postcode, phone, monthly_cap
    } = req.body;

    if (!name || !institution_type || !primary_contact_name || !primary_contact_email) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Create institution
    const instRes = await fetch(`${SUPABASE_URL}/rest/v1/institutions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name, institution_type, abn, website, school_number,
        primary_contact_name, primary_contact_email, primary_contact_mobile,
        billing_email: billing_email || primary_contact_email,
        notes, status: status || 'trial',
        created_by: staff.name
      })
    });

    const instData = await instRes.json();
    if (!instRes.ok) return res.status(500).json({ error: instData.message || 'Failed to create institution' });
    const inst = Array.isArray(instData) ? instData[0] : instData;

    // Create first campus
    const campRes = await fetch(`${SUPABASE_URL}/rest/v1/campuses`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        institution_id: inst.id,
        campus_name: campus_name || name,
        address_street, address_suburb, address_state,
        address_postcode, phone,
        monthly_cap: monthly_cap || 1000,
        status: status || 'trial'
      })
    });

    const campData = await campRes.json();
    if (!campRes.ok) return res.status(500).json({ error: campData.message || 'Failed to create campus' });
    const campus = Array.isArray(campData) ? campData[0] : campData;

    return res.status(201).json({ ok: true, institution_id: inst.id, campus_id: campus.id });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
