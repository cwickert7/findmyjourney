// FILE: api/cv-generate.js
// Generates CV content and optional cover letter using Claude AI
// Saves result to Upstash Redis and returns UUID + preview HTML

const TTL_SECONDS = 60 * 60 * 24 * 365 * 2; // 2 years

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
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

function buildCVPrompt(cv, path, assessment) {
  const name = `${cv.first_name || ''} ${cv.last_name || ''}`.trim();
  const profile = cv.profile || cv.profile_draft || (assessment && assessment.summary) || '';
  const softSkills = (cv.soft_skills || []).join(', ');
  const hardSkills = cv.hard_skills || '';
  const exp = (cv.experience || []).map(e =>
    `${e.role} at ${e.employer} (${e.start || ''} – ${e.end || ''}): ${e.duties || ''}`
  ).join('\n');
  const edu = path === 'school'
    ? `${cv.school_name || ''}, ${cv.school_year || ''}`
    : path === 'leaver'
    ? `${cv.school_name || ''}, finished ${cv.school_year || ''}`
    : (cv.education || []).map(e => `${e.qualification} — ${e.institution} (${e.year})`).join('\n');
  const sports = (cv.sport_blocks || []).map(s => `${s.role} — ${s.name} (${s.start || ''}–${s.end || ''})`).join(', ');
  const volunteers = (cv.volunteer_blocks || []).map(v => `${v.role} at ${v.org} ${v.period || ''}`).join(', ');
  const langs = (cv.language_blocks || []).map(l => `${l.language} (${l.proficiency})`).join(', ');
  const certs = (cv.cert_blocks || []).map(c => `${c.name}${c.issuer ? ' — ' + c.issuer : ''}${c.year ? ' (' + c.year + ')' : ''}`).join(', ');

  return `You are an expert Australian CV writer specialising in young people aged 15–25. Write a professional, warm, honest CV for the following Explorer. Use Australian English. Do not fabricate any experience, qualifications or skills not provided.

EXPLORER DETAILS:
Name: ${name}
Path: ${path}
Profile: ${profile}
Education: ${edu}
Experience: ${exp || 'None provided'}
Soft skills: ${softSkills || 'Not specified'}
Hard skills: ${hardSkills || 'Not specified'}
Languages: ${langs || 'English only'}
Certifications: ${certs || 'None'}
Sport/activities: ${sports || 'None'}
Volunteering: ${volunteers || 'None'}
Responsibilities at home: ${cv.responsibilities || 'None'}
Other activities: ${cv.other_activities || 'None'}
Proud moment: ${cv.proud_moment || 'Not provided'}
Achievements: ${cv.achievements || 'None'}
Extracurricular: ${cv.extracurricular || 'None'}
Assessment insights: ${assessment ? `Career matches: ${JSON.stringify(assessment.careerJobs || []).substring(0,200)}` : 'None'}

INSTRUCTIONS:
1. Write a polished professional profile (3–4 sentences) that is specific to this Explorer — not generic. Draw on their actual strengths, path and goals.
2. For each experience entry, write 2–3 strong bullet points using action verbs if duties are thin or generic.
3. If life skills (sport, volunteering, responsibilities) are provided, weave them into a skills or activities section.
4. Keep tone warm, confident and honest — appropriate for a young Australian job seeker.
5. Return ONLY valid JSON, no markdown, no preamble.

Return this exact JSON structure:
{
  "profile": "3-4 sentence professional profile",
  "experience_enhanced": [{"employer": "", "role": "", "start": "", "end": "", "bullets": ["bullet1", "bullet2", "bullet3"]}],
  "skills_section": ["skill1", "skill2"],
  "activities_section": "formatted activities paragraph or empty string",
  "cv_html": "complete CV as styled HTML using inline styles, clean professional layout with FMJ terracotta (#C4714A) section headings"
}`;
}

function buildCoverLetterPrompt(cv, assessment, jd) {
  const name = `${cv.first_name || ''} ${cv.last_name || ''}`.trim();
  const profile = cv.profile || cv.profile_draft || (assessment && assessment.summary) || '';
  const exp = (cv.experience || []).map(e =>
    `${e.role} at ${e.employer} (${e.start || ''} – ${e.end || ''})`
  ).join(', ');

  return `You are an expert Australian career writer. Write a professional, specific cover letter for ${name} applying for the role described below. Use Australian English. Be specific, warm and confident. Do not fabricate anything not in the Explorer's profile.

EXPLORER PROFILE:
${profile}

EXPERIENCE: ${exp || 'Limited — focus on potential and transferable skills'}
SKILLS: ${(cv.soft_skills || []).join(', ')}
PROUD MOMENT: ${cv.proud_moment || ''}
ACHIEVEMENTS: ${cv.achievements || ''}

JOB DESCRIPTION:
${jd}

INSTRUCTIONS:
- Opening paragraph: hook that references the specific role and why this Explorer is genuinely interested
- Middle paragraph(s): match their actual experience and skills to the role requirements — be specific
- Closing: confident, action-oriented, Australian in tone
- Length: 3–4 paragraphs, no more than 350 words
- Return ONLY the cover letter text, no subject line, no date, no address block — just the body paragraphs`;
}

