// FILE: api/admin/students.js
// GET all students across all institutions for FMJ admin view

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
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const staff = await verifyFMJStaff(token);
  if (!staff) return res.status(401).json({ error: 'Unauthorised' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const headers = {
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json'
  };

  try {
    const { search, status, branch, sep } = req.query;

    let url = `${SUPABASE_URL}/rest/v1/students?select=id,first_name,last_name,email,status,branch,sep_flag,campus_id,institution_id,result_uuid,completed_at,created_at&order=created_at.desc&limit=500`;

    if (status) url += `&status=eq.${status}`;
    if (branch) url += `&branch=eq.${branch}`;
    if (sep === 'true') url += `&sep_flag=eq.true`;

    const r = await fetch(url, { headers });
    const students = await r.json();
    if (!r.ok) return res.status(500).json({ error: students.message || 'Failed to load students' });

    // Filter by search if provided
    let result = Array.isArray(students) ? students : [];
    if (search) {
      const s = search.toLowerCase();
      result = result.filter(st =>
        (st.first_name || '').toLowerCase().includes(s) ||
        (st.last_name || '').toLowerCase().includes(s) ||
        (st.email || '').toLowerCase().includes(s)
      );
    }

    return res.status(200).json({ students: result });
  } catch (e) {
    console.error('Students error:', e.message);
    return res.status(500).json({ error: 'Failed to load students' });
  }
}
