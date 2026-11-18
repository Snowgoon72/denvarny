// Gaveplanlegger – ønskeliste med hemmelige reservasjoner, venner og bursdagsvarsler.
// Null eksterne avhengigheter: krever Node.js 22.5+ (innebygd SQLite).
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { linkPreview } = require('./preview.js');
const { sendSmtp, smtpConfig } = require('./smtp.js');

// ---------- Konfigurasjon ----------
const ROOT = __dirname;
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const PORT = Number(process.env.PORT || CONFIG.port || 3000);
const BASE_URL = (process.env.BASE_URL || CONFIG.baseUrl || `http://localhost:${PORT}`).replace(/\/$/, '');
const DB_FILE = process.env.DB_FILE || path.join(ROOT, 'data', 'gaveliste.db');
const SESSION_DAYS = 30;
const MIN_AGE = 13; // Norsk aldersgrense for samtykke til informasjonssamfunnstjenester
const REMINDER_DAYS = CONFIG.reminderDays || [14, 7, 1];
const UPCOMING_WINDOW = CONFIG.upcomingWindowDays || 30;

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
const db = new DatabaseSync(DB_FILE);
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  birthdate TEXT,                       -- valgfritt
  gender TEXT,                          -- valgfritt: kvinne | mann | annet | ikke_oppgitt
  phone TEXT,
  pw_hash TEXT NOT NULL,
  pw_salt TEXT NOT NULL,
  share_token TEXT NOT NULL UNIQUE,
  email_reminders INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS wishes (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT,
  note TEXT,
  price TEXT,
  priority INTEGER NOT NULL DEFAULT 2,
  status TEXT NOT NULL DEFAULT 'active', -- active | received | removed
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS claims (
  wish_id INTEGER PRIMARY KEY REFERENCES wishes(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS friends (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, friend_id)
);
CREATE TABLE IF NOT EXISTS friend_requests (
  from_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (from_id, to_id)
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT,
  dedupe_key TEXT UNIQUE,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Gaveplanlegger: personer uten konto som brukeren skal gi gave til (kun synlig for eieren)
CREATE TABLE IF NOT EXISTS recipients (
  id INTEGER PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  birthdate TEXT,              -- valgfritt, YYYY-MM-DD (år kan være ukjent: 1900)
  relation TEXT,
  email TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS gift_ideas (
  id INTEGER PRIMARY KEY,
  recipient_id INTEGER NOT NULL REFERENCES recipients(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT,
  price TEXT,
  occasion TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'idea', -- idea | bought | given
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_recipients_owner ON recipients(owner_id);
-- Juleliste: hvem man skal gi julegave til et gitt år, med budsjett
CREATE TABLE IF NOT EXISTS christmas_entries (
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  recipient_id INTEGER NOT NULL REFERENCES recipients(id) ON DELETE CASCADE,
  budget INTEGER,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (owner_id, year, recipient_id)
);
-- Lister i gaveplanleggeren (juleliste, bryllup, konfirmasjon …) med frist
CREATE TABLE IF NOT EXISTS gift_lists (
  id INTEGER PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'annet',   -- jul | bryllup | konfirmasjon | bursdag | annet
  deadline TEXT NOT NULL,                -- YYYY-MM-DD
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS gift_list_people (
  list_id INTEGER NOT NULL REFERENCES gift_lists(id) ON DELETE CASCADE,
  recipient_id INTEGER NOT NULL REFERENCES recipients(id) ON DELETE CASCADE,
  budget INTEGER,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (list_id, recipient_id)
);
-- Ønskelister for anledninger (bryllup, bryllupsdag, jubileum …), tidligere «bryllupslister».
-- Felles for to eiere, synlig for vennene, og kan deles med lenke til folk uten konto.
CREATE TABLE IF NOT EXISTS registries (
  id INTEGER PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  partner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  event_date TEXT NOT NULL,
  message TEXT,
  token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS registry_items (
  id INTEGER PRIMARY KEY,
  registry_id INTEGER NOT NULL REFERENCES registries(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT,
  price TEXT,
  note TEXT,
  qty INTEGER NOT NULL DEFAULT 1,        -- antall ønsket (f.eks. 12 tallerkener)
  spleis INTEGER NOT NULL DEFAULT 0,     -- 1 = gjestene kan bidra med beløp
  priority INTEGER NOT NULL DEFAULT 2,
  status TEXT NOT NULL DEFAULT 'active', -- active | removed
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS registry_claims (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES registry_items(id) ON DELETE CASCADE,
  qty INTEGER NOT NULL DEFAULT 1,
  amount INTEGER,                        -- bidrag i kr ved spleis
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  guest_name TEXT,
  guest_email TEXT,
  cancel_token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_lists_owner ON gift_lists(owner_id);
CREATE INDEX IF NOT EXISTS idx_ritems_reg ON registry_items(registry_id);
CREATE INDEX IF NOT EXISTS idx_rclaims_item ON registry_claims(item_id);
-- Kontakt oss og tilbakemeldinger (feil, forbedringer, spørsmål)
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,                    -- feil | forbedring | sporsmal | kontakt
  message TEXT NOT NULL,
  name TEXT,
  email TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  page TEXT,
  user_agent TEXT,
  status TEXT NOT NULL DEFAULT 'ny',     -- ny | behandlet
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Glemt passord: engangslenker (bare en hash av koden lagres)
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wishes_user ON wishes(user_id);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read);
`);
// Migrering: en person i gaveplanleggeren kan være koblet til en venn med konto (brukes av julelisten)
if (!db.prepare('PRAGMA table_info(recipients)').all().some((c) => c.name === 'linked_user_id')) {
  db.exec('ALTER TABLE recipients ADD COLUMN linked_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE');
}

// Migrering: fødselsdato og kjønn er blitt valgfritt (gamle databaser hadde NOT NULL).
// SQLite kan ikke endre en kolonne, så tabellen bygges om med samme data.
if (db.prepare('PRAGMA table_info(users)').all().some((c) => (c.name === 'birthdate' || c.name === 'gender') && c.notnull)) {
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name).join(', ');
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec(`BEGIN;
    CREATE TABLE users_ny (
      id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
      birthdate TEXT, gender TEXT, phone TEXT, pw_hash TEXT NOT NULL, pw_salt TEXT NOT NULL,
      share_token TEXT NOT NULL UNIQUE, email_reminders INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')));
    INSERT INTO users_ny(${cols}) SELECT ${cols} FROM users;
    DROP TABLE users;
    ALTER TABLE users_ny RENAME TO users;
    COMMIT;`);
  db.exec('PRAGMA foreign_keys = ON');
}
// Migrering: bryllupslister er blitt ønskelister for anledninger (bryllup, bryllupsdag, jubileum …)
{
  const cols = db.prepare('PRAGMA table_info(registries)').all().map((c) => c.name);
  if (!cols.includes('kind')) db.exec("ALTER TABLE registries ADD COLUMN kind TEXT NOT NULL DEFAULT 'bryllup'");
  if (!cols.includes('visible_friends')) db.exec('ALTER TABLE registries ADD COLUMN visible_friends INTEGER NOT NULL DEFAULT 1');
}
// Migrering: postnummer, brukernavn, søkbarhet og normalisert mobilnummer på brukere; kallenavn på venner
{
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!cols.includes('postnr')) db.exec('ALTER TABLE users ADD COLUMN postnr TEXT');
  if (!cols.includes('username')) db.exec('ALTER TABLE users ADD COLUMN username TEXT');
  if (!cols.includes('searchable')) db.exec('ALTER TABLE users ADD COLUMN searchable INTEGER NOT NULL DEFAULT 1');
  if (!cols.includes('phone_norm')) {
    db.exec('ALTER TABLE users ADD COLUMN phone_norm TEXT');
    for (const u of db.prepare('SELECT id, phone FROM users WHERE phone IS NOT NULL').all()) db.prepare('UPDATE users SET phone_norm=? WHERE id=?').run(normPhone(u.phone), u.id);
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_username ON users(lower(username)) WHERE username IS NOT NULL');
  db.exec('CREATE INDEX IF NOT EXISTS users_phone ON users(phone_norm)');
  if (!db.prepare('PRAGMA table_info(friends)').all().some((c) => c.name === 'nickname')) db.exec('ALTER TABLE friends ADD COLUMN nickname TEXT');
}
// Mobilnummer lagres også uten mellomrom og landskode, så man finner hverandre uansett hvordan nummeret er skrevet
function normPhone(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('0047')) d = d.slice(4); else if (d.length === 10 && d.startsWith('47')) d = d.slice(2);
  return d.length >= 5 ? d : null;
}
// Migrering: gaveideer kan høre til en liste
if (!db.prepare('PRAGMA table_info(gift_ideas)').all().some((c) => c.name === 'list_id')) {
  db.exec('ALTER TABLE gift_ideas ADD COLUMN list_id INTEGER REFERENCES gift_lists(id) ON DELETE SET NULL');
}
// Migrering: gamle julelister (christmas_entries) blir vanlige lister i gaveplanleggeren
for (const g of db.prepare('SELECT DISTINCT owner_id, year FROM christmas_entries').all()) {
  const lid = Number(db.prepare("INSERT INTO gift_lists(owner_id, name, kind, deadline) VALUES (?,?,'jul',?)")
    .run(g.owner_id, `Juleliste ${g.year}`, `${g.year}-12-24`).lastInsertRowid);
  db.prepare(`INSERT OR IGNORE INTO gift_list_people(list_id, recipient_id, budget, sort)
              SELECT ?, recipient_id, budget, sort FROM christmas_entries WHERE owner_id=? AND year=?`).run(lid, g.owner_id, g.year);
  db.prepare(`UPDATE gift_ideas SET list_id=? WHERE list_id IS NULL AND lower(occasion)=lower(?)
              AND recipient_id IN (SELECT recipient_id FROM gift_list_people WHERE list_id=?)`).run(lid, `Jul ${g.year}`, lid);
  db.prepare('DELETE FROM christmas_entries WHERE owner_id=? AND year=?').run(g.owner_id, g.year);
}

// ---------- Hjelpefunksjoner ----------
const token = (n = 24) => crypto.randomBytes(n).toString('base64url');
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');
const q = (sql) => db.prepare(sql);

function isHttpUrl(s) {
  try { const u = new URL(s); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; }
}
function cleanStr(s, max = 500) { return typeof s === 'string' ? s.trim().slice(0, max) : ''; }

function todayParts(now = new Date()) {
  // Bruker norsk tid for «i dag»
  const s = now.toLocaleDateString('sv-SE', { timeZone: CONFIG.timeZone || 'Europe/Oslo' });
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}
function birthdayInfo(birthdate, now = new Date()) {
  if (!birthdate) return null;
  const [by, bm, bd] = birthdate.split('-').map(Number);
  const t = todayParts(now);
  const today = Date.UTC(t.y, t.m - 1, t.d);
  const mk = (y) => {
    // 29. februar feires 28. februar i år uten skuddår
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    const day = bm === 2 && bd === 29 && !leap ? 28 : bd;
    return Date.UTC(y, bm - 1, day);
  };
  let next = mk(t.y), year = t.y;
  if (next < today) { next = mk(t.y + 1); year = t.y + 1; }
  const days = Math.round((next - today) / 86400000);
  return { daysUntil: days, turning: by > 0 ? year - by : null, nextDate: new Date(next).toISOString().slice(0, 10) };
}
function ageOf(birthdate) {
  const b = birthdayInfo(birthdate);
  if (!b) return null;
  return b.daysUntil === 0 ? b.turning : b.turning - 1;
}

function publicUser(u) {
  return {
    id: u.id, name: u.name, email: u.email, birthdate: u.birthdate, gender: u.gender,
    phone: u.phone || '', emailReminders: !!u.email_reminders,
    postnr: u.postnr || '', username: u.username || '', searchable: !!u.searchable,
    shareUrl: `${BASE_URL}/#/invitasjon/${u.share_token}`,
  };
}
// u.nickname er kallenavnet DU har gitt vennen (bare du ser det). displayName brukes overalt i visningen.
function friendView(u) {
  const base = { id: u.id, name: u.name, email: u.email, username: u.username || '', nickname: u.nickname || '', displayName: u.nickname || u.name };
  const b = birthdayInfo(u.birthdate);
  if (!b) return { ...base, birthday: null, daysUntil: null, turning: null, nextDate: null };
  return { ...base, birthday: u.birthdate.slice(5), ...b };
}
const POSTNR_RE = /^\d{4}$/;
const USERNAME_RE = /^[a-zA-Z0-9æøåÆØÅ._-]{3,30}$/;
function checkProfileExtras(body, userId) {
  const postnr = cleanStr(body.postnr, 10);
  if (postnr && !POSTNR_RE.test(postnr)) throw Object.assign(new Error('Postnummer må være fire siffer.'), { status: 400 });
  let username = cleanStr(body.username, 40).replace(/^@/, '');
  if (username) {
    if (!USERNAME_RE.test(username)) throw Object.assign(new Error('Brukernavn må være 3–30 tegn: bokstaver, tall, punktum, bindestrek eller understrek.'), { status: 400 });
    if (q('SELECT 1 FROM users WHERE lower(username)=lower(?) AND id!=?').get(username, userId || 0)) throw Object.assign(new Error('Brukernavnet er opptatt. Prøv et annet.'), { status: 409 });
  }
  return { postnr: postnr || null, username: username || null };
}
function areFriends(a, b) { return !!q('SELECT 1 FROM friends WHERE user_id=? AND friend_id=?').get(a, b); }
function makeFriends(a, b) {
  if (a === b) return;
  q('INSERT OR IGNORE INTO friends(user_id, friend_id) VALUES (?,?)').run(a, b);
  q('INSERT OR IGNORE INTO friends(user_id, friend_id) VALUES (?,?)').run(b, a);
  q('DELETE FROM friend_requests WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?)').run(a, b, b, a);
}
function notify(userId, kind, message, link = null, dedupeKey = null) {
  q('INSERT OR IGNORE INTO notifications(user_id, kind, message, link, dedupe_key) VALUES (?,?,?,?,?)')
    .run(userId, kind, message, link, dedupeKey);
}

// ---------- E-post (valgfritt, via Resend sitt HTTP-API) ----------
// E-post sendes via egen e-postkonto (SMTP_HOST …) eller Resend (RESEND_API_KEY). Returnerer { ok, error }.
const MAIL_FROM = () => process.env.MAIL_FROM || process.env.SMTP_USER || 'Gaveplanlegger <varsel@example.com>';
const emailConfigured = () => !!(process.env.SMTP_HOST || process.env.RESEND_API_KEY);
async function sendEmail(to, subject, text, { replyTo } = {}) {
  try {
    if (smtpConfig()) {
      await sendSmtp({ from: MAIL_FROM(), to, subject, text, replyTo });
      return { ok: true };
    }
    const key = process.env.RESEND_API_KEY;
    if (!key) { console.log(`[e-post ikke konfigurert] Til ${to}: ${subject}`); return { ok: false, error: 'E-post er ikke satt opp.' }; }
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: MAIL_FROM(), to, subject, text, ...(replyTo ? { reply_to: replyTo } : {}) }),
    });
    if (!r.ok) { const t = await r.text(); console.error('[e-post] Resend feilet', r.status, t); return { ok: false, error: `Resend svarte ${r.status}: ${t.slice(0, 200)}` }; }
    return { ok: true };
  } catch (e) {
    console.error('[e-post] Sending feilet:', e.code || '', e.message);
    return { ok: false, error: e.code === 'ERR_TLS_CERT_ALTNAME_INVALID' || /certificate|cert/i.test(e.message)
      ? `Sertifikatet til e-postserveren passer ikke med SMTP_HOST (${e.message}).` : e.message };
  }
}

// ---------- Bursdagsvarsler (kjøres ved oppstart og hver time) ----------
function runBirthdayReminders() {
  const users = q('SELECT * FROM users').all();
  const t = todayParts();
  for (const friend of users) {
    const b = birthdayInfo(friend.birthdate);
    if (!b) continue; // har ikke lagt inn bursdag
    if (!REMINDER_DAYS.includes(b.daysUntil) && b.daysUntil !== 0) continue;
    const watchers = q('SELECT u.*, f.nickname AS friend_nick FROM friends f JOIN users u ON u.id=f.user_id WHERE f.friend_id=?').all(friend.id);
    for (const w of watchers) {
      const when = b.daysUntil === 0 ? 'i dag' : b.daysUntil === 1 ? 'i morgen' : `om ${b.daysUntil} dager`;
      const msg = `${w.friend_nick || friend.name} fyller ${b.turning} år ${when}!`;
      const key = `bday:${w.id}:${friend.id}:${b.nextDate}:${b.daysUntil}`;
      const exists = q('SELECT 1 FROM notifications WHERE dedupe_key=?').get(key);
      if (exists) continue;
      notify(w.id, 'birthday', msg, `#/venn/${friend.id}`, key);
      if (w.email_reminders) {
        sendEmail(w.email, `🎁 ${msg}`,
          `Hei ${w.name}!\n\n${msg}\nSe ønskelisten og reserver en gave: ${BASE_URL}/#/venn/${friend.id}\n\nHilsen Gaveplanlegger`);
      }
    }
  }
  // Personer i gaveplanleggeren (uten konto) – varsle eieren
  for (const r of q('SELECT r.*, u.email AS owner_email, u.name AS owner_name, u.email_reminders FROM recipients r JOIN users u ON u.id=r.owner_id WHERE r.birthdate IS NOT NULL').all()) {
    const b = birthdayInfo(r.birthdate);
    if (!REMINDER_DAYS.includes(b.daysUntil) && b.daysUntil !== 0) continue;
    const when = b.daysUntil === 0 ? 'i dag' : b.daysUntil === 1 ? 'i morgen' : `om ${b.daysUntil} dager`;
    const msg = b.turning ? `${r.name} fyller ${b.turning} år ${when}!` : `${r.name} har bursdag ${when}!`;
    const key = `rbday:${r.owner_id}:${r.id}:${b.nextDate}:${b.daysUntil}`;
    if (q('SELECT 1 FROM notifications WHERE dedupe_key=?').get(key)) continue;
    notify(r.owner_id, 'birthday', msg, '#/gaveplanlegger', key);
    if (r.email_reminders) sendEmail(r.owner_email, `🎁 ${msg}`, `Hei ${r.owner_name}!\n\n${msg}\nSe gaveideene dine: ${BASE_URL}/#/gaveplanlegger\n\nHilsen Gaveplanlegger`);
  }
  // Frist på lister i gaveplanleggeren: varsle 7 og 1 dag før hvis noen mangler gave
  for (const l of q('SELECT * FROM gift_lists').all()) {
    const days = daysUntilDate(l.deadline);
    if (![7, 1].includes(days)) continue;
    const s = listSummary(l);
    if (!s.people || s.done >= s.people) continue;
    const key = `listdl:${l.id}:${l.deadline}:${days}`;
    if (q('SELECT 1 FROM notifications WHERE dedupe_key=?').get(key)) continue;
    notify(l.owner_id, 'wish', `«${l.name}»: ${days === 1 ? 'fristen er i morgen' : 'en uke til fristen'} – ${s.people - s.done} ${s.people - s.done === 1 ? 'person mangler' : 'personer mangler'} gave.`, `#/liste/${l.id}`, key);
  }
  q("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
  return t;
}

// ---------- Annonser (Google AdSense eller tilsvarende) ----------
function adsConfig() {
  const ads = CONFIG.ads || {};
  const client = process.env.ADSENSE_CLIENT || ads.client || '';
  const enabled = /^ca-pub-\d{10,}$/.test(client);
  return { enabled, client: enabled ? client : null, slots: ads.slots || {}, showPlaceholders: !enabled && ads.showPlaceholders !== false };
}
function adsTxt() {
  const { client } = adsConfig();
  if (!client) return '# Legg inn AdSense-ID (ca-pub-...) i config.json for å aktivere ads.txt\n';
  return `google.com, ${client.replace('ca-', '')}, DIRECT, f08c47fec0942fa0\n`;
}

// ---------- HTTP ----------
// I drift (https): be nettleseren alltid bruke https, og ikke la andre sider ramme inn appen
const SECURITY_HEADERS = BASE_URL.startsWith('https')
  ? { 'Strict-Transport-Security': 'max-age=31536000', 'X-Frame-Options': 'SAMEORIGIN' }
  : { 'X-Frame-Options': 'SAMEORIGIN' };
function send(res, status, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    ...SECURITY_HEADERS,
    ...headers,
  });
  res.end(isObj ? JSON.stringify(body) : body);
}
const err = (res, status, message) => send(res, status, { error: message });

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function sessionCookie(tok, maxAge) {
  const secure = BASE_URL.startsWith('https') ? '; Secure' : '';
  return `sid=${tok}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}
function currentUser(req) {
  const sid = parseCookies(req).sid;
  if (!sid) return null;
  return q(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
            WHERE s.token=? AND s.expires_at > datetime('now')`).get(sid) || null;
}
function startSession(res, userId) {
  const tok = token(32);
  q(`INSERT INTO sessions(token, user_id, expires_at) VALUES (?,?, datetime('now', '+${SESSION_DAYS} days'))`).run(tok, userId);
  return sessionCookie(tok, SESSION_DAYS * 86400);
}
async function readJson(req) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > 100_000) throw new Error('For stor forespørsel'); chunks.push(c); }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

// Klientens IP-adresse. Bak Render/Railway kommer den i X-Forwarded-For (sett TRUST_PROXY=1).
function clientIp(req) {
  if (process.env.TRUST_PROXY) {
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (fwd) return fwd;
  }
  return req.socket.remoteAddress;
}
function adminEmails() {
  return (process.env.ADMIN_EMAILS || CONFIG.adminEmails?.join(',') || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
}
const isAdmin = (u) => !!u && adminEmails().includes(u.email.toLowerCase());

// Enkel bremse mot gjetting av passord
const attempts = new Map();
function rateLimited(key, max = 10) {
  const now = Date.now();
  const list = (attempts.get(key) || []).filter((t) => now - t < 15 * 60_000);
  list.push(now); attempts.set(key, list);
  return list.length > max;
}

// ---------- Ruter ----------
const routes = [];
const route = (method, pattern, handler, opts = {}) => {
  const keys = []; const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler, auth: opts.auth !== false });
};

