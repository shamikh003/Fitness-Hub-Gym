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
try { if(process.env.NODE_ENV !== 'test') process.loadEnvFile(envPath); } catch { /* no .env, use environment variables */ }

const PORT = Number(process.env.PORT) || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const STAFF_USER = process.env.STAFF_USER || 'admin';
const STAFF_PASSWORD = process.env.STAFF_PASSWORD || 'fitnesshub@2026';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(48).toString('hex');
const STAFF_CONFIGURED = NODE_ENV !== 'production' || Boolean(process.env.STAFF_PASSWORD && process.env.SESSION_SECRET);
if (!STAFF_CONFIGURED) console.warn('Staff access requires STAFF_PASSWORD and SESSION_SECRET. Public website remains available.');
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
  return new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Karachi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
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
  const dueDate = client.paidUntil || addDays(client.lastPaidDate, planCycleDays(client.plan));
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

const BOOKINGS_SQL = `CREATE TABLE IF NOT EXISTS bookings (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT NOT NULL, session TEXT NOT NULL, date TEXT NOT NULL, createdAt TEXT NOT NULL)`;

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
      await tursoClient.execute(BOOKINGS_SQL);
      try {await tursoClient.execute("ALTER TABLE clients ADD COLUMN paidUntil TEXT NOT NULL DEFAULT ''");} catch(err) {if(!/duplicate column/i.test(err.message))throw err;}
      for (const sql of require("./lib/owner").schemas) await tursoClient.execute(sql);
      try {await tursoClient.execute("ALTER TABLE payment_ledger ADD COLUMN kind TEXT NOT NULL DEFAULT 'renewal'");} catch(err) {if(!/duplicate column/i.test(err.message))throw err;}
      try { await tursoClient.execute("ALTER TABLE clients ADD COLUMN preferences TEXT NOT NULL DEFAULT ''"); } catch {}
      try {
        await tursoClient.execute(`ALTER TABLE clients ADD COLUMN approvalStatus TEXT NOT NULL DEFAULT 'active'`);
      } catch { /* column exists */ }
    } else {
      const { DatabaseSync } = require('node:sqlite');
      const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
      fs.mkdirSync(dataDir, { recursive: true });
      localDb = new DatabaseSync(path.join(dataDir, 'gym.db'));
      localDb.exec(SCHEMA_SQL);
      localDb.exec(BOOKINGS_SQL);
      try {localDb.exec("ALTER TABLE clients ADD COLUMN paidUntil TEXT NOT NULL DEFAULT ''");} catch(err) {if(!/duplicate column/i.test(err.message))throw err;}
      for (const sql of require("./lib/owner").schemas) localDb.exec(sql);
      try {localDb.exec("ALTER TABLE payment_ledger ADD COLUMN kind TEXT NOT NULL DEFAULT 'renewal'");} catch(err) {if(!/duplicate column/i.test(err.message))throw err;}
      try { localDb.exec("ALTER TABLE clients ADD COLUMN preferences TEXT NOT NULL DEFAULT ''"); } catch {}
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

async function dbBatch(statements) {
  await ensureDb();
  if (USE_TURSO) return tursoClient.batch(statements,'write');
  localDb.exec('BEGIN IMMEDIATE');
  try {
    const results=statements.map(({sql,args=[]})=>localDb.prepare(sql).run(...args));
    localDb.exec('COMMIT'); return results;
  } catch(err) {localDb.exec('ROLLBACK'); throw err;}
}

/* ---- Validation ---- */
const phoneRe = /^(?:\+?92|0)3\d{9}$/;
const validDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v;
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateAdmission(b) {
  const e = {};
  if (!b.name || b.name.trim().length < 3) e.name = 'Enter full name (at least 3 characters).';
  if (!b.fatherName || b.fatherName.trim().length < 3) e.fatherName = "Enter father's name.";
  if (!b.phone || !phoneRe.test(String(b.phone).trim())) e.phone = 'Enter a valid phone number.';
  if (b.email && b.email.trim() !== '' && !emailRe.test(b.email.trim())) e.email = 'Enter a valid email address.';
  if (!['Male', 'Female', 'Other'].includes(b.gender)) e.gender = 'Select a gender.';
  if (!validDate(b.dob) || b.dob >= todayStr()) e.dob = 'Select a valid date of birth in the past.';
  if (b.cnic && !/^\d{5}-\d{7}-\d$/.test(b.cnic)) e.cnic = 'Use CNIC format 12345-1234567-1.';
  if (!Object.hasOwn(PLANS,b.plan)) e.plan = 'Select a valid fee plan.';
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
function safeDecode(value) { try { return decodeURIComponent(value); } catch { return ''; } }
function getCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return safeDecode(part.slice(idx + 1).trim());
  }
  return null;
}
function currentUser(req) {
  if (!STAFF_CONFIGURED) return null;
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
  const allowedOrigin = process.env.FRONTEND_ORIGIN || `${req.protocol}://${req.get('host')}`;
  if (origin && origin !== allowedOrigin) return res.status(403).json({error:'Origin not allowed.'});
  if (origin) {
    res.vary('Origin');
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

app.use(express.json({limit:'48kb'}));
app.use('/api', (req, res, next) => { res.set('Cache-Control','no-store'); next(); });
const attempts = new Map();
function limitRequests(max) { return (req,res,next) => {
  const key = req.ip + ':' + req.path;
  const now = Date.now();
  for (const [key, value] of attempts) if (now - value.start > 900000) attempts.delete(key);
  const entry = attempts.get(key) || {start:now, count:0};
  entry.count++; attempts.set(key,entry);
  if (entry.count > max) return res.status(429).json({error:'Too many requests. Please try again in 15 minutes.'});
  next();
}; }
app.use('/api/auth/login',limitRequests(15));
app.post(['/api/clients','/api/bookings'],limitRequests(25));
// Reject unexpected types before validators or SQL see them.
app.use('/api', (req,res,next) => {
  if (req.path === '/site' && req.method === 'PUT') return next();
  if (req.body && (typeof req.body !== 'object' || Array.isArray(req.body))) return res.status(400).json({error:'Invalid request.'});
  for (const [key,value] of Object.entries(req.body || {})) {
    if (key === 'addons') { if (!Array.isArray(value) || value.length > 3 || value.some(v => typeof v !== 'string' || v.length > 100)) return res.status(400).json({error:'Invalid add-ons.'}); }
    else if (typeof value !== 'string' && typeof value !== 'number' && value !== null) return res.status(400).json({error:'Invalid field: '+key});
    if (typeof value === 'string' && value.length > 1000) return res.status(400).json({error:'Field too long: '+key});
  }
  next();
});

/* ---- Health Check Endpoint (Use this URL in UptimeRobot / Cron-job to prevent Render sleep) ---- */
app.get('/api/health', (req, res) => {
  res.json({ ok: true, status: 'awake', db: USE_TURSO ? 'turso' : 'sqlite', staffConfigured:STAFF_CONFIGURED, timestamp: new Date().toISOString() });
});

/* ---- Auth routes ---- */
app.post('/api/auth/login', (req, res) => {
  if (!STAFF_CONFIGURED) return res.status(503).json({error:'Staff login is not configured. Set STAFF_PASSWORD and SESSION_SECRET in the hosting environment.'});
  const { username, password } = req.body || {};
  const ok =
    typeof username === 'string' && typeof password === 'string' &&
    safeEqual(username, STAFF_USER) &&
    safeEqual(password, STAFF_PASSWORD);
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

const {getSettings,recordPayment} = require('./lib/owner')(app,{dbGet,dbAll,dbRun,dbBatch,requireAuth,todayStr,addDays,daysBetween,planCycleDays,serialize,validDate,displayId});

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
        b.plan, (await getSettings()).prices[b.plan], today, today, new Date().toISOString(), 'pending'
      ]
    );
    await dbRun('UPDATE clients SET preferences = ? WHERE id = ?', [JSON.stringify({fitnessGoal:S(b.fitnessGoal),preferredCoach:S(b.preferredCoach),addons:b.addons || []}),info.lastInsertRowid]);
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

/* ---- Staff: Reject pending admission ---- */
app.post('/api/clients/:id/reject', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = await dbGet('SELECT * FROM clients WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'Client not found.' });
    if (row.approvalStatus !== 'pending') return res.status(400).json({error:'Only pending admissions can be rejected.'});
    await dbRun('DELETE FROM clients WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ---- Staff: Update client details ---- */
app.put('/api/clients/:id', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = await dbGet('SELECT * FROM clients WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'Client not found.' });
    const b = req.body || {};
    const errors = {};
    if (b.name !== undefined && (typeof b.name !== 'string' || b.name.trim().length < 3)) errors.name = 'Enter a full name.';
    if (b.phone !== undefined && !phoneRe.test(S(b.phone))) errors.phone = 'Enter a valid Pakistani mobile number.';
    if (b.plan !== undefined && !Object.hasOwn(PLANS,b.plan)) errors.plan = 'Select a valid plan.';
    if (b.lastPaidDate !== undefined && b.lastPaidDate !== row.lastPaidDate && (!validDate(b.lastPaidDate) || b.lastPaidDate > todayStr())) errors.lastPaidDate = 'Payment date must be valid and cannot be in the future.';
    if (Object.keys(errors).length) return res.status(400).json({errors});
    if (b.lastPaidDate !== undefined && b.lastPaidDate !== row.lastPaidDate) return res.status(400).json({error:'Record payments through the cash payment form; coverage dates cannot be edited directly.'});
    const plan = PLANS[b.plan] ? b.plan : row.plan;
    await dbRun(
      `UPDATE clients
          SET name = ?, fatherName = ?, phone = ?, plan = ?, planPrice = ?, cnic = ?, lastPaidDate = ?, address = ?, emergencyContact = ?, paidUntil = ?
        WHERE id = ?`,
      [
        S(b.name || row.name),
        S(b.fatherName ?? row.fatherName),
        S(b.phone || row.phone),
        plan,
        plan === row.plan ? row.planPrice : (await getSettings()).prices[plan],
        S(b.cnic ?? row.cnic),
        S(b.lastPaidDate || row.lastPaidDate),
        S(b.address ?? row.address),
        S(b.emergencyContact ?? row.emergencyContact),
        row.paidUntil || addDays(row.lastPaidDate,planCycleDays(row.plan)),
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

/* ---- Trial and class requests shared with staff ---- */
app.post('/api/bookings', async (req,res,next) => {
  try {
    const {name,phone,session,date} = req.body || {};
    if (typeof name !== 'string' || name.trim().length < 3 || !phoneRe.test(S(phone)) || typeof session !== 'string' || !session.trim() || !validDate(date) || date < todayStr()) return res.status(400).json({error:'Enter a full name, Pakistani mobile number and a visit date today or later.'});
    const existing = await dbGet('SELECT id FROM bookings WHERE phone = ? AND session = ? AND date = ?', [S(phone),S(session),date]);
    if (existing) return res.status(409).json({error:'This booking request already exists. Please contact the gym to make changes.'});
    const saved = await dbRun('INSERT INTO bookings (name,phone,session,date,createdAt) VALUES (?,?,?,?,?)',[S(name),S(phone),S(session),date,new Date().toISOString()]);
    res.status(201).json({id:saved.lastInsertRowid,status:'requested'});
  } catch(err) {next(err);}
});
app.get('/api/bookings', requireAuth, async(req,res,next) => {
  try {res.json(await dbAll('SELECT * FROM bookings ORDER BY date, id DESC'));} catch(err) {next(err);}
});
/* ---- Static files ---- */
app.use(express.static(path.join(__dirname, 'public')));

/* ---- Error handler ---- */
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed JSON in request body.' });
  }
  if (err && err.type === 'entity.too.large') return res.status(413).json({error:'File or request is too large. Images must be under 1 MB.'});
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
