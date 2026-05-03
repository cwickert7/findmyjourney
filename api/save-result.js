// FILE: api/save-result.js
// Saves Explorer results to Upstash Redis (for return links) AND Supabase (for dashboard and analytics)

const TTL_SECONDS = 60 * 60 * 24 * 365; // 12 months

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function generateShortCode() {
  const chars = 'ABCDEFGHJKLMNPQRTUVWXYZ2346789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

async function upstashSet(key, value, ttl) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const body = ttl
    ? ['SET', key, JSON.stringify(value), 'EX', ttl]
    : ['SET', key, JSON.stringify(value)];
  const res = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([body])
  });
  return res.ok;
}

async function saveToSupabase(payload) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;

  const dbHeaders = {
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/assessment_results`, {
      method: 'POST',
      headers: dbHeaders,
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) {
      console.error('Supabase save error:', data.message);
      return null;
    }
    const result = Array.isArray(data) ? data[0] : data;

    // If student_id present — update student record to completed and trigger billing
    if (payload.student_id) {
      await fetch(`${SUPABASE_URL}/rest/v1/students?id=eq.${payload.student_id}`, {
        method: 'PATCH',
        headers: dbHeaders,
        body: JSON.stringify({
          status: 'completed',
          completed_at: new Date().toISOString(),
          result_uuid: payload.redis_uuid,
          branch: payload.branch || null,
          sep_flag: payload.sep_flag || false,
          billing_triggered: true
        })
      });

      // Mark billing on result record
      await fetch(`${SUPABASE_URL}/rest/v1/assessment_results?id=eq.${result.id}`, {
        method: 'PATCH',
        headers: dbHeaders,
        body: JSON.stringify({ billing_triggered: true })
      });
    }

    return result;
  } catch(e) {
    console.error('Supabase save exception:', e.message);
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      name, matches, encouragement, summary, tips,
      sepTriggered, institutionCode, branch,
      // New fields for Supabase
      firstName, lastName, email, state, city,
      campus_id, institution_id, student_id,
      session_type, raw_answers, assessment_version
    } = req.body;

    if (!name || !matches || !Array.isArray(matches)) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const uuid = generateUUID();
    const shortCode = generateShortCode();
    const savedAt = new Date().toISOString();

    const resultData = {
      uuid,
      shortCode,
      name,
      matches,
      encouragement: encouragement || '',
      summary: summary || '',
      tips: tips || [],
      sepTriggered: !!sepTriggered,
      institutionCode: institutionCode || null,
      branch: branch || null,
      savedAt,
      version: 2
    };

    // ── Save to Redis (existing — keeps return links working) ──
    await upstashSet(`result:${uuid}`, resultData, TTL_SECONDS);
    await upstashSet(`shortcode:${shortCode}`, uuid, TTL_SECONDS);

    if (institutionCode) {
      const instKey = `institution:${institutionCode.toUpperCase()}:results`;
      const url = process.env.UPSTASH_REDIS_REST_URL;
      const token = process.env.UPSTASH_REDIS_REST_TOKEN;
      await fetch(`${url}/pipeline`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify([
          ['RPUSH', instKey, uuid],
          ['EXPIRE', instKey, TTL_SECONDS]
        ])
      });
    }

    // ── Save to Supabase (new — for dashboard and analytics) ──
    const supabasePayload = {
      redis_uuid: uuid,
      campus_id: campus_id || null,
      institution_id: institution_id || null,
      student_id: student_id || null,
      session_type: session_type || 'individual',
      first_name: firstName || name || null,
      last_name: lastName || null,
      email: email || null,
      state: state || null,
      city: city || null,
      branch: branch || null,
      sep_flag: !!sepTriggered,
      raw_answers: raw_answers || null,
      career_matches: matches || null,
      summary: summary || null,
      encouragement: encouragement || null,
      tips: tips || null,
      assessment_version: assessment_version || 'v2',
      billing_triggered: false,
      completed_at: savedAt
    };

    await saveToSupabase(supabasePayload);

    return res.status(200).json({ uuid, shortCode, savedAt });

  } catch (err) {
    console.error('save-result error:', err);
    return res.status(500).json({ error: 'Failed to save results' });
  }
}
