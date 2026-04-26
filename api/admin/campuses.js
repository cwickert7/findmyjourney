// api/admin/campuses.js — add additional campus to existing institution
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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const staff = await verifyFMJStaff(token);
  if (!staff) return res.status(401).json({ error: 'Unauthorised' });

  const {
    institution_id, campus_name, address_street, address_suburb,
    address_state, address_postcode, phone, monthly_cap, status
  } = req.body;

  if (!institution_id || !campus_name) {
    return res.status(400).json({ error: 'institution_id and campus_name required' });
  }

  const db = adminClient();

  // Verify institution exists
  const { data: inst } = await db
    .from('institutions')
    .select('id, name')
    .eq('id', institution_id)
    .single();

  if (!inst) return res.status(404).json({ error: 'Institution not found' });

  const { data: campus, error } = await db
    .from('campuses')
    .insert({
      institution_id,
      campus_name,
      address_street, address_suburb, address_state,
      address_postcode, phone,
      monthly_cap: monthly_cap || 1000,
      status: status || 'trial'
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  return res.status(201).json({ ok: true, campus_id: campus.id });
}
