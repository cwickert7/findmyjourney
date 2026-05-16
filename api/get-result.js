// api/get-result.js
// Retrieves saved Explorer results by UUID or short code
// Rate limited: 5 attempts per IP per 15 minutes

const RATE_LIMIT = 30;
const RATE_WINDOW = 60 * 15; // 15 minutes in seconds

async function upstashGet(key) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  return data.result ? JSON.parse(data.result) : null;
}

async function checkRateLimit(ip) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const key = `ratelimit:getresult:${ip}`;
  const res = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([
      ['INCR', key],
      ['EXPIRE', key, RATE_WINDOW]
    ])
  });
  const data = await res.json();
  const count = data[0]?.result || 0;
  return count <= RATE_LIMIT;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  const allowed = await checkRateLimit(ip);
  if (!allowed) {
    return res.status(429).json({ error: 'Too many attempts. Please try again in 15 minutes.' });
  }

  const { id, code } = req.query;

  try {
    let result = null;

    if (id) {
      // Direct UUID lookup
      result = await upstashGet(`result:${id}`);
    } else if (code) {
      // Short code lookup — find UUID first
      const cleanCode = code.toUpperCase().trim();
      const uuid = await upstashGet(`shortcode:${cleanCode}`);
      if (uuid) result = await upstashGet(`result:${uuid}`);
    }

    if (!result) {
      return res.status(404).json({ error: 'Results not found. The code may be incorrect or your results may have expired.' });
    }

    return res.status(200).json({ result });

  } catch (err) {
    console.error('get-result error:', err);
    return res.status(500).json({ error: 'Failed to retrieve results' });
  }
}
