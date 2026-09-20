// server.js — Backend for Tonmoy Day Sarkar's portfolio
// Deploy this as a Web Service on Render. See README.md for full setup.

const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');

const app = express();

// ---------- Config ----------
const PORT = process.env.PORT || 3000;

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*')
  .split(',')
  .map(s => s.trim());

app.use(express.json());
app.use(cors({
  origin: ALLOWED_ORIGINS.includes('*') ? true : ALLOWED_ORIGINS,
}));

// ---------- Database (Postgres — e.g. a free Neon or Supabase instance) ----------
// If DATABASE_URL isn't set, DB-backed features (message history, visit
// tracking, admin view) are silently skipped so the rest of the API still works.
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    })
  : null;

async function initDb() {
  if (!pool) {
    console.log('DATABASE_URL not set — skipping DB setup (messages/visits/admin will be disabled).');
    return;
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS visits (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL,
      path TEXT,
      referrer TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  console.log('Database ready.');
}
initDb().catch(err => console.error('DB init error:', err));

// ---------- Mail transport ----------
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ---------- Simple in-memory cache (for publications / GitHub feeds) ----------
const cache = new Map(); // key -> { data, expires }
function getCached(key) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.data;
  return null;
}
function setCached(key, data, ttlMs) {
  cache.set(key, { data, expires: Date.now() + ttlMs });
}

// ---------- Rate limiters ----------
const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { ok: false, error: 'Too many messages sent. Please try again later.' },
});
const askLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: { ok: false, error: 'Too many questions this hour. Please try again later.' },
});
const trackLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
});

// ================= Routes =================

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Portfolio backend is running.' });
});
app.get('/health', (req, res) => res.json({ ok: true }));

// ---------- Contact form ----------
app.post('/api/contact', contactLimiter, async (req, res) => {
  try {
    const { name, email, message, company } = req.body || {};

    if (company) return res.status(200).json({ ok: true }); // honeypot

    if (!name || !email || !message) {
      return res.status(400).json({ ok: false, error: 'Name, email and message are all required.' });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ ok: false, error: 'Please enter a valid email address.' });
    }
    if (message.length > 5000) {
      return res.status(400).json({ ok: false, error: 'Message is too long.' });
    }

    await transporter.sendMail({
      from: `"Portfolio Contact Form" <${process.env.EMAIL_USER}>`,
      to: process.env.TO_EMAIL || process.env.EMAIL_USER,
      replyTo: email,
      subject: `New portfolio message from ${name}`,
      text: `Name: ${name}\nEmail: ${email}\n\nMessage:\n${message}`,
      html: `<p><strong>Name:</strong> ${escapeHtml(name)}</p>
             <p><strong>Email:</strong> ${escapeHtml(email)}</p>
             <p><strong>Message:</strong></p>
             <p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>`,
    });

    if (pool) {
      pool.query(
        'INSERT INTO messages (name, email, message) VALUES ($1, $2, $3)',
        [name, email, message]
      ).catch(err => console.error('Failed to store message:', err));
    }

    res.json({ ok: true, message: 'Message sent successfully.' });
  } catch (err) {
    console.error('Contact form error:', err);
    res.status(500).json({ ok: false, error: 'Something went wrong sending your message. Please try again later.' });
  }
});

// ---------- Visit / download tracking ----------
app.post('/api/track', trackLimiter, async (req, res) => {
  try {
    if (!pool) return res.json({ ok: true }); // silently no-op if no DB configured
    const { type, path } = req.body || {};
    if (!type || !['pageview', 'cv_download'].includes(type)) {
      return res.status(400).json({ ok: false, error: 'Invalid tracking type.' });
    }
    const referrer = (req.headers.referer || '').slice(0, 500);
    await pool.query(
      'INSERT INTO visits (type, path, referrer) VALUES ($1, $2, $3)',
      [type, (path || '').slice(0, 300), referrer]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Tracking error:', err);
    res.status(500).json({ ok: false });
  }
});

// ---------- Publications feed (ORCID public API — free, no key) ----------
app.get('/api/publications', async (req, res) => {
  try {
    const cached = getCached('publications');
    if (cached) return res.json({ ok: true, publications: cached, cached: true });

    const orcid = process.env.ORCID_ID || '0009-0007-3565-6578';
    const response = await fetch(`https://pub.orcid.org/v3.0/${orcid}/works`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`ORCID API returned ${response.status}`);
    const data = await response.json();

    const publications = (data.group || []).map(group => {
      const summary = group['work-summary'][0];
      const title = summary.title && summary.title.title && summary.title.title.value;
      const journal = summary['journal-title'] && summary['journal-title'].value;
      const year = summary['publication-date'] && summary['publication-date'].year && summary['publication-date'].year.value;
      const doiEntry = (summary['external-ids'] && summary['external-ids']['external-id'] || [])
        .find(id => id['external-id-type'] === 'doi');
      const doi = doiEntry ? doiEntry['external-id-value'] : null;
      return { title, journal, year, doi };
    }).filter(p => p.title);

    setCached('publications', publications, 6 * 60 * 60 * 1000); // 6 hours
    res.json({ ok: true, publications, cached: false });
  } catch (err) {
    console.error('Publications fetch error:', err);
    res.status(502).json({ ok: false, error: 'Could not fetch publications right now.' });
  }
});

// ---------- GitHub projects feed ----------
app.get('/api/github-repos', async (req, res) => {
  try {
    const cached = getCached('github-repos');
    if (cached) return res.json({ ok: true, repos: cached, cached: true });

    const username = process.env.GITHUB_USERNAME || 'tonmoy7722';
    const response = await fetch(
      `https://api.github.com/users/${username}/repos?sort=updated&per_page=6`,
      { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'portfolio-backend' } }
    );
    if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
    const data = await response.json();

    const repos = data
      .filter(r => !r.fork)
      .map(r => ({
        name: r.name,
        description: r.description,
        url: r.html_url,
        language: r.language,
        stars: r.stargazers_count,
        updated: r.updated_at,
      }));

    setCached('github-repos', repos, 6 * 60 * 60 * 1000);
    res.json({ ok: true, repos, cached: false });
  } catch (err) {
    console.error('GitHub fetch error:', err);
    res.status(502).json({ ok: false, error: 'Could not fetch GitHub projects right now.' });
  }
});

