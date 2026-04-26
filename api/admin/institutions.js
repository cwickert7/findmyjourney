// api/admin/institutions.js
import { createClient } from '@supabase/supabase-js';

function adminClient() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

async function verifyFMJStaff(token) {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  const { data } = await adminClient()
    .from('fmj_staff')
    .select('id, name, role')
    .eq('auth_user_id', user.id)
    .eq('is_active', true)
    .single();
  return data || null;
}

export default async function handler(req, res) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const staff = await verifyFMJStaff(token);
  if (!staff) return res.status(401).json({ error: 'Unauthorised' });

  const db = adminClient();

  // ── GET all institutions ──
  if (req.method === 'GET') {
    const { search, type, status, state } = req.query;

    let query = db
      .from('institutions')
      .select(`
        id, name, institution_type, status,
        primary_contact_name, primary_contact_email,
        abn, school_number, created_at, created_by,
        campuses (
          id, campus_name, address_state, address_suburb,
          monthly_cap, status,
          campus_stats (
            total_completed, completions_this_month,
            total_started, total_sent, total_not_sent, total_sep
          )
        )
      `)
      .order('created_at', { ascending: false });

    if (search) {
      query = query.or(`name.ilike.%${search}%,primary_contact_email.ilike.%${search}%`);
    }
    if (type) query = query.eq('institution_type', type);
    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    // Filter by state if provided (state is on campus not institution)
    let result = data;
    if (state) {
      result = data.filter(inst =>
        inst.campuses && inst.campuses.some(c => c.address_state === state)
      );
    }

    return res.status(200).json({ institutions: result });
  }

  // ── POST create new institution + first campus ──
  if (req.method === 'POST') {
    const {
      // Institution fields
      name, institution_type, abn, website, school_number,
      primary_contact_name, primary_contact_email, primary_contact_mobile,
      billing_email, notes, status,
      // Campus fields
      campus_name, address_street, address_suburb, address_state,
      address_postcode, phone, monthly_cap
    } = req.body;

    if (!name || !institution_type || !primary_contact_name || !primary_contact_email) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Create institution
    const { data: inst, error: instErr } = await db
      .from('institutions')
      .insert({
        name, institution_type, abn, website, school_number,
        primary_contact_name, primary_contact_email, primary_contact_mobile,
        billing_email: billing_email || primary_contact_email,
        notes, status: status || 'trial',
        created_by: staff.name
      })
      .select()
      .single();

    if (instErr) return res.status(500).json({ error: instErr.message });

    // Create first campus
    const { data: campus, error: campErr } = await db
      .from('campuses')
      .insert({
        institution_id: inst.id,
        campus_name: campus_name || name,
        address_street, address_suburb, address_state,
        address_postcode, phone,
        monthly_cap: monthly_cap || 1000,
        status: status || 'trial'
      })
      .select()
      .single();

    if (campErr) return res.status(500).json({ error: campErr.message });

    return res.status(201).json({
      ok: true,
      institution_id: inst.id,
      campus_id: campus.id
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
