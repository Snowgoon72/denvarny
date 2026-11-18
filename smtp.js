// Enkel SMTP-klient uten eksterne pakker, for å sende e-post fra en vanlig e-postkonto
// (f.eks. jorn@gaveplanlegger.no hos Domene.no).
//   SMTP_SECURE=ssl       → port 465, kryptert fra start (standard)
//   SMTP_SECURE=starttls  → port 587, krypteres med STARTTLS
//   SMTP_SECURE=none      → ukryptert (bare for tester på egen maskin)
'use strict';
const net = require('node:net');
const tls = require('node:tls');
const crypto = require('node:crypto');

const TIMEOUT_MS = 20000;

function smtpConfig() {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  const secure = (process.env.SMTP_SECURE || '').toLowerCase() || (process.env.SMTP_PORT === '587' ? 'starttls' : 'ssl');
  const port = Number(process.env.SMTP_PORT) || (secure === 'starttls' ? 587 : secure === 'none' ? 25 : 465);
  return { host, port, secure, user: process.env.SMTP_USER || '', pass: process.env.SMTP_PASS || '',
    servername: process.env.SMTP_TLS_SERVERNAME || host };
}

// Leser SMTP-svar linje for linje. Et svar kan gå over flere linjer («250-…» … «250 …»).
function makeReader() {
  let buf = '', waiting = null, lines = [];
  const onData = (d) => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      lines.push(line);
      if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) {
        const resp = { code: Number(line.slice(0, 3)), text: lines.join('\n') }; lines = [];
        if (waiting) { const w = waiting; waiting = null; w(resp); }
      }
    }
  };
  return {
    attach(sock) { sock.on('data', onData); },
    detach(sock) { sock.removeListener('data', onData); },
    next() { return new Promise((resolve) => { waiting = resolve; }); },
  };
}

// RFC 2047: emneord med æøå
const encodeHeader = (s) => /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
function encodeFrom(from) {
  const m = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  return m ? `${encodeHeader(m[1].replace(/"/g, ''))} <${m[2]}>` : from;
}
const addrOf = (from) => (from.match(/<([^>]+)>/) || [null, from])[1].trim();

function buildMessage({ from, to, subject, text, replyTo }) {
  const domain = addrOf(from).split('@')[1] || 'localhost';
  const body = Buffer.from(text.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64').replace(/.{1,76}/g, '$&\r\n');
  return [
    `From: ${encodeFrom(from)}`,
    `To: ${to}`,
    ...(replyTo && /^[^\s@<>,;]+@[^\s@<>,;]+$/.test(replyTo) ? [`Reply-To: ${replyTo}`] : []),
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${crypto.randomBytes(12).toString('hex')}@${domain}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    body,
  ].join('\r\n');
}

async function sendSmtp({ from, to, subject, text, replyTo }, cfg = smtpConfig()) {
  if (!cfg) throw new Error('SMTP er ikke satt opp.');
  const reader = makeReader();
  let sock = await new Promise((resolve, reject) => {
    const s = cfg.secure === 'ssl'
      ? tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.servername }, () => resolve(s))
      : net.connect({ host: cfg.host, port: cfg.port }, () => resolve(s));
    s.once('error', reject);
    s.setTimeout(TIMEOUT_MS, () => s.destroy(new Error('Tidsavbrudd mot e-postserveren.')));
  });
  const fail = (msg) => { try { sock.destroy(); } catch {} throw new Error(msg); };
  let lastError = null, closed;
  const watch = (s) => {
    s.on('error', (e) => { lastError = e; });
    closed = new Promise((_, rej) => s.once('close', () => rej(lastError || new Error('E-postserveren lukket forbindelsen.'))));
    closed.catch(() => {});
    reader.attach(s);
  };
  watch(sock);
  const expect = async (codes, what) => {
    const r = await Promise.race([reader.next(), closed]);
    if (!codes.includes(r.code)) fail(`E-postserveren avviste ${what}: ${r.text.split('\n').pop()}`);
    return r;
  };
  const cmd = async (line, codes, what) => { sock.write(line + '\r\n'); return expect(codes, what); };

  await expect([220], 'tilkoblingen');
  const helo = addrOf(from).split('@')[1] || 'localhost';
  let ehlo = await cmd(`EHLO ${helo}`, [250], 'EHLO');
  if (cfg.secure === 'starttls') {
    if (!/STARTTLS/i.test(ehlo.text)) fail('E-postserveren støtter ikke STARTTLS på denne porten.');
    await cmd('STARTTLS', [220], 'STARTTLS');
    reader.detach(sock);
    sock = await new Promise((resolve, reject) => {
      const t = tls.connect({ socket: sock, servername: cfg.servername }, () => resolve(t));
      t.once('error', reject);
    });
    watch(sock);
    ehlo = await cmd(`EHLO ${helo}`, [250], 'EHLO');
  }
  if (cfg.user) {
    if (/AUTH[ =][^\n]*PLAIN/i.test(ehlo.text)) {
      await cmd(`AUTH PLAIN ${Buffer.from(`\0${cfg.user}\0${cfg.pass}`).toString('base64')}`, [235], 'brukernavn eller passord');
    } else {
      await cmd('AUTH LOGIN', [334], 'innloggingen');
      await cmd(Buffer.from(cfg.user).toString('base64'), [334], 'brukernavnet');
      await cmd(Buffer.from(cfg.pass).toString('base64'), [235], 'brukernavn eller passord');
    }
  }
  await cmd(`MAIL FROM:<${addrOf(from)}>`, [250], 'avsenderen');
  await cmd(`RCPT TO:<${to}>`, [250, 251], 'mottakeren');
  await cmd('DATA', [354], 'meldingen');
  // Linjer som starter med punktum må dobles (body er base64, så det gjelder bare toppfeltene)
  const msg = buildMessage({ from, to, subject, text, replyTo }).replace(/^\./gm, '..');
  await cmd(`${msg}\r\n.`, [250], 'meldingen');
  try { sock.write('QUIT\r\n'); sock.end(); } catch {}
  return true;
}

module.exports = { sendSmtp, smtpConfig, buildMessage };
