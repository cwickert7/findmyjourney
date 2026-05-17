// FILE: api/cv-get.js
// Retrieves a saved CV by UUID from Upstash Redis

async function upstashGet(key) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  return data.result ? JSON.parse(data.result) : null;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { uuid } = req.query;
  if (!uuid) return res.status(400).json({ error: 'Missing uuid' });

  // Basic UUID format validation
  if (!/^[0-9a-f-]{36}$/.test(uuid)) return res.status(400).json({ error: 'Invalid uuid' });

  try {
    const payload = await upstashGet(`cv:${uuid}`);
    if (!payload) return res.status(404).json({ error: 'CV not found. It may have expired.' });

    return res.status(200).json({
      ok: true,
      cv: payload.cv,
      path: payload.path,
      cv_html: payload.cv_html,
      has_cover_letter: !!payload.cover_letter,
      created_at: payload.created_at
    });

  } catch(e) {
    console.error('cv-get error:', e.message);
    return res.status(500).json({ error: 'Failed to retrieve CV. Please try again.' });
  }
}
