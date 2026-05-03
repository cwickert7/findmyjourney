// FILE: api/set-password.js
// Validates password submission and sets auth cookie server-side

const PASSWORD = 'fmj2026preview';
const COOKIE_VERSION = '1';
const COOKIE_NAME = `fmj_access_v${COOKIE_VERSION}`;

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password, redirect } = req.body;

  if (password === PASSWORD) {
    // Set httpOnly cookie — cannot be read or tampered with by JavaScript
    res.setHeader('Set-Cookie', 
      `${COOKIE_NAME}=granted; Path=/; Max-Age=604800; SameSite=Lax; HttpOnly`
    );
    return res.status(200).json({ ok: true, redirect: redirect || '/' });
  } else {
    return res.status(401).json({ error: 'Incorrect password' });
  }
}