// --- Konto ---
const GENDERS = ['kvinne', 'mann', 'annet', 'ikke_oppgitt'];
route('POST', '/api/register', async (req, res, { body }) => {
  const email = cleanStr(body.email, 200).toLowerCase();
  const name = cleanStr(body.name, 100);
  const birthdate = cleanStr(body.birthdate, 10) || null; // valgfritt
  const gender = cleanStr(body.gender, 30) || null;        // valgfritt
  const phone = cleanStr(body.phone, 30);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err(res, 400, 'Ugyldig e-postadresse.');
  if (!name) return err(res, 400, 'Navn må fylles ut.');
  if (birthdate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthdate) || isNaN(Date.parse(birthdate))) return err(res, 400, 'Ugyldig fødselsdato.');
    if (Date.parse(birthdate) > Date.now()) return err(res, 400, 'Fødselsdato kan ikke være i fremtiden.');
    if (ageOf(birthdate) < MIN_AGE) return err(res, 400, `Du må være minst ${MIN_AGE} år for å registrere deg.`);
  }
  if (!body.confirmAge) return err(res, 400, `Bekreft at du er ${MIN_AGE} år eller eldre.`);
  if (gender && !GENDERS.includes(gender)) return err(res, 400, 'Ugyldig valg for kjønn.');
  if (password.length < 8) return err(res, 400, 'Passordet må ha minst 8 tegn.');
  if (!body.acceptTerms) return err(res, 400, 'Du må godta vilkårene og personvernerklæringen.');
  if (q('SELECT 1 FROM users WHERE email=?').get(email)) return err(res, 409, 'Det finnes allerede en konto med denne e-postadressen.');
  const extra = checkProfileExtras(body);
  const salt = token(16);
  const r = q(`INSERT INTO users(email, name, birthdate, gender, phone, phone_norm, postnr, username, pw_hash, pw_salt, share_token)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(email, name, birthdate, gender, phone || null, normPhone(phone), extra.postnr, extra.username, hashPw(password, salt), salt, token(12));
  const id = Number(r.lastInsertRowid);
  // Ventende venneforespørsler som ble sendt til denne e-posten før registrering
  const cookie = startSession(res, id);
  send(res, 201, { user: publicUser(q('SELECT * FROM users WHERE id=?').get(id)) }, { 'Set-Cookie': cookie });
}, { auth: false });

route('POST', '/api/login', async (req, res, { body }) => {
  const email = cleanStr(body.email, 200).toLowerCase();
  if (rateLimited('login:' + email) || rateLimited('ip:' + clientIp(req))) return err(res, 429, 'For mange forsøk. Vent litt og prøv igjen.');
  const u = q('SELECT * FROM users WHERE email=?').get(email);
  const ok = u && crypto.timingSafeEqual(Buffer.from(hashPw(String(body.password || ''), u.pw_salt), 'hex'), Buffer.from(u.pw_hash, 'hex'));
  if (!ok) return err(res, 401, 'Feil e-post eller passord.');
  send(res, 200, { user: publicUser(u) }, { 'Set-Cookie': startSession(res, u.id) });
}, { auth: false });

// --- Glemt passord ---
const RESET_HOURS = 2;
const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');
function createResetLink(userId, hours = RESET_HOURS) {
  const tok = token(32);
  q("UPDATE password_resets SET used=1 WHERE user_id=? AND used=0").run(userId); // bare den nyeste lenken virker
  q(`INSERT INTO password_resets(token_hash, user_id, expires_at) VALUES (?,?, datetime('now', '+${Number(hours)} hours'))`).run(sha256(tok), userId);
  return `${BASE_URL}/#/nytt-passord/${tok}`;
}
// Svarer alltid likt, så ingen kan finne ut hvilke e-poster som har konto
route('POST', '/api/password/forgot', async (req, res, { body }) => {
  const email = cleanStr(body.email, 200).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err(res, 400, 'Skriv inn e-postadressen du registrerte deg med.');
  if (rateLimited('forgot-ip:' + clientIp(req), 10) || rateLimited('forgot:' + email, 3)) return err(res, 429, 'For mange forsøk. Vent litt og prøv igjen.');
  const u = q('SELECT * FROM users WHERE email=?').get(email);
  if (u) {
    const link = createResetLink(u.id);
    await sendEmail(u.email, `Nytt passord – ${siteInfo().name}`,
      `Hei ${u.name}!\n\nNoen (forhåpentligvis du) har bedt om å lage nytt passord.\nBruk denne lenken innen ${RESET_HOURS} timer:\n${link}\n\nHar du ikke bedt om dette, kan du se bort fra e-posten. Passordet ditt er ikke endret.\n\nHilsen ${siteInfo().name}`);
  }
  send(res, 200, { ok: true, emailEnabled: emailConfigured() });
}, { auth: false });
route('GET', '/api/password/reset/:token', async (req, res, { params }) => {
  const r = q(`SELECT u.name FROM password_resets p JOIN users u ON u.id=p.user_id
               WHERE p.token_hash=? AND p.used=0 AND p.expires_at > datetime('now')`).get(sha256(params.token));
  if (!r) return err(res, 410, 'Lenken er brukt eller utløpt. Be om en ny.');
  send(res, 200, { name: r.name.split(' ')[0] });
}, { auth: false });
route('POST', '/api/password/reset', async (req, res, { body }) => {
  if (rateLimited('reset-ip:' + clientIp(req), 20)) return err(res, 429, 'For mange forsøk. Vent litt og prøv igjen.');
  const password = typeof body.password === 'string' ? body.password : '';
  if (password.length < 8) return err(res, 400, 'Passordet må ha minst 8 tegn.');
  const r = q(`SELECT * FROM password_resets WHERE token_hash=? AND used=0 AND expires_at > datetime('now')`).get(sha256(String(body.token || '')));
  if (!r) return err(res, 410, 'Lenken er brukt eller utløpt. Be om en ny.');
  const salt = token(16);
  q('UPDATE users SET pw_hash=?, pw_salt=? WHERE id=?').run(hashPw(password, salt), salt, r.user_id);
  q('UPDATE password_resets SET used=1 WHERE user_id=?').run(r.user_id);
  q('DELETE FROM sessions WHERE user_id=?').run(r.user_id); // logg ut alle andre steder
  const u = q('SELECT * FROM users WHERE id=?').get(r.user_id);
  notify(u.id, 'friend', 'Passordet ditt ble endret. Var det ikke deg, ta kontakt med oss med en gang.', '#/kontakt');
  send(res, 200, { user: publicUser(u) }, { 'Set-Cookie': startSession(res, u.id) });
}, { auth: false });

