// Tester av e-post via egen e-postkonto (SMTP), mot en liten falsk e-postserver. Kjør: npm test
'use strict';
const assert = require('node:assert/strict');
const net = require('node:net');
const tls = require('node:tls');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { sendSmtp } = require('../smtp.js');

// Falsk SMTP-server. opts: { plain, starttls, tlsOpts, user, pass }
function fakeSmtp(opts = {}) {
  const got = [];
  const handler = (sock0) => {
    let sock = sock0, buf = '', inData = false, data = '', authStep = null, authUser = '';
    const w = (l) => sock.write(l + '\r\n');
    const onData = (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (inData) {
          if (line === '.') { inData = false; got.push(data); data = ''; w('250 OK queued'); } else data += line.replace(/^\.\./, '.') + '\r\n';
          continue;
        }
        if (authStep === 'user') { authUser = Buffer.from(line, 'base64').toString(); authStep = 'pass'; w('334 UGFzc3dvcmQ6'); continue; }
        if (authStep === 'pass') { authStep = null; w(authUser === opts.user && Buffer.from(line, 'base64').toString() === opts.pass ? '235 OK' : '535 Authentication failed'); continue; }
        const c = line.toUpperCase();
        if (c.startsWith('EHLO')) w(`250-fake\r\n${opts.starttls && !sock.encrypted ? '250-STARTTLS\r\n' : ''}250 AUTH ${opts.plain ? 'PLAIN LOGIN' : 'LOGIN'}`);
        else if (c === 'STARTTLS') {
          w('220 Go ahead'); sock.removeListener('data', onData);
          sock = new tls.TLSSocket(sock, { isServer: true, ...opts.tlsOpts }); sock.on('data', onData);
        } else if (c.startsWith('AUTH PLAIN')) {
          const [, u, p] = Buffer.from(line.split(' ')[2], 'base64').toString().split('\0');
          w(u === opts.user && p === opts.pass ? '235 OK' : '535 Authentication failed');
        } else if (c === 'AUTH LOGIN') { authStep = 'user'; w('334 VXNlcm5hbWU6'); }
        else if (c.startsWith('MAIL FROM') || c.startsWith('RCPT TO')) w('250 OK');
        else if (c === 'DATA') { inData = true; w('354 Send'); }
        else if (c === 'QUIT') { w('221 Bye'); sock.end(); }
        else w('500 ?');
      }
    };
    sock.on('data', onData); sock.on('error', () => {});
    w('220 fake ESMTP');
  };
  const server = opts.ssl ? tls.createServer(opts.tlsOpts, handler) : net.createServer(handler);
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port, got })));
}
const decode = (raw) => {
  const [head, body] = raw.split('\r\n\r\n');
  const subj = head.match(/^Subject: (.*)$/m)[1];
  const m = subj.match(/^=\?UTF-8\?B\?(.+)\?=$/);
  return { head, subject: m ? Buffer.from(m[1], 'base64').toString() : subj, body: Buffer.from(body.replace(/\s/g, ''), 'base64').toString() };
};

