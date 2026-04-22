// api/save-result.js
// Saves Explorer results to Upstash Redis with 12-month TTL
// Returns UUID (for link) and short code (for manual entry)

const TTL_SECONDS = 60 * 60 * 24 * 365; // 12 months

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function generateShortCode() {
  const chars = 'ABCDEFGHJKLMNPQRTUVWXYZ2346789'; // no 0/O/1/I/S/5
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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { name, matches, encouragement, summary, tips, sepTriggered, institutionCode, branch } = req.body;

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
      matches,          // full job objects with all fields for retrieval
      encouragement: encouragement || '',
      summary: summary || '',
      tips: tips || [],
      sepTriggered: !!sepTriggered,
      institutionCode: institutionCode || null,
      branch: branch || null,
      savedAt,
      version: 2
    };

    // Store main result by UUID
    await upstashSet(`result:${uuid}`, resultData, TTL_SECONDS);

    // Store short code lookup → UUID
    await upstashSet(`shortcode:${shortCode}`, uuid, TTL_SECONDS);

    // If institution code, append UUID to institution's result list
    if (institutionCode) {
      const instKey = `institution:${institutionCode.toUpperCase()}:results`;
      const url = process.env.UPSTASH_REDIS_REST_URL;
      const token = process.env.UPSTASH_REDIS_REST_TOKEN;
      // RPUSH to append, then set TTL
      await fetch(`${url}/pipeline`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify([
          ['RPUSH', instKey, uuid],
          ['EXPIRE', instKey, TTL_SECONDS]
        ])
      });
    }

    return res.status(200).json({ uuid, shortCode, savedAt });

  } catch (err) {
    console.error('save-result error:', err);
    return res.status(500).json({ error: 'Failed to save results' });
  }
}