route('POST', '/api/logout', async (req, res) => {
  const sid = parseCookies(req).sid;
  if (sid) q('DELETE FROM sessions WHERE token=?').run(sid);
  send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
}, { auth: false });

route('GET', '/api/me', async (req, res, { user }) => {
  if (!user) return send(res, 200, { user: null });
  const unread = q('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read=0').get(user.id).n;
  const requests = q('SELECT COUNT(*) n FROM friend_requests WHERE to_id=?').get(user.id).n;
  send(res, 200, { user: { ...publicUser(user), isAdmin: isAdmin(user) }, unread, requests,
    newFeedback: isAdmin(user) ? q("SELECT COUNT(*) n FROM feedback WHERE status='ny'").get().n : 0 });
}, { auth: false });

route('PUT', '/api/me', async (req, res, { user, body }) => {
  const name = cleanStr(body.name, 100) || user.name;
  const phone = cleanStr(body.phone, 30);
  // Tomt felt fjerner opplysningen (begge er valgfrie)
  const gender = body.gender === '' ? null : GENDERS.includes(body.gender) ? body.gender : user.gender;
  let birthdate = user.birthdate;
  if (body.birthdate === '') birthdate = null;
  else if (/^\d{4}-\d{2}-\d{2}$/.test(body.birthdate || '')) {
    if (Date.parse(body.birthdate) > Date.now()) return err(res, 400, 'Fødselsdato kan ikke være i fremtiden.');
    birthdate = body.birthdate;
  }
  const extra = checkProfileExtras(body, user.id);
  const searchable = body.searchable === undefined ? user.searchable : body.searchable ? 1 : 0;
  q('UPDATE users SET name=?, phone=?, phone_norm=?, gender=?, birthdate=?, email_reminders=?, postnr=?, username=?, searchable=? WHERE id=?')
    .run(name, phone || null, normPhone(phone), gender, birthdate, body.emailReminders ? 1 : 0, extra.postnr, extra.username, searchable, user.id);
  if (body.newPassword) {
    if (String(body.newPassword).length < 8) return err(res, 400, 'Nytt passord må ha minst 8 tegn.');
    if (hashPw(String(body.currentPassword || ''), user.pw_salt) !== user.pw_hash) return err(res, 400, 'Nåværende passord er feil.');
    const salt = token(16);
    q('UPDATE users SET pw_hash=?, pw_salt=? WHERE id=?').run(hashPw(String(body.newPassword), salt), salt, user.id);
  }
  send(res, 200, { user: publicUser(q('SELECT * FROM users WHERE id=?').get(user.id)) });
});

route('POST', '/api/me/new-share-link', async (req, res, { user }) => {
  q('UPDATE users SET share_token=? WHERE id=?').run(token(12), user.id);
  send(res, 200, { user: publicUser(q('SELECT * FROM users WHERE id=?').get(user.id)) });
});

route('DELETE', '/api/me', async (req, res, { user, body }) => {
  if (hashPw(String(body.password || ''), user.pw_salt) !== user.pw_hash) return err(res, 400, 'Feil passord.');
  q('DELETE FROM users WHERE id=?').run(user.id);
  send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
});

// --- Egne ønsker (eier ser ALDRI hvem/om noen har reservert) ---
route('GET', '/api/wishes', async (req, res, { user }) => {
  const rows = q(`SELECT id, title, url, note, price, priority, status, created_at FROM wishes
                  WHERE user_id=? AND status!='removed' ORDER BY status='received', priority, created_at DESC`).all(user.id);
  send(res, 200, { wishes: rows });
});
function wishInput(body) {
  const title = cleanStr(body.title, 200);
  const url = cleanStr(body.url, 2000);
  if (!title) throw Object.assign(new Error('Ønsket må ha en tittel.'), { status: 400 });
  if (url && !isHttpUrl(url)) throw Object.assign(new Error('Lenken må starte med http:// eller https://'), { status: 400 });
  const priority = [1, 2, 3].includes(Number(body.priority)) ? Number(body.priority) : 2;
  return { title, url: url || null, note: cleanStr(body.note, 1000) || null, price: cleanStr(body.price, 40) || null, priority };
}
route('POST', '/api/wishes', async (req, res, { user, body }) => {
  const w = wishInput(body);
  const r = q('INSERT INTO wishes(user_id, title, url, note, price, priority) VALUES (?,?,?,?,?,?)')
    .run(user.id, w.title, w.url, w.note, w.price, w.priority);
  send(res, 201, { id: Number(r.lastInsertRowid) });
});
route('PUT', '/api/wishes/:id', async (req, res, { user, body, params }) => {
  const wish = q('SELECT * FROM wishes WHERE id=? AND user_id=?').get(params.id, user.id);
  if (!wish) return err(res, 404, 'Fant ikke ønsket.');
  if (body.status) {
    if (!['active', 'received', 'removed'].includes(body.status)) return err(res, 400, 'Ugyldig status.');
    q("UPDATE wishes SET status=?, updated_at=datetime('now') WHERE id=?").run(body.status, wish.id);
    // Gi beskjed til den som eventuelt har reservert, uten at eier får vite noe
    const claim = q('SELECT user_id FROM claims WHERE wish_id=?').get(wish.id);
    if (claim && body.status !== 'active') {
      const txt = body.status === 'received'
        ? `${user.name} har markert «${wish.title}» som mottatt.`
        : `${user.name} har fjernet «${wish.title}» fra ønskelisten – du har reservert dette ønsket.`;
      notify(claim.user_id, 'wish', txt, '#/reservasjoner');
    }
  } else {
    const w = wishInput(body);
    q("UPDATE wishes SET title=?, url=?, note=?, price=?, priority=?, updated_at=datetime('now') WHERE id=?")
      .run(w.title, w.url, w.note, w.price, w.priority, wish.id);
  }
  send(res, 200, { ok: true });
});