// ---------- AI chat: "Ask about Tonmoy" (Groq free tier) ----------
const TONMOY_BIO = `
You are a helpful assistant embedded in Tonmoy Day Sarkar's portfolio website.
Answer visitor questions about Tonmoy ONLY using the facts below. Be concise
(2-4 sentences unless asked for detail), friendly, and professional. If asked
something not covered here, say you don't have that information and suggest
using the contact form.

FACTS ABOUT TONMOY DAY SARKAR:
- Based in Tangail, Bangladesh. Job-hunting for ML/software roles in Bangladesh.
- Bachelor of Technology in Computer Engineering (Software Engineering), Jain
  Deemed-to-be University, Bangalore, India (Jul 2020 - Nov 2024), final grade 8.727/10.
- Four peer-reviewed IEEE conference publications: (1) an e-commerce recommendation
  system using element-by-element collaborative filtering, (2) telecom customer churn
  prediction using SMOTE-ENN and RandomizedSearchCV hyperparameter tuning, (3) restaurant
  rating prediction comparing linear regression and decision tree regression, (4)
  geospatial/statistical analysis of restaurant distribution using K-means clustering.
- Worked as Data Analyst Intern (Brand & Visual) in Dhaka, Bangladesh, Dec 2025-May 2026:
  data analysis and visualization for business decisions.
- Worked as Student Research Assistant at Jain University, Sep 2023-Jul 2024, under
  Mr. Karthikeyan S., producing the four IEEE publications above.
- Skills: Python, C, C++, scikit-learn (regression, clustering, ensemble methods,
  SMOTE-ENN); JavaScript/Node.js/Express/React/Next.js; MongoDB, Firebase; HTML/CSS/
  Bootstrap; Git/GitHub; Hadoop.
- Certifications: Machine Learning Virtual Internship (CodSoft), Certificate of
  Reviewing (European Journal of Computer Sciences and Informatics), Data Analysis
  Using Python (IBM/Cognitive Class), Asia AI Odyssey Challenge (Microsoft), Moving
  Data into Hadoop (Big Data University), Data Analytics and Visualization (Accenture
  North America / Forage).
- Links: Google Scholar (scholar.google.com/citations?user=LB6A9soAAAAJ), LinkedIn
  (linkedin.com/in/tonmoy7722), GitHub (github.com/tonmoy7722), ORCID
  (0009-0007-3565-6578).
`.trim();

app.post('/api/ask', askLimiter, async (req, res) => {
  try {
    const { question, history } = req.body || {};
    if (!question || typeof question !== 'string' || question.length > 1000) {
      return res.status(400).json({ ok: false, error: 'Please provide a valid question.' });
    }
    if (!process.env.GROQ_API_KEY) {
      return res.status(503).json({ ok: false, error: 'Chat is not configured yet.' });
    }

    const messages = [
      { role: 'system', content: TONMOY_BIO },
      ...(Array.isArray(history) ? history.slice(-6) : []),
      { role: 'user', content: question },
    ];

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages,
        max_tokens: 300,
        temperature: 0.4,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Groq API error:', response.status, errText);
      throw new Error('LLM request failed');
    }
    const data = await response.json();
    const answer = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;

    res.json({ ok: true, answer: answer || "Sorry, I couldn't come up with an answer to that." });
  } catch (err) {
    console.error('Ask error:', err);
    res.status(502).json({ ok: false, error: 'Could not reach the assistant right now.' });
  }
});

