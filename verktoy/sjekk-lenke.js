// Feilsøking av lenkehenting. Kjør:  npm run sjekk-lenke -- https://www.butikk.no/produkt
// Viser steg for steg hva som skjer når appen prøver å hente navn og pris.
'use strict';
const dns = require('node:dns').promises;
const { fetchHtml, parseProduct, errorCode, explainNetworkError } = require('../preview.js');

const url = process.argv[2];
if (!url) {
  console.log('Bruk: npm run sjekk-lenke -- https://www.butikk.no/produkt');
  process.exit(1);
}

(async () => {
  console.log(`Node.js ${process.version} · ${process.platform}`);
  console.log(`Lenke: ${url}\n`);
  let u;
  try { u = new URL(url); } catch { console.log('❌ Lenken er ikke en gyldig adresse.'); process.exit(1); }

  // 1. Navneoppslag
  try {
    const addrs = await dns.lookup(u.hostname, { all: true });
    console.log(`✔ 1. Fant ${u.hostname}: ${addrs.map((a) => a.address).join(', ')}`);
  } catch (e) {
    console.log(`❌ 1. Fant ikke ${u.hostname} (${e.code}). Sjekk lenken og internettforbindelsen.`);
    process.exit(1);
  }

  // 2. Henting
  let page;
  const t0 = Date.now();
  try {
    page = await fetchHtml(url);
    console.log(`✔ 2. Hentet siden på ${Date.now() - t0} ms (${Math.round(page.html.length / 1024)} kB)${page.finalUrl !== url ? ` – videresendt til ${page.finalUrl}` : ''}`);
  } catch (e) {
    console.log(`❌ 2. Henting feilet etter ${Date.now() - t0} ms: ${e.message}`);
    const code = e.code || errorCode(e);
    if (code) console.log(`   Teknisk kode: ${code}`);
    if (code && /CERT|SSL|TLS|ISSUER|SELF_SIGNED|DEPTH_ZERO/.test(code)) {
      console.log('\n   Prøv:  npm run start:systemsertifikat   (og: npm run sjekk-lenke:systemsertifikat -- <lenke>)');
      console.log('   Dette lar appen bruke de samme sertifikatene som nettleseren din.');
    }
    process.exit(1);
  }

  // 3. Tolking
  const d = parseProduct(page.html, page.finalUrl);
  const ld = /application\/ld\+json/i.test(page.html), og = /og:title/i.test(page.html);
  console.log(`   Siden har ${ld ? '' : 'ikke '}JSON-LD, ${og ? '' : 'ikke '}Open Graph-titel.`);
  if (/captcha|cf-chl|access denied|are you a robot|px-captcha/i.test(page.html)) {
    console.log('⚠  Siden ser ut til å vise en robotsjekk – butikken blokkerer trolig automatisk henting.');
  }
  console.log(`${d.title ? '✔' : '❌'} 3. Navn: ${d.title || '(fant ikke)'}`);
  console.log(`${d.price ? '✔' : '❌'}    Pris: ${d.price || '(fant ikke)'}`);
  if (!d.title && !d.price) process.exit(1);
})().catch((e) => { console.log('❌ Uventet feil:', e.message, explainNetworkError(errorCode(e))); process.exit(1); });