// --- Venner ---
route('GET', '/api/friends', async (req, res, { user }) => {
  const friends = q('SELECT u.*, f.nickname FROM friends f JOIN users u ON u.id=f.friend_id WHERE f.user_id=?').all(user.id)
    .map(friendView).sort((a, b) => (a.daysUntil ?? 9999) - (b.daysUntil ?? 9999) || a.displayName.localeCompare(b.displayName, 'nb'));
  const incoming = q('SELECT u.id, u.name, u.email, u.username FROM friend_requests r JOIN users u ON u.id=r.from_id WHERE r.to_id=?').all(user.id);
  const outgoing = q('SELECT u.id, u.name, u.email, u.username FROM friend_requests r JOIN users u ON u.id=r.to_id WHERE r.from_id=?').all(user.id);
  send(res, 200, { friends, incoming, outgoing, upcomingWindow: UPCOMING_WINDOW });
});
// Finn venner på navn, brukernavn, e-post eller mobilnummer.
// E-post og mobil må stemme helt; navnesøk viser bare dem som har sagt ja til å bli funnet (standard).
route('GET', '/api/users/search', async (req, res, { user, url }) => {
  if (rateLimited('search:' + user.id, 60)) return err(res, 429, 'Mange søk på kort tid. Vent litt og prøv igjen.');
  const term = cleanStr(url.searchParams.get('q'), 100);
  let rows = [], kind = 'name';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(term)) { kind = 'email'; rows = q('SELECT * FROM users WHERE email=?').all(term.toLowerCase()); }
  else if (/^[+\d][\d\s-]{4,}$/.test(term)) { kind = 'phone'; const n = normPhone(term); rows = n ? q('SELECT * FROM users WHERE phone_norm=?').all(n) : []; }
  else {
    const t = term.replace(/^@/, '').toLowerCase();
    if (t.length < 3) return err(res, 400, 'Skriv minst 3 bokstaver.');
    const like = '%' + t.replace(/[%_\\]/g, '\\$&') + '%';
    rows = q(`SELECT * FROM users WHERE id!=? AND (lower(username)=? OR (searchable=1 AND (lower(name) LIKE ? ESCAPE '\\' OR lower(username) LIKE ? ESCAPE '\\')))
              ORDER BY lower(username)=? DESC, name LIMIT 15`).all(user.id, t, like, like, t);
  }
  const results = rows.filter((u) => u.id !== user.id).map((u) => ({
    id: u.id, name: u.name, username: u.username || '',
    status: areFriends(user.id, u.id) ? 'friends'
      : q('SELECT 1 FROM friend_requests WHERE from_id=? AND to_id=?').get(user.id, u.id) ? 'requested'
      : q('SELECT 1 FROM friend_requests WHERE from_id=? AND to_id=?').get(u.id, user.id) ? 'incoming' : 'none',
  }));
  send(res, 200, { kind, results });
});
route('PUT', '/api/friends/:id/nickname', async (req, res, { user, params, body }) => {
  const nickname = cleanStr(body.nickname, 60) || null;
  const r = q('UPDATE friends SET nickname=? WHERE user_id=? AND friend_id=?').run(nickname, user.id, Number(params.id));
  if (!r.changes) return err(res, 404, 'Fant ikke vennen.');
  send(res, 200, { ok: true, nickname });
});
route('POST', '/api/friends', async (req, res, { user, body }) => {
  const email = cleanStr(body.email, 200).toLowerCase();
  const other = body.userId ? q('SELECT * FROM users WHERE id=?').get(Number(body.userId)) : q('SELECT * FROM users WHERE email=?').get(email);
  if (!other) return send(res, 200, { status: 'not_registered' });
  if (other.id === user.id) return err(res, 400, 'Det er deg selv 🙂');
  if (areFriends(user.id, other.id)) return send(res, 200, { status: 'already' });
  if (q('SELECT 1 FROM friend_requests WHERE from_id=? AND to_id=?').get(other.id, user.id)) {
    makeFriends(user.id, other.id);
    notify(other.id, 'friend', `${user.name} godtok venneforespørselen din.`, '#/venner');
    return send(res, 200, { status: 'friends' });
  }
  q('INSERT OR IGNORE INTO friend_requests(from_id, to_id) VALUES (?,?)').run(user.id, other.id);
  notify(other.id, 'friend', `${user.name} vil bli venn med deg på Gaveplanlegger.`, '#/venner');
  send(res, 200, { status: 'requested' });
});
route('POST', '/api/friends/:id/accept', async (req, res, { user, params }) => {
  const id = Number(params.id);
  if (!q('SELECT 1 FROM friend_requests WHERE from_id=? AND to_id=?').get(id, user.id)) return err(res, 404, 'Fant ikke forespørselen.');
  makeFriends(user.id, id);
  notify(id, 'friend', `${user.name} godtok venneforespørselen din.`, '#/venner');
  send(res, 200, { ok: true });
});
route('POST', '/api/friends/:id/decline', async (req, res, { user, params }) => {
  q('DELETE FROM friend_requests WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?)').run(params.id, user.id, user.id, params.id);
  send(res, 200, { ok: true });
});
route('DELETE', '/api/friends/:id', async (req, res, { user, params }) => {
  const id = Number(params.id);
  q('DELETE FROM friends WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?)').run(user.id, id, id, user.id);
  send(res, 200, { ok: true });
});
// Invitasjonslenke: innlogget bruker som åpner lenken blir venn med eieren
route('GET', '/api/invite/:token', async (req, res, { params }) => {
  const owner = q('SELECT id, name FROM users WHERE share_token=?').get(params.token);
  if (!owner) return err(res, 404, 'Lenken er ugyldig eller utløpt.');
  send(res, 200, { owner });
}, { auth: false });
route('POST', '/api/invite/:token', async (req, res, { user, params }) => {
  const owner = q('SELECT id, name FROM users WHERE share_token=?').get(params.token);
  if (!owner) return err(res, 404, 'Lenken er ugyldig eller utløpt.');
  if (owner.id !== user.id && !areFriends(user.id, owner.id)) {
    makeFriends(user.id, owner.id);
    notify(owner.id, 'friend', `${user.name} har åpnet ønskelisten din og er nå venn med deg.`, '#/venner');
  }
  send(res, 200, { ownerId: owner.id });
});

// --- Venners lister og reservasjoner ---
route('GET', '/api/friends/:id/wishes', async (req, res, { user, params }) => {
  const id = Number(params.id);
  if (!areFriends(user.id, id)) return err(res, 403, 'Du må være venn for å se denne listen.');
  const friend = q('SELECT u.*, f.nickname FROM users u JOIN friends f ON f.friend_id=u.id AND f.user_id=? WHERE u.id=?').get(user.id, id);
  const rows = q(`SELECT w.id, w.title, w.url, w.note, w.price, w.priority, c.user_id AS claimer
                  FROM wishes w LEFT JOIN claims c ON c.wish_id=w.id
                  WHERE w.user_id=? AND w.status='active' ORDER BY w.priority, w.created_at DESC`).all(id);
  const wishes = rows.map((w) => ({
    id: w.id, title: w.title, note: w.note, price: w.price, priority: w.priority,
    host: w.url ? new URL(w.url).hostname.replace(/^www\./, '') : null,
    url: w.url && isHttpUrl(w.url) ? w.url : null,
    claimed: !!w.claimer, claimedByMe: w.claimer === user.id,
  }));
  const eventLists = q(`SELECT * FROM registries WHERE (owner_id=? OR partner_id=?) AND visible_friends=1 AND event_date >= date('now','-7 days') ORDER BY event_date`)
    .all(id, id).map((g) => ({ title: g.title, kind: g.kind, eventDate: g.event_date, daysLeft: daysUntilDate(g.event_date), url: `#/onskeliste/${g.token}` }));
  send(res, 200, { friend: friendView(friend), wishes, eventLists });
});
route('POST', '/api/wishes/:id/claim', async (req, res, { user, params }) => {
  const w = q('SELECT * FROM wishes WHERE id=?').get(params.id);
  if (!w || w.status !== 'active' || !areFriends(user.id, w.user_id)) return err(res, 404, 'Fant ikke ønsket.');
  const r = q('INSERT OR IGNORE INTO claims(wish_id, user_id) VALUES (?,?)').run(w.id, user.id);
  if (!r.changes) return err(res, 409, 'Noen andre har allerede tatt dette ønsket.');
  send(res, 200, { ok: true });
});
route('DELETE', '/api/wishes/:id/claim', async (req, res, { user, params }) => {
  q('DELETE FROM claims WHERE wish_id=? AND user_id=?').run(params.id, user.id);
  send(res, 200, { ok: true });
});
route('GET', '/api/claims', async (req, res, { user }) => {
  const rows = q(`SELECT w.id, w.title, w.url, w.price, w.status, u.id AS owner_id, u.name AS owner_name, u.birthdate
                  FROM claims c JOIN wishes w ON w.id=c.wish_id JOIN users u ON u.id=w.user_id
                  WHERE c.user_id=? ORDER BY u.name`).all(user.id)
    .map((r) => ({ ...r, url: r.url && isHttpUrl(r.url) ? r.url : null, daysUntil: birthdayInfo(r.birthdate)?.daysUntil ?? null, birthdate: undefined }));
  const wedding = q(`SELECT c.qty, c.amount, c.cancel_token, i.title, i.url, i.price, i.status, g.title AS registry, g.token, g.event_date
                     FROM registry_claims c JOIN registry_items i ON i.id=c.item_id JOIN registries g ON g.id=i.registry_id
                     WHERE c.user_id=? ORDER BY g.event_date`).all(user.id)
    .map((w) => ({ ...w, url: w.url && isHttpUrl(w.url) ? w.url : null, daysUntil: daysUntilDate(w.event_date) }));
  send(res, 200, { claims: rows, wedding });
});

