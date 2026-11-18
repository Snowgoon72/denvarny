// Henter produktnavn og pris fra en nettbutikk-lenke.
// Leser strukturerte data som butikkene legger inn for Google/Facebook:
//   1) JSON-LD (schema.org Product/Offer)  2) Open Graph / produkt-metatagger  3) microdata  4) <title>
'use strict';
const dns = require('node:dns').promises;
const net = require('node:net');

const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 5;
const cache = new Map(); // url -> { at, data }

// ---------- Sikkerhet: ikke la serveren hente interne adresser (SSRF) ----------
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}
async function assertPublicUrl(u) {
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Lenken må starte med http:// eller https://');
  if (u.port && !['80', '443', ''].includes(u.port) && !process.env.ALLOW_PRIVATE_PREVIEW) throw new Error('Ugyldig port.');
  if (process.env.ALLOW_PRIVATE_PREVIEW) return; // kun for tester
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => { throw new Error('Fant ikke nettsiden.'); });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error('Kan ikke hente fra denne adressen.');
}

// Finn den egentlige feilkoden (Node legger den i e.cause)
function errorCode(e) {
  for (let c = e, i = 0; c && i < 5; c = c.cause, i++) if (c.code) return c.code;
  return null;
}
function explainNetworkError(code) {
  if (!code) return 'Fikk ikke kontakt med nettsiden.';
  if (/CERT|SSL|TLS|ISSUER|SELF_SIGNED|DEPTH_ZERO/.test(code)) {
    return 'Sikkerhetssertifikatet til nettsiden ble ikke godtatt. Det skyldes ofte et antivirusprogram som sjekker nettrafikk – start appen med «npm run start:systemsertifikat».';
  }
  if (['ECONNRESET', 'UND_ERR_SOCKET', 'EPIPE', 'UND_ERR_CLOSED'].includes(code)) return 'Butikken avbrøt forbindelsen – den blokkerer trolig automatisk henting.';
  if (['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'ENETUNREACH', 'EHOSTUNREACH'].includes(code)) return 'Fikk ikke svar fra nettsiden (tidsavbrudd).';
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(code)) return 'Fant ikke nettsiden – sjekk lenken og internettforbindelsen.';
  if (code === 'ECONNREFUSED') return 'Nettsiden nektet tilkobling.';
  return `Fikk ikke kontakt med nettsiden (${code}).`;
}

async function fetchHtml(startUrl) {
  let url = new URL(startUrl);
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    await assertPublicUrl(url);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url, {
        redirect: 'manual', signal: ctrl.signal,
        headers: {
          // Mange nettbutikker avviser ukjente klienter, så vi presenterer oss som en vanlig nettleser
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
          'Accept-Language': 'nb-NO,nb;q=0.9,no;q=0.8,en;q=0.5',
        },
      });
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('Butikken svarte ikke i tide.');
      const code = errorCode(e);
      console.error(`[lenkehenting] ${url.hostname}: ${code || e.message}`, e.cause?.message || '');
      throw Object.assign(new Error(explainNetworkError(code)), { code });
    } finally { clearTimeout(timer); }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location'), url); continue;
    }
    if (!res.ok) throw new Error(`Butikken svarte med feil (${res.status}).`);
    const type = res.headers.get('content-type') || '';
    if (!/html|xml/i.test(type)) throw new Error('Lenken peker ikke til en nettside.');
    // Les maks MAX_BYTES
    const reader = res.body.getReader(); const chunks = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; chunks.push(value);
      if (size > MAX_BYTES) { reader.cancel().catch(() => {}); break; }
    }
    const buf = Buffer.concat(chunks);
    let charset = (type.match(/charset=([\w-]+)/i) || [])[1];
    if (!charset) charset = (buf.subarray(0, 4000).toString('latin1').match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1] || 'utf-8';
    let html;
    try { html = new TextDecoder(charset.toLowerCase()).decode(buf); } catch { html = buf.toString('utf8'); }
    return { html, finalUrl: url.toString() };
  }
  throw new Error('For mange videresendinger.');
}

