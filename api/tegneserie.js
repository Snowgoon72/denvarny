// /api/tegneserie – slår opp tegneserieinfo hos Nasjonalbiblioteket (NB) og Grand Comics Database (GCD).
//
// POST { strekkode }                  → ISBN (978/979…) eller blad-EAN med ISSN (977…) slås opp hos NB
// POST { sokeord, nr?, aar? }         → tittel/bladserie søkes hos NB, og serie + nummer hos GCD
//
// Svar: { funnet, kilder: [...], tittel, bladserie, nr, aar, forfatter, oversatt_av, forlag,
//         opplag, spraak, land, antall_sider, isbn, issn, lenke }
//
// NB:  https://api.nb.no/catalog/v1/items  – åpen, ingen nøkkel, metadata er CC0.
// GCD: https://www.comics.org/api/         – åpen lesing, data er CC BY-SA 4.0 (krev kreditering i appen).
//      GCD har ikke søk på strekkode/ISBN, bare serie-navn + nummer (+ år).
//      Valgfritt: sett GCD_EMAIL og GCD_PASSWORD i Vercel hvis GCD krever innlogging.

const TIDSAVBRUDD_MS = 8000;
const USER_AGENT = 'Samlerbasen/1.0 (samlerapp; kontakt via appen)';

// ---------- små hjelpere ----------
async function hentJson(url, ekstraHeaders = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIDSAVBRUDD_MS);
    try {
        const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT, ...ekstraHeaders }, signal: ctrl.signal });
        if (!r.ok) return null;
        return await r.json();
    } catch (e) {
        return null;
    } finally {
        clearTimeout(t);
    }
}

// Finner første verdi for en av nøklene, uansett hvor dypt den ligger (NB-svaret varierer litt)
function finn(obj, nokler, dybde = 0) {
    if (!obj || typeof obj !== 'object' || dybde > 6) return undefined;
    for (const k of nokler) if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
    for (const v of Object.values(obj)) {
        if (v && typeof v === 'object') {
            const f = finn(v, nokler, dybde + 1);
            if (f !== undefined) return f;
        }
    }
    return undefined;
}
const somTekst = v => {
    if (v == null) return '';
    if (Array.isArray(v)) return v.map(somTekst).filter(Boolean).join(', ');
    if (typeof v === 'object') return somTekst(v.name || v.navn || v.value || v.title || v.code || '');
    return String(v).trim();
};
const fireSiffer = v => { const m = String(v || '').match(/\b(1[89]\d\d|20\d\d)\b/); return m ? m[1] : ''; };
// "Falk, Lee (1911-1999)" → "Lee Falk"
const vendNavn = n => {
    n = String(n || '').replace(/\(.*?\)/g, '').trim();
    const d = n.split(',').map(s => s.trim()).filter(Boolean);
    return d.length === 2 ? d[1] + ' ' + d[0] : n;
};

const SPRAAK = {
    nob: 'Norsk', nno: 'Nynorsk', nor: 'Norsk', no: 'Norsk', nb: 'Norsk', nn: 'Nynorsk',
    swe: 'Svensk', sv: 'Svensk', dan: 'Dansk', da: 'Dansk', fin: 'Finsk', fi: 'Finsk',
    eng: 'Engelsk', en: 'Engelsk', ger: 'Tysk', deu: 'Tysk', de: 'Tysk', fre: 'Fransk', fra: 'Fransk', fr: 'Fransk',
    ita: 'Italiensk', it: 'Italiensk', spa: 'Spansk', es: 'Spansk', jpn: 'Japansk', ja: 'Japansk', dut: 'Nederlandsk', nld: 'Nederlandsk', nl: 'Nederlandsk'
};
const LAND = {
    no: 'Norge', se: 'Sverige', dk: 'Danmark', fi: 'Finland', is: 'Island', us: 'USA', gb: 'Storbritannia', uk: 'Storbritannia',
    fr: 'Frankrike', be: 'Belgia', de: 'Tyskland', it: 'Italia', es: 'Spania', nl: 'Nederland', jp: 'Japan', ca: 'Canada'
};