// --- Varsler og oversikt ---
route('GET', '/api/notifications', async (req, res, { user }) => {
  const rows = q('SELECT id, kind, message, link, read, created_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50').all(user.id);
  send(res, 200, { notifications: rows });
});
route('POST', '/api/notifications/read', async (req, res, { user }) => {
  q('UPDATE notifications SET read=1 WHERE user_id=?').run(user.id);
  send(res, 200, { ok: true });
});
route('GET', '/api/dashboard', async (req, res, { user }) => {
  const friends = q('SELECT u.*, f.nickname FROM friends f JOIN users u ON u.id=f.friend_id WHERE f.user_id=?').all(user.id).map(friendView).map((f) => ({ ...f, name: f.displayName }));
  const recips = q('SELECT * FROM recipients WHERE owner_id=? AND birthdate IS NOT NULL').all(user.id)
    .map((r) => ({ id: r.id, name: r.name, birthday: r.birthdate.slice(5), ...birthdayInfo(r.birthdate), planner: true,
      ideas: q("SELECT COUNT(*) n FROM gift_ideas WHERE recipient_id=? AND status!='given'").get(r.id).n }));
  const upcoming = [...friends, ...recips].filter((f) => f.daysUntil != null && f.daysUntil <= UPCOMING_WINDOW).sort((a, b) => a.daysUntil - b.daysUntil);
  const counts = q("SELECT COUNT(*) n FROM wishes WHERE user_id=? AND status='active'").get(user.id).n;
  const claims = q('SELECT COUNT(*) n FROM claims WHERE user_id=?').get(user.id).n;
  const mine = birthdayInfo(user.birthdate); // null hvis ikke lagt inn
  send(res, 200, { friendsLists: friendsEventLists(user.id).filter((g) => g.daysLeft <= 60), upcoming, activeWishes: counts, myClaims: claims, friendCount: friends.length, recipientCount: q('SELECT COUNT(*) n FROM recipients WHERE owner_id=? AND linked_user_id IS NULL').get(user.id).n,
    nextList: (() => {
      const l = q('SELECT * FROM gift_lists WHERE owner_id=?').all(user.id).map(listSummary)
        .filter((x) => x.daysLeft >= 0 && x.daysLeft <= 60).sort((a, b) => a.daysLeft - b.daysLeft)[0];
      return l || null;
    })(),
    registries: q('SELECT COUNT(*) n FROM registries WHERE owner_id=? OR partner_id=?').get(user.id, user.id).n, myBirthday: mine, window: UPCOMING_WINDOW });
});

// --- Hent navn og pris fra en produktlenke ---
route('POST', '/api/link-preview', async (req, res, { user, body }) => {
  const url = cleanStr(body.url, 2000);
  if (!isHttpUrl(url)) return err(res, 400, 'Lenken må starte med http:// eller https://');
  if (rateLimited('preview:' + user.id, 60)) return err(res, 429, 'Du har hentet mange lenker på kort tid. Vent litt.');
  try { send(res, 200, await linkPreview(url)); }
  catch (e) { err(res, 422, e.name === 'AbortError' ? 'Butikken svarte ikke i tide.' : (e.message || 'Klarte ikke å hente siden.')); }
});

// --- Offentlig oppsett for nettsiden (annonser) ---
route('GET', '/api/config', async (req, res) => send(res, 200, { ads: adsConfig(), site: siteInfo() }), { auth: false });
// Opplysninger om tjenesten og hvem som står bak (vises på Kontakt- og Personvern-sidene)
function siteInfo() {
  const o = CONFIG.owner || {};
  return { name: CONFIG.siteName || 'Gaveplanlegger', owner: o.name || '', orgnr: o.orgnr || '', email: process.env.CONTACT_EMAIL || o.email || '',
    address: o.address || '', updated: o.privacyUpdated || '', backupDays: Number(o.backupDays) || null,
    beta: { enabled: process.env.BETA !== undefined ? !['0', 'false', 'nei'].includes(process.env.BETA.toLowerCase()) : !!CONFIG.beta?.enabled,
      message: CONFIG.beta?.message || 'Tjenesten er i testversjon.' } };
}

