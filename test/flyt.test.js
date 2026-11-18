// Ende-til-ende-test av hele flyten med to brukere. Kjør: npm test
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gaveliste-')), 'test.db');
process.env.PORT = '0';
process.env.ADMIN_EMAILS = 'carl@test.no';
const { server, runBirthdayReminders } = require('../server.js');

function client(base) {
  let cookie = '';
  return async (method, p, body) => {
    const r = await fetch(base + p, {
      method, redirect: 'manual',
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data, location: r.headers.get('location') };
  };
}
function dateInDays(days, yearsAgo) {
  const d = new Date(); d.setDate(d.getDate() + days); d.setFullYear(d.getFullYear() - yearsAgo);
  return d.toISOString().slice(0, 10);
}

server.listen(0, async () => {
  const base = `http://localhost:${server.address().port}`;
  const anna = client(base), bjorn = client(base), carl = client(base);
  let ok = 0; const step = (n) => { ok++; console.log('✔', n); };
  try {
    // Registrering med validering
    let r = await anna('POST', '/api/register', { name: 'Anna', email: 'anna@test.no', birthdate: dateInDays(5, 30), gender: 'kvinne', password: 'kort', acceptTerms: true, confirmAge: true });
    assert.equal(r.status, 400); step('for kort passord avvises');
    r = await anna('POST', '/api/register', { name: 'Anna', email: 'anna@test.no', birthdate: dateInDays(5, 8), gender: 'kvinne', password: 'hemmelig123', acceptTerms: true, confirmAge: true });
    assert.equal(r.status, 400); step('under 13 år avvises');
    r = await anna('POST', '/api/register', { name: 'Anna Berg', email: 'anna@test.no', birthdate: dateInDays(7, 30), gender: 'kvinne', password: 'hemmelig123', acceptTerms: true, confirmAge: true });
    assert.equal(r.status, 201); const annaUser = r.data.user; step('Anna registrert');
    r = await bjorn('POST', '/api/register', { name: 'Bjørn', email: 'bjorn@test.no', birthdate: dateInDays(40, 35), gender: 'mann', password: 'hemmelig123', acceptTerms: true, confirmAge: true });
    assert.equal(r.status, 201); const bjornUser = r.data.user; step('Bjørn registrert');
    r = await carl('POST', '/api/register', { name: 'Carl', email: 'carl@test.no', birthdate: dateInDays(100, 20), gender: 'ikke_oppgitt', password: 'hemmelig123', acceptTerms: true, confirmAge: true });
    const carlUser = r.data.user;
    r = await carl('POST', '/api/register', { name: 'X', email: 'CARL@test.no', birthdate: '1990-01-01', gender: 'mann', password: 'hemmelig123', acceptTerms: true, confirmAge: true });
    assert.equal(r.status, 409); step('duplikat e-post avvises (uavhengig av store/små bokstaver)');
    const dina = client(base);
    r = await dina('POST', '/api/register', { name: 'Dina', email: 'dina@test.no', password: 'hemmelig123', acceptTerms: true }); assert.equal(r.status, 400);
    r = await dina('POST', '/api/register', { name: 'Dina', email: 'dina@test.no', password: 'hemmelig123', acceptTerms: true, confirmAge: true, gender: 'ukjent' }); assert.equal(r.status, 400);
    r = await dina('POST', '/api/register', { name: 'Dina', email: 'dina@test.no', password: 'hemmelig123', acceptTerms: true, confirmAge: true });
    assert.equal(r.status, 201); assert.equal(r.data.user.birthdate, null); assert.equal(r.data.user.gender, null);
    r = await dina('GET', '/api/dashboard'); assert.equal(r.status, 200); assert.equal(r.data.myBirthday, null);
    step('registrering uten fødselsdato og kjønn (alder bekreftes med avkrysning)');

    // Innlogging
    r = await client(base)('POST', '/api/login', { email: 'anna@test.no', password: 'feil' }); assert.equal(r.status, 401);
    r = await client(base)('POST', '/api/login', { email: 'Anna@test.no', password: 'hemmelig123' }); assert.equal(r.status, 200); step('innlogging virker');

    // Ønsker
    r = await anna('POST', '/api/wishes', { title: 'Ullsokker', url: 'javascript:alert(1)' }); assert.equal(r.status, 400); step('farlige lenker avvises');
    const w1 = (await anna('POST', '/api/wishes', { title: 'Ullsokker', url: 'https://www.eksempelbutikk.no/sokker', price: '299 kr', priority: 1 })).data.id;
    const w2 = (await anna('POST', '/api/wishes', { title: 'Bok: Sult', note: 'Pocket' })).data.id;
    const w3 = (await anna('POST', '/api/wishes', { title: 'Kaffekopp', url: 'https://annenbutikk.no/kopp' })).data.id;
    r = await anna('GET', '/api/wishes'); assert.equal(r.data.wishes.length, 3); step('ønsker lagt til');

    // Tilgang uten vennskap
    r = await bjorn('GET', `/api/friends/${annaUser.id}/wishes`); assert.equal(r.status, 403); step('fremmede ser ikke listen');
    r = await bjorn('POST', `/api/wishes/${w1}/claim`, {}); assert.equal(r.status, 404); step('fremmede kan ikke reservere');

    // Invitasjonslenke → vennskap
    const tok = annaUser.shareUrl.split('/').pop();
    r = await bjorn('POST', `/api/invite/${tok}`, {}); assert.equal(r.data.ownerId, annaUser.id); step('invitasjonslenke gjør dem til venner');

    // Reservasjon i hemmelighet
    r = await bjorn('POST', `/api/wishes/${w1}/claim`, {}); assert.equal(r.status, 200);
    r = await anna('GET', '/api/wishes');
    assert.ok(!JSON.stringify(r.data).includes('claim')); step('eier ser ikke reservasjoner');
    r = await bjorn('GET', `/api/friends/${annaUser.id}/wishes`);
    assert.equal(r.data.wishes.find((w) => w.id === w1).claimedByMe, true);
    step('venn ser sin reservasjon');

    // Venneforespørsel via e-post
    r = await carl('POST', '/api/friends', { email: 'anna@test.no' }); assert.equal(r.data.status, 'requested');
    r = await anna('GET', '/api/friends'); assert.equal(r.data.incoming.length, 1);
    r = await anna('POST', `/api/friends/${carlUser.id}/accept`, {}); assert.equal(r.status, 200); step('venneforespørsel sendt og godtatt');
    r = await carl('GET', `/api/friends/${annaUser.id}/wishes`);
    assert.equal(r.data.wishes.find((w) => w.id === w1).claimed, true);
    assert.equal(r.data.wishes.find((w) => w.id === w1).claimedByMe, false);
    r = await carl('POST', `/api/wishes/${w1}/claim`, {}); assert.equal(r.status, 409); step('samme gave kan ikke reserveres to ganger');
    r = await carl('POST', '/api/friends', { email: 'ny@person.no' }); assert.equal(r.data.status, 'not_registered'); step('uregistrert venn → invitasjon');

    // Direkte lenker (ingen affiliate) og annonseoppsett
    r = await bjorn('GET', `/api/friends/${annaUser.id}/wishes`);
    assert.equal(r.data.wishes.find((w) => w.id === w1).url, 'https://www.eksempelbutikk.no/sokker');
    r = await bjorn('GET', `/go/w/${w1}`); assert.notEqual(r.status, 302); step('lenker går rett til butikken');
    r = await client(base)('GET', '/api/config'); assert.equal(r.data.ads.enabled, false); assert.equal(r.data.ads.showPlaceholders, true);
    r = await client(base)('GET', '/ads.txt'); assert.equal(r.status, 200); step('annonseoppsett og ads.txt');

    // Gaveplanlegger
    r = await anna('POST', '/api/recipients', { name: 'Bestemor', relation: 'Bestemor', day: 31, month: 2 }); assert.equal(r.status, 400); step('ugyldig bursdag avvises');
    const t = new Date(); t.setDate(t.getDate() + 7);
    r = await anna('POST', '/api/recipients', { name: 'Bestemor Ruth', relation: 'Bestemor', day: t.getDate(), month: t.getMonth() + 1, year: 1950 });
    const rid = r.data.id;
    const rid2 = (await anna('POST', '/api/recipients', { name: 'Kollega Per', day: t.getDate(), month: t.getMonth() + 1 })).data.id;
    r = await anna('POST', `/api/recipients/${rid}/ideas`, { title: 'Strikkebok', price: '349 kr', occasion: 'Bursdag' }); const gid = r.data.id;
    await anna('POST', `/api/recipients/${rid}/ideas`, { title: 'Blomster', url: 'https://blomster.no' });
    r = await anna('POST', `/api/recipients/${rid}/ideas`, { title: 'X', url: 'javascript:1' }); assert.equal(r.status, 400);
    await anna('PUT', `/api/ideas/${gid}`, { status: 'bought' });
    r = await anna('GET', '/api/recipients');
    const ruth = r.data.recipients.find((x) => x.id === rid);
    assert.equal(ruth.ideas.length, 2); assert.equal(ruth.ideas.find((g) => g.id === gid).status, 'bought');
    assert.equal(ruth.birthday.daysUntil, 7);
    assert.equal(r.data.recipients.find((x) => x.id === rid2).birthday.turning, null); step('personer og gaveideer lagres');
    r = await bjorn('GET', '/api/recipients'); assert.equal(r.data.recipients.length, 0);
    r = await bjorn('PUT', `/api/ideas/${gid}`, { status: 'given' }); assert.equal(r.status, 404);
    r = await bjorn('DELETE', `/api/recipients/${rid}`, {});
    r = await anna('GET', '/api/recipients'); assert.equal(r.data.recipients.length, 2); step('gaveplanleggeren er privat');
    r = await anna('GET', '/api/dashboard');
    assert.ok(r.data.upcoming.some((u) => u.planner && u.name === 'Bestemor Ruth' && u.turning > 70)); step('planlegger-bursdager på oversikten');

    // Lister i gaveplanleggeren
    const iso = (days) => { const d = new Date(); d.setDate(d.getDate() + days); return d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Oslo' }); };
    r = await anna('POST', '/api/lists', { name: 'Juleliste 2026', kind: 'jul', deadline: '2026-13-01' }); assert.equal(r.status, 400);
    const L = (await anna('POST', '/api/lists', { name: 'Juleliste 2026', kind: 'jul', deadline: iso(30) })).data.id;
    r = await anna('POST', `/api/lists/${L}/people`, { friendId: bjornUser.id }); const jb = r.data.recipientId;
    r = await anna('POST', `/api/lists/${L}/people`, { friendId: 99999 }); assert.equal(r.status, 403);
    await anna('POST', `/api/lists/${L}/people`, { recipientId: rid, budget: 500 });
    const kari = (await anna('POST', `/api/lists/${L}/people`, { name: 'Tante Kari' })).data.recipientId;
    await anna('POST', `/api/recipients/${kari}/ideas`, { title: 'Skjerf', price: '1 299,50 kr', listId: L });
    const sk = (await anna('POST', `/api/recipients/${kari}/ideas`, { title: 'Te', price: '150 kr', listId: L })).data.id;
    await anna('POST', `/api/recipients/${kari}/ideas`, { title: 'Bursdagsgave', price: '999', occasion: 'Bursdag' }); // ikke i listen
    await anna('PUT', `/api/ideas/${sk}`, { status: 'bought' });
    await anna('PUT', `/api/lists/${L}/people/${kari}`, { budget: 1000 });
    const bw = (await bjorn('POST', '/api/wishes', { title: 'Lue', price: '300 kr' })).data.id;
    await bjorn('POST', '/api/wishes', { title: 'Hansker', price: '400 kr' });
    r = await anna('GET', `/api/lists/${L}`);
    assert.equal(r.data.entries.length, 3);
    let eb = r.data.entries.find((e) => e.id === jb);
    assert.equal(eb.kind, 'friend'); assert.ok(eb.wishes.some((w) => w.title === 'Lue' && !w.claimed)); assert.equal(eb.done, false);
    step('venner i listen viser ønskelisten sin');
    await anna('POST', `/api/wishes/${bw}/claim`, {});
    r = await anna('GET', `/api/lists/${L}`);
    eb = r.data.entries.find((e) => e.id === jb);
    assert.equal(eb.wishes.find((w) => w.id === bw).claimedByMe, true); assert.equal(eb.spent, 300); assert.equal(eb.done, true);
    const ek = r.data.entries.find((e) => e.id === kari);
    assert.equal(ek.ideas.length, 2); assert.equal(ek.spent, 150); assert.equal(ek.planned, 1300); assert.equal(ek.budget, 1000);
    assert.equal(r.data.list.people, 3); assert.equal(r.data.list.done, 2); assert.equal(r.data.list.budget, 1500); assert.equal(r.data.list.state, 'active');
    step('liste med personer, budsjett, summer og reservasjon fra ønskeliste');
    r = await anna('GET', '/api/recipients'); assert.ok(!r.data.recipients.some((x) => x.id === jb));
    assert.equal(r.data.recipients.find((x) => x.id === kari).ideas.find((g) => g.title === 'Te').list_name, 'Juleliste 2026');
    step('gaveideer viser hvilken liste de hører til');

    // Frist + 7 dager → historikk
    const G = (await anna('POST', '/api/lists', { name: 'Konfirmasjon Emil', kind: 'konfirmasjon', deadline: iso(-3) })).data.id;
    const H = (await anna('POST', '/api/lists', { name: 'Juleliste 2025', kind: 'jul', deadline: iso(-8) })).data.id;
    await anna('POST', `/api/lists/${H}/people`, { recipientId: rid, budget: 400 });
    await anna('POST', `/api/lists/${H}/people`, { recipientId: kari });
    r = await anna('GET', '/api/lists');
    assert.deepEqual(r.data.active.map((l) => l.id).sort(), [L, G].sort()); assert.deepEqual(r.data.history.map((l) => l.id), [H]);
    r = await anna('GET', `/api/lists/${G}`); assert.equal(r.data.list.state, 'grace'); assert.equal(r.data.list.graceLeft, 4);
    step('listen vises i 7 dager etter fristen, så går den til historikk');
    r = await anna('POST', `/api/lists/${H}/copy`, { name: 'Juleliste 2027', deadline: iso(400) });
    r = await anna('GET', `/api/lists/${r.data.id}`); assert.equal(r.data.entries.length, 2);
    assert.equal(r.data.entries.find((e) => e.id === rid).budget, 400); assert.equal(r.data.entries.every((e) => !e.ideas.length), true);
    step('ny liste fra historikk (samme personer og budsjett)');
    r = await bjorn('GET', `/api/lists/${L}`); assert.equal(r.status, 404);
    r = await bjorn('PUT', `/api/ideas/${sk}`, { status: 'given' }); assert.equal(r.status, 404);
    r = await bjorn('POST', `/api/recipients/${kari}/ideas`, { title: 'x', listId: L }); assert.equal(r.status, 404);
    step('listene er private');
    await anna('DELETE', `/api/lists/${L}/people/${kari}`, {});
    r = await anna('GET', `/api/lists/${L}`); assert.equal(r.data.entries.length, 2); step('fjerne person fra liste');
    await anna('DELETE', `/api/wishes/${bw}/claim`, {});

    // Bryllupsliste
    r = await anna('POST', '/api/registries', { title: 'Anna og Carl', kind: 'bryllup', eventDate: iso(60), message: 'Velkommen!', partnerEmail: 'carl@test.no' });
    const RG = r.data.id; assert.ok(!r.data.warning);
    r = await carl('GET', `/api/registries/${RG}`); assert.equal(r.data.registry.couple.length, 2); step('ønskeliste med medeier');
    r = await bjorn('GET', '/api/notifications'); assert.ok(r.data.notifications.some((n) => n.message.includes('har laget en ønskeliste: «Anna og Carl»')));
    r = await bjorn('GET', '/api/registries'); assert.equal(r.data.friendsLists.length, 1); assert.equal(r.data.friendsLists[0].kind, 'bryllup');
    r = await bjorn('GET', `/api/friends/${annaUser.id}/wishes`); assert.equal(r.data.eventLists.length, 1);
    r = await bjorn('GET', '/api/dashboard'); assert.equal(r.data.friendsLists.length, 1);
    step('vennene får beskjed og ser ønskelisten i appen');
    const skjult = (await anna('POST', '/api/registries', { title: 'Sølvbryllup', kind: 'bryllupsdag', eventDate: iso(90), visibleFriends: false })).data.id;
    r = await bjorn('GET', '/api/registries'); assert.equal(r.data.friendsLists.length, 1, 'skjult liste vises ikke for venner');
    await anna('PUT', `/api/registries/${skjult}`, { title: 'Sølvbryllup', kind: 'bryllupsdag', eventDate: iso(90), visibleFriends: true });
    r = await bjorn('GET', '/api/registries'); assert.equal(r.data.friendsLists.length, 2);
    assert.ok(r.data.friendsLists.some((g) => g.kind === 'bryllupsdag'));
    r = await anna('GET', '/api/registries'); assert.equal(r.data.registries.find((g) => g.id === skjult).kind, 'bryllupsdag');
    await anna('DELETE', `/api/registries/${skjult}`, {});
    step('anledninger (bryllupsdag) og valg om synlighet for venner');
    const tallerken = (await carl('POST', `/api/registries/${RG}/items`, { title: 'Tallerken', price: '200 kr', qty: 12 })).data.id;
    const sofa = (await anna('POST', `/api/registries/${RG}/items`, { title: 'Sofa', price: '12 000 kr', spleis: true })).data.id;
    r = await anna('POST', `/api/registries/${RG}/items`, { title: 'Reise', spleis: true }); assert.equal(r.status, 400);
    const rtok = (await anna("GET", `/api/registries/${RG}`)).data.registry.shareUrl.split("/").pop();
    const guest = client(base);
    r = await guest('GET', `/api/r/${rtok}`); assert.equal(r.status, 200); assert.equal(r.data.items.find((i) => i.id === tallerken).remaining, 12);
    step('gjester ser listen uten konto');
    r = await guest('POST', `/api/r/${rtok}/claim`, { itemId: tallerken, qty: 4 }); assert.equal(r.status, 400);
    r = await guest('POST', `/api/r/${rtok}/claim`, { itemId: tallerken, qty: 4, name: 'Tante Olga', email: 'olga@test.no' });
    assert.equal(r.status, 201); const olgaCancel = r.data.cancelToken;
    r = await bjorn('POST', `/api/r/${rtok}/claim`, { itemId: tallerken, qty: 9 }); assert.equal(r.status, 409);
    r = await bjorn('POST', `/api/r/${rtok}/claim`, { itemId: tallerken, qty: 8 }); assert.equal(r.status, 201);
    r = await guest('POST', `/api/r/${rtok}/claim`, { itemId: tallerken, qty: 1, name: 'Sen gjest' }); assert.equal(r.status, 409);
    step('antall: flere gjester deler på samme gave');
    r = await guest('POST', `/api/r/${rtok}/claim`, { itemId: sofa, amount: 20, name: 'Per' }); assert.equal(r.status, 400);
    await guest('POST', `/api/r/${rtok}/claim`, { itemId: sofa, amount: 5000, name: 'Per' });
    r = await bjorn('POST', `/api/r/${rtok}/claim`, { itemId: sofa, amount: 9000 }); assert.equal(r.data.amount, 7000);
    r = await guest('GET', `/api/r/${rtok}`); const sf = r.data.items.find((i) => i.id === sofa);
    assert.equal(sf.raised, 12000); assert.equal(sf.full, true); step('spleis: bidrag begrenses til det som gjenstår');
    r = await anna('POST', `/api/r/${rtok}/claim`, { itemId: tallerken }); assert.equal(r.status, 403);
    r = await anna('GET', `/api/r/${rtok}`); assert.equal(r.data.isCouple, true); assert.equal(r.data.items[0].remaining, undefined);
    r = await anna('GET', `/api/registries/${RG}`); assert.equal(r.data.registry.revealed, false); assert.equal(r.data.items[0].givers, undefined);
    step('brudeparet ser ikke reservasjoner før bryllupet');
    r = await guest('GET', `/api/r/${rtok}/claim/${olgaCancel}`); assert.equal(r.data.title, 'Tallerken');
    r = await guest("DELETE", `/api/r/${rtok}/claim/${olgaCancel}`, {}); assert.equal(r.status, 200);
    r = await guest('GET', `/api/r/${rtok}`); assert.equal(r.data.items.find((i) => i.id === tallerken).remaining, 4);
    r = await guest("DELETE", `/api/r/${rtok}/claim/${olgaCancel}`, {}); assert.equal(r.status, 404); step('gjest kan angre med lenke');
    r = await bjorn('GET', '/api/claims'); assert.equal(r.data.wedding.length, 2); step('bryllupsgaver under «Reservert av meg»');
    // Etter bryllupet: hvem ga hva
    await anna('PUT', `/api/registries/${RG}`, { title: 'Anna og Carl', eventDate: iso(-1) });
    r = await anna('GET', `/api/registries/${RG}`); assert.equal(r.data.registry.revealed, true);
    assert.deepEqual(r.data.items.find((i) => i.id === sofa).givers.map((x) => x.name), ['Per', 'Bjørn']); step('etter bryllupet: hvem ga hva');
    r = await bjorn('GET', `/api/registries/${RG}`); assert.equal(r.status, 404);
    r = await bjorn('DELETE', `/api/registry-items/${sofa}`, {}); assert.equal(r.status, 404); step('bare brudeparet kan endre listen');
    r = await client(base)('GET', '/api/r/feil-token'); assert.equal(r.status, 404);

    // Eier markerer mottatt / fjerner → reserverende får beskjed
    await anna('PUT', `/api/wishes/${w1}`, { status: 'received' });
    await anna('PUT', `/api/wishes/${w2}`, { status: 'removed' });
    r = await bjorn('GET', `/api/friends/${annaUser.id}/wishes`); assert.equal(r.data.wishes.length, 1);
    r = await bjorn('GET', '/api/notifications'); assert.ok(r.data.notifications.some((n) => n.message.includes('mottatt')));
    r = await bjorn('GET', '/api/claims'); assert.equal(r.data.claims[0].status, 'received'); step('mottatt/fjernet håndteres');

    // Bursdagsvarsel (Anna har bursdag om 7 dager)
    runBirthdayReminders(); runBirthdayReminders();
    r = await bjorn('GET', '/api/notifications');
    const bd = r.data.notifications.filter((n) => n.kind === 'birthday');
    assert.equal(bd.length, 1); assert.match(bd[0].message, /Anna Berg fyller 30 år om 7 dager/); step('bursdagsvarsel opprettes én gang');
    r = await anna('GET', '/api/notifications');
    const pb = r.data.notifications.filter((n) => n.kind === 'birthday').map((n) => n.message);
    assert.ok(pb.some((m) => /Bestemor Ruth fyller \d+ år om 7 dager/.test(m)));
    assert.ok(pb.some((m) => /Kollega Per har bursdag om 7 dager/.test(m))); step('varsel for personer i gaveplanleggeren');
    r = await bjorn('GET', '/api/dashboard'); assert.equal(r.data.upcoming[0].name, 'Anna Berg'); step('kommende bursdager på oversikten');

    // Fjerne venn
    await anna('DELETE', `/api/friends/${bjornUser.id}`, {});
    r = await bjorn('GET', `/api/friends/${annaUser.id}/wishes`); assert.equal(r.status, 403); step('fjernet venn mister tilgang');

    // CSRF
    r = await fetch(base + '/api/wishes', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
    assert.equal(r.status, 415); step('skjemapost fra andre sider blokkeres');

    // Kontakt oss og tilbakemeldinger
    const gjest = client(base);
    r = await gjest('POST', '/api/feedback', { kind: 'feil', message: 'Hei' }); assert.equal(r.status, 400);
    r = await gjest('POST', '/api/feedback', { kind: 'feil', message: 'Knappen virker ikke på mobil', email: 'ola@test.no', page: '#/venner' }); assert.equal(r.status, 201);
    r = await gjest('POST', '/api/feedback', { kind: 'kontakt', message: 'Kjøp billig medisin her', website: 'spam.example' }); assert.equal(r.status, 201);
    r = await anna('POST', '/api/feedback', { kind: 'forbedring', message: 'Kan dere legge til mørk modus?' }); assert.equal(r.status, 201);
    r = await carl('GET', '/api/me'); assert.equal(r.data.user.isAdmin, true); assert.equal(r.data.newFeedback, 2);
    r = await carl('GET', '/api/admin/feedback'); assert.equal(r.data.feedback.length, 2, 'honningkrukke stopper roboter');
    assert.equal(r.data.feedback.find((f) => f.kind === 'forbedring').email, 'anna@test.no');
    assert.equal(r.data.feedback.find((f) => f.kind === 'feil').page, '#/venner');
    r = await carl('GET', '/api/notifications'); assert.ok(r.data.notifications.some((n) => n.message.includes('Knappen virker ikke')));
    const fid = (await carl('GET', '/api/admin/feedback')).data.feedback[0].id;
    await carl('PUT', `/api/admin/feedback/${fid}`, { status: 'behandlet' });
    r = await carl('GET', '/api/admin/feedback?status=ny'); assert.equal(r.data.feedback.length, 1);
    r = await anna('GET', '/api/admin/feedback'); assert.equal(r.status, 403);
    step('tilbakemeldinger og kontakt oss, med adminliste');
    r = await anna('GET', '/api/admin/backup'); assert.equal(r.status, 403);
    r = await carl('GET', '/api/admin/backup'); assert.equal(r.status, 200); assert.ok(String(r.data).startsWith('SQLite format 3'));
    step('sikkerhetskopi kun for admin');

    // Glemt passord
    const glemt = client(base);
    r = await glemt('POST', '/api/password/forgot', { email: 'finnes.ikke@test.no' }); assert.equal(r.status, 200);
    r = await glemt('POST', '/api/password/forgot', { email: 'bjorn@test.no' }); assert.equal(r.status, 200); step('glemt passord avslører ikke om e-posten finnes');
    r = await anna('POST', '/api/admin/reset-link', { email: 'bjorn@test.no' }); assert.equal(r.status, 403);
    r = await carl('POST', '/api/admin/reset-link', { email: 'bjorn@test.no' }); assert.equal(r.status, 200);
    const rtok2 = r.data.link.split('/').pop();
    const gammel = client(base); await gammel('POST', '/api/login', { email: 'bjorn@test.no', password: 'hemmelig123' });
    r = await glemt('GET', `/api/password/reset/${rtok2}`); assert.equal(r.data.name, 'Bjørn');
    r = await glemt('POST', '/api/password/reset', { token: rtok2, password: 'kort' }); assert.equal(r.status, 400);
    r = await glemt('POST', '/api/password/reset', { token: rtok2, password: 'nyttpassord1' }); assert.equal(r.status, 200);
    r = await glemt('GET', '/api/me'); assert.equal(r.data.user.email, 'bjorn@test.no');
    r = await gammel('GET', '/api/wishes'); assert.equal(r.status, 401, 'gamle innlogginger logges ut');
    r = await glemt('POST', '/api/password/reset', { token: rtok2, password: 'nyttpassord2' }); assert.equal(r.status, 410);
    r = await client(base)('POST', '/api/login', { email: 'bjorn@test.no', password: 'nyttpassord1' }); assert.equal(r.status, 200);
    step('nytt passord med engangslenke, gamle innlogginger avsluttes');
    r = await fetch(base + '/healthz'); assert.equal(await r.text(), 'ok');
    r = await gjest('GET', '/api/config'); assert.equal(r.data.site.name, 'Gaveplanlegger'); assert.equal(r.data.site.beta.enabled, true); step('helsesjekk, nettstedsinfo og beta-merking');

    // Admin-statistikk
    r = await anna('GET', '/api/admin/stats'); assert.equal(r.status, 403); step('statistikk kun for admin');

    // Venn uten bursdag
    const dinaTok = (await dina('GET', '/api/me')).data.user.shareUrl.split('/').pop();
    await anna('POST', `/api/invite/${dinaTok}`, {});
    r = await anna('GET', '/api/friends'); const fd = r.data.friends.find((f) => f.name === 'Dina');
    assert.equal(fd.birthday, null); assert.equal(fd.daysUntil, null); assert.equal(r.data.friends[r.data.friends.length - 1].name, 'Dina');
    r = await anna('GET', '/api/dashboard'); assert.ok(!r.data.upcoming.some((f) => f.name === 'Dina'));
    r = await anna('GET', `/api/friends/${fd.id}/wishes`); assert.equal(r.status, 200);
    runBirthdayReminders();
    await dina('PUT', '/api/me', { name: 'Dina', birthdate: '1990-05-05', gender: 'kvinne' });
    r = await dina('GET', '/api/me'); assert.equal(r.data.user.birthdate, '1990-05-05');
    await dina('PUT', '/api/me', { name: 'Dina', birthdate: '', gender: '' });
    r = await dina('GET', '/api/me'); assert.equal(r.data.user.birthdate, null); assert.equal(r.data.user.gender, null);
    step('venner uten bursdag håndteres, og opplysningene kan fjernes igjen');

    // Profil: postnummer, brukernavn, mobil
    r = await dina('PUT', '/api/me', { name: 'Dina Dahl', postnr: '12', username: 'dina' }); assert.equal(r.status, 400);
    r = await dina('PUT', '/api/me', { name: 'Dina Dahl', postnr: '0150', username: 'dina', phone: '+47 912 34 567', searchable: true });
    assert.equal(r.status, 200); assert.equal(r.data.user.postnr, '0150'); assert.equal(r.data.user.username, 'dina');
    r = await carl('PUT', '/api/me', { name: 'Carl', username: 'DINA' }); assert.equal(r.status, 409, 'brukernavn er unikt uansett store/små bokstaver');
    step('postnummer, brukernavn og mobil i profilen');

    // Finn venner
    r = await carl('GET', '/api/users/search?q=di'); assert.equal(r.status, 400);
    r = await carl('GET', '/api/users/search?q=dahl'); assert.equal(r.data.results.length, 1); assert.equal(r.data.results[0].name, 'Dina Dahl');
    assert.equal(r.data.results[0].email, undefined, 'navnesøk viser ikke e-post');
    const dinaId = r.data.results[0].id;
    r = await carl('GET', '/api/users/search?q=@dina'); assert.equal(r.data.results[0].id, dinaId);
    r = await carl('GET', '/api/users/search?q=91234567'); assert.equal(r.data.kind, 'phone'); assert.equal(r.data.results[0].id, dinaId);
    r = await carl('GET', '/api/users/search?q=0047%20912%2034%20567'); assert.equal(r.data.results[0].id, dinaId);
    r = await carl('GET', `/api/users/search?q=${encodeURIComponent('dina@test.no')}`); assert.equal(r.data.results.length, 1);
    r = await carl('GET', '/api/users/search?q=99999999'); assert.equal(r.data.results.length, 0);
    await dina('PUT', '/api/me', { name: 'Dina Dahl', postnr: '0150', username: 'dina', phone: '91234567', searchable: false });
    r = await carl('GET', '/api/users/search?q=dahl'); assert.equal(r.data.results.length, 0, 'skjult i navnesøk');
    r = await carl('GET', '/api/users/search?q=dina'); assert.equal(r.data.results.length, 1, 'eksakt brukernavn finnes fortsatt');
    r = await carl('POST', '/api/friends', { userId: dinaId }); assert.ok(['requested', 'friends', 'already'].includes(r.data.status));
    r = await carl('GET', '/api/users/search?q=91234567'); assert.ok(['requested', 'friends'].includes(r.data.results[0].status));
    step('finn venner på navn, brukernavn, e-post og mobil – og legg dem til');

    // Kallenavn på venner (bare synlig for den som satte det)
    r = await anna('PUT', `/api/friends/${dinaId}/nickname`, { nickname: 'Søssa' }); assert.equal(r.status, 200);
    r = await anna('GET', '/api/friends'); let fdn = r.data.friends.find((f) => f.id === dinaId);
    assert.equal(fdn.displayName, 'Søssa'); assert.equal(fdn.name, 'Dina Dahl');
    r = await anna('GET', `/api/friends/${dinaId}/wishes`); assert.equal(r.data.friend.displayName, 'Søssa');
    r = await anna('PUT', '/api/friends/999999/nickname', { nickname: 'x' }); assert.equal(r.status, 404);
    await anna('PUT', `/api/friends/${dinaId}/nickname`, { nickname: '' });
    r = await anna('GET', '/api/friends'); assert.equal(r.data.friends.find((f) => f.id === dinaId).displayName, 'Dina Dahl');
    step('kallenavn på venner');

    console.log(`\nAlle ${ok} tester bestått ✅`);
  } catch (e) { console.error('\n❌', e); process.exitCode = 1; }
  server.close();
});
