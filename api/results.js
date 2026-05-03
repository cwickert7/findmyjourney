// FILE: api/results.js
// POST saves a completed assessment result to Supabase, GET retrieves by redis_uuid or student_id

export default async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const dbHeaders = {
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };

  // ── GET result by redis_uuid or student_id ──
  if (req.method === 'GET') {
    const { redis_uuid, student_id } = req.query;
    let url = `${SUPABASE_URL}/rest/v1/assessment_results?select=*`;
    if (redis_uuid) url += `&redis_uuid=eq.${redis_uuid}`;
    else if (student_id) url += `&student_id=eq.${student_id}&order=completed_at.desc&limit=1`;
    else return res.status(400).json({ error: 'redis_uuid or student_id required' });

    const r = await fetch(url, { headers: dbHeaders });
    const data = await r.json();
    if (!data || data.length === 0) return res.status(404).json({ error: 'Result not found' });
    return res.status(200).json({ result: data[0] });
  }

  // ── POST save new result ──
  if (req.method === 'POST') {
    const {
      redis_uuid, campus_id, institution_id, student_id, session_type,
      first_name, last_name, email, state, city,
      branch, sep_flag, raw_answers, career_matches,
      summary, encouragement, tips
    } = req.body;

    if (!redis_uuid) return res.status(400).json({ error: 'redis_uuid required' });

    // Save to Supabase
    const saveRes = await fetch(`${SUPABASE_URL}/rest/v1/assessment_results`, {
      method: 'POST',
      headers: dbHeaders,
      body: JSON.stringify({
        redis_uuid,
        campus_id: campus_id || null,
        institution_id: institution_id || null,
        student_id: student_id || null,
        session_type: session_type || 'individual',
        first_name, last_name, email, state, city,
        branch, sep_flag: sep_flag || false,
        raw_answers: raw_answers || null,
        career_matches: career_matches || null,
        summary: summary || null,
        encouragement: encouragement || null,
        tips: tips || null,
        billing_triggered: false,
        completed_at: new Date().toISOString()
      })
    });

    const saveData = await saveRes.json();
    if (!saveRes.ok) return res.status(500).json({ error: saveData.message || 'Failed to save result' });

    const result = Array.isArray(saveData) ? saveData[0] : saveData;

    // If student_id present — update student record to completed + trigger billing
    if (student_id) {
      await fetch(`${SUPABASE_URL}/rest/v1/students?id=eq.${student_id}`, {
        method: 'PATCH',
        headers: dbHeaders,
        body: JSON.stringify({
          status: 'completed',
          completed_at: new Date().toISOString(),
          result_uuid: redis_uuid,
          branch: branch || null,
          sep_flag: sep_flag || false,
          billing_triggered: true
        })
      });

      // Also mark billing on result
      await fetch(`${SUPABASE_URL}/rest/v1/assessment_results?id=eq.${result.id}`, {
        method: 'PATCH',
        headers: dbHeaders,
        body: JSON.stringify({ billing_triggered: true })
      });
    }

    return res.status(201).json({ ok: true, result_id: result.id });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