// Hit går tilbakemeldinger og henvendelser: SUPPORT_EMAIL, ellers kontaktadressen, ellers administratorene
function supportEmails() {
  const s = process.env.SUPPORT_EMAIL || CONFIG.owner?.supportEmail || siteInfo().email;
  return s ? [s] : adminEmails();
}
// --- Kontakt oss og hurtig tilbakemelding (alle kan sende, også uten konto) ---
const FEEDBACK_KINDS = { feil: '🐞 Feil', forbedring: '💡 Forbedringsønske', sporsmal: '❓ Spørsmål', kontakt: '✉️ Henvendelse' };
route('POST', '/api/feedback', async (req, res, { user, body }) => {
  if (body.website) return send(res, 201, { ok: true }); // skjult felt som bare roboter fyller ut
  if (rateLimited('fb:' + clientIp(req), 8)) return err(res, 429, 'Du har sendt mange meldinger på kort tid. Prøv igjen om litt.');
  const kind = FEEDBACK_KINDS[body.kind] ? body.kind : 'kontakt';
  const message = cleanStr(body.message, 4000);
  if (message.length < 5) return err(res, 400, 'Skriv litt mer, så vi forstår hva det gjelder.');
  const email = user ? user.email : cleanStr(body.email, 200).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err(res, 400, 'Ugyldig e-postadresse.');
  const name = user ? user.name : cleanStr(body.name, 100) || null;
  const page = cleanStr(body.page, 300) || null;
  const r = q('INSERT INTO feedback(kind, message, name, email, user_id, page, user_agent) VALUES (?,?,?,?,?,?,?)')
    .run(kind, message, name, email || null, user ? user.id : null, page, cleanStr(req.headers['user-agent'] || '', 300));
  const id = Number(r.lastInsertRowid);
  // Varsle administratorene i appen, og send e-post til support-adressen (eller administratorene hvis den mangler).
  // «Svar» i e-postprogrammet går rett til den som skrev.
  for (const a of adminEmails()) {
    const au = q('SELECT id FROM users WHERE email=?').get(a);
    if (au) notify(au.id, 'wish', `${FEEDBACK_KINDS[kind]} fra ${name || email || 'anonym'}: «${message.slice(0, 60)}${message.length > 60 ? '…' : ''}»`, '#/admin');
  }
  for (const to of supportEmails()) {
    sendEmail(to, `${FEEDBACK_KINDS[kind]} #${id} – ${siteInfo().name}`,
      `${message}\n\nFra: ${name || '-'} <${email || 'ingen e-post'}>\nSide: ${page || '-'}\nNettleser: ${req.headers['user-agent'] || '-'}\n\nSe alle: ${BASE_URL}/#/admin`,
      { replyTo: email || undefined });
  }
  send(res, 201, { ok: true, id });
}, { auth: false });
route('GET', '/api/admin/feedback', async (req, res, { user, url }) => {
  if (!isAdmin(user)) return err(res, 403, 'Kun for administrator.');
  const status = url.searchParams.get('status');
  const rows = q(`SELECT * FROM feedback ${status ? 'WHERE status=?' : ''} ORDER BY status='behandlet', id DESC LIMIT 300`).all(...(status ? [status] : []));
  send(res, 200, { feedback: rows, kinds: FEEDBACK_KINDS });
});
// Administrator kan sende en test-e-post til seg selv for å sjekke oppsettet
route('POST', '/api/admin/test-email', async (req, res, { user }) => {
  if (!isAdmin(user)) return err(res, 403, 'Kun for administrator.');
  if (!emailConfigured()) return send(res, 200, { ok: false, error: 'E-post er ikke satt opp. Legg inn SMTP_HOST, SMTP_USER og SMTP_PASS (eller RESEND_API_KEY) hos Render.' });
  const via = smtpConfig() ? `e-postserveren ${smtpConfig().host}:${smtpConfig().port}` : 'Resend';
  const r = await sendEmail(user.email, `Test fra ${siteInfo().name}`,
    `Hei ${user.name}!\n\nDette er en test-e-post fra ${siteInfo().name}, sendt via ${via}.\nKommer denne fram, virker glemt passord, bursdagsvarsler og kvitteringer.\n\nHilsen ${siteInfo().name}`);
  send(res, 200, { ...r, to: user.email, via });
});
// Administrator kan lage en lenke for nytt passord og sende den selv (f.eks. på SMS) når e-post ikke er satt opp
route('POST', '/api/admin/reset-link', async (req, res, { user, body }) => {
  if (!isAdmin(user)) return err(res, 403, 'Kun for administrator.');
  const u = q('SELECT id, name, email, phone FROM users WHERE email=?').get(cleanStr(body.email, 200).toLowerCase());
  if (!u) return err(res, 404, 'Fant ingen bruker med den e-postadressen.');
  send(res, 200, { link: createResetLink(u.id, 24), name: u.name, phone: u.phone || '', hours: 24 });
});
// Sikkerhetskopi: en konsistent kopi av hele databasen som fil (kun administrator)
route('GET', '/api/admin/backup', async (req, res, { user }) => {
  if (!isAdmin(user)) return err(res, 403, 'Kun for administrator.');
  const tmp = path.join(require('node:os').tmpdir(), `gaveliste-backup-${Date.now()}.db`);
  db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="gaveliste-${stamp}.db"`,
    'Cache-Control': 'no-store', ...SECURITY_HEADERS });
  const stream = fs.createReadStream(tmp);
  stream.pipe(res);
  stream.on('close', () => fs.unlink(tmp, () => {}));
});
route('PUT', '/api/admin/feedback/:id', async (req, res, { user, body, params }) => {
  if (!isAdmin(user)) return err(res, 403, 'Kun for administrator.');
  if (!['ny', 'behandlet'].includes(body.status)) return err(res, 400, 'Ugyldig status.');
  q('UPDATE feedback SET status=? WHERE id=?').run(body.status, params.id);
  send(res, 200, { ok: true });
});

// --- Gaveplanlegger: personer uten ønskeliste + gaveideer (kun synlig for eieren) ---
function recipientInput(body) {
  const name = cleanStr(body.name, 100);
  if (!name) throw Object.assign(new Error('Navn må fylles ut.'), { status: 400 });
  let birthdate = null;
  const m = Number(body.month), d = Number(body.day), y = Number(body.year) || 0;
  if (m || d) {
    const ok = m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(2000, m, 0)).getUTCDate();
    if (!ok) throw Object.assign(new Error('Ugyldig bursdag.'), { status: 400 });
    if (y && (y < 1900 || y > new Date().getFullYear())) throw Object.assign(new Error('Ugyldig fødselsår.'), { status: 400 });
    birthdate = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  const email = cleanStr(body.email, 200).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Object.assign(new Error('Ugyldig e-postadresse.'), { status: 400 });
  return { name, birthdate, relation: cleanStr(body.relation, 60) || null, email: email || null, note: cleanStr(body.note, 1000) || null };
}
function ideaInput(body) {
  const title = cleanStr(body.title, 200);
  const url = cleanStr(body.url, 2000);
  if (!title) throw Object.assign(new Error('Gaveideen må ha en tittel.'), { status: 400 });
  if (url && !isHttpUrl(url)) throw Object.assign(new Error('Lenken må starte med http:// eller https://'), { status: 400 });
  return { title, url: url || null, price: cleanStr(body.price, 40) || null, occasion: cleanStr(body.occasion, 60) || null, note: cleanStr(body.note, 1000) || null };
}
function ownRecipient(userId, id) { return q('SELECT * FROM recipients WHERE id=? AND owner_id=?').get(id, userId); }
function ownIdea(userId, id) {
  return q('SELECT g.* FROM gift_ideas g JOIN recipients r ON r.id=g.recipient_id WHERE g.id=? AND r.owner_id=?').get(id, userId);
}
route('GET', '/api/recipients', async (req, res, { user }) => {
  const recips = q('SELECT * FROM recipients WHERE owner_id=? AND linked_user_id IS NULL').all(user.id);
  const ideas = q(`SELECT g.*, gl.name AS list_name FROM gift_ideas g JOIN recipients r ON r.id=g.recipient_id
                   LEFT JOIN gift_lists gl ON gl.id=g.list_id WHERE r.owner_id=?
                   AND r.linked_user_id IS NULL ORDER BY CASE g.status WHEN 'idea' THEN 0 WHEN 'bought' THEN 1 ELSE 2 END, g.created_at DESC`).all(user.id);
  const out = recips.map((r) => ({
    ...r, owner_id: undefined,
    birthday: r.birthdate ? { mmdd: r.birthdate.slice(5), year: Number(r.birthdate.slice(0, 4)) || null, ...birthdayInfo(r.birthdate) } : null,
    ideas: ideas.filter((g) => g.recipient_id === r.id),
  })).sort((a, b) => (a.birthday?.daysUntil ?? 999) - (b.birthday?.daysUntil ?? 999) || a.name.localeCompare(b.name, 'nb'));
  send(res, 200, { recipients: out, shareUrl: publicUser(user).shareUrl });
});
route('POST', '/api/recipients', async (req, res, { user, body }) => {
  const r = recipientInput(body);
  const x = q('INSERT INTO recipients(owner_id, name, birthdate, relation, email, note) VALUES (?,?,?,?,?,?)')
    .run(user.id, r.name, r.birthdate, r.relation, r.email, r.note);
  send(res, 201, { id: Number(x.lastInsertRowid) });
});
route('PUT', '/api/recipients/:id', async (req, res, { user, body, params }) => {
  if (!ownRecipient(user.id, params.id)) return err(res, 404, 'Fant ikke personen.');
  const r = recipientInput(body);
  q('UPDATE recipients SET name=?, birthdate=?, relation=?, email=?, note=? WHERE id=?').run(r.name, r.birthdate, r.relation, r.email, r.note, params.id);
  send(res, 200, { ok: true });
});
route('DELETE', '/api/recipients/:id', async (req, res, { user, params }) => {
  q('DELETE FROM recipients WHERE id=? AND owner_id=?').run(params.id, user.id);
  send(res, 200, { ok: true });
});
route('POST', '/api/recipients/:id/ideas', async (req, res, { user, body, params }) => {
  if (!ownRecipient(user.id, params.id)) return err(res, 404, 'Fant ikke personen.');
  const g = ideaInput(body);
  let listId = null;
  if (body.listId) {
    const l = q('SELECT id, name FROM gift_lists WHERE id=? AND owner_id=?').get(body.listId, user.id);
    if (!l) return err(res, 404, 'Fant ikke listen.');
    listId = l.id; g.occasion = g.occasion || l.name;
  }
  const x = q('INSERT INTO gift_ideas(recipient_id, title, url, price, occasion, note, list_id) VALUES (?,?,?,?,?,?,?)')
    .run(params.id, g.title, g.url, g.price, g.occasion, g.note, listId);
  send(res, 201, { id: Number(x.lastInsertRowid) });
});
route('PUT', '/api/ideas/:id', async (req, res, { user, body, params }) => {
  if (!ownIdea(user.id, params.id)) return err(res, 404, 'Fant ikke gaveideen.');
  if (body.status) {
    if (!['idea', 'bought', 'given'].includes(body.status)) return err(res, 400, 'Ugyldig status.');
    q('UPDATE gift_ideas SET status=? WHERE id=?').run(body.status, params.id);
  } else {
    const g = ideaInput(body);
    q('UPDATE gift_ideas SET title=?, url=?, price=?, occasion=?, note=? WHERE id=?').run(g.title, g.url, g.price, g.occasion, g.note, params.id);
  }
  send(res, 200, { ok: true });
});
route('DELETE', '/api/ideas/:id', async (req, res, { user, params }) => {
  if (!ownIdea(user.id, params.id)) return err(res, 404, 'Fant ikke gaveideen.');
  q('DELETE FROM gift_ideas WHERE id=?').run(params.id);
  send(res, 200, { ok: true });
});

// --- Lister i gaveplanleggeren ---
function parsePrice(s) {
  if (!s) return 0;
  const m = String(s).replace(/\s/g, '').match(/\d+(?:[.,]\d{1,2})?/);
  return m ? Math.round(Number(m[0].replace(',', '.'))) : 0;
}
function daysUntilDate(ymd) {
  const t = todayParts(); const [y, m, d] = ymd.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(t.y, t.m - 1, t.d)) / 86400000);
}
const GRACE_DAYS = 7; // listen vises som aktiv i 7 dager etter fristen, så går den til historikk
const LIST_KINDS = ['jul', 'bryllup', 'konfirmasjon', 'bursdag', 'annet'];
function validDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '') || isNaN(Date.parse(s))) throw Object.assign(new Error('Ugyldig dato.'), { status: 400 });
  return s;
}
function ownList(userId, id) { return q('SELECT * FROM gift_lists WHERE id=? AND owner_id=?').get(id, userId); }
function friendWishes(viewerId, friendId) {
  return q(`SELECT w.id, w.title, w.url, w.price, w.note, w.priority, w.status, c.user_id AS claimer
            FROM wishes w LEFT JOIN claims c ON c.wish_id=w.id
            WHERE w.user_id=? AND (w.status='active' OR (w.status='received' AND c.user_id=?))
            ORDER BY w.status='received', w.priority, w.created_at DESC`).all(friendId, viewerId)
    .map((w) => ({ id: w.id, title: w.title, price: w.price, note: w.note, priority: w.priority, received: w.status === 'received',
      url: w.url && isHttpUrl(w.url) ? w.url : null, claimed: !!w.claimer, claimedByMe: w.claimer === viewerId }));
}
function listEntries(l) {
  const rows = q(`SELECT r.*, p.budget, p.sort, u.name AS friend_name FROM gift_list_people p
                  JOIN recipients r ON r.id=p.recipient_id LEFT JOIN users u ON u.id=r.linked_user_id
                  WHERE p.list_id=? ORDER BY p.sort, p.created_at`).all(l.id);
  return rows.map((r) => {
    const linked = r.linked_user_id && areFriends(l.owner_id, r.linked_user_id) ? r.linked_user_id : null;
    const ideas = q(`SELECT * FROM gift_ideas WHERE recipient_id=? AND list_id=?
                     ORDER BY CASE status WHEN 'idea' THEN 0 WHEN 'bought' THEN 1 ELSE 2 END, created_at`).all(r.id, l.id);
    const wishes = linked ? friendWishes(l.owner_id, linked) : [];
    const mine = wishes.filter((w) => w.claimedByMe);
    const spent = ideas.filter((g) => g.status !== 'idea').reduce((a, g) => a + parsePrice(g.price), 0) + mine.reduce((a, w) => a + parsePrice(w.price), 0);
    const planned = ideas.filter((g) => g.status === 'idea').reduce((a, g) => a + parsePrice(g.price), 0);
    const registries = linked ? q(`SELECT title, token, event_date, kind, visible_friends FROM registries WHERE (owner_id=? OR partner_id=?) AND event_date >= date('now','-30 days')`)
      .all(linked, linked).filter((g) => g.visible_friends).map((g) => ({ title: g.title, kind: g.kind, url: `#/onskeliste/${g.token}`, eventDate: g.event_date })) : [];
    return { id: r.id, name: r.friend_name || r.name, relation: r.relation, kind: r.linked_user_id ? 'friend' : 'person', friendId: linked,
      budget: r.budget, ideas, wishes, registries, spent, planned, done: ideas.some((g) => g.status !== 'idea') || mine.length > 0 };
  });
}
function listSummary(l) {
  const entries = listEntries(l);
  const daysLeft = daysUntilDate(l.deadline);
  return { id: l.id, name: l.name, kind: l.kind, deadline: l.deadline, daysLeft,
    state: daysLeft >= 0 ? 'active' : daysLeft >= -GRACE_DAYS ? 'grace' : 'history',
    people: entries.length, done: entries.filter((e) => e.done).length,
    spent: entries.reduce((a, e) => a + e.spent, 0), budget: entries.reduce((a, e) => a + (e.budget || 0), 0) };
}
function addRecipientToList(user, listId, body) {
  let rid;
  if (body.friendId) {
    const fid = Number(body.friendId);
    if (!areFriends(user.id, fid)) throw Object.assign(new Error('Du kan bare legge til venner.'), { status: 403 });
    const ex = q('SELECT id FROM recipients WHERE owner_id=? AND linked_user_id=?').get(user.id, fid);
    rid = ex ? ex.id : Number(q('INSERT INTO recipients(owner_id, name, linked_user_id) VALUES (?,?,?)')
      .run(user.id, q('SELECT name FROM users WHERE id=?').get(fid).name, fid).lastInsertRowid);
  } else if (body.recipientId) {
    const r = ownRecipient(user.id, body.recipientId);
    if (!r) throw Object.assign(new Error('Fant ikke personen.'), { status: 404 });
    rid = r.id;
  } else {
    const name = cleanStr(body.name, 100);
    if (!name) throw Object.assign(new Error('Skriv inn et navn.'), { status: 400 });
    rid = Number(q('INSERT INTO recipients(owner_id, name, relation) VALUES (?,?,?)').run(user.id, name, cleanStr(body.relation, 60) || null).lastInsertRowid);
  }
  const budget = Number(body.budget) > 0 ? Math.round(Number(body.budget)) : null;
  const sort = q('SELECT COALESCE(MAX(sort),0)+1 n FROM gift_list_people WHERE list_id=?').get(listId).n;
  q('INSERT OR IGNORE INTO gift_list_people(list_id, recipient_id, budget, sort) VALUES (?,?,?,?)').run(listId, rid, budget, sort);
  return rid;
}
route('GET', '/api/lists', async (req, res, { user }) => {
  const all = q('SELECT * FROM gift_lists WHERE owner_id=?').all(user.id).map(listSummary);
  send(res, 200, {
    active: all.filter((l) => l.state !== 'history').sort((a, b) => a.deadline.localeCompare(b.deadline)),
    history: all.filter((l) => l.state === 'history').sort((a, b) => b.deadline.localeCompare(a.deadline)),
  });
});
route('POST', '/api/lists', async (req, res, { user, body }) => {
  const name = cleanStr(body.name, 80); if (!name) return err(res, 400, 'Gi listen et navn.');
  const kind = LIST_KINDS.includes(body.kind) ? body.kind : 'annet';
  const r = q('INSERT INTO gift_lists(owner_id, name, kind, deadline) VALUES (?,?,?,?)').run(user.id, name, kind, validDate(body.deadline));
  send(res, 201, { id: Number(r.lastInsertRowid) });
});
route('PUT', '/api/lists/:id', async (req, res, { user, body, params }) => {
  const l = ownList(user.id, params.id); if (!l) return err(res, 404, 'Fant ikke listen.');
  const name = cleanStr(body.name, 80) || l.name;
  const kind = LIST_KINDS.includes(body.kind) ? body.kind : l.kind;
  q('UPDATE gift_lists SET name=?, kind=?, deadline=? WHERE id=?').run(name, kind, body.deadline ? validDate(body.deadline) : l.deadline, l.id);
  send(res, 200, { ok: true });
});
route('DELETE', '/api/lists/:id', async (req, res, { user, params }) => {
  q('DELETE FROM gift_lists WHERE id=? AND owner_id=?').run(params.id, user.id);
  send(res, 200, { ok: true });
});
route('GET', '/api/lists/:id', async (req, res, { user, params }) => {
  const l = ownList(user.id, params.id); if (!l) return err(res, 404, 'Fant ikke listen.');
  const entries = listEntries(l);
  const inList = new Set(entries.map((e) => e.friendId ? 'f' + e.friendId : 'r' + e.id));
  const linkedIds = new Set(q('SELECT id FROM recipients WHERE owner_id=? AND linked_user_id IS NOT NULL').all(user.id).map((r) => r.id));
  const candidates = [
    ...q('SELECT u.id, u.name FROM friends f JOIN users u ON u.id=f.friend_id WHERE f.user_id=? ORDER BY u.name').all(user.id)
      .filter((f) => !inList.has('f' + f.id)).map((f) => ({ type: 'friend', id: f.id, name: f.name })),
    ...q('SELECT id, name, relation FROM recipients WHERE owner_id=? AND linked_user_id IS NULL ORDER BY name').all(user.id)
      .filter((r) => !inList.has('r' + r.id) && !linkedIds.has(r.id)).map((r) => ({ type: 'person', id: r.id, name: r.name, relation: r.relation })),
  ];
  const s = listSummary(l);
  send(res, 200, { list: { ...s, planned: entries.reduce((a, e) => a + e.planned, 0), graceLeft: s.state === 'grace' ? GRACE_DAYS + s.daysLeft : null },
    entries, candidates });
});
route('POST', '/api/lists/:id/people', async (req, res, { user, body, params }) => {
  const l = ownList(user.id, params.id); if (!l) return err(res, 404, 'Fant ikke listen.');
  send(res, 201, { recipientId: addRecipientToList(user, l.id, body) });
});
route('PUT', '/api/lists/:id/people/:rid', async (req, res, { user, body, params }) => {
  const l = ownList(user.id, params.id); if (!l) return err(res, 404, 'Fant ikke listen.');
  const b = body.budget === '' || body.budget == null ? null : Math.round(Number(body.budget));
  if (b !== null && (!Number.isFinite(b) || b < 0)) return err(res, 400, 'Ugyldig budsjett.');
  q('UPDATE gift_list_people SET budget=? WHERE list_id=? AND recipient_id=?').run(b, l.id, params.rid);
  send(res, 200, { ok: true });
});
route('DELETE', '/api/lists/:id/people/:rid', async (req, res, { user, params }) => {
  const l = ownList(user.id, params.id); if (!l) return err(res, 404, 'Fant ikke listen.');
  q('DELETE FROM gift_list_people WHERE list_id=? AND recipient_id=?').run(l.id, params.rid);
  send(res, 200, { ok: true });
});
// Lag en ny liste basert på en gammel (samme personer og budsjett, nye gaver)
route('POST', '/api/lists/:id/copy', async (req, res, { user, body, params }) => {
  const l = ownList(user.id, params.id); if (!l) return err(res, 404, 'Fant ikke listen.');
  const name = cleanStr(body.name, 80) || l.name;
  const r = q('INSERT INTO gift_lists(owner_id, name, kind, deadline) VALUES (?,?,?,?)').run(user.id, name, l.kind, validDate(body.deadline));
  const nid = Number(r.lastInsertRowid);
  q(`INSERT INTO gift_list_people(list_id, recipient_id, budget, sort)
     SELECT ?, recipient_id, budget, sort FROM gift_list_people WHERE list_id=?`).run(nid, l.id);
  send(res, 201, { id: nid });
});