// ---------- strekkode → ISBN / ISSN ----------
function tolkStrekkode(raa) {
    const s = String(raa || '').replace(/[^0-9Xx]/g, '').toUpperCase();
    if (/^97[89]\d{10}$/.test(s)) return { isbn: s };
    if (/^\d{9}[\dX]$/.test(s)) return { isbn: s };
    // Blad-EAN: 977 + 7 første sifre i ISSN + 2 sifre + kontrollsiffer
    if (/^977\d{10}$/.test(s)) {
        const sju = s.slice(3, 10);
        let sum = 0;
        for (let i = 0; i < 7; i++) sum += Number(sju[i]) * (8 - i);
        const k = (11 - (sum % 11)) % 11;
        const issn = sju.slice(0, 4) + '-' + sju.slice(4) + (k === 10 ? 'X' : String(k));
        return { issn };
    }
    return {};
}

// ---------- Nasjonalbiblioteket ----------
function nbTilFelt(item) {
    const md = item.metadata || item;
    const ut = { kilde: 'Nasjonalbiblioteket' };
    ut.tittel = somTekst(finn(md, ['title', 'mainTitle']));
    const serie = finn(md, ['series', 'seriesTitle']);
    const serieTekst = serie ? somTekst(Array.isArray(serie) ? serie[0] : serie) : '';
    if (serieTekst) ut.bladserie = serieTekst.replace(/\s*;.*$/, '');
    const del = finn(md, ['partNumber', 'seriesNumber', 'volume']);
    if (del) ut.nr = somTekst(del);
    else { const m = serieTekst.match(/;\s*(?:nr\.?\s*)?(\d+[a-z]?)/i); if (m) ut.nr = m[1]; }   // "Fantomet ; 7"
    const oi = finn(md, ['originInfo']) || md;
    ut.forlag = somTekst(finn(oi, ['publisher', 'publishers']));
    ut.aar = fireSiffer(somTekst(finn(oi, ['issued', 'dateIssued', 'publicationYear', 'year'])));
    const ed = somTekst(finn(oi, ['edition']));
    if (/opplag|utg|print|uppl/i.test(ed)) ut.opplag = ed;

    // Personer med roller (expand=metadata gir people[] med MARC-roller: aut, ill, art, trl ...)
    const folk = finn(md, ['people', 'persons', 'contributors']);
    const forfattere = [], oversettere = [];
    if (Array.isArray(folk)) {
        folk.forEach(p => {
            const navn = vendNavn(somTekst(p.name || p.navn || p.displayName || p));
            const roller = JSON.stringify(p.roles || p.role || p.relator || p.relators || '').toLowerCase();
            if (!navn) return;
            if (/trl|oversett|translat/.test(roller)) oversettere.push(navn);
            else forfattere.push(navn);
        });
    }
    if (!forfattere.length) {
        const cr = finn(md, ['creators', 'creator', 'authors']);
        (Array.isArray(cr) ? cr : cr ? [cr] : []).forEach(c => { const n = vendNavn(somTekst(c)); if (n) forfattere.push(n); });
    }
    ut.forfatter = [...new Set(forfattere)].join(', ');
    ut.oversatt_av = [...new Set(oversettere)].join(', ');

    const spr = finn(md, ['languages', 'language']);
    const kode = somTekst(Array.isArray(spr) ? spr[0] : spr).toLowerCase();
    ut.spraak = SPRAAK[kode] || (kode.length > 3 ? kode.charAt(0).toUpperCase() + kode.slice(1) : '');
    // NB samler norske utgivelser (pliktavlevering) – norsk språk ⇒ gitt ut i Norge
    if (/norsk|nynorsk/i.test(ut.spraak)) ut.land = 'Norge';
    const sider = somTekst(finn(md, ['extent', 'physicalDescription', 'pageCount']));
    const ms = sider.match(/(\d+)\s*(s\b|sider|bl\.|p\b|pages)/i);
    if (ms) ut.antall_sider = ms[1];
    const id = item.id || finn(item, ['id', 'sesamId']);
    if (id) ut.lenke = 'https://www.nb.no/items/' + id;
    return ut;
}