(async () => {
  let ok = 0; const step = (n) => { ok++; console.log('✔', n); };
  const servers = [];
  try {
    const mail = { from: 'Gaveplanlegger <jorn@gaveplanlegger.no>', to: 'ola@test.no', subject: 'Nytt passord – Gaveplanlegger 🎁', text: 'Hei Ola!\nÆ Ø Å\n.\nLenke: https://gaveplanlegger.no/#/x' };

    let f = await fakeSmtp({ plain: true, user: 'jorn@gaveplanlegger.no', pass: 'hemmelig' }); servers.push(f.server);
    await sendSmtp(mail, { host: '127.0.0.1', port: f.port, secure: 'none', user: 'jorn@gaveplanlegger.no', pass: 'hemmelig' });
    let d = decode(f.got[0]);
    assert.equal(d.subject, mail.subject); assert.equal(d.body, mail.text.replace(/\n/g, '\r\n'));
    assert.match(d.head, /^From: Gaveplanlegger <jorn@gaveplanlegger\.no>$/m); assert.match(d.head, /^To: ola@test\.no$/m);
    step('sender e-post med æøå, emoji og punktum-linje (AUTH PLAIN)');

    f = await fakeSmtp({ plain: false, user: 'u@x.no', pass: 'p' }); servers.push(f.server);
    await sendSmtp(mail, { host: '127.0.0.1', port: f.port, secure: 'none', user: 'u@x.no', pass: 'p' });
    assert.equal(f.got.length, 1); step('AUTH LOGIN når serveren ikke tilbyr PLAIN');

    await assert.rejects(sendSmtp(mail, { host: '127.0.0.1', port: f.port, secure: 'none', user: 'u@x.no', pass: 'feil' }), /brukernavn eller passord/);
    step('feil passord gir forståelig feilmelding');

    await assert.rejects(sendSmtp(mail, { host: '127.0.0.1', port: 1, secure: 'none', user: '', pass: '' }));
    step('server som ikke svarer gir feil');

    // Kryptert (465 SSL og 587 STARTTLS) – krever openssl for å lage et testsertifikat
    let pem = null;
    try {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smtp-'));
      execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout "${dir}/k.pem" -out "${dir}/c.pem" -days 1 -subj /CN=localhost -addext subjectAltName=DNS:localhost`, { stdio: 'ignore' });
      pem = { key: fs.readFileSync(`${dir}/k.pem`), cert: fs.readFileSync(`${dir}/c.pem`) };
    } catch { console.log('– hopper over krypterte tester (openssl mangler)'); }
    if (pem) {
      const orig = tls.connect; // stol på testsertifikatet bare i denne testen
      tls.connect = (o, cb) => orig({ ...o, ca: pem.cert }, cb);
      f = await fakeSmtp({ ssl: true, plain: true, tlsOpts: pem, user: 'a', pass: 'b' }); servers.push(f.server);
      await sendSmtp(mail, { host: 'localhost', port: f.port, secure: 'ssl', user: 'a', pass: 'b', servername: 'localhost' });
      assert.equal(f.got.length, 1); step('port 465 med SSL');
      f = await fakeSmtp({ starttls: true, plain: true, tlsOpts: pem, user: 'a', pass: 'b' }); servers.push(f.server);
      await sendSmtp(mail, { host: 'localhost', port: f.port, secure: 'starttls', user: 'a', pass: 'b', servername: 'localhost' });
      assert.equal(f.got.length, 1); step('port 587 med STARTTLS');
      tls.connect = orig;
      // Uten å stole på sertifikatet skal det feile
      f = await fakeSmtp({ ssl: true, plain: true, tlsOpts: pem, user: 'a', pass: 'b' }); servers.push(f.server);
      await assert.rejects(sendSmtp(mail, { host: 'localhost', port: f.port, secure: 'ssl', user: 'a', pass: 'b', servername: 'localhost' }));
      step('ukjent sertifikat avvises');
    }

    // Gjennom appen: glemt passord og test-e-post fra Admin
    f = await fakeSmtp({ plain: true, user: 'jorn@gaveplanlegger.no', pass: 'hemmelig' }); servers.push(f.server);
    Object.assign(process.env, { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(f.port), SMTP_SECURE: 'none', SMTP_USER: 'jorn@gaveplanlegger.no',
      SMTP_PASS: 'hemmelig', MAIL_FROM: 'Gaveplanlegger <jorn@gaveplanlegger.no>', ADMIN_EMAILS: 'admin@test.no', PORT: '0',
      DB_FILE: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gp-')), 't.db') });
    const { server } = require('../server.js'); servers.push(server);
    await new Promise((r) => server.listen(0, r));
    const base = `http://localhost:${server.address().port}`;
    let cookie = '';
    const call = async (method, p, body) => {
      const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
      return { status: r.status, data: await r.json() };
    };
    await call('POST', '/api/register', { name: 'Admin Test', email: 'admin@test.no', password: 'hemmelig123', acceptTerms: true, confirmAge: true });
    let r = await call('POST', '/api/admin/test-email', {});
    assert.equal(r.data.ok, true); assert.match(r.data.via, /127\.0\.0\.1/);
    assert.match(decode(f.got.at(-1)).body, /test-e-post/); step('test-e-post fra Admin');
    r = await call('POST', '/api/password/forgot', { email: 'admin@test.no' }); assert.equal(r.data.emailEnabled, true);
    await new Promise((res) => setTimeout(res, 300));
    assert.match(decode(f.got.at(-1)).body, /#\/nytt-passord\/[\w-]{20,}/); step('glemt passord sender lenke på e-post');
    process.env.CONTACT_EMAIL = 'support@gaveplanlegger.no';
    r = await call('POST', '/api/feedback', { kind: 'feil', message: 'Knappen virker ikke på mobil' }); assert.equal(r.status, 201);
    await new Promise((res) => setTimeout(res, 300));
    d = decode(f.got.at(-1));
    assert.match(d.head, /^To: support@gaveplanlegger\.no$/m); assert.match(d.head, /^Reply-To: admin@test\.no$/m); assert.match(d.body, /Knappen virker ikke/);
    step('tilbakemeldinger går til support-adressen, og «Svar» går til avsenderen');
    process.env.SMTP_PASS = 'feil';
    r = await call('POST', '/api/admin/test-email', {}); assert.equal(r.data.ok, false); assert.match(r.data.error, /brukernavn eller passord/);
    step('Admin viser feilmeldingen når innloggingen feiler');

    console.log(`\nAlle ${ok} e-posttester bestått ✅`);
  } catch (e) { console.error('\n❌', e); process.exitCode = 1; }
  for (const s of servers) s.close();
  setTimeout(() => process.exit(), 200);
})();
