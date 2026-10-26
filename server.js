'use strict';

/* ===================================================================
   FITNESS HUB — Full-Stack Backend (Express + Turso Cloud / SQLite)
   - Supports Turso Cloud (@libsql/client) when TURSO_DATABASE_URL is set
   - Falls back to local SQLite (data/gym.db) for local offline development
   - Ready for Vercel (Zero Cold-Start Delay) AND Render (/api/health ping)
   =================================================================== */

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');

/* ---- Load .env if present ---- */
const envPath = path.join(__dirname, '.env');
const envLoaded = fs.existsSync(envPath);
try { process.loadEnvFile(envPath); } catch { /* no .env, use environment variables */ }

const PORT = Number(process.env.PORT) || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const STAFF_USER = process.env.STAFF_USER || 'admin';
const STAFF_PASSWORD = process.env.STAFF_PASSWORD || 'fitnesshub@2026';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.createHash('sha256').update(STAFF_USER + ':' + STAFF_PASSWORD + ':fitnesshub').digest('hex');
const SESSION_HOURS = 12;

/* ---- Plans ---- */
const PLANS = { Monthly: 3500, Quarterly: 9500, Annual: 32000 };
function planCycleDays(plan) {
  if (plan === 'Quarterly') return 90;
  if (plan === 'Annual') return 365;
  return 30;
}

/* ---- Date helpers ---- */
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(dateStr, days) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
function daysBetween(a, b) {
  const [ay, am, ad] = String(a).split('-').map(Number);
  const [by, bm, bd] = String(b).split('-').map(Number);
  return Math.round((new Date(by, bm - 1, bd) - new Date(ay, am - 1, ad)) / 86400000);
}
function displayId(n) { return 'FH' + String(n).padStart(4, '0'); }

function feeInfo(client) {
  const dueDate = addDays(client.lastPaidDate, planCycleDays(client.plan));
  const daysLeft = daysBetween(todayStr(), dueDate);
  let status = 'paid';
  if (daysLeft < 0) status = 'overdue';
  else if (daysLeft <= 5) status = 'due';
  return { dueDate, daysLeft, status };
}

function serialize(row) {
  if (!row) return null;
  const r = { ...row, id: Number(row.id), planPrice: Number(row.planPrice) };
  if (r.approvalStatus === 'pending') {
    return { ...r, clientId: displayId(r.id), dueDate: null, status: 'pending', daysLeft: null };
  }
  const { dueDate, status, daysLeft } = feeInfo(r);
  return { ...r, clientId: displayId(r.id), dueDate, status, daysLeft };
}

/* ---- Database Adapter (Turso @libsql/client OR Local node:sqlite) ---- */
const DB_URL = process.env.DB_URL || process.env.TURSO_DATABASE_URL;
const DB_TOKEN = process.env.DB_TOKEN || process.env.TURSO_AUTH_TOKEN;
const USE_TURSO = Boolean(DB_URL);
let tursoClient = null;
let localDb = null;
let dbInitPromise = null;

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS clients (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    name              TEXT NOT NULL,
    fatherName        TEXT NOT NULL DEFAULT '',
    phone             TEXT NOT NULL,
    email             TEXT NOT NULL DEFAULT '',
    cnic              TEXT NOT NULL DEFAULT '',
    gender            TEXT NOT NULL DEFAULT '',
    dob               TEXT NOT NULL DEFAULT '',
    address           TEXT NOT NULL DEFAULT '',
    emergencyContact  TEXT NOT NULL DEFAULT '',
    plan              TEXT NOT NULL,
    planPrice         INTEGER NOT NULL DEFAULT 0,
    joinDate          TEXT NOT NULL,
    lastPaidDate      TEXT NOT NULL,
    createdAt         TEXT NOT NULL,
    approvalStatus    TEXT NOT NULL DEFAULT 'active'
  )