// --- Ønskelister for anledninger (tidligere bryllupslister) ---
const EVENT_KINDS = { bryllup: 'Bryllup', bryllupsdag: 'Bryllupsdag', jubileum: 'Jubileum', bursdag: 'Bursdag', konfirmasjon: 'Konfirmasjon', annet: 'Annet' };
// Lister fra venner som eierne har valgt å vise for venner, fra en uke før til en uke etter dagen
// Gi vennene beskjed når en liste blir synlig for dem (én gang per venn og liste)
function notifyFriendsOfList(g, user) {
  if (!g.visible_friends) return;
  const ids = q('SELECT friend_id FROM friends WHERE user_id IN (?, ?)').all(g.owner_id, g.partner_id || 0)
    .map((r) => r.friend_id).filter((id) => id !== g.owner_id && id !== g.partner_id);
  for (const id of new Set(ids)) {
    notify(id, 'wish', `${user.name} har laget en ønskeliste: «${g.title}» (${EVENT_KINDS[g.kind].toLowerCase()} ${fmtNoDate(g.event_date)}).`,
      `#/onskeliste/${g.token}`, `evlist:${g.id}:${id}`);
  }
}
function fmtNoDate(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return `${d}. ${['januar', 'februar', 'mars', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'desember'][m - 1]} ${y}`;
}
function friendsEventLists(userId) {
  return q(`SELECT DISTINCT g.* FROM registries g JOIN friends f ON f.friend_id IN (g.owner_id, g.partner_id)
            WHERE f.user_id=? AND g.visible_friends=1 AND g.owner_id!=? AND COALESCE(g.partner_id,0)!=?
              AND g.event_date >= date('now','-7 days') ORDER BY g.event_date`).all(userId, userId, userId)
    .map((g) => ({ title: g.title, kind: g.kind, eventDate: g.event_date, daysLeft: daysUntilDate(g.event_date), couple: coupleNames(g), url: `#/onskeliste/${g.token}` }));
}
function myRegistry(userId, id) { return q('SELECT * FROM registries WHERE id=? AND (owner_id=? OR partner_id=?)').get(id, userId, userId); }
function coupleNames(g) {
  return [g.owner_id, g.partner_id].filter(Boolean).map((id) => q('SELECT name FROM users WHERE id=?').get(id)?.name).filter(Boolean);
}
function registryInput(body, current) {
  const title = cleanStr(body.title, 100); if (!title) throw Object.assign(new Error('Gi ønskelisten et navn, f.eks. «Kari og Ola gifter seg».'), { status: 400 });
  return { title, eventDate: validDate(body.eventDate), message: cleanStr(body.message, 1500) || null,
    kind: EVENT_KINDS[body.kind] ? body.kind : current?.kind || 'annet',
    visible: body.visibleFriends === undefined && current ? current.visible_friends : body.visibleFriends === false || body.visibleFriends === 'false' ? 0 : 1 };
}
function setPartner(user, g, email) {
  email = cleanStr(email, 200).toLowerCase();
  if (!email) return null;
  const p = q('SELECT * FROM users WHERE email=?').get(email);
  if (!p) throw Object.assign(new Error('Fant ingen bruker med den e-postadressen. Be partneren lage konto først.'), { status: 400 });
  if (p.id === g.owner_id) return null;
  if (g.partner_id !== p.id) {
    q('UPDATE registries SET partner_id=? WHERE id=?').run(p.id, g.id);
    notify(p.id, 'friend', `${user.name} har lagt deg til som medeier av ønskelisten «${g.title}».`, `#/onskelister/${g.id}`);
  }
  return p.id;
}
function itemInput(body) {
  const w = wishInput(body);
  const qty = Math.min(Math.max(parseInt(body.qty, 10) || 1, 1), 100);
  const spleis = body.spleis ? 1 : 0;
  if (spleis && !parsePrice(w.price)) throw Object.assign(new Error('Spleis krever en pris, slik at gjestene ser hvor mye som gjenstår.'), { status: 400 });
  return { ...w, qty: spleis ? 1 : qty, spleis };
}
function itemStats(itemId) {
  return q('SELECT COALESCE(SUM(qty),0) qty, COALESCE(SUM(amount),0) amount, COUNT(*) n FROM registry_claims WHERE item_id=?').get(itemId);
}
const regShareUrl = (g) => `${BASE_URL}/#/onskeliste/${g.token}`;

route('GET', '/api/registries', async (req, res, { user }) => {
  const rows = q('SELECT * FROM registries WHERE owner_id=? OR partner_id=? ORDER BY event_date').all(user.id, user.id);
  send(res, 200, { friendsLists: friendsEventLists(user.id), registries: rows.map((g) => ({ id: g.id, title: g.title, kind: g.kind, visibleFriends: !!g.visible_friends,
    eventDate: g.event_date, daysLeft: daysUntilDate(g.event_date),
    items: q("SELECT COUNT(*) n FROM registry_items WHERE registry_id=? AND status='active'").get(g.id).n,
    couple: coupleNames(g), isOwner: g.owner_id === user.id, shareUrl: regShareUrl(g) })) });
});
route('POST', '/api/registries', async (req, res, { user, body }) => {
  const r = registryInput(body);
  const id = Number(q('INSERT INTO registries(owner_id, title, event_date, message, token, kind, visible_friends) VALUES (?,?,?,?,?,?,?)')
    .run(user.id, r.title, r.eventDate, r.message, token(12), r.kind, r.visible).lastInsertRowid);
  let warning;
  try { setPartner(user, q('SELECT * FROM registries WHERE id=?').get(id), body.partnerEmail); }
  catch (e) { warning = e.message; }
  notifyFriendsOfList(q('SELECT * FROM registries WHERE id=?').get(id), user);
  send(res, 201, warning ? { id, warning } : { id });
});
route('PUT', '/api/registries/:id', async (req, res, { user, body, params }) => {
  const g = myRegistry(user.id, params.id); if (!g) return err(res, 404, 'Fant ikke ønskelisten.');
  const r = registryInput(body, g);
  q('UPDATE registries SET title=?, event_date=?, message=?, kind=?, visible_friends=? WHERE id=?').run(r.title, r.eventDate, r.message, r.kind, r.visible, g.id);
  if (body.partnerEmail !== undefined) setPartner(user, g, body.partnerEmail);
  if (r.visible && !g.visible_friends) notifyFriendsOfList(q('SELECT * FROM registries WHERE id=?').get(g.id), user);
  send(res, 200, { ok: true });
});
route('POST', '/api/registries/:id/new-link', async (req, res, { user, params }) => {
  const g = myRegistry(user.id, params.id); if (!g) return err(res, 404, 'Fant ikke ønskelisten.');
  q('UPDATE registries SET token=? WHERE id=?').run(token(12), g.id);
  send(res, 200, { ok: true });
});
route('DELETE', '/api/registries/:id', async (req, res, { user, params }) => {
  const g = myRegistry(user.id, params.id); if (!g) return err(res, 404, 'Fant ikke ønskelisten.');
  if (g.owner_id !== user.id) return err(res, 403, 'Bare den som opprettet listen kan slette den.');
  q('DELETE FROM registries WHERE id=?').run(g.id);
  send(res, 200, { ok: true });
});
// Eiernes visning: ingen reservasjoner før dagen – etterpå vises hvem som ga hva (til takkekort)
route('GET', '/api/registries/:id', async (req, res, { user, params }) => {
  const g = myRegistry(user.id, params.id); if (!g) return err(res, 404, 'Fant ikke ønskelisten.');
  const revealed = daysUntilDate(g.event_date) < 0;
  const items = q("SELECT * FROM registry_items WHERE registry_id=? AND status='active' ORDER BY priority, created_at").all(g.id).map((i) => {
    const out = { id: i.id, title: i.title, url: i.url, price: i.price, note: i.note, qty: i.qty, spleis: !!i.spleis, priority: i.priority };
    if (revealed) {
      out.givers = q(`SELECT c.qty, c.amount, COALESCE(u.name, c.guest_name) AS name, COALESCE(u.email, c.guest_email) AS email
                      FROM registry_claims c LEFT JOIN users u ON u.id=c.user_id WHERE c.item_id=? ORDER BY c.created_at`).all(i.id);
    }
    return out;
  });
  const partner = g.partner_id ? q('SELECT name, email FROM users WHERE id=?').get(g.partner_id) : null;
  send(res, 200, { registry: { id: g.id, title: g.title, eventDate: g.event_date, message: g.message, daysLeft: daysUntilDate(g.event_date),
    shareUrl: regShareUrl(g), isOwner: g.owner_id === user.id, partner, couple: coupleNames(g), revealed, kind: g.kind, visibleFriends: !!g.visible_friends }, items });
});
route('POST', '/api/registries/:id/items', async (req, res, { user, body, params }) => {
  const g = myRegistry(user.id, params.id); if (!g) return err(res, 404, 'Fant ikke ønskelisten.');
  const i = itemInput(body);
  const r = q('INSERT INTO registry_items(registry_id, title, url, price, note, qty, spleis, priority) VALUES (?,?,?,?,?,?,?,?)')
    .run(g.id, i.title, i.url, i.price, i.note, i.qty, i.spleis, i.priority);
  send(res, 201, { id: Number(r.lastInsertRowid) });
});
function myItem(userId, id) {
  return q('SELECT i.* FROM registry_items i JOIN registries g ON g.id=i.registry_id WHERE i.id=? AND (g.owner_id=? OR g.partner_id=?)').get(id, userId, userId);
}
route('PUT', '/api/registry-items/:id', async (req, res, { user, body, params }) => {
  const it = myItem(user.id, params.id); if (!it) return err(res, 404, 'Fant ikke gaven.');
  const i = itemInput(body);
  q('UPDATE registry_items SET title=?, url=?, price=?, note=?, qty=?, spleis=?, priority=? WHERE id=?')
    .run(i.title, i.url, i.price, i.note, i.qty, i.spleis, i.priority, it.id);
  send(res, 200, { ok: true });
});
route('DELETE', '/api/registry-items/:id', async (req, res, { user, params }) => {
  const it = myItem(user.id, params.id); if (!it) return err(res, 404, 'Fant ikke gaven.');
  // Gjester som har reservert, får beskjed hvis de har konto
  for (const c of q('SELECT user_id FROM registry_claims WHERE item_id=? AND user_id IS NOT NULL').all(it.id)) {
    notify(c.user_id, 'wish', `«${it.title}» er fjernet fra en ønskeliste du har reservert fra.`, '#/reservasjoner');
  }
  q("UPDATE registry_items SET status='removed' WHERE id=?").run(it.id);
  send(res, 200, { ok: true });
});

