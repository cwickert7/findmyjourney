// FILE: api/portal/students.js
// GET students, POST add student and send assessment invite link, handles duplicate detection and cap checks

// api/portal/students.js — GET students, POST add student, send invite link
async function verifyPortalUser(token) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${token}` }
  });
  if (!userRes.ok) return null;
  const userData = await userRes.json();
  if (!userData.id) return null;
  const instUserRes = await fetch(
    `${SUPABASE_URL}/rest/v1/institution_users?auth_user_id=eq.${userData.id}&is_active=eq.true&select=id,name,role,campus_id,institution_id`,
    { headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` } }
  );
  const instUsers = await instUserRes.json();
  return instUsers && instUsers.length > 0 ? instUsers[0] : null;
}

export default async function handler(req, res) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const portalUser = await verifyPortalUser(token);
  if (!portalUser) return res.status(401).json({ error: 'Unauthorised' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const dbHeaders = {
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };

  // ── GET students ──
  if (req.method === 'GET') {
    const { campus_id, status, year_level } = req.query;
    const targetCampus = campus_id || portalUser.campus_id;

    // Practitioners only see their own students
    let url = `${SUPABASE_URL}/rest/v1/students?campus_id=eq.${targetCampus}&select=id,first_name,last_name,email,year_level,status,sep_flag,branch,link_sent_at,completed_at,billing_triggered,uploaded_by&order=created_at.desc`;

    if (portalUser.role === 'practitioner') {
      url += `&or=(uploaded_by.eq.${portalUser.id},also_visible_to.cs.{${portalUser.id}})`;
    }
    if (status) url += `&status=eq.${status}`;
    if (year_level) url += `&year_level=eq.${year_level}`;

    const r = await fetch(url, { headers: dbHeaders });
    const students = await r.json();
    return res.status(200).json({ students: Array.isArray(students) ? students : [] });
  }

  // ── POST add student and send link ──
  if (req.method === 'POST') {
    const { first_name, last_name, email, year_level, send_link, fmj_issued } = req.body;

    if (!first_name || !last_name || !email) {
      return res.status(400).json({ error: 'First name, last name and email required' });
    }

    // Check monthly cap (skip for FMJ-issued)
    if (!fmj_issued) {
      const statsRes = await fetch(
        `${SUPABASE_URL}/rest/v1/campus_stats?campus_id=eq.${portalUser.campus_id}&select=completions_this_month`,
        { headers: dbHeaders }
      );
      const statsData = await statsRes.json();
      const campusRes = await fetch(
        `${SUPABASE_URL}/rest/v1/campuses?id=eq.${portalUser.campus_id}&select=monthly_cap`,
        { headers: dbHeaders }
      );
      const campusData = await campusRes.json();
      const cap = campusData && campusData[0] ? campusData[0].monthly_cap : 1000;
      const used = statsData && statsData[0] ? statsData[0].completions_this_month : 0;
      if (used >= cap) {
        return res.status(429).json({ error: `Monthly cap of ${cap} reached. Contact Find My Journey to increase your limit.` });
      }
    }

    // Check for recent duplicate (sent in last 90 days)
    const dupeRes = await fetch(
      `${SUPABASE_URL}/rest/v1/students?campus_id=eq.${portalUser.campus_id}&email=eq.${encodeURIComponent(email)}&select=id,first_name,last_name,link_sent_at,status`,
      { headers: dbHeaders }
    );
    const dupeData = await dupeRes.json();
    if (dupeData && dupeData.length > 0) {
      const existing = dupeData[0];
      const sentAt = existing.link_sent_at ? new Date(existing.link_sent_at) : null;
      const daysSince = sentAt ? Math.floor((Date.now() - sentAt.getTime()) / (1000 * 60 * 60 * 24)) : 999;
      if (daysSince < 90) {
        return res.status(409).json({
          error: 'duplicate',
          message: `A link was sent to ${first_name} ${last_name} on ${sentAt.toLocaleDateString('en-AU')} (${daysSince} days ago). Are you sure you want to send a new one?`,
          existing_id: existing.id,
          days_since: daysSince
        });
      }
    }

    // Generate unique link UUID
    const linkUuid = crypto.randomUUID ? crypto.randomUUID() : generateUUID();

    // Create or update student record
    let studentId;
    if (dupeData && dupeData.length > 0) {
      // Update existing — store previous link
      const existingId = dupeData[0].id;
      const prevLinkUuid = dupeData[0].link_uuid;
      await fetch(`${SUPABASE_URL}/rest/v1/students?id=eq.${existingId}`, {
        method: 'PATCH',
        headers: dbHeaders,
        body: JSON.stringify({
          link_uuid: linkUuid,
          prior_link_uuid: prevLinkUuid,
          link_sent_at: new Date().toISOString(),
          status: 'sent',
          also_visible_to: [portalUser.id]
        })
      });
      studentId = existingId;
    } else {
      // Create new student
      const createRes = await fetch(`${SUPABASE_URL}/rest/v1/students`, {
        method: 'POST',
        headers: dbHeaders,
        body: JSON.stringify({
          campus_id: portalUser.campus_id,
          institution_id: portalUser.institution_id,
          uploaded_by: portalUser.id,
          first_name, last_name, email,
          year_level: year_level || null,
          link_uuid: linkUuid,
          link_sent_at: new Date().toISOString(),
          status: 'sent',
          billing_triggered: false
        })
      });
      const createData = await createRes.json();
      studentId = Array.isArray(createData) ? createData[0].id : createData.id;
    }

    // Send assessment link email
    if (send_link !== false) {
      const SITE_URL = process.env.SITE_URL || 'https://findmyjourney.com.au';
      const assessmentLink = `${SITE_URL}?student=${linkUuid}&first=${encodeURIComponent(first_name)}&last=${encodeURIComponent(last_name)}`;

      // Get institution name
      const instRes = await fetch(
        `${SUPABASE_URL}/rest/v1/institutions?id=eq.${portalUser.institution_id}&select=name`,
        { headers: dbHeaders }
      );
      const instData = await instRes.json();
      const instName = instData && instData[0] ? instData[0].name : 'your school';

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`
        },
        body: JSON.stringify({
          from: 'Find My Journey <onboarding@resend.dev>',
          to: [email],
          subject: `${instName} has invited you to Find My Journey`,
          html: `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#F5F0E8;padding:32px">
            <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;border:1px solid #E8DFD0">
              <div style="font-family:Georgia,serif;font-size:20px;color:#2C2422;margin-bottom:20px">Find My Journey</div>
              <h1 style="font-family:Georgia,serif;font-size:26px;font-weight:400;color:#2C2422;margin:0 0 14px">Hi ${first_name},</h1>
              <p style="font-size:15px;color:#6B6058;line-height:1.7;margin:0 0 14px"><strong>${instName}</strong> has invited you to discover your career direction with Find My Journey.</p>
              <p style="font-size:14px;color:#6B6058;line-height:1.7;margin:0 0 24px">It takes about 20 minutes. There are no right or wrong answers — just honest questions about who you are, what drives you, and how you work best. At the end you'll get personalised career matches, salary information, and a step-by-step pathway.</p>
              <a href="${assessmentLink}" style="display:inline-block;background:#C4714A;color:#fff;border-radius:50px;padding:15px 36px;font-size:16px;font-weight:600;text-decoration:none;margin-bottom:24px">Begin my journey →</a>
              <p style="font-size:12px;color:#9A8E84;line-height:1.6;border-top:1px solid #E8DFD0;padding-top:16px;margin:0">
                This link is personal to you — please don't share it.<br>
                Free · Private · No account needed
              </p>
            </div>
          </body></html>`
        })
      });
    }

    return res.status(201).json({ ok: true, student_id: studentId, link_uuid: linkUuid });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
