// api/admin/institution.js — GET one, PATCH update
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
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Campus ID required' });

  // ── GET one campus + parent institution + all sibling campuses ──
  if (req.method === 'GET') {
    const { data: campus, error: campErr } = await db
      .from('campuses')
      .select(`
        id, campus_name, address_street, address_suburb,
        address_state, address_postcode, phone,
        monthly_cap, status, created_at,
        institution_id,
        campus_stats (
          total_completed, total_started, total_sent,
          total_not_sent, total_sep, completions_this_month
        )
      `)
      .eq('id', id)
      .single();

    if (campErr) return res.status(404).json({ error: 'Campus not found' });

    // Get parent institution
    const { data: inst, error: instErr } = await db
      .from('institutions')
      .select('*')
      .eq('id', campus.institution_id)
      .single();

    if (instErr) return res.status(500).json({ error: instErr.message });

    // Get all campuses for this institution
    const { data: allCampuses } = await db
      .from('campuses')
      .select(`
        id, campus_name, address_state, address_suburb,
        monthly_cap, status,
        campus_stats (total_completed, completions_this_month)
      `)
      .eq('institution_id', campus.institution_id)
      .order('created_at');

    return res.status(200).json({
      campus,
      institution: inst,
      all_campuses: allCampuses || []
    });
  }

  // ── PATCH update campus status or cap ──
  if (req.method === 'PATCH') {
    const { field, value } = req.body;
    const allowed = ['status', 'monthly_cap'];
    if (!allowed.includes(field)) {
      return res.status(400).json({ error: 'Invalid field' });
    }

    const { error } = await db
      .from('campuses')
      .update({ [field]: value })
      .eq('id', id);

    if (error) return res.status(500).json({ error: error.message });

    // If status update, also update parent institution status
    if (field === 'status') {
      const { data: campus } = await db
        .from('campuses')
        .select('institution_id')
        .eq('id', id)
        .single();
      if (campus) {
        await db
          .from('institutions')
          .update({ status: value })
          .eq('id', campus.institution_id);
      }
    }

    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
