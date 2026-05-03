// FILE: api/gate.js
// Server-side auth gate — checks cookie before serving any page, redirects to password page if not authenticated

import { readFileSync } from 'fs';
import { join } from 'path';

// ── CONFIGURATION ──
// To change password: update PASSWORD and increment COOKIE_VERSION
// Incrementing version instantly revokes ALL existing sessions
const PASSWORD = 'fmj2026preview';
const COOKIE_VERSION = '1';
const COOKIE_NAME = `fmj_access_v${COOKIE_VERSION}`;
const COOKIE_VALUE = 'granted';

// Pages that bypass auth entirely
const PUBLIC_PATHS = ['/password.html', '/api/'];

export default async function handler(req, res) {
  const { path } = req.query;
  const requestPath = '/' + (Array.isArray(path) ? path.join('/') : path || '');

  // Always allow public paths through
  if (PUBLIC_PATHS.some(p => requestPath.startsWith(p))) {
    return res.status(200).end();
  }

  // Check cookie
  const cookies = req.headers.cookie || '';
  const isAuthenticated = cookies.includes(`${COOKIE_NAME}=${COOKIE_VALUE}`);

  if (!isAuthenticated) {
    // Redirect to password page
    const redirect = encodeURIComponent(requestPath);
    res.setHeader('Location', `/password.html?r=${redirect}`);
    return res.status(302).end();
  }

  // Authenticated — serve the requested file
  try {
    const filePath = join(process.cwd(), requestPath.endsWith('/') ? requestPath + 'index.html' : requestPath);
    const content = readFileSync(filePath, 'utf-8');
    const ext = requestPath.split('.').pop();
    const contentTypes = { html: 'text/html', js: 'application/javascript', css: 'text/css', json: 'application/json' };
    res.setHeader('Content-Type', contentTypes[ext] || 'text/plain');
    return res.status(200).send(content);
  } catch(e) {
    return res.status(404).send('Not found');
  }
}