// ---------- Tolking ----------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', aring: 'å', Aring: 'Å', aelig: 'æ', AElig: 'Æ', oslash: 'ø', Oslash: 'Ø', ndash: '–', mdash: '—', euro: '€' };
function decode(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return ENT[e] ?? m;
  }).replace(/\s+/g, ' ').trim();
}
function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? decode(m[2] ?? m[3] ?? m[4]) : null;
}
function metaMap(html) {
  const map = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const key = (attr(tag, 'property') || attr(tag, 'name') || attr(tag, 'itemprop') || '').toLowerCase();
    const val = attr(tag, 'content');
    if (key && val && !(key in map)) map[key] = val;
  }
  return map;
}
function* walk(node) {
  if (Array.isArray(node)) { for (const n of node) yield* walk(n); return; }
  if (node && typeof node === 'object') {
    yield node;
    if (node['@graph']) yield* walk(node['@graph']);
    for (const k of ['mainEntity', 'itemOffered', 'hasVariant']) if (node[k]) yield* walk(node[k]);
  }
}
const isType = (n, t) => [].concat(n['@type'] || []).some((x) => String(x).toLowerCase() === t);
function offerPrice(offers) {
  for (const o of walk(offers)) {
    const p = o.price ?? o.lowPrice ?? o.priceSpecification?.price ?? [].concat(o.priceSpecification || [])[0]?.price;
    if (p != null && p !== '') return { price: p, currency: o.priceCurrency || o.priceSpecification?.priceCurrency || null };
  }
  return null;
}
function fromJsonLd(html) {
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try { data = JSON.parse(m[1].trim().replace(/^<!--|-->$/g, '')); } catch { continue; }
    for (const n of walk(data)) {
      if (isType(n, 'product') || isType(n, 'productgroup')) {
        const offer = offerPrice(n.offers) || (n.hasVariant ? offerPrice([].concat(n.hasVariant).map((v) => v.offers)) : null);
        const image = [].concat(n.image || [])[0];
        return { title: n.name ? decode(n.name) : null, ...(offer || {}), image: typeof image === 'string' ? image : image?.url || null };
      }
    }
  }
  return null;
}
function cleanTitle(t, host) {
  if (!t) return null;
  // Fjern « | Butikknavn» / « - Butikknavn» på slutten
  const m = t.match(/^(.*\S)\s+[|–—-]\s+([^|–—]+)$/);
  if (m) {
    const suffix = m[2].toLowerCase().replace(/\s/g, '');
    const site = host.replace(/^www\./, '').split('.')[0];
    if (suffix.includes(site) || m[2].length <= 25) return m[1].trim();
  }
  return t;
}
function formatPrice(price, currency) {
  if (price == null) return null;
  let n = typeof price === 'number' ? price : Number(String(price).replace(/\s/g, '').replace(/,(\d{1,2})$/, '.$1').replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  const cur = (currency || 'NOK').toUpperCase();
  const num = n % 1 === 0 ? n.toLocaleString('nb-NO') : n.toLocaleString('nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return cur === 'NOK' ? `${num} kr` : `${num} ${cur}`;
}
const stripTags = (h) => decode(String(h).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '));
// Norsk prisformat i synlig tekst: «14 990,-», «1 299 kr», «249,90 kr», «NOK 499»
const NOK_RE = /(?:NOK\s*)?(\d{1,3}(?:[\s .]\d{3})+|\d{2,7})(?:\s*,-|,(\d{2})\s*(?:kr|NOK)?|\s*(?:kr|NOK)\b)/i;
// Finn første beløp i en tekst som faktisk er prisen – ikke «Spar 10 000,-», «Førpris: 24 990,-» eller «526,- /md.»
function priceInText(text) {
  const re = new RegExp(NOK_RE.source, 'gi');
  for (const m of text.matchAll(re)) {
    const before = text.slice(Math.max(0, m.index - 24), m.index);
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 14);
    if (/(spar|sparer|save|rabatt|avslag|før|førpris|veil|veiledende|tidligere|ord\.?|normalpris|fra)\s*:?\s*(kr\.?|nok)?\s*-?\s*$/i.test(before)) continue;
    if (/^\s*(\/\s*m(n)?d|per\s*m|i\s*mnd|mnd|md\b|måned|%|x\b)/i.test(after)) continue;
    if (/(?:^|[^,\d])[-−–]\s*$/.test(before)) continue; // «-10 000,-» er et fradrag (men ikke «,-» fra forrige beløp)
    const n = nokNumber(m);
    if (n >= 10) return n;
  }
  return null;
}
function nokNumber(m) {
  const whole = m[1].replace(/[\s .]/g, '');
  return Number(m[2] ? `${whole}.${m[2]}` : whole);
}
// Pris fra synlige elementer med «price/pris» i klassenavnet (hopper over gammel pris, rabatt og månedspris)
const SKIP = 'old|before|was|strike|regular|original|month|maaned|måned|finan|save|saving|discount|rabatt|spar|tidligere|veil|per-|unit';
function visiblePrice(html) {
  const open = /<(\w+)\b[^>]*\b(?:class|data-testid|id|itemprop)\s*=\s*["'][^"']*(?:price|pris)[^"']*["'][^>]*>/gi;
  for (const m of html.matchAll(open)) {
    if (new RegExp(SKIP, 'i').test(m[0])) continue;
    // Teksten fram til neste priselement (slik at en «boks» ikke låner prisen fra et barn med gammel pris)
    let chunk = html.slice(m.index + m[0].length, m.index + m[0].length + 600)
      .replace(new RegExp(`<(\\w+)\\b[^>]*\\b(?:class|data-testid|id)\\s*=\\s*["'][^"']*(?:${SKIP})[^"']*["'][^>]*>[\\s\\S]*?<\\/\\1>`, 'gi'), ' ');
    const next = chunk.search(/<\w+\b[^>]*\b(?:class|data-testid|id|itemprop)\s*=\s*["'][^"']*(?:price|pris)/i);
    if (next >= 0) chunk = chunk.slice(0, next);
    const n = priceInText(stripTags(chunk));
    if (n != null) return n;
  }
  return null;
}
// Pris i innebygde data (f.eks. React/Next.js-tilstand): "price": 14990
function embeddedPrice(html) {
  const m = html.match(/"(?:price|salesPrice|currentPrice|priceIncVat|price_inc_vat)"\s*:\s*"?(\d+(?:\.\d{1,2})?)"?/i);
  return m && Number(m[1]) >= 10 ? Number(m[1]) : null;
}
function parseProduct(html, pageUrl) {
  const host = new URL(pageUrl).hostname;
  const ld = fromJsonLd(html) || {};
  const meta = metaMap(html);
  const titleTag = decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
  const h1 = stripTags((html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '');
  const ogTitle = meta['og:title'] || meta['twitter:title'] || '';
  // Overskriften (h1) er som regel produktnavnet; bruk den når tittelen starter med den
  const h1Match = h1.length >= 3 && [ogTitle, titleTag].some((t) => t && t.toLowerCase().startsWith(h1.toLowerCase())) ? h1 : null;
  const title = ld.title || h1Match || cleanTitle(ogTitle, host) || cleanTitle(titleTag, host) || null;
  let price = ld.price, currency = ld.currency;
  if (price == null) {
    price = meta['product:price:amount'] || meta['og:price:amount'] || meta.price || null;
    currency = meta['product:price:currency'] || meta['og:price:currency'] || meta.pricecurrency || null;
  }
  if (price == null) { // microdata: <span itemprop="price" content="499">
    const tag = (html.match(/<[^>]+itemprop\s*=\s*["']price["'][^>]*>/i) || [])[0];
    if (tag) price = attr(tag, 'content');
  }
  if (price == null) { price = visiblePrice(html); if (price != null) currency = 'NOK'; }
  if (price == null) { price = embeddedPrice(html); if (price != null) currency = currency || 'NOK'; }
  return {
    title: title ? title.slice(0, 200) : null,
    price: formatPrice(price, currency),
    image: ld.image || meta['og:image'] || null,
    site: host.replace(/^www\./, ''),
  };
}

async function linkPreview(rawUrl) {
  const key = rawUrl.trim();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 3600_000) return hit.data;
  const { html, finalUrl } = await fetchHtml(key);
  const data = parseProduct(html, finalUrl);
  if (!data.title && !data.price) throw new Error('Fant ikke navn eller pris på siden.');
  cache.set(key, { at: Date.now(), data });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return data;
}

module.exports = { linkPreview, parseProduct, isPrivateIp, fetchHtml, errorCode, explainNetworkError };