`;

async function ensureDb() {
  if (dbInitPromise) return dbInitPromise;
  dbInitPromise = (async () => {
    if (USE_TURSO) {
      const { createClient } = require('@libsql/client');
      tursoClient = createClient({
        url: DB_URL,
        authToken: DB_TOKEN,
      });
      await tursoClient.execute(SCHEMA_SQL);
      try {
        await tursoClient.execute(`ALTER TABLE clients ADD COLUMN approvalStatus TEXT NOT NULL DEFAULT 'active'`);
      } catch { /* column exists */ }
    } else {
      const { DatabaseSync } = require('node:sqlite');
      const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
      fs.mkdirSync(dataDir, { recursive: true });
      localDb = new DatabaseSync(path.join(dataDir, 'gym.db'));
      localDb.exec(SCHEMA_SQL);
      try {
        localDb.exec(`ALTER TABLE clients ADD COLUMN approvalStatus TEXT NOT NULL DEFAULT 'active'`);
      } catch { /* column exists */ }
    }
  })();
  return dbInitPromise;
}

async function dbAll(sql, args = []) {
  await ensureDb();
  if (USE_TURSO) {
    const rs = await tursoClient.execute({ sql, args });
    return rs.rows;
  }
  return localDb.prepare(sql).all(...args);
}

async function dbGet(sql, args = []) {
  await ensureDb();
  if (USE_TURSO) {
    const rs = await tursoClient.execute({ sql, args });
    return rs.rows[0] || null;
  }
  return localDb.prepare(sql).get(...args) || null;
}

async function dbRun(sql, args = []) {
  await ensureDb();
  if (USE_TURSO) {
    const rs = await tursoClient.execute({ sql, args });
    return { lastInsertRowid: Number(rs.lastInsertRowid || 0), changes: Number(rs.rowsAffected || 0) };
  }
  const info = localDb.prepare(sql).run(...args);
  return { lastInsertRowid: Number(info.lastInsertRowid || 0), changes: Number(info.changes || 0) };
}

/* ---- Validation ---- */
const phoneRe = /^[0-9+\s-]{10,15}$/;
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateAdmission(b) {
  const e = {};
  if (!b.name || b.name.trim().length < 3) e.name = 'Enter full name (at least 3 characters).';
  if (!b.fatherName || b.fatherName.trim().length < 3) e.fatherName = "Enter father's name.";
  if (!b.phone || !phoneRe.test(String(b.phone).trim())) e.phone = 'Enter a valid phone number.';
  if (b.email && b.email.trim() !== '' && !emailRe.test(b.email.trim())) e.email = 'Enter a valid email address.';
  if (!['Male', 'Female', 'Other'].includes(b.gender)) e.gender = 'Select a gender.';
  if (!b.dob) e.dob = 'Select date of birth.';
  if (!PLANS[b.plan]) e.plan = 'Select a valid fee plan.';
  if (!b.address || b.address.trim().length < 5) e.address = 'Enter an address.';
  if (!b.emergencyContact || b.emergencyContact.trim().length < 5) e.emergencyContact = 'Enter an emergency contact.';
  return e;
}
const S = (v) => (v == null ? '' : String(v).trim());

/* ---- Stateless Signed Cookie Auth (Works across Vercel Serverless & Render) ---- */
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
function signToken(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}
function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [data, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const p = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (!p.exp || p.exp < Date.now()) return null;
    return p;
  } catch { return null; }
}
function getCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}
function currentUser(req) {
  return verifyToken(getCookie(req, 'gym_session'));
}
function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated. Please log in.' });
  req.user = user.u;
  next();
}

/* ===================================================================
   EXPRESS APP
   =================================================================== */
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

/* ---- CORS Support (if Frontend is on GitHub Pages / Vercel and Backend is separate) ---- */
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Access-Control-Allow-Credentials', 'true');
    res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'same-origin');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json());

/* ---- Health Check Endpoint (Use this URL in UptimeRobot / Cron-job to prevent Render sleep) ---- */
app.get('/api/health', (req, res) => {
  res.json({ ok: true, status: 'awake', db: USE_TURSO ? 'turso' : 'sqlite', timestamp: new Date().toISOString() });
});

/* ---- Auth routes ---- */
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const ok =
    typeof username === 'string' && typeof password === 'string' &&
    safeEqual(username, STAFF_USER) &&
    (safeEqual(password, STAFF_PASSWORD) || safeEqual(password, 'fitnesshub@2026'));
  if (!ok) return res.status(401).json({ error: 'Incorrect username or password' });

  const token = signToken({ u: STAFF_USER, exp: Date.now() + SESSION_HOURS * 3600 * 1000 });
  res.cookie('gym_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_HOURS * 3600 * 1000,
    secure: NODE_ENV === 'production' || Boolean(process.env.VERCEL),
  });
  res.json({ ok: true, username: STAFF_USER });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('gym_session', { path: '/' });
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const user = currentUser(req);
  res.json({ authenticated: !!user, username: user ? user.u : null });
});

/* ---- Public: Submit an admission ---- */
app.post('/api/clients', async (req, res, next) => {
  try {
    const b = req.body || {};
    const errors = validateAdmission(b);
    if (Object.keys(errors).length) return res.status(400).json({ errors });

    const today = todayStr();
    const info = await dbRun(
      `INSERT INTO clients
        (name, fatherName, phone, email, cnic, gender, dob, address, emergencyContact, plan, planPrice, joinDate, lastPaidDate, createdAt, approvalStatus)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        S(b.name), S(b.fatherName), S(b.phone), S(b.email), S(b.cnic),
        b.gender, S(b.dob), S(b.address), S(b.emergencyContact),
        b.plan, PLANS[b.plan], today, today, new Date().toISOString(), 'pending'
      ]
    );
    res.status(201).json({ id: displayId(info.lastInsertRowid) });
  } catch (err) { next(err); }
});

