// Tester henting av navn og pris fra lenker, mot lokale eksempelsider. Kjør: npm test
'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');

process.env.ALLOW_PRIVATE_PREVIEW = '1'; // eksempelsidene kjører på localhost
const { linkPreview, isPrivateIp } = require('../preview.js');

const pages = {
  '/jsonld': ['text/html; charset=utf-8', `<html><head><title>Feil tittel | Butikk</title>
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Ullgenser Dale \\u00d8ye","image":["https://x.no/a.jpg"],
    "offers":{"@type":"Offer","price":"1299.00","priceCurrency":"NOK"}}</script></head><body></body></html>`],
  '/graph': ['text/html', `<script type="application/ld+json">{"@graph":[{"@type":"WebPage"},{"@type":["ProductGroup"],"name":"Joggesko",
    "hasVariant":[{"@type":"Product","offers":[{"@type":"AggregateOffer","lowPrice":899,"priceCurrency":"NOK"}]}]}]}</script>`],
  '/og': ['text/html', `<meta property="og:title" content="Kaffekopp i steingods &amp; skål | Butikken">
    <meta property="product:price:amount" content="349,00"><meta property="product:price:currency" content="NOK">`],
  '/micro': ['text/html', `<title>Sult – Knut Hamsun - Ark</title><span itemprop="price" content="199.5">199,50</span>`],
  '/eur': ['text/html', `<meta property="og:title" content="Lego Technic"><meta property="product:price:amount" content="49.99"><meta property="product:price:currency" content="EUR">`],
  '/komplett': ['text/html', `<html><head><title>Samsung 65" The Frame Pro Neo QLED 4K Mini LED Smart TV (2026) - 60 - 69 tommer TV | Komplett.no</title>
    <meta property="og:title" content="Samsung 65&quot; The Frame Pro Neo QLED 4K Mini LED Smart TV (2026) - 60 - 69 tommer TV"></head><body>
    <h1 class="product-main-info__name"><span>Samsung 65" The Frame Pro Neo QLED 4K Mini LED Smart TV (2026)</span></h1>
    <div class="product-price"><span class="product-price-before">24 990,-</span><span class="product-price-now">14&nbsp;990,-</span></div>
    <div class="financing-price">526,- per mnd</div></body></html>`],
  '/komplett2': ['text/html', `<h1>Samsung 65" The Frame Pro</h1><title>Samsung 65" The Frame Pro - TV | Komplett.no</title>
    <div class="product-price"><div class="campaign-price-badge">SPAR 10 000,-</div><span class="product-price-now">14 990,-</span>
    <div class="product-price-before">Førpris: 24 990,-</div></div><div class="monthly-price">526,- /md.</div>`],
  '/komplett3': ['text/html', `<h1>TV</h1><div class="price-block">SPAR 10 000,- 14 990,- Førpris: 24 990,- 526,- /md.</div>`],
  '/synlig': ['text/html', `<title>Kaffetrakter</title><h1>Moccamaster KBG Select</h1><div class="price-box"><p class="price-was">3 299 kr</p><p>Pris: 2 499 kr</p></div>`],
  '/tom': ['text/html', `<html><body>Ingenting her</body></html>`],
  '/bilde': ['image/png', 'PNG'],
};

const srv = http.createServer((req, res) => {
  if (req.url === '/flyttet') { res.writeHead(301, { Location: '/jsonld' }); return res.end(); }
  if (req.url === '/latin1') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=iso-8859-1' });
    return res.end(Buffer.from('<title>Bløtkakefat i glass | Kitchn</title><meta property="product:price:amount" content="250">', 'latin1'));
  }
  const p = pages[req.url];
  if (!p) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': p[0] }); res.end(p[1]);
});

srv.listen(0, async () => {
  const base = `http://127.0.0.1:${srv.address().port}`;
  let ok = 0; const step = (n) => { ok++; console.log('✔', n); };
  try {
    let d = await linkPreview(base + '/jsonld');
    assert.equal(d.title, 'Ullgenser Dale Øye'); assert.equal(d.price, '1\u00a0299 kr'); assert.equal(d.image, 'https://x.no/a.jpg'); step('JSON-LD Product');
    d = await linkPreview(base + '/graph'); assert.equal(d.title, 'Joggesko'); assert.equal(d.price, '899 kr'); step('JSON-LD @graph med varianter');
    d = await linkPreview(base + '/og'); assert.equal(d.title, 'Kaffekopp i steingods & skål'); assert.equal(d.price, '349 kr'); step('Open Graph-metatagger');
    d = await linkPreview(base + '/micro'); assert.equal(d.title, 'Sult – Knut Hamsun'); assert.equal(d.price, '199,50 kr'); step('microdata og <title>');
    d = await linkPreview(base + '/komplett');
    assert.equal(d.title, 'Samsung 65" The Frame Pro Neo QLED 4K Mini LED Smart TV (2026)'); assert.equal(d.price, '14\u00a0990 kr');
    step('Komplett-lignende side: navn fra overskrift, pris fra synlig tekst');
    d = await linkPreview(base + '/komplett2'); assert.equal(d.price, '14\u00a0990 kr');
    d = await linkPreview(base + '/komplett3'); assert.equal(d.price, '14\u00a0990 kr'); step('hopper over «SPAR 10 000,-», førpris og månedspris');
    d = await linkPreview(base + '/synlig'); assert.equal(d.price, '2\u00a0499 kr'); step('synlig pris – hopper over gammel pris');
    d = await linkPreview(base + '/eur'); assert.equal(d.price, '49,99 EUR'); step('utenlandsk valuta');
    d = await linkPreview(base + '/latin1'); assert.equal(d.title, 'Bløtkakefat i glass'); assert.equal(d.price, '250 kr'); step('gammel tegnkoding (latin1)');
    d = await linkPreview(base + '/flyttet'); assert.equal(d.title, 'Ullgenser Dale Øye'); step('følger videresending');
    await assert.rejects(linkPreview(base + '/tom'), /Fant ikke/); step('side uten produktinfo gir forståelig feil');
    await assert.rejects(linkPreview(base + '/bilde'), /ikke til en nettside/); step('ikke-nettside avvises');
    await assert.rejects(linkPreview(base + '/finnes-ikke'), /404/); step('404 håndteres');

    // Sikkerhet: interne adresser blokkeres når testbryteren er av
    delete process.env.ALLOW_PRIVATE_PREVIEW;
    for (const u of ['http://127.0.0.1/', 'http://localhost/', 'http://10.0.0.5/', 'http://192.168.1.1/', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/', 'file:///etc/passwd']) {
      await assert.rejects(linkPreview(u), /Kan ikke hente|http/, u);
    }
    assert.equal(isPrivateIp('8.8.8.8'), false); assert.equal(isPrivateIp('172.20.1.1'), true); assert.equal(isPrivateIp('::ffff:127.0.0.1'), true);
    step('interne adresser og filer blokkeres');
    console.log(`\nAlle ${ok} lenketester bestått ✅`);
  } catch (e) { console.error('\n❌', e); process.exitCode = 1; }
  srv.close();
});
