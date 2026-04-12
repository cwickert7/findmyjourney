// api/institution-dashboard.js
// Returns all results for an institution code
// Auth: institution code + admin key (PIN) passed as query params

async function upstashGet(key) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  if (!data.result) return null;
  try { return JSON.parse(data.result); } catch { return data.result; }
}

async function upstashLRange(key, start, end) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const res = await fetch(`${url}/lrange/${encodeURIComponent(key)}/${start}/${end}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  return data.result || [];
}

async function upstashSet(key, value, ttl) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const body = ttl
    ? [['SET', key, JSON.stringify(value), 'EX', ttl]]
    : [['SET', key, JSON.stringify(value)]];
  await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

const VALID_KEYS = (process.env.DASHBOARD_ADMIN_KEYS || '').split(',').map(k => k.trim());

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { code, key, action, uuid, notes, seen } = req.method === 'POST'
    ? req.body
    : req.query;

  // Auth check
  if (!code || !key) return res.status(401).json({ error: 'Missing credentials' });
  const instCode = code.toUpperCase().trim();
  // Allow any key that matches env var, or if none set, allow any (dev mode)
  if (VALID_KEYS.length > 0 && VALID_KEYS[0] !== '' && !VALID_KEYS.includes(key)) {
    return res.status(401).json({ error: 'Invalid access key' });
  }

  // GET - fetch all results for institution
  if (req.method === 'GET' && !action) {
    try {
      const uuids = await upstashLRange(`institution:${instCode}:results`, 0, -1);
      if (!uuids || uuids.length === 0) {
        return res.status(200).json({ results: [], total: 0 });
      }
      // Fetch all results in parallel
      const results = await Promise.all(
        uuids.map(async (id) => {
          const result = await upstashGet(`result:${id}`);
          if (!result) return null;
          // Also get advisor metadata (notes, seen status)
          const meta = await upstashGet(`advisor:${instCode}:${id}`);
          return { ...result, advisorMeta: meta || { seen: false, notes: '' } };
        })
      );
      const filtered = results.filter(Boolean);
      return res.status(200).json({ results: filtered, total: filtered.length });
    } catch (err) {
      console.error('Dashboard GET error:', err);
      return res.status(500).json({ error: 'Failed to fetch results' });
    }
  }

  // POST - update advisor metadata (notes / seen status)
  if (req.method === 'POST' && action === 'update_meta') {
    if (!uuid) return res.status(400).json({ error: 'Missing uuid' });
    try {
      const existing = await upstashGet(`advisor:${instCode}:${uuid}`) || {};
      const updated = {
        ...existing,
        notes: notes !== undefined ? notes : existing.notes || '',
        seen: seen !== undefined ? seen : existing.seen || false,
        updatedAt: new Date().toISOString()
      };
      await upstashSet(`advisor:${instCode}:${uuid}`, updated, 60 * 60 * 24 * 365);
      return res.status(200).json({ ok: true, meta: updated });
    } catch (err) {
      console.error('Dashboard POST error:', err);
      return res.status(500).json({ error: 'Failed to update' });
    }
  }

  return res.status(400).json({ error: 'Invalid request' });
}
