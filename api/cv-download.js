// FILE: api/cv-download.js
// Generates downloadable CV files (PDF, DOCX) and cover letter from saved CV data
// Uses puppeteer-core for PDF and docx library for Word format

async function upstashGet(key) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  return data.result ? JSON.parse(data.result) : null;
}

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function buildFullHTML(cvHTML, name) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(name)} — CV</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;font-size:11px;line-height:1.6;color:#1a1a1a;background:#fff;padding:40px 48px}
  @media print{body{padding:0}}
</style>
</head>
<body>
${cvHTML}
</body>
</html>`;
}

function buildCoverHTML(name, coverText) {
  const paragraphs = coverText.split(/\n\n+/).filter(Boolean);
  const paras = paragraphs.map(p => `<p style="margin-bottom:12px;font-size:11px;line-height:1.6;color:#1a1a1a">${esc(p)}</p>`).join('');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${esc(name)} — Cover Letter</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;font-size:11px;line-height:1.6;color:#1a1a1a;background:#fff;padding:48px 56px}
</style>
</head>
<body>
<div style="margin-bottom:28px">
  <div style="font-size:18px;font-weight:700;color:#1a1a1a;margin-bottom:4px">${esc(name)}</div>
  <div style="font-size:10px;color:#C4714A;letter-spacing:.06em;text-transform:uppercase;border-bottom:2px solid #C4714A;padding-bottom:8px;margin-bottom:20px">Cover Letter</div>
</div>
${paras}
<div style="margin-top:28px;font-size:11px;color:#1a1a1a">
  <p>Yours sincerely,</p>
  <p style="margin-top:20px;font-weight:700">${esc(name)}</p>
</div>
<div style="margin-top:48px;font-size:9px;color:#C8BFB5;border-top:1px solid #E8DFD0;padding-top:8px">Generated with Find My Journey CV Builder — findmyjourney.com.au</div>
</body>
</html>`;
}

async function generatePDF(html) {
  // Use Vercel's built-in Chromium via @sparticuz/chromium
  let chromium, puppeteer;
  try {
    chromium = require('@sparticuz/chromium');
    puppeteer = require('puppeteer-core');
  } catch(e) {
    throw new Error('PDF generation dependencies not installed');
  }

  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });

  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  const pdf = await page.pdf({
    format: 'A4',
    margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' },
    printBackground: true
  });
  await browser.close();
  return pdf;
}

function buildDocxFromCV(payload) {
  // Build a simple DOCX-compatible HTML that Word can open
  // Returns an HTML blob that Word accepts natively
  const cv = payload.cv || {};
  const name = `${cv.first_name || ''} ${cv.last_name || ''}`.trim();
  const enhanced = payload.enhanced || {};

  const mhtml = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head><meta charset='utf-8'><title>${esc(name)} CV</title>
<style>
  body{font-family:Arial,sans-serif;font-size:11pt;margin:2.5cm}
  h1{font-size:18pt;color:#1a1a1a;margin-bottom:4pt}
  .contact{font-size:9pt;color:#6B6058;border-bottom:2pt solid #C4714A;padding-bottom:6pt;margin-bottom:12pt}
  h2{font-size:9pt;font-weight:bold;letter-spacing:.06em;text-transform:uppercase;color:#C4714A;border-bottom:1pt solid #E8DFD0;padding-bottom:2pt;margin-top:14pt;margin-bottom:6pt}
  .item-head{display:flex;justify-content:space-between}
  .item-title{font-size:10pt;font-weight:bold}
  .item-date{font-size:9pt;color:#9A8E84}
  .item-org{font-size:9pt;color:#6B6058}
  p,li{font-size:10pt;color:#1a1a1a;margin-bottom:3pt}
  .profile{font-size:10pt;line-height:1.5}
  .skill{display:inline-block;background:#FAF7F2;border:1pt solid #E8DFD0;padding:2pt 5pt;margin:2pt;font-size:9pt}
</style></head>
<body>
${payload.cv_html || ''}
<p style="margin-top:40pt;font-size:8pt;color:#C8BFB5">Generated with Find My Journey CV Builder — findmyjourney.com.au</p>
</body></html>`;

  return Buffer.from(mhtml, 'utf-8');
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { uuid, format } = req.query;
  if (!uuid || !format) return res.status(400).json({ error: 'Missing uuid or format' });
  if (!/^[0-9a-f-]{36}$/.test(uuid)) return res.status(400).json({ error: 'Invalid uuid' });
  if (!['pdf','docx','cover'].includes(format)) return res.status(400).json({ error: 'Invalid format' });

  try {
    const payload = await upstashGet(`cv:${uuid}`);
    if (!payload) return res.status(404).json({ error: 'CV not found' });

    const cv = payload.cv || {};
    const name = `${cv.first_name || ''} ${cv.last_name || ''}`.trim() || 'CV';

    if (format === 'pdf') {
      try {
        const html = buildFullHTML(payload.cv_html || '', name);
        const pdf = await generatePDF(html);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${name.replace(/\s+/g,'-')}-CV.pdf"`);
        return res.status(200).send(pdf);
      } catch(pdfErr) {
        console.error('PDF generation error:', pdfErr.message);
        // Fallback: return HTML for the browser to print-to-PDF
        res.setHeader('Content-Type', 'text/html');
        return res.status(200).send(buildFullHTML(payload.cv_html || '', name) + '<script>window.onload=function(){window.print();}</script>');
      }
    }

    if (format === 'docx') {
      const docxBuf = buildDocxFromCV(payload);
      res.setHeader('Content-Type', 'application/msword');
      res.setHeader('Content-Disposition', `attachment; filename="${name.replace(/\s+/g,'-')}-CV.doc"`);
      return res.status(200).send(docxBuf);
    }

    if (format === 'cover') {
      if (!payload.cover_letter) {
        return res.status(404).json({ error: 'No cover letter found for this CV' });
      }
      try {
        const html = buildCoverHTML(name, payload.cover_letter);
        const pdf = await generatePDF(html);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${name.replace(/\s+/g,'-')}-Cover-Letter.pdf"`);
        return res.status(200).send(pdf);
      } catch(pdfErr) {
        // Fallback: return HTML
        res.setHeader('Content-Type', 'text/html');
        return res.status(200).send(buildCoverHTML(name, payload.cover_letter) + '<script>window.onload=function(){window.print();}</script>');
      }
    }

  } catch(e) {
    console.error('cv-download error:', e.message);
    return res.status(500).json({ error: 'Download failed. Please try again.' });
  }
}