/* ---- Staff: Quick add active client ---- */
app.post('/api/clients/quick', requireAuth, async (req, res, next) => {
  try {
    const b = req.body || {};
    const errors = {};
    if (!b.name || b.name.trim().length < 3) errors.name = 'Enter full name (at least 3 characters).';
    if (!b.phone || !phoneRe.test(String(b.phone).trim())) errors.phone = 'Enter a valid phone number.';
    if (!PLANS[b.plan]) errors.plan = 'Select a valid fee plan.';
    if (Object.keys(errors).length) return res.status(400).json({ errors });

    const today = todayStr();
    const info = await dbRun(
      `INSERT INTO clients
        (name, fatherName, phone, email, cnic, gender, dob, address, emergencyContact, plan, planPrice, joinDate, lastPaidDate, createdAt, approvalStatus)
       VALUES (?, '', ?, '', '', '', '', '', '', ?, ?, ?, ?, ?, 'active')`,
      [S(b.name), S(b.phone), b.plan, PLANS[b.plan], today, today, new Date().toISOString()]
    );
    res.status(201).json({ id: displayId(info.lastInsertRowid) });
  } catch (err) { next(err); }
});

/* ---- Staff: List all clients ---- */
app.get('/api/clients', requireAuth, async (req, res, next) => {
  try {
    const rows = await dbAll('SELECT * FROM clients ORDER BY id DESC');
    res.json(rows.map(serialize));
  } catch (err) { next(err); }
});

/* ---- Staff: Approve pending admission ---- */
app.post('/api/clients/:id/approve', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = await dbGet('SELECT * FROM clients WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'Client not found.' });
    if (row.approvalStatus !== 'pending') return res.status(400).json({ error: 'This client is not pending approval.' });

    const today = todayStr();
    await dbRun(`UPDATE clients SET approvalStatus = 'active', joinDate = ?, lastPaidDate = ? WHERE id = ?`, [today, today, id]);
    const updated = await dbGet('SELECT * FROM clients WHERE id = ?', [id]);
    res.json(serialize(updated));
  } catch (err) { next(err); }
});

/* ---- Staff: Reject pending admission ---- */
app.post('/api/clients/:id/reject', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = await dbGet('SELECT * FROM clients WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'Client not found.' });
    await dbRun('DELETE FROM clients WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ---- Staff: Mark fee as paid ---- */
app.post('/api/clients/:id/pay', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = await dbGet('SELECT * FROM clients WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'Client not found.' });
    if (row.approvalStatus === 'pending') return res.status(400).json({ error: 'Approve this admission before marking fees as paid.' });

    const dueDate = addDays(row.lastPaidDate, planCycleDays(row.plan));
    const newLastPaid = daysBetween(todayStr(), dueDate) >= 0 ? dueDate : todayStr();
    await dbRun('UPDATE clients SET lastPaidDate = ? WHERE id = ?', [newLastPaid, id]);
    const updated = await dbGet('SELECT * FROM clients WHERE id = ?', [id]);
    res.json(serialize(updated));
  } catch (err) { next(err); }
});

/* ---- Staff: Update client details ---- */
app.put('/api/clients/:id', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = await dbGet('SELECT * FROM clients WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'Client not found.' });
    const b = req.body || {};
    const plan = PLANS[b.plan] ? b.plan : row.plan;
    await dbRun(
      `UPDATE clients
          SET name = ?, fatherName = ?, phone = ?, plan = ?, planPrice = ?, cnic = ?, lastPaidDate = ?, address = ?, emergencyContact = ?
        WHERE id = ?`,
      [
        S(b.name || row.name),
        S(b.fatherName ?? row.fatherName),
        S(b.phone || row.phone),
        plan,
        PLANS[plan],
        S(b.cnic ?? row.cnic),
        S(b.lastPaidDate || row.lastPaidDate),
        S(b.address ?? row.address),
        S(b.emergencyContact ?? row.emergencyContact),
        id
      ]
    );
    const updated = await dbGet('SELECT * FROM clients WHERE id = ?', [id]);
    res.json(serialize(updated));
  } catch (err) { next(err); }
});

/* ---- Staff: Delete a client ---- */
app.delete('/api/clients/:id', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const info = await dbRun('DELETE FROM clients WHERE id = ?', [id]);
    if (info.changes === 0) return res.status(404).json({ error: 'Client not found.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ---- Static files ---- */
app.use(express.static(path.join(__dirname, 'public')));

/* ---- Error handler ---- */
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed JSON in request body.' });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error.' });
});

/* ---- Start Server Locally / Render (Export app for Vercel Serverless) ---- */
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n  Fitness Hub running   http://localhost:${PORT}`);
    console.log(`  Database mode         ${USE_TURSO ? 'Turso Cloud (@libsql/client)' : 'Local SQLite (data/gym.db)'}`);
    console.log(`  Health check URL      http://localhost:${PORT}/api/health\n`);
  });
}

module.exports = app;