// ---------- Admin: view messages + stats (password-protected) ----------
function checkAdminPassword(req, res) {
  const password = req.query.password || (req.body && req.body.password);
  if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
    res.status(401).json({ ok: false, error: 'Invalid or missing admin password.' });
    return false;
  }
  return true;
}

app.get('/api/admin/messages', async (req, res) => {
  if (!checkAdminPassword(req, res)) return;
  if (!pool) return res.status(503).json({ ok: false, error: 'Database not configured.' });
  try {
    const result = await pool.query(
      'SELECT id, name, email, message, created_at FROM messages ORDER BY created_at DESC LIMIT 200'
    );
    res.json({ ok: true, messages: result.rows });
  } catch (err) {
    console.error('Admin messages error:', err);
    res.status(500).json({ ok: false, error: 'Could not load messages.' });
  }
});

app.get('/api/admin/stats', async (req, res) => {
  if (!checkAdminPassword(req, res)) return;
  if (!pool) return res.status(503).json({ ok: false, error: 'Database not configured.' });
  try {
    const totals = await pool.query(`
      SELECT type, COUNT(*)::int AS count FROM visits GROUP BY type
    `);
    const last30 = await pool.query(`
      SELECT type, date_trunc('day', created_at) AS day, COUNT(*)::int AS count
      FROM visits
      WHERE created_at > now() - interval '30 days'
      GROUP BY type, day
      ORDER BY day ASC
    `);
    const messageCount = await pool.query('SELECT COUNT(*)::int AS count FROM messages');
    res.json({
      ok: true,
      totals: totals.rows,
      last30Days: last30.rows,
      messageCount: messageCount.rows[0].count,
    });
  } catch (err) {
    console.error('Admin stats error:', err);
    res.status(500).json({ ok: false, error: 'Could not load stats.' });
  }
});

// Minimal admin HTML page — enter password, view messages + stats.
app.get('/admin', (req, res) => {
  res.type('html').send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Portfolio Admin</title>
<style>
  body{font-family:system-ui,sans-serif; background:#161311; color:#eee; padding:32px; max-width:900px; margin:0 auto;}
  input{padding:8px; border-radius:4px; border:1px solid #555; background:#222; color:#eee; width:260px;}
  button{padding:8px 16px; border-radius:4px; border:none; background:#c9a15a; color:#111; cursor:pointer; margin-left:8px;}
  table{width:100%; border-collapse:collapse; margin-top:24px;}
  th,td{text-align:left; padding:8px; border-bottom:1px solid #333; font-size:14px; vertical-align:top;}
  th{color:#c9a15a;}
  .stat{display:inline-block; margin-right:28px; margin-top:20px;}
  .stat b{font-size:22px; display:block;}
  #err{color:#e2988f; margin-top:10px;}
</style></head>
<body>
  <h1>Portfolio Admin</h1>
  <div>
    <input id="pw" type="password" placeholder="Admin password">
    <button onclick="load()">View</button>
  </div>
  <div id="err"></div>
  <div id="stats"></div>
  <table id="msgTable" style="display:none">
    <thead><tr><th>Date</th><th>Name</th><th>Email</th><th>Message</th></tr></thead>
    <tbody id="msgBody"></tbody>
  </table>
<script>
async function load(){
  const pw = document.getElementById('pw').value;
  document.getElementById('err').textContent = '';
  try {
    const [statsRes, msgRes] = await Promise.all([
      fetch('/api/admin/stats?password=' + encodeURIComponent(pw)),
      fetch('/api/admin/messages?password=' + encodeURIComponent(pw)),
    ]);
    if (!statsRes.ok || !msgRes.ok) throw new Error('Unauthorized or server error');
    const stats = await statsRes.json();
    const msgs = await msgRes.json();

    const totalsHtml = stats.totals.map(t => '<div class="stat"><b>' + t.count + '</b>' + t.type + '</div>').join('');
    document.getElementById('stats').innerHTML = totalsHtml + '<div class="stat"><b>' + stats.messageCount + '</b>messages</div>';

    const tbody = document.getElementById('msgBody');
    tbody.innerHTML = msgs.messages.map(m =>
      '<tr><td>' + new Date(m.created_at).toLocaleString() + '</td><td>' + esc(m.name) + '</td><td>' + esc(m.email) + '</td><td>' + esc(m.message) + '</td></tr>'
    ).join('');
    document.getElementById('msgTable').style.display = 'table';
  } catch (e) {
    document.getElementById('err').textContent = 'Wrong password, or database/admin not configured.';
  }
}
function esc(s){ const d=document.createElement('div'); d.textContent = s; return d.innerHTML; }
</script>
</body></html>`);
});

app.listen(PORT, () => {
  console.log(`Portfolio backend listening on port ${PORT}`);
});