// Gjestenes side (ingen innlogging nødvendig – lenken er hemmelig)
route('GET', '/api/r/:token', async (req, res, { user, params }) => {
  const g = q('SELECT * FROM registries WHERE token=?').get(params.token);
  if (!g) return err(res, 404, 'Ønskelisten finnes ikke, eller lenken er byttet ut.');
  const isCouple = !!user && (user.id === g.owner_id || user.id === g.partner_id);
  const items = q("SELECT * FROM registry_items WHERE registry_id=? AND status='active' ORDER BY priority, created_at").all(g.id).map((i) => {
    const st = itemStats(i.id);
    const target = parsePrice(i.price);
    const mine = user ? q('SELECT id, qty, amount, cancel_token FROM registry_claims WHERE item_id=? AND user_id=?').all(i.id, user.id) : [];
    const base = { id: i.id, title: i.title, url: i.url && isHttpUrl(i.url) ? i.url : null, price: i.price, note: i.note, priority: i.priority,
      qty: i.qty, spleis: !!i.spleis, target, mine };
    if (isCouple) return base; // eierne skal ikke se hva som er tatt
    return { ...base, claimedQty: st.qty, remaining: Math.max(i.qty - st.qty, 0), raised: st.amount, givers: st.n,
      full: i.spleis ? st.amount >= target : st.qty >= i.qty };
  });
  send(res, 200, { registry: { title: g.title, kind: g.kind, eventDate: g.event_date, message: g.message, daysLeft: daysUntilDate(g.event_date), couple: coupleNames(g) },
    items, isCouple, viewer: user ? { name: user.name } : null });
}, { auth: false });
route('POST', '/api/r/:token/claim', async (req, res, { user, body, params }) => {
  const g = q('SELECT * FROM registries WHERE token=?').get(params.token);
  if (!g) return err(res, 404, 'Ønskelisten finnes ikke.');
  if (user && (user.id === g.owner_id || user.id === g.partner_id)) return err(res, 403, 'Dere kan ikke reservere fra deres egen liste 🙂');
  if (rateLimited('rclaim:' + clientIp(req), 30)) return err(res, 429, 'For mange forsøk. Vent litt.');
  const it = q("SELECT * FROM registry_items WHERE id=? AND registry_id=? AND status='active'").get(body.itemId, g.id);
  if (!it) return err(res, 404, 'Fant ikke gaven.');
  const name = user ? user.name : cleanStr(body.name, 100);
  const email = user ? null : cleanStr(body.email, 200).toLowerCase() || null;
  if (!name) return err(res, 400, 'Skriv navnet ditt, så de vet hvem gaven er fra.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err(res, 400, 'Ugyldig e-postadresse.');
  const st = itemStats(it.id);
  let qty = 1, amount = null;
  if (it.spleis) {
    amount = Math.round(Number(body.amount));
    if (!Number.isFinite(amount) || amount < 50) return err(res, 400, 'Bidraget må være minst 50 kr.');
    const left = parsePrice(it.price) - st.amount;
    if (left <= 0) return err(res, 409, 'Denne gaven er allerede fullfinansiert.');
    amount = Math.min(amount, left); qty = 0;
  } else {
    qty = Math.max(parseInt(body.qty, 10) || 1, 1);
    const left = it.qty - st.qty;
    if (left <= 0) return err(res, 409, 'Beklager, noen har akkurat tatt denne.');
    if (qty > left) return err(res, 409, `Det er bare ${left} igjen.`);
  }
  const cancel = token(18);
  const r = q('INSERT INTO registry_claims(item_id, qty, amount, user_id, guest_name, guest_email, cancel_token) VALUES (?,?,?,?,?,?,?)')
    .run(it.id, qty, amount, user ? user.id : null, user ? null : name, email, cancel);
  const cancelUrl = `${BASE_URL}/#/onskeliste/${g.token}?angre=${cancel}`;
  if (email) {
    sendEmail(email, `Du har reservert «${it.title}» til ${g.title}`,
      `Hei ${name}!\n\nTakk! Du har ${amount ? `bidratt med ${amount} kr til` : 'reservert'} «${it.title}» på ønskelisten «${g.title}».\n` +
      `De ser ikke hvem som har reservert hva før etter dagen.\n\nVil du angre? Bruk denne lenken: ${cancelUrl}\n\nHilsen Gaveplanlegger`);
  }
  send(res, 201, { claimId: Number(r.lastInsertRowid), cancelToken: cancel, cancelUrl, qty, amount });
}, { auth: false });
route('DELETE', '/api/r/:token/claim/:cancel', async (req, res, { params }) => {
  const g = q('SELECT id FROM registries WHERE token=?').get(params.token);
  if (!g) return err(res, 404, 'Ønskelisten finnes ikke.');
  const r = q(`DELETE FROM registry_claims WHERE cancel_token=? AND item_id IN (SELECT id FROM registry_items WHERE registry_id=?)`).run(params.cancel, g.id);
  if (!r.changes) return err(res, 404, 'Fant ikke reservasjonen – den kan allerede være angret.');
  send(res, 200, { ok: true });
}, { auth: false });
route('GET', '/api/r/:token/claim/:cancel', async (req, res, { params }) => {
  const c = q(`SELECT c.qty, c.amount, i.title FROM registry_claims c JOIN registry_items i ON i.id=c.item_id JOIN registries g ON g.id=i.registry_id
               WHERE c.cancel_token=? AND g.token=?`).get(params.cancel, params.token);
  if (!c) return err(res, 404, 'Fant ikke reservasjonen – den kan allerede være angret.');
  send(res, 200, c);
}, { auth: false });

// --- Admin: enkel statistikk ---
route('GET', '/api/admin/stats', async (req, res, { user }) => {
  if (!isAdmin(user)) return err(res, 403, 'Kun for administrator.');
  send(res, 200, {
    users: q('SELECT COUNT(*) n FROM users').get().n,
    wishes: q('SELECT COUNT(*) n FROM wishes').get().n,
    claims: q('SELECT COUNT(*) n FROM claims').get().n,
    recipients: q('SELECT COUNT(*) n FROM recipients').get().n,
    giftIdeas: q('SELECT COUNT(*) n FROM gift_ideas').get().n,
    giftLists: q('SELECT COUNT(*) n FROM gift_lists').get().n,
    registries: q('SELECT COUNT(*) n FROM registries').get().n,
    registryClaims: q('SELECT COUNT(*) n FROM registry_claims').get().n,
    feedbackNew: q("SELECT COUNT(*) n FROM feedback WHERE status='ny'").get().n,
    newUsersLast30: q("SELECT COUNT(*) n FROM users WHERE created_at > datetime('now','-30 days')").get().n,
  });
});

// ---------- Statiske filer ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
function serveStatic(req, res, pathname) {
  const pub = path.join(ROOT, 'public');
  let file = path.normalize(path.join(pub, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(pub)) return err(res, 403, 'Nei');
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(pub, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache', ...SECURITY_HEADERS });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, BASE_URL);
  try {
    if (url.pathname === '/ads.txt') return send(res, 200, adsTxt());
    if (url.pathname === '/healthz') { db.prepare('SELECT 1').get(); return send(res, 200, 'ok'); }
    if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname);
    // Beskyttelse mot CSRF: endrende kall må være JSON fra samme opprinnelse
    if (req.method !== 'GET') {
      const ct = req.headers['content-type'] || '';
      if (!ct.startsWith('application/json')) return err(res, 415, 'Forventer JSON.');
      const origin = req.headers.origin;
      if (origin && origin !== BASE_URL && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) return err(res, 403, 'Ugyldig opprinnelse.');
    }
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = url.pathname.match(r.re); if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const user = currentUser(req);
      if (r.auth && !user) return err(res, 401, 'Du må logge inn.');
      const body = req.method === 'GET' ? {} : await readJson(req);
      return await r.handler(req, res, { user, body, params, url });
    }
    err(res, 404, 'Ikke funnet.');
  } catch (e) {
    if (e.status) return err(res, e.status, e.message);
    if (e instanceof SyntaxError) return err(res, 400, 'Ugyldig JSON.');
    console.error(e); err(res, 500, 'Noe gikk galt på serveren.');
  }
});

if (require.main === module) {
  runBirthdayReminders();
  setInterval(runBirthdayReminders, 60 * 60 * 1000);
  server.listen(PORT, () => console.log(`🎁 Gaveplanlegger kjører på ${BASE_URL} (port ${PORT})`));
}
module.exports = { server, runBirthdayReminders, birthdayInfo, db };