async function sokNb(q, ekstra = '') {
    const url = 'https://api.nb.no/catalog/v1/items?q=' + encodeURIComponent(q) + '&size=5&expand=metadata' + ekstra;
    const data = await hentJson(url);
    const liste = data && (finn(data, ['items']) || []);
    return Array.isArray(liste) ? liste : [];
}

async function nbFraKode({ isbn, issn }) {
    if (isbn) {
        const t = await sokNb('isbn:' + isbn);
        if (t.length) return { ...nbTilFelt(t[0]), isbn };
    }
    if (issn) {
        let t = await sokNb('issn:' + issn);
        if (!t.length) t = await sokNb(issn);
        if (t.length) {
            const f = nbTilFelt(t[0]);
            // Et ISSN gjelder hele bladserien, ikke ett nummer
            return { kilde: f.kilde, bladserie: f.bladserie || f.tittel, forlag: f.forlag, spraak: f.spraak, land: f.land, issn, lenke: f.lenke };
        }
    }
    return null;
}

async function nbFraTittel(sokeord) {
    const t = await sokNb(sokeord, '&searchType=FIELD_RESTRICTED_SEARCH');
    if (!t.length) return null;
    const ord = sokeord.toLowerCase().split(/\s+/).filter(o => o.length > 2);
    const best = t.find(i => { const tit = somTekst(finn(i.metadata || i, ['title'])).toLowerCase(); return ord.every(o => tit.includes(o)); });
    return best ? nbTilFelt(best) : null;
}

// ---------- Grand Comics Database ----------
function gcdHeaders() {
    const { GCD_EMAIL, GCD_PASSWORD } = process.env;
    return GCD_EMAIL && GCD_PASSWORD ? { Authorization: 'Basic ' + Buffer.from(GCD_EMAIL + ':' + GCD_PASSWORD).toString('base64') } : {};
}
const gcd = url => hentJson(url.includes('format=json') ? url : url + (url.includes('?') ? '&' : '?') + 'format=json', gcdHeaders());