function buildCVHTML(cv, enhanced, path) {
  const name = `${cv.first_name || ''} ${cv.last_name || ''}`.trim();
  const contact = [cv.phone, cv.email, cv.suburb && cv.state ? `${cv.suburb}, ${cv.state}` : null, cv.linkedin].filter(Boolean).join(' | ');

  let html = `<div style="font-family:'Arial',sans-serif;font-size:11px;line-height:1.6;color:#1a1a1a;max-width:595px;margin:0 auto">`;

  // Header
  html += `<div style="margin-bottom:12px"><div style="font-size:22px;font-weight:700;color:#1a1a1a;margin-bottom:2px">${esc(name)}</div>`;
  html += `<div style="font-size:10px;color:#6B6058;border-bottom:2px solid #C4714A;padding-bottom:8px">${esc(contact)}</div></div>`;

  // Profile
  const profile = enhanced.profile || cv.profile || cv.profile_draft || '';
  if (profile) {
    html += section('Professional Profile');
    html += `<p style="margin:0 0 8px;font-size:10px;color:#2C2422;line-height:1.6">${esc(profile)}</p>`;
  }

  // Education
  html += section('Education');
  if (path === 'school' || path === 'leaver') {
    html += cvItem(cv.school_name, cv.school_year || cv.school_grad || '', '', '');
    if (cv.subjects && cv.subjects.length) {
      html += `<div style="font-size:9px;color:#6B6058;margin-bottom:4px">Subjects: ${cv.subjects.join(', ')}</div>`;
    }
    if (cv.school_achievements) {
      html += `<div style="font-size:9px;color:#2C2422;margin-bottom:4px">${esc(cv.school_achievements)}</div>`;
    }
    if (cv.further_study) {
      html += `<div style="font-size:9px;color:#2C2422;margin-bottom:4px">${esc(cv.further_study)}</div>`;
    }
  } else {
    (cv.education || []).forEach(function(e) {
      const qual = `${e.qualification || ''}${e.major ? ' (' + e.major + ')' : ''}`;
      html += cvItem(qual, e.year || '', e.institution || '', '');
    });
  }

  // Experience
  const expBlocks = enhanced.experience_enhanced || cv.experience || [];
  if (expBlocks.length > 0) {
    html += section('Experience');
    expBlocks.forEach(function(e) {
      const dateRange = [e.start, e.end].filter(Boolean).join(' \u2013 ');
      html += cvItem(e.role || '', dateRange, e.employer || '', '');
      if (e.bullets && e.bullets.length) {
        html += '<ul style="margin:3px 0 8px 16px;padding:0">';
        e.bullets.forEach(function(b) { html += `<li style="font-size:9px;color:#2C2422;margin-bottom:2px">${esc(b)}</li>`; });
        html += '</ul>';
      } else if (e.duties) {
        html += `<div style="font-size:9px;color:#2C2422;margin-bottom:6px">${esc(e.duties)}</div>`;
      }
    });
  }

  // Skills
  const allSkills = (enhanced.skills_section || []).concat(
    (cv.soft_skills || []),
    (cv.hard_skills || '').split(',').map(s => s.trim()).filter(Boolean)
  );
  const uniqueSkills = allSkills.filter((s, i) => allSkills.indexOf(s) === i).slice(0, 16);
  if (uniqueSkills.length > 0) {
    html += section('Skills');
    html += `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px">`;
    uniqueSkills.forEach(function(s) {
      html += `<span style="background:#FAF7F2;border:1px solid #E8DFD0;border-radius:3px;padding:2px 6px;font-size:9px;color:#2C2422">${esc(s)}</span>`;
    });
    html += '</div>';
  }

  // Languages
  if (cv.language_blocks && cv.language_blocks.length > 0) {
    html += section('Languages');
    html += `<div style="font-size:9px;color:#2C2422;margin-bottom:8px">${cv.language_blocks.map(l => `${l.language} — ${l.proficiency}`).map(esc).join(' | ')}</div>`;
  }

  // Activities
  const hasActivities = (cv.sport_blocks && cv.sport_blocks.length) || (cv.volunteer_blocks && cv.volunteer_blocks.length) || cv.extracurricular || cv.other_activities;
  if (hasActivities) {
    html += section('Activities & Interests');
    if (cv.sport_blocks && cv.sport_blocks.length) {
      cv.sport_blocks.forEach(function(s) {
        html += `<div style="font-size:9px;color:#2C2422;margin-bottom:2px">${esc(s.role + ' \u2014 ' + s.name + (s.start ? ' (' + s.start + (s.end ? '\u2013' + s.end : '') + ')' : ''))}</div>`;
      });
    }
    if (cv.volunteer_blocks && cv.volunteer_blocks.length) {
      cv.volunteer_blocks.forEach(function(v) {
        html += `<div style="font-size:9px;color:#2C2422;margin-bottom:2px">${esc(v.role + ' \u2014 ' + v.org + (v.period ? ' (' + v.period + ')' : ''))}</div>`;
      });
    }
    if (cv.extracurricular) {
      html += `<div style="font-size:9px;color:#2C2422;margin-bottom:2px">${esc(cv.extracurricular)}</div>`;
    }
    if (cv.other_activities) {
      html += `<div style="font-size:9px;color:#2C2422;margin-bottom:2px">${esc(cv.other_activities)}</div>`;
    }
    html += '<div style="margin-bottom:8px"></div>';
  }

  // Certifications
  if (cv.cert_blocks && cv.cert_blocks.length > 0) {
    html += section('Certifications & Licences');
    cv.cert_blocks.forEach(function(c) {
      html += `<div style="font-size:9px;color:#2C2422;margin-bottom:2px">${esc(c.name)}${c.issuer ? ' \u2014 ' + esc(c.issuer) : ''}${c.year ? ' (' + c.year + ')' : ''}</div>`;
    });
    html += '<div style="margin-bottom:8px"></div>';
  }

  // Achievements
  if (cv.achievements) {
    html += section('Achievements');
    html += `<div style="font-size:9px;color:#2C2422;margin-bottom:8px">${esc(cv.achievements)}</div>`;
  }

  // Referees
  if (cv.referees && cv.referees.length > 0) {
    html += section('Referees');
    cv.referees.forEach(function(r) {
      if (!r.name) return;
      html += `<div style="margin-bottom:6px">`;
      html += `<div style="font-size:9px;font-weight:700;color:#1a1a1a">${esc(r.name)}${r.title ? ' \u2014 ' + esc(r.title) : ''}</div>`;
      if (r.org) html += `<div style="font-size:9px;color:#6B6058">${esc(r.org)}</div>`;
      const contact2 = [r.phone, r.email].filter(Boolean).map(esc).join(' | ');
      if (contact2) html += `<div style="font-size:9px;color:#9A8E84">${contact2}</div>`;
      html += '</div>';
    });
  }

  html += '</div>';
  return html;
}

function section(title) {
  return `<div style="font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#C4714A;border-bottom:1px solid #E8DFD0;padding-bottom:3px;margin:12px 0 7px">${title}</div>`;
}

function cvItem(title, date, org, body) {
  let h = `<div style="margin-bottom:6px">`;
  h += `<div style="display:flex;justify-content:space-between;align-items:baseline">`;
  h += `<span style="font-size:10px;font-weight:700;color:#1a1a1a">${esc(title)}</span>`;
  h += `<span style="font-size:9px;color:#9A8E84">${esc(date)}</span>`;
  h += '</div>';
  if (org) h += `<div style="font-size:9px;color:#6B6058;margin-bottom:2px">${esc(org)}</div>`;
  if (body) h += `<div style="font-size:9px;color:#2C2422">${esc(body)}</div>`;
  h += '</div>';
  return h;
}

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { cv, path, assessment, hasJD } = req.body;
  if (!cv || !path) return res.status(400).json({ error: 'Missing required fields' });

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'API not configured' });

  try {
    // ── Step 1: Generate CV content ──
    const cvPrompt = buildCVPrompt(cv, path, assessment);
    const cvRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2500,
        messages: [{ role: 'user', content: cvPrompt }]
      })
    });

    if (!cvRes.ok) {
      const err = await cvRes.text();
      console.error('Claude CV error:', err);
      return res.status(500).json({ error: 'Failed to generate CV. Please try again.' });
    }

    const cvData = await cvRes.json();
    let enhanced = {};
    try {
      const raw = cvData.content[0].text.replace(/```json|```/g, '').trim();
      enhanced = JSON.parse(raw);
    } catch(e) {
      console.error('CV JSON parse error:', e.message);
      enhanced = {};
    }

    // ── Step 2: Generate cover letter if JD provided ──
    let coverLetterText = null;
    if (hasJD && cv.jd && cv.jd.trim().length > 20) {
      const clPrompt = buildCoverLetterPrompt(cv, assessment, cv.jd);
      const clRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 800,
          messages: [{ role: 'user', content: clPrompt }]
        })
      });
      if (clRes.ok) {
        const clData = await clRes.json();
        coverLetterText = clData.content[0].text.trim();
      }
    }

    // ── Step 3: Build CV HTML ──
    const cvHTML = enhanced.cv_html || buildCVHTML(cv, enhanced, path);

    // ── Step 4: Save to Redis ──
    const uuid = generateUUID();
    const payload = {
      uuid,
      cv,
      path,
      enhanced,
      cover_letter: coverLetterText,
      cv_html: cvHTML,
      created_at: new Date().toISOString()
    };

    await upstashSet(`cv:${uuid}`, payload, TTL_SECONDS);

    return res.status(200).json({
      ok: true,
      uuid,
      cv_html: cvHTML,
      has_cover_letter: !!coverLetterText
    });

  } catch(e) {
    console.error('cv-generate error:', e.message);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