async function gcdFraSerie(serie, nr, aar) {
    if (!serie || !nr) return null;
    const navn = encodeURIComponent(serie).replace(/%2F/g, '/');
    const forsok = [];
    if (aar) forsok.push(`https://www.comics.org/api/series/name/${navn}/issue/${encodeURIComponent(nr)}/year/${aar}/`);
    forsok.push(`https://www.comics.org/api/series/name/${navn}/issue/${encodeURIComponent(nr)}/`);

    let utgave = null;
    for (const url of forsok) {
        const d = await gcd(url);
        if (!d) continue;
        const liste = Array.isArray(d) ? d : (d.results || (d.api_url ? [d] : []));
        // Foretrekk norske utgaver når navnet finnes i flere land
        utgave = liste.find(i => /\/no\b|norw/i.test(JSON.stringify(i.series_name || ''))) || liste[0];
        if (utgave) break;
    }
    if (!utgave) return null;
    if (typeof utgave === 'string') utgave = await gcd(utgave);
    else if (utgave.api_url && !utgave.story_set) utgave = (await gcd(utgave.api_url)) || utgave;
    if (!utgave) return null;

    const ut = { kilde: 'Grand Comics Database' };
    ut.nr = somTekst(utgave.number) || String(nr);
    ut.aar = fireSiffer(utgave.key_date || utgave.publication_date || utgave.on_sale_date);
    const sider = parseInt(utgave.page_count, 10);
    if (sider > 0) ut.antall_sider = String(sider);
    if (utgave.isbn) ut.isbn = String(utgave.isbn).replace(/-/g, '');
    if (utgave.indicia_publisher) ut.forlag = somTekst(utgave.indicia_publisher);

    // Kreditter fra historiene (manus / tegner / oversetter står ofte i notater eller egne felt)
    const manus = new Set(), tegnere = new Set(), oversettere = new Set();
    (Array.isArray(utgave.story_set) ? utgave.story_set : []).forEach(st => {
        const rydd = s => somTekst(s).split(/[;,]/).map(x => x.replace(/\[.*?\]|\(.*?\)|\?/g, '').trim()).filter(x => x && !/^none$/i.test(x));
        rydd(st.script || st.writer).forEach(n => manus.add(n));
        rydd(st.pencils).forEach(n => tegnere.add(n));
        const tekst = somTekst(st.notes) + ' ' + somTekst(st.translation || '');
        const m = tekst.match(/(?:oversatt av|oversettelse|translated by|translation)[:\s]+([^.;\n]+)/i);
        if (m) oversettere.add(m[1].trim());
    });
    const deler = [];
    if (manus.size) deler.push((tegnere.size ? 'Manus: ' : '') + [...manus].slice(0, 4).join(', '));
    if (tegnere.size) deler.push('Tegner: ' + [...tegnere].slice(0, 4).join(', '));
    ut.forfatter = deler.join(', ');
    ut.oversatt_av = [...oversettere].join(', ');

    // Serie: navn, land, språk, forlag
    const serieUrl = typeof utgave.series === 'string' ? utgave.series : (utgave.series && utgave.series.api_url);
    const s = serieUrl ? await gcd(serieUrl) : null;
    if (s) {
        ut.bladserie = somTekst(s.name);
        ut.land = LAND[String(s.country || '').toLowerCase()] || '';
        ut.spraak = SPRAAK[String(s.language || '').toLowerCase()] || '';
        if (!ut.forlag && s.publisher) {
            const p = typeof s.publisher === 'string' ? await gcd(s.publisher) : s.publisher;
            if (p) ut.forlag = somTekst(p.name || p);
        }
    }
    const id = utgave.id || String(utgave.api_url || '').match(/issue\/(\d+)/)?.[1];
    if (id) ut.lenke = 'https://www.comics.org/issue/' + id + '/';
    return ut;
}

// Første kilde vinner; senere kilder fyller bare tomme felt
function slaaSammen(...treff) {
    const ut = { funnet: false, kilder: [] };
    treff.filter(Boolean).forEach(t => {
        ut.funnet = true;
        ut.kilder.push(t.kilde);
        Object.entries(t).forEach(([k, v]) => { if (k !== 'kilde' && v && !ut[k]) ut[k] = v; });
    });
    return ut;
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Kun POST er tillatt' });
    const { strekkode, sokeord, nr, aar } = req.body || {};

    try {
        if (strekkode) {
            const kode = tolkStrekkode(strekkode);
            if (!kode.isbn && !kode.issn) return res.status(200).json({ funnet: false, kilder: [], grunn: 'Strekkoden er verken ISBN eller blad-EAN (977)' });
            const nb = await nbFraKode(kode);
            // Har vi bladserie og nummer, kan GCD fylle ut kreditter
            const g = nb && nb.bladserie && (nr || nb.nr) ? await gcdFraSerie(nb.bladserie, nr || nb.nr, aar || nb.aar) : null;
            return res.status(200).json({ ...slaaSammen(nb, g), ...kode });
        }
        if (sokeord) {
            const ren = String(sokeord).replace(/["#]/g, ' ').replace(/\s+/g, ' ').trim();
            const [nb, g] = await Promise.all([nbFraTittel(ren + (nr ? ' ' + nr : '')), gcdFraSerie(ren, nr, aar)]);
            return res.status(200).json(slaaSammen(nb, g));
        }
        return res.status(400).json({ error: 'Send strekkode eller sokeord' });
    } catch (err) {
        console.error('Tegneserie-oppslag feilet:', err);
        return res.status(500).json({ error: 'Serverfeil ved tegneserie-oppslag' });
    }
}
