'use strict';
// ---------- Grunnleggende ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const app = $('#app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des'];
const PRIO = { 1: 'Ønsker meg aller mest', 2: 'Vanlig', 3: 'Kjekt å ha' };
let me = null;
let pendingInvite = sessionStorage.getItem('invite') || null;

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !opts.allow401) { me = null; showTopbar(false); location.hash = '#/logg-inn'; throw new Error(data.error || 'Ikke innlogget'); }
  if (!res.ok) throw new Error(data.error || 'Noe gikk galt.');
  return data;
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2800);
}
function formError(form, msg) {
  let box = $('.error', form);
  if (!box) { box = document.createElement('div'); box.className = 'error'; form.prepend(box); }
  box.textContent = msg; box.hidden = !msg;
}
const formData = (form) => Object.fromEntries(new FormData(form).entries());
function whenText(days) {
  if (days === 0) return 'i dag 🎉';
  if (days === 1) return 'i morgen';
  if (days < 7) return `om ${days} dager`;
  if (days < 14) return 'om en ukes tid';
  return `om ${days} dager`;
}
function dateBadge(mmdd) {
  const [m, d] = mmdd.split('-').map(Number);
  return `<div class="bday-date"><b>${d}</b><span>${MONTHS[m - 1]}</span></div>`;
}
function initials(name) { return name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase(); }

// ---------- Annonser (Google AdSense) ----------
let ads = { enabled: false, showPlaceholders: false, slots: {} };
let site = { name: 'Gaveplanlegger' };
const adsReady = fetch('/api/config').then((r) => r.json()).then((c) => {
  ads = c.ads || ads; site = c.site || site;
  if (site.beta?.enabled) showBeta();
  if (ads.enabled) {
    const sc = document.createElement('script');
    sc.async = true; sc.crossOrigin = 'anonymous';
    sc.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(ads.client)}`;
    document.head.appendChild(sc);
  }
}).catch(() => {});
// Returnerer HTML for en annonseplass. Tom streng når annonser er av og plassholdere er skrudd av.
function adSlot(name) {
  const slot = ads.slots?.[name];
  if (ads.enabled && slot) {
    return `<div class="ad-wrap"><span class="ad-label">Annonse</span><ins class="adsbygoogle" style="display:block"
      data-ad-client="${esc(ads.client)}" data-ad-slot="${esc(slot)}" data-ad-format="auto" data-full-width-responsive="true"></ins></div>`;
  }
  if (ads.showPlaceholders) return `<div class="ad-wrap placeholder"><span class="ad-label">Annonse</span><div>Annonseplass «${esc(name)}» – vises når AdSense er koblet til</div></div>`;
  return '';
}
function activateAds() {
  if (!ads.enabled) return;
  $$('ins.adsbygoogle:not([data-adsbygoogle-status])').forEach(() => { try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch {} });
}

// ---------- Testversjon (beta) ----------
// «Beta» ved logoen på alle sider, og en stripe øverst som kan lukkes (husket mens fanen er åpen)
function showBeta() {
  document.body.classList.add('is-beta');
  let closed = false; try { closed = sessionStorage.getItem('beta-closed') === '1'; } catch {}
  if (closed || $('#beta-bar')) return;
  $('#app').insertAdjacentHTML('beforebegin', `<div id="beta-bar" class="beta-bar" role="note">
    <span><b>Testversjon</b> · ${esc(site.beta.message)}</span>
    <span class="row" style="gap:.3rem;flex-wrap:nowrap"><button class="btn small" id="beta-fb">Gi tilbakemelding</button>
    <button class="icon-btn" id="beta-close" aria-label="Lukk">✕</button></span></div>`);
  $('#beta-fb').onclick = () => $('#fb-btn')?.click();
  $('#beta-close').onclick = () => { $('#beta-bar').remove(); try { sessionStorage.setItem('beta-closed', '1'); } catch {} };
}

// ---------- Toppmeny og varsler ----------
function showTopbar(on) { $('#topbar').hidden = !on; }
async function refreshMe() {
  const d = await api('/api/me', { allow401: true }).catch(() => null);
  me = d?.user || null;
  if (me) {
    showTopbar(true);
    $('#avatar').textContent = initials(me.name);
    $('#bell-dot').hidden = !d.unread;
    $('#req-count').hidden = !d.requests; $('#req-count').textContent = d.requests;
    $('#admin-link').hidden = !me.isAdmin;
    $('#fb-count').hidden = !d.newFeedback; $('#fb-count').textContent = d.newFeedback;
  } else showTopbar(false);
  return me;
}
$('#bell').addEventListener('click', async (e) => {
  e.stopPropagation();
  const panel = $('#notif-panel');
  if (!panel.hidden) { panel.hidden = true; return; }
  const { notifications } = await api('/api/notifications');
  panel.innerHTML = notifications.length
    ? `<div class="row spread" style="padding:.3rem .6rem"><b>Varsler</b></div>` + notifications.map((n) => `
        <a class="notif ${n.read ? '' : 'unread'}" href="${esc(n.link || '#/')}">${n.kind === 'birthday' ? '🎂 ' : n.kind === 'friend' ? '👋 ' : '🎁 '}${esc(n.message)}
        <time>${esc(new Date(n.created_at + 'Z').toLocaleString('nb-NO', { dateStyle: 'medium', timeStyle: 'short' }))}</time></a>`).join('')
    : '<p class="muted center pad">Ingen varsler ennå.</p>';
  panel.hidden = false;
  await api('/api/notifications/read', { method: 'POST', body: {} });
  $('#bell-dot').hidden = true;
});
document.addEventListener('click', (e) => { if (!e.target.closest('#notif-panel')) $('#notif-panel').hidden = true; });

// ---------- Ruting ----------
let routeQuery = new URLSearchParams();
const views = {};
async function router() {
  const hash = location.hash || '#/';
  const [path, query = ''] = hash.split('?');
  const [, page = '', arg] = path.split('/');
  routeQuery = new URLSearchParams(query);
  $('#notif-panel').hidden = true;
  if (page === 'invitasjon' && arg) { pendingInvite = arg; sessionStorage.setItem('invite', arg); }
  await adsReady;
  if (!me) await refreshMe();
  if (!me && !['logg-inn', 'registrer', 'invitasjon', 'bryllupsliste', 'onskeliste', 'kontakt', 'personvern', 'glemt-passord', 'nytt-passord'].includes(page)) { location.hash = '#/logg-inn'; return; }
  if (me && pendingInvite) return acceptInvite();
  if (me && ['logg-inn', 'registrer'].includes(page)) {
    const next = sessionStorage.getItem('after-login'); sessionStorage.removeItem('after-login');
    location.hash = next || '#/'; return;
  }
  $$('#mainnav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === ({ liste: 'gaveplanlegger', venn: 'venner', bryllupsliste: 'onskelister', onskeliste: 'onskelister', bryllup: 'onskelister' }[page] || page || 'oversikt')));
  const view = { '': views.overview, 'logg-inn': views.login, registrer: views.register, invitasjon: views.inviteLanding,
    'mine-onsker': views.myWishes, venner: views.friends, venn: views.friend, reservasjoner: views.claims, profil: views.profile, gaveplanlegger: views.planner, liste: views.list, onskelister: views.weddings, onskeliste: views.weddingPublic, bryllup: views.weddings, bryllupsliste: views.weddingPublic,
    kontakt: views.contact, personvern: views.privacy, admin: views.admin, 'glemt-passord': views.forgot, 'nytt-passord': views.resetPassword,
    juleliste: () => { location.hash = '#/gaveplanlegger'; } }[page];
  window.scrollTo(0, 0);
  try { await (view || views.overview)(arg); activateAds(); } catch (e) { if (me) app.innerHTML = `<div class="error">${esc(e.message)}</div>`; }
}
window.addEventListener('hashchange', router);

async function acceptInvite() {
  const tok = pendingInvite; pendingInvite = null; sessionStorage.removeItem('invite');
  try {
    const { ownerId } = await api(`/api/invite/${encodeURIComponent(tok)}`, { method: 'POST', body: {} });
    if (ownerId === me.id) { toast('Dette er din egen delingslenke.'); location.hash = '#/mine-onsker'; }
    else { toast('Dere er nå venner! 🎉'); location.hash = `#/venn/${ownerId}`; }
  } catch (e) { toast(e.message); location.hash = '#/'; }
}

// ---------- Innlogging og registrering ----------
function authLayout(inner, inviteOwner) {
  app.innerHTML = `
  <div class="auth-wrap">
    <section class="auth-hero">
      <h1>🎁 Gaveplanlegger</h1>
      <p style="font-size:1.15rem">Ønskelisten som holder på hemmeligheten.</p>
      <ul>
        <li>Skriv ønskene dine – med lenke til gaven</li>
        <li>Del listen med venner på e-post eller SMS</li>
        <li>Venner reserverer gaver uten at du ser hvem eller hva</li>
        <li>Få varsel før vennene dine har bursdag</li>
      </ul>
    </section>
    <section class="card auth-card">
      ${inviteOwner ? `<div class="invite-banner">🎉 <b>${esc(inviteOwner)}</b> har delt ønskelisten sin med deg. Logg inn eller lag en konto for å se den.</div>` : ''}
      ${inner}
    </section>
  </div>`;
}
async function inviteOwnerName() {
  if (!pendingInvite) return null;
  try { return (await api(`/api/invite/${encodeURIComponent(pendingInvite)}`, { allow401: true })).owner.name; }
  catch { pendingInvite = null; sessionStorage.removeItem('invite'); return null; }
}
// ---------- Glemt passord ----------
views.forgot = async () => {
  if (me) { location.hash = '#/profil'; return; }
  authLayout(`
    <h2>Glemt passord</h2>
    <p class="muted small" style="margin-top:0">Skriv e-postadressen du registrerte deg med, så sender vi en lenke for å lage nytt passord.</p>
    <form id="f" novalidate>
      <div class="field"><label for="email">E-post</label><input id="email" name="email" type="email" autocomplete="email" required></div>
      <button class="btn block">Send lenke</button>
    </form>
    <div id="forgot-done"></div>
    <p class="center small" style="margin-top:1rem"><a href="#/logg-inn">Tilbake til innlogging</a></p>`);
  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault(); formError(e.target, '');
    try {
      const r = await api('/api/password/forgot', { method: 'POST', body: formData(e.target), allow401: true });
      e.target.hidden = true;
      $('#forgot-done').innerHTML = r.emailEnabled
        ? `<div class="invite-banner">📬 Hvis det finnes en konto med <b>${esc(e.target.elements.email.value)}</b>, har vi sendt en lenke dit. Den virker i 2 timer. Sjekk også søppelpost.</div>`
        : `<div class="invite-banner">Vi kan ikke sende e-post akkurat nå. Ta kontakt via <a href="#/kontakt">Kontakt oss</a>, så hjelper vi deg inn igjen.</div>`;
    } catch (err) { formError(e.target, err.message); }
  });
};
views.resetPassword = async (tok) => {
  let info;
  try { info = await api(`/api/password/reset/${encodeURIComponent(tok || '')}`, { allow401: true }); }
  catch (e) {
    authLayout(`<h2>Lenken virker ikke</h2><p>${esc(e.message)}</p><a class="btn block" href="#/glemt-passord">Be om ny lenke</a>`);
    return;
  }
  authLayout(`
    <h2>Nytt passord</h2>
    <p class="muted small" style="margin-top:0">Hei ${esc(info.name)}! Velg et nytt passord. Du blir logget ut alle andre steder.</p>
    <form id="f" novalidate>
      <div class="field"><label for="pw1">Nytt passord <span class="hint">– minst 8 tegn</span></label><input id="pw1" name="password" type="password" autocomplete="new-password" minlength="8"></div>
      <div class="field"><label for="pw2">Gjenta passordet</label><input id="pw2" type="password" autocomplete="new-password"></div>
      <button class="btn block">Lagre og logg inn</button>
    </form>`);
  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault(); formError(e.target, '');
    if ($('#pw1').value !== $('#pw2').value) return formError(e.target, 'Passordene er ikke like.');
    try {
      await api('/api/password/reset', { method: 'POST', body: { token: tok, password: $('#pw1').value }, allow401: true });
      await refreshMe(); toast('Passordet er endret. Velkommen tilbake!'); location.hash = '#/';
    } catch (err) { formError(e.target, err.message); }
  });
};

views.inviteLanding = async () => { location.hash = '#/registrer'; };

views.login = async () => {
  authLayout(`
    <h2>Logg inn</h2>
    <form id="f" novalidate>
      <div class="field"><label for="email">E-post</label><input id="email" name="email" type="email" autocomplete="email" required></div>
      <div class="field"><label for="password">Passord</label><input id="password" name="password" type="password" autocomplete="current-password" required></div>
      <button class="btn block">Logg inn</button>
    </form>
    <p class="center small" style="margin-top:1rem"><a href="#/glemt-passord">Glemt passord?</a> · Ny her? <a href="#/registrer">Lag en konto</a></p>`, await inviteOwnerName());
  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/api/login', { method: 'POST', body: formData(e.target), allow401: true }); await refreshMe(); router(); }
    catch (err) { formError(e.target, err.message); }
  });
};

views.register = async () => {
  const maxDate = new Date().toISOString().slice(0, 10);
  authLayout(`
    <h2>Lag konto</h2>
    <form id="f" novalidate>
      <div class="field"><label for="name">Navn</label><input id="name" name="name" autocomplete="name" required></div>
      <div class="field"><label for="email">E-post</label><input id="email" name="email" type="email" autocomplete="email" required></div>
      <div class="field"><label for="birthdate">Fødselsdato <span class="hint">(valgfritt – da får vennene dine varsel før bursdagen din)</span></label>
        <input id="birthdate" name="birthdate" type="date" max="${maxDate}"></div>
      <div class="field"><label>Kjønn <span class="hint">(valgfritt)</span></label>
        <div class="segmented">
          ${[['kvinne', 'Kvinne'], ['mann', 'Mann'], ['annet', 'Annet'], ['ikke_oppgitt', 'Vil ikke oppgi']].map(([v, l]) =>
            `<label><input type="radio" name="gender" value="${v}"><span>${l}</span></label>`).join('')}
        </div></div>
      <div class="field"><label for="phone">Mobilnummer <span class="hint">(valgfritt – venner kan finne deg på nummeret)</span></label><input id="phone" name="phone" type="tel" autocomplete="tel"></div>
      <div class="field"><label for="postnr">Postnummer <span class="hint">(valgfritt – for å finne gaver i butikker nær deg)</span></label><input id="postnr" name="postnr" inputmode="numeric" pattern="\\d{4}" maxlength="4" autocomplete="postal-code" style="max-width:8rem"></div>
      <div class="field"><label for="password">Passord <span class="hint">– minst 8 tegn</span></label><input id="password" name="password" type="password" autocomplete="new-password" minlength="8" required></div>
      <div class="field"><label class="check"><input type="checkbox" name="confirmAge" value="1"><span>Jeg er 13 år eller eldre.</span></label></div>
      <div class="field"><label class="check"><input type="checkbox" name="acceptTerms" value="1">
        <span>Jeg godtar at Gaveplanlegger lagrer opplysningene jeg gir for å drive tjenesten, og at venner ser navnet mitt og bursdagen min hvis jeg legger den inn. Les <a href="#/personvern" target="_blank">personvernerklæringen</a>.</span></label></div>
      <button class="btn block">Lag konto</button>
    </form>
    <p class="center small" style="margin-top:1rem">Har du konto? <a href="#/logg-inn">Logg inn</a></p>`, await inviteOwnerName());
  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = formData(e.target); body.acceptTerms = !!body.acceptTerms; body.confirmAge = !!body.confirmAge;
    try { await api('/api/register', { method: 'POST', body, allow401: true }); await refreshMe(); toast('Velkommen! 🎁'); router(); }
    catch (err) { formError(e.target, err.message); }
  });
};

// ---------- Oversikt ----------
views.overview = async () => {
  const d = await api('/api/dashboard');
  const soonest = d.upcoming.find((f) => f.daysUntil <= 7);
  const mb = d.myBirthday;
  app.innerHTML = `
    <div class="hello"><h1>Hei, ${esc(me.name.split(' ')[0])}!</h1>
      <p class="muted">${!mb ? 'Legg gjerne inn bursdagen din under <a href="#/profil">Min profil</a>, så får vennene dine beskjed før den.'
        : mb.daysUntil === 0 ? `Gratulerer med ${mb.turning}-årsdagen! 🎂` : `Det er ${mb.daysUntil} dager til du fyller ${mb.turning}.`}
      ${mb && mb.daysUntil <= 45 && d.activeWishes < 3 ? ' Kanskje på tide å fylle på ønskelisten?' : ''}</p></div>
    ${soonest ? `<div class="alert-soon"><div><b>🎂 ${esc(soonest.name)} ${turningText(soonest)}</b><br>
      <span style="opacity:.85">${soonest.planner ? (soonest.ideas ? `Du har ${soonest.ideas} ${soonest.ideas > 1 ? 'gaveideer' : 'gaveidé'} klar – har du bestemt deg?` : 'Du har ingen gaveideer ennå. På tide å finne noe?')
        : 'Ta en titt på ønskelisten før noen andre tar det beste ønsket.'}</span></div>
      <a class="btn" href="${soonest.planner ? '#/gaveplanlegger' : `#/venn/${soonest.id}`}">${soonest.planner ? 'Se gaveideer' : 'Se ønskelisten'}</a></div>` : ''}
    <div class="grid grid-4" style="margin-bottom:1rem">
      <a class="card stat" href="#/mine-onsker" style="text-decoration:none;color:inherit"><b>${d.activeWishes}</b>ønsker på listen din</a>
      <a class="card stat" href="#/venner" style="text-decoration:none;color:inherit"><b>${d.friendCount}</b>venner</a>
      <a class="card stat" href="#/reservasjoner" style="text-decoration:none;color:inherit"><b>${d.myClaims}</b>gaver du har reservert</a>
      <a class="card stat" href="#/gaveplanlegger" style="text-decoration:none;color:inherit"><b>${d.recipientCount}</b>i planleggeren</a>
    </div>
    ${d.nextList ? `<a class="xmas-banner" href="#/liste/${d.nextList.id}">
      <span>${KIND[d.nextList.kind][0]} <b>${esc(d.nextList.name)}</b> · ${d.nextList.daysLeft === 0 ? 'fristen er i dag' : `${d.nextList.daysLeft} dager til fristen`} ·
      ${d.nextList.done}/${d.nextList.people} har fått gave</span>
      <span class="btn small">Åpne listen</span></a>`
      : (() => { const n = new Date(); return n.getMonth() >= 9 && n.getMonth() <= 11 && n.getDate() <= 24 ? `<a class="xmas-banner" href="#/gaveplanlegger?ny=jul">
        <span>🎄 <b>Snart jul!</b> Lag en juleliste og hold styr på alle julegavene.</span><span class="btn small">Lag juleliste</span></a>` : ''; })()}
    ${d.friendsLists?.length ? `<section style="margin-bottom:1rem"><h2>Ønskelister fra vennene dine</h2>
      <div class="list-cards">${d.friendsLists.map(friendListCard).join('')}</div></section>` : ''}
    <div class="grid grid-2">
      <section class="card">
        <h2>Bursdager de neste ${d.window} dagene</h2>
        ${d.upcoming.length ? `<ul class="bday-list">${d.upcoming.map(bdayRow).join('')}</ul>`
          : `<div class="empty"><div class="big">🎈</div>Ingen bursdager den neste måneden.<br><a href="#/venner">Legg til venner</a> eller <a href="#/gaveplanlegger">personer i planleggeren</a></div>`}
      </section>
      <div class="stack"><section class="card share-box">${shareBlock()}</section>${adSlot('oversikt')}</div>
    </div>`;
  bindShare();
};
function turningText(f) { return f.turning ? `fyller ${f.turning} ${whenText(f.daysUntil)}` : `har bursdag ${whenText(f.daysUntil)}`; }
function bdayRow(f) {
  const t = turningText(f);
  return `<li class="bday ${f.daysUntil <= 7 ? 'soon' : ''}">${dateBadge(f.birthday)}
    <div class="bday-main"><b>${esc(f.name)}</b>${f.planner ? ' <span class="badge">Planlegger</span>' : ''}
      <div class="muted small">${t[0].toUpperCase() + t.slice(1)}</div></div>
    ${f.planner ? `<a class="btn small secondary" href="#/gaveplanlegger">Gaveideer${f.ideas ? ` (${f.ideas})` : ''}</a>`
      : `<a class="btn small secondary" href="#/venn/${f.id}">Ønskeliste</a>`}</li>`;
}

// ---------- Deling ----------
function shareBlock() {
  const text = `Hei! Her er ønskelisten min på Gaveplanlegger – du kan reservere en gave uten at jeg ser hva du har valgt: ${me.shareUrl}`;
  return `
    <h2>Del ønskelisten din</h2>
    <p class="muted small">Alle som åpner lenken og logger inn, blir venn med deg og kan se listen din.</p>
    <div class="share-link"><input readonly value="${esc(me.shareUrl)}" id="share-url" aria-label="Delingslenke"><button class="btn small" id="copy-link">Kopier</button></div>
    <div class="row" style="margin-top:.8rem">
      <a class="btn secondary small" href="mailto:?subject=${encodeURIComponent('Ønskelisten min 🎁')}&body=${encodeURIComponent(text)}">✉️ E-post</a>
      <a class="btn secondary small" href="sms:?&body=${encodeURIComponent(text)}">💬 SMS</a>
      ${navigator.share ? '<button class="btn secondary small" id="native-share">📤 Del …</button>' : ''}
    </div>`;
}
function bindShare() {
  $('#copy-link')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(me.shareUrl); } catch { $('#share-url').select(); document.execCommand('copy'); }
    toast('Lenken er kopiert');
  });
  $('#native-share')?.addEventListener('click', () => navigator.share({ title: 'Ønskelisten min', text: 'Her er ønskelisten min 🎁', url: me.shareUrl }).catch(() => {}));
}

// ---------- Mine ønsker ----------
views.myWishes = async () => {
  const { wishes } = await api('/api/wishes');
  const active = wishes.filter((w) => w.status === 'active');
  const received = wishes.filter((w) => w.status === 'received');
  app.innerHTML = `
    <div class="row spread" style="margin-bottom:1rem"><h1 style="margin:0">Mine ønsker</h1>
      <button class="btn" id="add-btn">+ Nytt ønske</button></div>
    <p class="muted small">Du ser aldri om noen har reservert et ønske – det er overraskelsen sin det. 🤫</p>
    <div class="grid" style="grid-template-columns: minmax(0,2fr) minmax(260px,1fr); align-items:start" id="wish-grid">
      <div class="stack">
        <section class="card wish-list">${active.length ? active.map(ownWishRow).join('')
          : '<div class="empty"><div class="big">📝</div>Listen er tom. Legg til det første ønsket ditt!</div>'}</section>
        ${received.length ? `<h2 style="margin-top:1.5rem">Mottatt 🎉</h2><section class="card wish-list">${received.map(ownWishRow).join('')}</section>` : ''}
      </div>
      <aside class="card share-box">${shareBlock()}</aside>
    </div>
    ${wishDialog()}`;
  if (matchMedia('(max-width: 760px)').matches) $('#wish-grid').style.gridTemplateColumns = '1fr';
  bindShare();
  $('#add-btn').addEventListener('click', () => openWishDialog());
  $$('[data-act]').forEach((b) => b.addEventListener('click', () => ownWishAction(b.dataset.act, Number(b.dataset.id), wishes)));
};
function ownWishRow(w) {
  const host = w.url ? new URL(w.url).hostname.replace(/^www\./, '') : '';
  return `<div class="wish prio-${w.priority} ${w.status === 'received' ? 'received' : ''}">
    <div class="wish-icon">${w.status === 'received' ? '✅' : w.priority === 1 ? '★' : '🎁'}</div>
    <div class="wish-main">
      <div class="wish-title">${esc(w.title)}</div>
      <div class="wish-meta">${[w.price && esc(w.price), w.priority === 1 && '<span class="badge gold">Ønsker meg aller mest</span>',
        w.url && `<a href="${esc(w.url)}" target="_blank" rel="noopener noreferrer">${esc(host)} ↗</a>`].filter(Boolean).join(' · ')}</div>
      ${w.note ? `<div class="wish-meta">${esc(w.note)}</div>` : ''}
    </div>
    <div class="wish-actions">
      ${w.status === 'active' ? `
        <button class="btn ghost small" data-act="edit" data-id="${w.id}">Endre</button>
        <button class="btn ghost small" data-act="received" data-id="${w.id}">Fått den</button>
        <button class="btn ghost small" data-act="remove" data-id="${w.id}">Fjern</button>`
      : `<button class="btn ghost small" data-act="active" data-id="${w.id}">Angre</button>
         <button class="btn ghost small" data-act="remove" data-id="${w.id}">Fjern</button>`}
    </div></div>`;
}
async function ownWishAction(act, id, wishes) {
  if (act === 'edit') return openWishDialog(wishes.find((w) => w.id === id));
  if (act === 'remove' && !confirm('Fjerne ønsket fra listen?')) return;
  const status = { received: 'received', remove: 'removed', active: 'active' }[act];
  await api(`/api/wishes/${id}`, { method: 'PUT', body: { status } });
  toast(status === 'received' ? 'Markert som mottatt 🎉' : status === 'removed' ? 'Ønsket er fjernet' : 'Ønsket er tilbake på listen');
  views.myWishes();
}
function wishDialog() {
  return `<dialog id="wish-dlg"><form id="wish-form" novalidate>
    <h2 id="wish-dlg-title">Nytt ønske</h2>
    <input type="hidden" name="id">
    ${urlField('w-url')}
    <div class="field"><label for="w-title">Hva ønsker du deg?</label><input id="w-title" name="title" required maxlength="200" placeholder="F.eks. Ullsokker str. 40"></div>
    <div class="grid grid-2" style="gap:.8rem">
      <div class="field"><label for="w-price">Ca. pris <span class="hint">(valgfritt)</span></label><input id="w-price" name="price" placeholder="F.eks. 299 kr"></div>
      <div class="field"><label for="w-prio">Hvor mye ønsker du deg den?</label><select id="w-prio" name="priority">
        ${Object.entries(PRIO).map(([v, l]) => `<option value="${v}" ${v === '2' ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    </div>
    <div class="field"><label for="w-note">Kommentar <span class="hint">(farge, størrelse …)</span></label><textarea id="w-note" name="note" maxlength="1000"></textarea></div>
    <div class="row" style="justify-content:flex-end"><button type="button" class="btn secondary" id="wish-cancel">Avbryt</button><button class="btn">Lagre</button></div>
  </form></dialog>`;
}
// ---------- Hent navn og pris fra lenke ----------
function urlField(id) {
  return `<div class="field"><label for="${id}">Lenke til gaven <span class="hint">– lim inn, så henter vi navn og pris</span></label>
    <div class="row" style="flex-wrap:nowrap"><input id="${id}" name="url" type="url" placeholder="https://" autocomplete="off">
      <button type="button" class="btn secondary small" data-fetch-link title="Hent navn og pris fra lenken">Hent</button></div>
    <div class="link-status small" aria-live="polite"></div></div>`;
}
function bindLinkFetch(form) {
  const url = form.elements.url, btn = $('[data-fetch-link]', form), status = $('.link-status', form);
  status.textContent = ''; status.className = 'link-status small';
  let last = '';
  const run = async (overwrite) => {
    const v = url.value.trim();
    if (!/^https?:\/\/\S+\.\S+/.test(v) || (!overwrite && v === last)) return;
    last = v; btn.disabled = true;
    status.className = 'link-status small muted'; status.textContent = '⏳ Henter info fra butikken …';
    try {
      const d = await api('/api/link-preview', { method: 'POST', body: { url: v } });
      const filled = [];
      if (d.title && (overwrite || !form.elements.title.value.trim())) { form.elements.title.value = d.title; filled.push('navn'); }
      if (d.price && (overwrite || !form.elements.price.value.trim())) { form.elements.price.value = d.price; filled.push('pris'); }
      status.className = 'link-status small ok';
      status.innerHTML = filled.length ? `✓ Fylte inn ${filled.join(' og ')} fra ${esc(d.site)}${d.price ? '' : ' – fant ingen pris'}`
        : `✓ Fant «${esc(d.title || '')}»${d.price ? ` · ${esc(d.price)}` : ''}. Trykk «Hent» for å bruke det.`;
    } catch (e) {
      status.className = 'link-status small warn';
      status.textContent = `Fikk ikke hentet info (${e.message.replace(/\.$/, '')}). Fyll inn selv.`;
    } finally { btn.disabled = false; }
  };
  url.onchange = () => run(false);
  url.onpaste = () => setTimeout(() => run(false), 0);
  btn.onclick = () => run(true);
}

function openWishDialog(w) {
  const dlg = $('#wish-dlg'), f = $('#wish-form');
  f.reset(); formError(f, '');
  $('#wish-dlg-title').textContent = w ? 'Endre ønske' : 'Nytt ønske';
  if (w) for (const k of ['id', 'title', 'url', 'price', 'priority', 'note']) f.elements[k].value = w[k] ?? '';
  else f.elements.id.value = '';
  $('#wish-cancel').onclick = () => dlg.close();
  f.onsubmit = async (e) => {
    e.preventDefault();
    const body = formData(f); const id = body.id; delete body.id;
    try {
      await api(id ? `/api/wishes/${id}` : '/api/wishes', { method: id ? 'PUT' : 'POST', body });
      dlg.close(); toast(id ? 'Ønsket er oppdatert' : 'Ønsket er lagt til 🎁'); views.myWishes();
    } catch (err) { formError(f, err.message); }
  };
  bindLinkFetch(f);
  dlg.showModal(); (w ? $('#w-title') : $('#w-url')).focus();
}

// ---------- Venner ----------
views.friends = async () => {
  const d = await api('/api/friends');
  app.innerHTML = `
    <h1>Venner</h1>
    <div class="grid grid-2" style="align-items:start">
      <div class="stack">
        ${d.incoming.length ? `<section class="card"><h2>Venneforespørsler</h2>${d.incoming.map((r) => `
          <div class="row spread" style="padding:.5rem 0"><div><b>${esc(r.name)}</b>${r.username ? ` <span class="muted small">@${esc(r.username)}</span>` : ''}<div class="muted small">${esc(r.email)}</div></div>
          <div class="row"><button class="btn small green" data-accept="${r.id}">Godta</button><button class="btn small secondary" data-decline="${r.id}">Avslå</button></div></div>`).join('')}</section>` : ''}
        <section class="card">
          <h2>Mine venner (${d.friends.length})</h2>
          ${d.friends.length ? `<ul class="bday-list">${d.friends.map((f) => `
            <li class="bday ${f.daysUntil != null && f.daysUntil <= 7 ? 'soon' : ''}">${f.birthday ? dateBadge(f.birthday) : '<div class="bday-date"><span>Ingen<br>dato</span></div>'}
              <div class="bday-main"><b>${esc(f.displayName)}</b>${f.nickname ? ` <span class="muted small">(${esc(f.name)})</span>` : ''}${f.username ? ` <span class="muted small">@${esc(f.username)}</span>` : ''}
                <div class="muted small">${f.birthday ? turningText(f).replace(/^./, (c) => c.toUpperCase()) : 'Har ikke lagt inn bursdag'}</div></div>
              <a class="btn small secondary" href="#/venn/${f.id}">Ønskeliste</a>
              <button class="btn ghost small" data-nick="${f.id}" data-nickname="${esc(f.nickname)}" data-name="${esc(f.name)}" title="Gi kallenavn" aria-label="Gi ${esc(f.name)} et kallenavn">✏️</button>
              <button class="btn ghost small" data-remove="${f.id}" data-name="${esc(f.displayName)}" aria-label="Fjern ${esc(f.displayName)}">✕</button></li>`).join('')}</ul>
            <p class="muted small" style="margin:.6rem 0 0">✏️ gir vennen et kallenavn som bare du ser, f.eks. «Mamma» eller «Onkel Per».</p>`
          : '<div class="empty"><div class="big">👋</div>Du har ingen venner her ennå. Legg til noen, eller del lenken din!</div>'}
        </section>
      </div>
      <div class="stack">
        <section class="card">
          <h2>Finn venner</h2>
          <form id="add-friend" novalidate>
            <div class="field"><label for="f-email">Navn, brukernavn, e-post eller mobilnummer</label>
              <input id="f-email" name="email" type="search" required placeholder="f.eks. Kari Nordmann, @kari, kari@… eller 912 34 567" autocomplete="off"></div>
            <button class="btn">Søk</button>
          </form>
          <div id="search-out"></div>
          <div id="invite-out"></div>
          ${d.outgoing.length ? `<p class="muted small" style="margin-top:1rem">Venter på svar fra: ${d.outgoing.map((o) => esc(o.name)).join(', ')}</p>` : ''}
        </section>
        <section class="card share-box">${shareBlock()}</section>
      </div>
    </div>`;
  bindShare();
  $$('[data-accept]').forEach((b) => b.onclick = async () => { await api(`/api/friends/${b.dataset.accept}/accept`, { method: 'POST', body: {} }); toast('Dere er nå venner!'); await refreshMe(); views.friends(); });
  $$('[data-decline]').forEach((b) => b.onclick = async () => { await api(`/api/friends/${b.dataset.decline}/decline`, { method: 'POST', body: {} }); await refreshMe(); views.friends(); });
  $$('[data-remove]').forEach((b) => b.onclick = async () => {
    if (!confirm(`Fjerne ${b.dataset.name} som venn? Dere vil ikke lenger se hverandres ønskelister.`)) return;
    await api(`/api/friends/${b.dataset.remove}`, { method: 'DELETE', body: {} }); toast('Venn fjernet'); views.friends();
  });
  $$('[data-nick]').forEach((b) => b.onclick = () => editNickname(b.dataset.nick, b.dataset.name, b.dataset.nickname, views.friends));
  $('#add-friend').addEventListener('submit', async (e) => {
    e.preventDefault(); formError(e.target, '');
    const term = e.target.elements.email.value.trim();
    const out = $('#search-out'); $('#invite-out').innerHTML = '';
    if (!term) return;
    try {
      const r = await api(`/api/users/search?q=${encodeURIComponent(term)}`);
      if (!r.results.length) {
        const text = `Hei! Jeg bruker Gaveplanlegger til ønskelister. Bli med, så kan vi se hverandres lister: ${me.shareUrl}`;
        out.innerHTML = r.kind === 'name'
          ? `<p class="muted small" style="margin-top:1rem">Fant ingen med navnet «${esc(term)}». Noen har valgt å ikke vises i navnesøk – prøv e-post eller mobilnummer, eller send invitasjonslenken din.</p>`
          : `<div class="invite-banner" style="margin-top:1rem"><b>${esc(term)}</b> har ikke konto ennå. Send en invitasjon:
            <div class="row" style="margin-top:.6rem">${r.kind === 'email'
              ? `<a class="btn small" href="mailto:${encodeURIComponent(term)}?subject=${encodeURIComponent('Bli med på Gaveplanlegger 🎁')}&body=${encodeURIComponent(text)}">✉️ Inviter på e-post</a>`
              : `<a class="btn small" href="sms:${encodeURIComponent(term.replace(/[^\d+]/g, ''))}?&body=${encodeURIComponent(text)}">💬 Inviter på SMS</a>`}</div></div>`;
        return;
      }
      const label = { friends: '<span class="badge green">Venner</span>', requested: '<span class="badge">Forespørsel sendt</span>' };
      out.innerHTML = `<ul class="search-results">${r.results.map((u) => `<li class="row spread">
        <div><b>${esc(u.name)}</b>${u.username ? ` <span class="muted small">@${esc(u.username)}</span>` : ''}</div>
        ${label[u.status] || `<button class="btn small" data-add="${u.id}">${u.status === 'incoming' ? 'Godta forespørsel' : 'Legg til'}</button>`}</li>`).join('')}</ul>`;
      $$('[data-add]', out).forEach((b) => b.onclick = async () => {
        b.disabled = true;
        try {
          const a = await api('/api/friends', { method: 'POST', body: { userId: Number(b.dataset.add) } });
          toast({ requested: 'Venneforespørsel sendt', friends: 'Dere er nå venner!', already: 'Dere er allerede venner' }[a.status]);
          views.friends();
        } catch (err) { toast(err.message); b.disabled = false; }
      });
    } catch (err) { formError(e.target, err.message); }
  });
};

// ---------- En venns ønskeliste ----------
views.friend = async (id) => {
  const { friend, wishes, eventLists = [] } = await api(`/api/friends/${id}/wishes`);
  const free = wishes.filter((w) => !w.claimed).length;
  app.innerHTML = `
    <p><a href="#/venner" class="small">← Alle venner</a></p>
    <div class="row spread" style="margin-bottom:.6rem">
      <h1 style="margin:0">${esc(friend.displayName)}s ønskeliste <button class="btn ghost small" id="nick" title="Gi kallenavn" aria-label="Gi kallenavn">✏️</button></h1>
      ${friend.birthday ? `<span class="badge ${friend.daysUntil <= 7 ? 'gold' : ''}">🎂 ${turningText(friend).replace(/^./, (c) => c.toUpperCase())}</span>` : ''}
    </div>
    ${eventLists.length ? `<div class="list-cards" style="margin-bottom:1rem">${eventLists.map((g) => `<a class="card list-card ev-card" href="${esc(g.url)}">
      <b class="list-name">${ev(g.kind).icon} ${esc(g.title)}</b><div class="muted small">Ønskeliste · ${fmtDate(g.eventDate)}${g.daysLeft > 0 ? ` · om ${g.daysLeft} dager` : ''}</div></a>`).join('')}</div>` : ''}
    ${friend.nickname || friend.username ? `<p class="muted small" style="margin-top:-.3rem">${[friend.nickname && esc(friend.name), friend.username && '@' + esc(friend.username)].filter(Boolean).join(' · ')}</p>` : ''}
    <p class="muted small">${free} av ${wishes.length} ønsker er ledige. ${esc(friend.displayName.split(' ')[0])} ser ikke hvem som har reservert hva.</p>
    <section class="card wish-list">
      ${wishes.length ? wishes.map((w, i) => friendWishRow(w) + (i === 2 && wishes.length > 5 ? `<div class="wish ad-row">${adSlot('onskeliste')}</div>` : '')).join('')
        : '<div class="empty"><div class="big">🤷</div>Ingen ønsker på listen ennå.</div>'}
    </section>
    <div style="margin-top:1rem">${adSlot('onskeliste')}</div>`;
  $('#nick').onclick = () => editNickname(friend.id, friend.name, friend.nickname, () => views.friend(id));
  $$('[data-claim]').forEach((b) => b.onclick = async () => {
    try { await api(`/api/wishes/${b.dataset.claim}/claim`, { method: 'POST', body: {} }); toast('Reservert! Det er hemmeligheten din 🤫'); }
    catch (e) { toast(e.message); }
    views.friend(id);
  });
  $$('[data-unclaim]').forEach((b) => b.onclick = async () => {
    await api(`/api/wishes/${b.dataset.unclaim}/claim`, { method: 'DELETE', body: {} }); toast('Reservasjonen er fjernet'); views.friend(id);
  });
};
async function editNickname(id, name, current, done) {
  const v = prompt(`Kallenavn for ${name} (bare du ser det). La feltet stå tomt for å bruke det vanlige navnet.`, current || '');
  if (v === null) return;
  try { await api(`/api/friends/${id}/nickname`, { method: 'PUT', body: { nickname: v.trim() } }); toast(v.trim() ? 'Kallenavn lagret' : 'Kallenavn fjernet'); done(); }
  catch (err) { toast(err.message); }
}
// Søk etter gaven i butikker nær postnummeret ditt (Google Maps)
function nearbyLink(title) {
  if (!me?.postnr) return '';
  return `<a class="btn small ghost" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${title} nær ${me.postnr}`)}" target="_blank" rel="noopener noreferrer" title="Finn butikker nær ${esc(me.postnr)}">📍 I nærheten</a>`;
}
function friendWishRow(w) {
  const state = w.claimedByMe ? 'mine' : w.claimed ? 'other' : 'free';
  return `<div class="wish prio-${w.priority} ${state === 'other' ? 'claimed-other' : ''}">
    <div class="wish-icon">${state === 'mine' ? '🤫' : state === 'other' ? '🔒' : w.priority === 1 ? '★' : '🎁'}</div>
    <div class="wish-main">
      <div class="wish-title">${esc(w.title)}</div>
      <div class="wish-meta">${[w.price && esc(w.price), w.priority === 1 && '<span class="badge gold">Ønsker seg aller mest</span>',
        state === 'mine' && '<span class="badge green">Du har reservert denne</span>', state === 'other' && '<span class="badge">Allerede tatt</span>'].filter(Boolean).join(' · ')}</div>
      ${w.note ? `<div class="wish-meta">${esc(w.note)}</div>` : ''}
    </div>
    <div class="wish-actions">
      ${w.url && state !== 'other' ? `<a class="btn small gold" href="${esc(w.url)}" target="_blank" rel="noopener noreferrer">Se hos ${esc(w.host)} ↗</a>` : ''}
      ${state !== 'other' ? nearbyLink(w.title) : ''}
      ${state === 'free' ? `<button class="btn small" data-claim="${w.id}">Jeg kjøper denne</button>` : ''}
      ${state === 'mine' ? `<button class="btn small secondary" data-unclaim="${w.id}">Angre</button>` : ''}
    </div></div>`;
}

// ---------- Mine reservasjoner ----------
views.claims = async () => {
  const { claims, wedding } = await api('/api/claims');
  const byOwner = {};
  for (const c of claims) (byOwner[c.owner_id] ||= { name: c.owner_name, days: c.daysUntil, items: [] }).items.push(c);
  const groups = Object.entries(byOwner).sort((a, b) => (a[1].days ?? 9999) - (b[1].days ?? 9999));
  app.innerHTML = `
    <h1>Gaver jeg har reservert</h1>
    <p class="muted small">Huskeliste over gaver du har lovet å kjøpe. Bare du ser denne.</p>
    ${groups.length ? groups.map(([oid, g]) => `
      <section class="card wish-list" style="margin-bottom:1rem">
        <div class="row spread" style="padding:1rem 1.1rem .2rem"><h2 style="margin:0">${esc(g.name)}</h2>${g.days != null ? `<span class="badge">🎂 ${whenText(g.days)}</span>` : ''}</div>
        ${g.items.map((c) => `<div class="wish">
          <div class="wish-icon">${c.status === 'active' ? '🤫' : c.status === 'received' ? '✅' : '⚠️'}</div>
          <div class="wish-main"><div class="wish-title">${esc(c.title)}</div>
            <div class="wish-meta">${[c.price && esc(c.price),
              c.status === 'received' && '<span class="badge green">Markert som mottatt</span>',
              c.status === 'removed' && '<span class="badge gold">Fjernet fra listen – sjekk om du fortsatt skal kjøpe den</span>'].filter(Boolean).join(' · ')}</div></div>
          <div class="wish-actions">
            ${c.url && c.status === 'active' ? `<a class="btn small gold" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">Se gaven ↗</a>` : ''}
            ${c.status === 'active' ? `<a class="btn small secondary" href="#/venn/${oid}">Til listen</a>` : ''}
            <button class="btn ghost small" data-unclaim="${c.id}">${c.status === 'active' ? 'Angre' : 'Fjern'}</button>
          </div></div>`).join('')}
      </section>`).join('')
    : wedding.length ? '' : '<section class="card"><div class="empty"><div class="big">🎁</div>Du har ikke reservert noen gaver ennå.<br><a href="#/venner">Se vennenes ønskelister</a></div></section>'}
    ${wedding.length ? `<section class="card wish-list" style="margin-bottom:1rem">
      <div class="row spread" style="padding:1rem 1.1rem .2rem"><h2 style="margin:0">🎉 Ønskelister</h2></div>
      ${wedding.map((w) => `<div class="wish">
        <div class="wish-icon">${w.status === 'active' ? '🎁' : '⚠️'}</div>
        <div class="wish-main"><div class="wish-title">${esc(w.title)}${w.qty > 1 ? ` × ${w.qty}` : ''}</div>
          <div class="wish-meta">${[esc(w.registry), w.amount ? `Bidrag ${kr(w.amount)}` : w.price && esc(w.price), w.daysUntil >= 0 ? whenText(w.daysUntil) : '',
            w.status !== 'active' && '<span class="badge gold">Fjernet fra listen</span>'].filter(Boolean).join(' · ')}</div></div>
        <div class="wish-actions">
          ${w.url && w.status === 'active' && !w.amount ? `<a class="btn small gold" href="${esc(w.url)}" target="_blank" rel="noopener noreferrer">Se gaven ↗</a>` : ''}
          <a class="btn small secondary" href="#/onskeliste/${esc(w.token)}">Til listen</a>
        </div></div>`).join('')}
    </section>` : ''}
    ${adSlot('reservasjoner')}`;
  $$('[data-unclaim]').forEach((b) => b.onclick = async () => { await api(`/api/wishes/${b.dataset.unclaim}/claim`, { method: 'DELETE', body: {} }); views.claims(); });
};

// ---------- Gaveplanlegger ----------
const IDEA_STATUS = { idea: ['💡', 'Idé'], bought: ['🛍️', 'Kjøpt'], given: ['✅', 'Gitt'] };
views.planner = async () => {
  const [{ recipients, shareUrl }, lists] = await Promise.all([api('/api/recipients'), api('/api/lists')]);
  app.innerHTML = `
    <div class="row spread" style="margin-bottom:.4rem"><h1 style="margin:0">Planlegger</h1>
      <div class="row"><button class="btn" id="add-list">+ Ny liste</button><button class="btn secondary" id="add-person">+ Ny person</button></div></div>
    <p class="muted small">Lag lister for juleklapper, bryllup, konfirmasjoner og andre anledninger, og samle gaveideer til folk som ikke har ønskeliste her. Bare du ser dette.</p>
    <div class="grid" style="grid-template-columns: minmax(0,2fr) minmax(240px,1fr); align-items:start" id="plan-grid">
      <div class="stack">
        <section>
          <h2>Lister</h2>
          ${lists.active.length ? `<div class="list-cards">${lists.active.map(listCardHtml).join('')}</div>`
            : `<div class="card"><p class="muted" style="margin-top:0">Ingen aktive lister. Kom i gang med en av disse:</p>
              <div class="row">${['jul', 'bryllup', 'konfirmasjon', 'annet'].map((k) => `<button class="chip" data-new-list="${k}">${KIND[k][0]} ${KIND[k][1]}</button>`).join('')}</div></div>`}
        </section>
        ${recipients.length ? `<section class="card wish-list jul-list">
            <div class="jul-toolbar"><h2 style="margin:0">Personer (${recipients.length})</h2>
              <div class="row" style="gap:.3rem"><button class="btn ghost small" id="plan-open-all">Vis alle</button><button class="btn ghost small" id="plan-close-all">Skjul alle</button></div></div>
            ${recipients.map((r) => personCard(r, openSet('plan').has(r.id))).join('')}
          </section>`
          : `<section class="card"><div class="empty"><div class="big">📋</div>Ingen personer ennå.<br>Legg til for eksempel bestemor, en kollega eller nevøen din.</div></section>`}
        ${lists.history.length ? `<details class="card history"><summary><h2 style="display:inline;margin:0">Historikk (${lists.history.length})</h2>
            <span class="muted small"> – lister der fristen er passert. Bruk dem som utgangspunkt for nye lister.</span></summary>
          ${lists.history.map((l) => `<div class="hist-row">
            <a href="#/liste/${l.id}"><b>${KIND[l.kind][0]} ${esc(l.name)}</b></a>
            <span class="muted small">Frist ${fmtDate(l.deadline)} · ${l.people} ${l.people === 1 ? 'person' : 'personer'} · ${kr(l.spent)}</span>
            <button class="btn small secondary" data-copy-list="${l.id}">Lag ny liste fra denne</button></div>`).join('')}
        </details>` : ''}
      </div>
      <aside class="stack">${adSlot('planlegger')}</aside>
    </div>
    ${personDialog()}${ideaDialog()}${listDialog()}`;
  if (matchMedia('(max-width: 760px)').matches) $('#plan-grid').style.gridTemplateColumns = '1fr';
  $('#add-list').onclick = () => openListDialog();
  $$('[data-new-list]').forEach((b) => b.onclick = () => openListDialog({ kind: b.dataset.newList }));
  $$('[data-copy-list]').forEach((b) => b.onclick = () => {
    const l = lists.history.find((x) => x.id === Number(b.dataset.copyList));
    openListDialog({ copyFrom: l, kind: l.kind, name: nextYearName(l.name), deadline: plusYear(l.deadline) });
  });
  if (routeQuery.get('ny')) openListDialog({ kind: routeQuery.get('ny') });
  const byId = Object.fromEntries(recipients.map((r) => [r.id, r]));
  $('#add-person').onclick = () => openPersonDialog();
  $$('[data-edit-person]').forEach((b) => b.onclick = () => openPersonDialog(byId[b.dataset.editPerson]));
  $$('[data-del-person]').forEach((b) => b.onclick = async () => {
    const r = byId[b.dataset.delPerson];
    if (!confirm(`Slette ${r.name} og alle gaveideene?`)) return;
    await api(`/api/recipients/${r.id}`, { method: 'DELETE', body: {} }); toast('Personen er slettet'); views.planner();
  });
  bindIdeaActions(byId, { onDone: views.planner });
  bindToggles('plan', recipients.map((r) => r.id), '#plan-open-all', '#plan-close-all');
  $$('[data-invite]').forEach((b) => b.onclick = () => {
    const r = byId[b.dataset.invite];
    const text = `Hei ${r.name.split(' ')[0]}! Jeg bruker Gaveplanlegger til ønskelister. Lag en du også, så slipper jeg å gjette 😉 ${shareUrl}`;
    $(`#invite-${r.id}`).innerHTML = `<div class="row" style="margin-top:.5rem">
      <a class="btn small secondary" href="mailto:${encodeURIComponent(r.email || '')}?subject=${encodeURIComponent('Lag ønskeliste på Gaveplanlegger 🎁')}&body=${encodeURIComponent(text)}">✉️ E-post</a>
      <a class="btn small secondary" href="sms:?&body=${encodeURIComponent(text)}">💬 SMS</a></div>`;
  });
};
// Husker hvilke personer som er utvidet, mens nettleserfanen er åpen
function openSet(key) { try { return new Set(JSON.parse(sessionStorage.getItem(`open-${key}`) || '[]')); } catch { return new Set(); } }
function setOpenSet(key, ids) { try { sessionStorage.setItem(`open-${key}`, JSON.stringify([...new Set(ids)])); } catch {} }
function bindToggles(key, allIds, openAllSel, closeAllSel) {
  $$('[data-toggle]').forEach((b) => b.onclick = () => {
    const id = Number(b.dataset.toggle), set = openSet(key);
    set.has(id) ? set.delete(id) : set.add(id); setOpenSet(key, [...set]);
    b.closest('.jul-person').classList.toggle('open', set.has(id)); b.setAttribute('aria-expanded', set.has(id));
  });
  const setAll = (open) => {
    setOpenSet(key, open ? allIds : []);
    $$('.jul-person').forEach((row) => { row.classList.toggle('open', open); $('[data-toggle]', row).setAttribute('aria-expanded', open); });
  };
  $(openAllSel)?.addEventListener('click', () => setAll(true));
  $(closeAllSel)?.addEventListener('click', () => setAll(false));
}
function bindIdeaActions(byId, opts) {
  $$('[data-add-idea]').forEach((b) => b.onclick = () => openIdeaDialog(byId[b.dataset.addIdea], null, opts));
  $$('[data-edit-idea]').forEach((b) => b.onclick = () => {
    const [rid, gid] = b.dataset.editIdea.split(':').map(Number);
    openIdeaDialog(byId[rid], byId[rid].ideas.find((g) => g.id === gid), opts);
  });
  $$('[data-idea-status]').forEach((b) => b.onclick = async () => {
    const [gid, status] = b.dataset.ideaStatus.split(':');
    await api(`/api/ideas/${gid}`, { method: 'PUT', body: { status } });
    toast({ bought: 'Markert som kjøpt 🛍️', given: 'Markert som gitt ✅', idea: 'Tilbake til idé' }[status]); opts.onDone();
  });
  $$('[data-del-idea]').forEach((b) => b.onclick = async () => {
    if (!confirm('Slette gaven fra listen?')) return;
    await api(`/api/ideas/${b.dataset.delIdea}`, { method: 'DELETE', body: {} }); opts.onDone();
  });
}
function personCard(r, isOpen) {
  const b = r.birthday;
  const active = r.ideas.filter((g) => g.status === 'idea').length;
  const bought = r.ideas.filter((g) => g.status === 'bought').length;
  const soon = b && b.daysUntil <= 30;
  return `<div class="jul-person ${isOpen ? 'open' : ''}">
    <button class="jul-head" data-toggle="${r.id}" aria-expanded="${!!isOpen}" aria-controls="plan-body-${r.id}">
      <span class="chev" aria-hidden="true">›</span>
      ${b ? `<span class="bday-date mini ${b.daysUntil <= 7 ? 'soon' : ''}"><b>${Number(b.mmdd.slice(3))}</b><span>${MONTHS[Number(b.mmdd.slice(0, 2)) - 1]}</span></span>`
        : '<span class="bday-date mini nodate" title="Ingen bursdag lagt inn">–</span>'}
      <span class="jul-name"><b>${esc(r.name)}</b>
        <span class="muted small">${[r.relation && esc(r.relation), b && (b.turning ? `fyller ${b.turning}` : 'bursdag') + ` ${whenText(b.daysUntil)}`].filter(Boolean).join(' · ')}</span></span>
      <span class="jul-sum">
        <span class="muted small">${r.ideas.length ? [active && `${active} ${active === 1 ? 'idé' : 'ideer'}`, bought && `${bought} kjøpt`].filter(Boolean).join(' · ') || 'Alt er gitt' : 'Ingen ideer'}</span>
        ${soon ? `<span class="badge ${b.daysUntil <= 7 ? 'gold' : ''}">🎂 ${whenText(b.daysUntil)}</span>` : ''}
      </span>
    </button>
    <div class="jul-body" id="plan-body-${r.id}">
      ${r.note || r.email ? `<div class="friend-hint">${[r.note && `📝 ${esc(r.note)}`, r.email && `✉️ ${esc(r.email)}`].filter(Boolean).join('<br>')}</div>` : ''}
      ${r.ideas.map((g) => ideaRow(r, g)).join('')}
      ${!r.ideas.length ? '<p class="muted small" style="padding:0 1.1rem">Ingen gaveideer ennå.</p>' : ''}
      <div id="invite-${r.id}" style="padding:0 1.1rem"></div>
      <div class="row spread jul-foot">
        <button class="btn small secondary" data-add-idea="${r.id}">+ Gaveidé</button>
        <div class="row" style="gap:.2rem">
          <button class="btn ghost small" data-invite="${r.id}" title="Inviter til å lage egen ønskeliste">Inviter</button>
          <button class="btn ghost small" data-edit-person="${r.id}">Endre</button>
          <button class="btn ghost small" data-del-person="${r.id}">Slett</button>
        </div>
      </div>
    </div>
  </div>`;
}
function ideaRow(r, g) {
  const [icon, label] = IDEA_STATUS[g.status];
  const host = g.url ? new URL(g.url).hostname.replace(/^www\./, '') : '';
  const next = { idea: ['bought', 'Kjøpt'], bought: ['given', 'Gitt'], given: ['idea', 'Angre'] }[g.status];
  return `<div class="wish ${g.status === 'given' ? 'received' : ''}">
    <div class="wish-icon">${icon}</div>
    <div class="wish-main"><div class="wish-title">${esc(g.title)}</div>
      <div class="wish-meta">${[`<span class="badge ${g.status === 'bought' ? 'gold' : g.status === 'given' ? 'green' : ''}">${label}</span>`,
        !r.kind && (g.list_name ? `📋 ${esc(g.list_name)}` : g.occasion && esc(g.occasion)), g.price && esc(g.price),
        g.url && `<a href="${esc(g.url)}" target="_blank" rel="noopener noreferrer">${esc(host)} ↗</a>`].filter(Boolean).join(' · ')}</div>
      ${g.note ? `<div class="wish-meta">${esc(g.note)}</div>` : ''}</div>
    <div class="wish-actions">
      <button class="btn ghost small" data-idea-status="${g.id}:${next[0]}">${next[1]}</button>
      <button class="btn ghost small" data-edit-idea="${r.id}:${g.id}">Endre</button>
      <button class="btn ghost small" data-del-idea="${g.id}" aria-label="Slett">✕</button>
    </div></div>`;
}
function personDialog() {
  return `<dialog id="person-dlg"><form id="person-form" novalidate>
    <h2 id="person-dlg-title">Ny person</h2>
    <input type="hidden" name="id">
    <div class="field"><label for="r-name">Navn</label><input id="r-name" name="name" required maxlength="100"></div>
    <div class="field"><label for="r-rel">Relasjon <span class="hint">(valgfritt)</span></label><input id="r-rel" name="relation" maxlength="60" placeholder="F.eks. bestemor, kollega, nevø" list="rel-list">
      <datalist id="rel-list">${['Mamma', 'Pappa', 'Bestemor', 'Bestefar', 'Søsken', 'Barn', 'Nevø', 'Niese', 'Venn', 'Kollega', 'Svigerfamilie'].map((x) => `<option value="${x}">`).join('')}</datalist></div>
    <div class="field"><label>Bursdag <span class="hint">(valgfritt – gir deg varsel)</span></label>
      <div class="row" style="flex-wrap:nowrap">
        <select name="day" aria-label="Dag"><option value="">Dag</option>${Array.from({ length: 31 }, (_, i) => `<option>${i + 1}</option>`).join('')}</select>
        <select name="month" aria-label="Måned"><option value="">Måned</option>${MONTHS.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('')}</select>
        <input name="year" type="number" inputmode="numeric" min="1900" max="${new Date().getFullYear()}" placeholder="År (valgfritt)" aria-label="År">
      </div></div>
    <div class="field"><label for="r-email">E-post <span class="hint">(valgfritt – for å invitere personen senere)</span></label><input id="r-email" name="email" type="email"></div>
    <div class="field"><label for="r-note">Notater <span class="hint">(størrelser, interesser, allergier …)</span></label><textarea id="r-note" name="note" maxlength="1000"></textarea></div>
    <div class="row" style="justify-content:flex-end"><button type="button" class="btn secondary" data-close>Avbryt</button><button class="btn">Lagre</button></div>
  </form></dialog>`;
}
function openPersonDialog(r) {
  const dlg = $('#person-dlg'), f = $('#person-form');
  f.reset(); formError(f, '');
  $('#person-dlg-title').textContent = r ? `Endre ${r.name}` : 'Ny person';
  f.elements.id.value = r?.id || '';
  if (r) {
    for (const k of ['name', 'relation', 'email', 'note']) f.elements[k].value = r[k] ?? '';
    if (r.birthday) {
      const [m, d] = r.birthday.mmdd.split('-').map(Number);
      f.elements.day.value = d; f.elements.month.value = m; f.elements.year.value = r.birthday.year || '';
    }
  }
  $('[data-close]', f).onclick = () => dlg.close();
  f.onsubmit = async (e) => {
    e.preventDefault();
    const body = formData(f); const id = body.id; delete body.id;
    try {
      const res = await api(id ? `/api/recipients/${id}` : '/api/recipients', { method: id ? 'PUT' : 'POST', body });
      if (!id && res.id) setOpenSet('plan', [...openSet('plan'), res.id]);
      dlg.close(); toast(id ? 'Lagret' : `${body.name} er lagt til`); views.planner();
    } catch (err) { formError(f, err.message); }
  };
  dlg.showModal(); $('#r-name').focus();
}
function ideaDialog() {
  return `<dialog id="idea-dlg"><form id="idea-form" novalidate>
    <h2 id="idea-dlg-title">Ny gaveidé</h2>
    <input type="hidden" name="id"><input type="hidden" name="rid">
    ${urlField('g-url')}
    <div class="field"><label for="g-title">Gave</label><input id="g-title" name="title" required maxlength="200" placeholder="F.eks. Strikkebok"></div>
    <div class="grid grid-2" style="gap:.8rem">
      <div class="field"><label for="g-price">Ca. pris</label><input id="g-price" name="price" placeholder="F.eks. 349 kr"></div>
      <div class="field"><label for="g-occ">Anledning</label><input id="g-occ" name="occasion" list="occ-list" placeholder="F.eks. Jul ${new Date().getFullYear()}">
        <datalist id="occ-list">${['Bursdag', `Jul ${new Date().getFullYear()}`, 'Morsdag', 'Farsdag', 'Konfirmasjon', 'Bryllup', 'Takk for hjelpen'].map((x) => `<option value="${x}">`).join('')}</datalist></div>
    </div>
    <div class="field"><label for="g-note">Notat</label><textarea id="g-note" name="note" maxlength="1000"></textarea></div>
    <div class="row" style="justify-content:flex-end"><button type="button" class="btn secondary" data-close>Avbryt</button><button class="btn">Lagre</button></div>
  </form></dialog>`;
}
function openIdeaDialog(r, g, opts = {}) {
  const onDone = opts.onDone || views.planner;
  const dlg = $('#idea-dlg'), f = $('#idea-form');
  f.reset(); formError(f, '');
  $('#idea-dlg-title').textContent = g ? 'Endre gave' : opts.listId ? `Gave til ${r.name}` : `Gaveidé til ${r.name}`;
  f.elements.rid.value = r.id; f.elements.id.value = g?.id || '';
  if (g) for (const k of ['title', 'url', 'price', 'occasion', 'note']) f.elements[k].value = g[k] ?? '';
  f.elements.occasion.closest('.field').hidden = !!opts.listId;
  $('[data-close]', f).onclick = () => dlg.close();
  f.onsubmit = async (e) => {
    e.preventDefault();
    const body = formData(f); const { id, rid } = body; delete body.id; delete body.rid;
    if (opts.listId && !id) body.listId = opts.listId;
    try {
      await api(id ? `/api/ideas/${id}` : `/api/recipients/${rid}/ideas`, { method: id ? 'PUT' : 'POST', body });
      dlg.close(); toast(id ? 'Lagret' : opts.listId ? 'Gaven er lagt til 🎁' : 'Gaveideen er lagt til 💡'); onDone();
    } catch (err) { formError(f, err.message); }
  };
  bindLinkFetch(f);
  dlg.showModal(); (g ? $('#g-title') : $('#g-url')).focus();
}

// ---------- Lister i planleggeren ----------
const kr = (n) => `${Math.round(n || 0).toLocaleString('nb-NO')} kr`;
const KIND = { jul: ['🎄', 'Juleliste'], bryllup: ['💍', 'Bryllup'], konfirmasjon: ['🎓', 'Konfirmasjon'], bursdag: ['🎂', 'Bursdag'], annet: ['🎁', 'Annet'] };
function fmtDate(ymd) { const [y, m, d] = ymd.split('-').map(Number); return `${d}. ${MONTHS[m - 1]} ${y}`; }
function plusYear(ymd) { const [y, m, d] = ymd.split('-'); return `${Number(y) + 1}-${m}-${d}`; }
function nextYearName(name) { return /\b(20\d\d)\b/.test(name) ? name.replace(/\b(20\d\d)\b/, (y) => Number(y) + 1) : name; }
function deadlineText(l) {
  if (l.state === 'history') return `Frist var ${fmtDate(l.deadline)}`;
  if (l.state === 'grace') return `Fristen var ${fmtDate(l.deadline)} · flyttes til historikk om ${7 + l.daysLeft} ${7 + l.daysLeft === 1 ? 'dag' : 'dager'}`;
  return l.daysLeft === 0 ? 'Fristen er i dag!' : `${fmtDate(l.deadline)} · ${l.daysLeft} ${l.daysLeft === 1 ? 'dag' : 'dager'} igjen`;
}
function listCardHtml(l) {
  const pct = l.people ? Math.round((l.done / l.people) * 100) : 0;
  return `<a class="card list-card ${l.state}" href="#/liste/${l.id}">
    <div class="row spread" style="align-items:flex-start"><b class="list-name">${KIND[l.kind][0]} ${esc(l.name)}</b>
      ${l.state === 'grace' ? '<span class="badge gold">Frist passert</span>' : l.daysLeft <= 7 ? '<span class="badge gold">Snart frist</span>' : ''}</div>
    <div class="muted small">${deadlineText(l)}</div>
    <div class="progress" style="max-width:none;margin:.6rem 0 .3rem"><span style="width:${pct}%"></span></div>
    <div class="small muted">${l.done}/${l.people} har fått gave · ${kr(l.spent)}${l.budget ? ` av ${kr(l.budget)}` : ''}</div>
  </a>`;
}
function listDialog() {
  return `<dialog id="list-dlg"><form id="list-form" novalidate>
    <h2 id="list-dlg-title">Ny liste</h2>
    <input type="hidden" name="copyFrom">
    <div class="field"><label>Type</label><div class="segmented">${Object.entries(KIND).map(([k, [ic, l]]) =>
      `<label><input type="radio" name="kind" value="${k}"><span>${ic} ${l}</span></label>`).join('')}</div></div>
    <div class="field"><label for="l-name">Navn på listen</label><input id="l-name" name="name" maxlength="80" placeholder="F.eks. Juleliste ${new Date().getFullYear()}"></div>
    <div class="field"><label for="l-dl">Frist <span class="hint">– listen vises i 7 dager etter fristen, så flyttes den til historikk</span></label><input id="l-dl" name="deadline" type="date" required></div>
    <p class="hint" id="list-copy-hint" hidden></p>
    <div class="row" style="justify-content:flex-end"><button type="button" class="btn secondary" data-close>Avbryt</button><button class="btn">Lagre</button></div>
  </form></dialog>`;
}
function openListDialog(o = {}) {
  const dlg = $('#list-dlg'), f = $('#list-form');
  f.reset(); formError(f, '');
  const y = new Date().getFullYear();
  const defaults = { jul: [`Juleliste ${new Date().getMonth() === 11 && new Date().getDate() > 24 ? y + 1 : y}`, `${new Date().getMonth() === 11 && new Date().getDate() > 24 ? y + 1 : y}-12-24`],
    bryllup: ['Bryllup ', ''], konfirmasjon: ['Konfirmasjon ', ''], bursdag: ['Bursdag ', ''], annet: ['', ''] };
  const edit = o.edit;
  $('#list-dlg-title').textContent = edit ? 'Endre liste' : o.copyFrom ? `Ny liste fra «${o.copyFrom.name}»` : 'Ny liste';
  f.elements.copyFrom.value = o.copyFrom?.id || '';
  $('#list-copy-hint').hidden = !o.copyFrom;
  $('#list-copy-hint').textContent = o.copyFrom ? `Personene og budsjettene fra «${o.copyFrom.name}» blir med. Gavene starter blanke.` : '';
  const setKind = (k, fill) => {
    const r = $(`input[name=kind][value="${k}"]`, f); if (r) r.checked = true;
    if (fill) { f.elements.name.value = defaults[k][0]; f.elements.deadline.value = defaults[k][1]; }
  };
  setKind(o.kind || 'jul', !o.name && !edit);
  if (o.name) f.elements.name.value = o.name;
  if (o.deadline) f.elements.deadline.value = o.deadline;
  if (edit) { setKind(edit.kind); f.elements.name.value = edit.name; f.elements.deadline.value = edit.deadline; }
  $$('input[name=kind]', f).forEach((r) => r.onchange = () => {
    const prev = Object.values(defaults).some(([n]) => f.elements.name.value === n || !f.elements.name.value);
    if (prev) setKind(r.value, true);
  });
  $('[data-close]', f).onclick = () => dlg.close();
  f.onsubmit = async (e) => {
    e.preventDefault();
    const body = formData(f);
    if (!body.name.trim()) return formError(f, 'Gi listen et navn.');
    if (!body.deadline) return formError(f, 'Velg en frist.');
    try {
      let id;
      if (edit) { await api(`/api/lists/${edit.id}`, { method: 'PUT', body }); id = edit.id; }
      else if (body.copyFrom) id = (await api(`/api/lists/${body.copyFrom}/copy`, { method: 'POST', body })).id;
      else id = (await api('/api/lists', { method: 'POST', body })).id;
      dlg.close(); toast(edit ? 'Listen er oppdatert' : 'Listen er laget');
      if (edit) views.list(id); else location.hash = `#/liste/${id}`;
    } catch (err) { formError(f, err.message); }
  };
  dlg.showModal(); f.elements.name.focus();
}

views.list = async (id) => {
  const d = await api(`/api/lists/${id}`);
  const l = d.list;
  const pct = l.people ? Math.round((l.done / l.people) * 100) : 0;
  const byId = Object.fromEntries(d.entries.map((e) => [e.id, e]));
  const key = `list-${l.id}`;
  app.innerHTML = `
    <p class="no-print"><a href="#/gaveplanlegger" class="small">← Planlegger</a></p>
    <div class="xmas-head">
      <div><h1 style="margin:0">${KIND[l.kind][0]} ${esc(l.name)}</h1>
        <p class="muted small" style="margin:.3rem 0 0">${deadlineText(l)}</p></div>
      <div class="row no-print"><button class="btn ghost small" id="edit-list">Endre</button><button class="btn ghost small" id="del-list">Slett</button>
        <button class="btn secondary small" onclick="window.print()">🖨️ Skriv ut</button></div>
    </div>
    ${l.state === 'grace' ? `<div class="invite-banner no-print" style="margin-top:1rem">⏳ Fristen har passert. Listen ligger her i ${l.graceLeft} ${l.graceLeft === 1 ? 'dag' : 'dager'} til, så flyttes den til historikken i planleggeren.</div>` : ''}
    ${l.state === 'history' ? `<div class="invite-banner no-print" style="margin-top:1rem">📚 Denne listen ligger i historikken. <button class="btn small" id="copy-this" style="margin-left:.5rem">Lag ny liste fra denne</button></div>` : ''}
    <div class="grid grid-4" style="margin:1rem 0">
      <div class="card stat"><b>${l.people}</b>personer</div>
      <div class="card stat"><b>${l.done}/${l.people}</b>har fått gave<div class="progress"><span style="width:${pct}%"></span></div></div>
      <div class="card stat"><b>${kr(l.spent)}</b>brukt${l.budget ? ` av ${kr(l.budget)}` : ''}</div>
      <div class="card stat"><b>${kr(l.planned)}</b>planlagt (ideer)</div>
    </div>
    <div class="grid" style="grid-template-columns: minmax(0,2fr) minmax(250px,1fr); align-items:start" id="jul-grid">
      <div class="stack">
        ${d.entries.length ? `<section class="card wish-list jul-list">
            <div class="jul-toolbar"><h2 style="margin:0">Personer (${d.entries.length})</h2>
              <div class="row no-print" style="gap:.3rem"><button class="btn ghost small" id="l-open-all">Vis alle</button><button class="btn ghost small" id="l-close-all">Skjul alle</button></div></div>
            ${d.entries.map((e) => listPersonCard(e, openSet(key).has(e.id))).join('')}
          </section>`
          : `<section class="card"><div class="empty"><div class="big">🎁</div>Listen er tom.<br>Legg til personene du skal gi gave til i boksen ${matchMedia('(max-width: 760px)').matches ? 'under' : 'til høyre'}.</div></section>`}
      </div>
      <aside class="stack no-print">
        <section class="card">
          <h2>Legg til personer</h2>
          ${d.candidates.length ? `<p class="muted small" style="margin-top:0">Trykk for å legge til. 👤 = venn med ønskeliste, 📋 = fra planleggeren.</p>
            <div class="chips">${d.candidates.map((c) => `<button class="chip" data-add-${c.type}="${c.id}">
              ${c.type === 'friend' ? '👤' : '📋'} ${esc(c.name)}</button>`).join('')}</div>
            ${d.candidates.length > 1 ? '<button class="btn ghost small" id="add-all" style="margin-top:.4rem">+ Legg til alle</button>' : ''}` : ''}
          <form id="jul-new" novalidate style="margin-top:1rem">
            <label for="jn-name">Ny person</label>
            <div class="row" style="flex-wrap:nowrap"><input id="jn-name" name="name" placeholder="F.eks. Tante Kari" maxlength="100"><button class="btn">Legg til</button></div>
            <p class="hint" style="margin:.4rem 0 0">Nye personer havner også under «Personer» i planleggeren.</p>
          </form>
        </section>
        ${adSlot('planlegger')}
      </aside>
    </div>
    ${ideaDialog()}${listDialog()}`;
  if (matchMedia('(max-width: 760px)').matches) $('#jul-grid').style.gridTemplateColumns = '1fr';
  const refresh = () => views.list(l.id);
  bindIdeaActions(byId, { listId: l.id, onDone: refresh });
  bindToggles(key, d.entries.map((e) => e.id), '#l-open-all', '#l-close-all');
  const add = async (body, open = true) => {
    const r = await api(`/api/lists/${l.id}/people`, { method: 'POST', body });
    if (open) setOpenSet(key, [...openSet(key), r.recipientId]);
  };
  $$('[data-add-friend]').forEach((b) => b.onclick = async () => { await add({ friendId: Number(b.dataset.addFriend) }); refresh(); });
  $$('[data-add-person]').forEach((b) => b.onclick = async () => { await add({ recipientId: Number(b.dataset.addPerson) }); refresh(); });
  $('#add-all')?.addEventListener('click', async () => {
    for (const c of d.candidates) await add(c.type === 'friend' ? { friendId: c.id } : { recipientId: c.id }, false);
    toast(`${d.candidates.length} personer lagt til`); refresh();
  });
  $('#jul-new').addEventListener('submit', async (e) => {
    e.preventDefault(); formError(e.target, '');
    try { await add({ name: e.target.elements.name.value }); refresh(); } catch (err) { formError(e.target, err.message); }
  });
  $$('[data-budget]').forEach((inp) => inp.addEventListener('change', async () => {
    try { await api(`/api/lists/${l.id}/people/${inp.dataset.budget}`, { method: 'PUT', body: { budget: inp.value } }); toast('Budsjett lagret'); refresh(); }
    catch (err) { toast(err.message); }
  }));
  $$('[data-remove-jul]').forEach((b) => b.onclick = async () => {
    const e = byId[b.dataset.removeJul];
    if (!confirm(`Fjerne ${e.name} fra «${l.name}»? Gaveideene beholdes under personen i planleggeren.`)) return;
    await api(`/api/lists/${l.id}/people/${e.id}`, { method: 'DELETE', body: {} }); refresh();
  });
  // Reservere fra en venns ønskeliste direkte i listen
  $$('[data-wclaim]').forEach((b) => b.onclick = async () => {
    try { await api(`/api/wishes/${b.dataset.wclaim}/claim`, { method: 'POST', body: {} }); toast('Reservert! 🤫'); } catch (err) { toast(err.message); }
    refresh();
  });
  $$('[data-wunclaim]').forEach((b) => b.onclick = async () => {
    await api(`/api/wishes/${b.dataset.wunclaim}/claim`, { method: 'DELETE', body: {} }); toast('Reservasjonen er fjernet'); refresh();
  });
  $('#edit-list').onclick = () => openListDialog({ edit: l });
  $('#del-list').onclick = async () => {
    if (!confirm(`Slette listen «${l.name}»? Personene og gaveideene beholdes i planleggeren.`)) return;
    await api(`/api/lists/${l.id}`, { method: 'DELETE', body: {} }); toast('Listen er slettet'); location.hash = '#/gaveplanlegger';
  };
  $('#copy-this')?.addEventListener('click', () => openListDialog({ copyFrom: l, kind: l.kind, name: nextYearName(l.name), deadline: plusYear(l.deadline) }));
};
function listPersonCard(e, open) {
  const over = e.budget && e.spent > e.budget;
  const myWishes = e.wishes.filter((w) => w.claimedByMe);
  const count = e.ideas.length + myWishes.length;
  const bought = e.ideas.filter((g) => g.status !== 'idea').length + myWishes.length;
  const money = e.spent || e.budget ? `${kr(e.spent)}${e.budget ? ` / ${kr(e.budget)}` : ''}` : '';
  const freeWishes = e.wishes.filter((w) => !w.claimed && !w.received).length;
  return `<div class="jul-person ${open ? 'open' : ''} ${e.done ? 'done' : ''}">
    <button class="jul-head" data-toggle="${e.id}" aria-expanded="${open}" aria-controls="lp-${e.id}">
      <span class="chev" aria-hidden="true">›</span>
      <span class="jul-name"><b>${esc(e.name)}</b>
        <span class="muted small">${[e.relation && esc(e.relation), e.kind === 'friend' && `har ønskeliste${e.wishes.length ? ` (${freeWishes} ledige)` : ''}`].filter(Boolean).join(' · ')}</span></span>
      <span class="jul-sum">
        <span class="muted small">${count ? `${count} ${count === 1 ? 'gave' : 'gaver'}${bought ? ` · ${bought} kjøpt` : ''}` : 'Ingen gaver'}</span>
        ${money ? `<span class="small ${over ? 'over' : 'muted'}">${money}</span>` : ''}
        <span class="badge ${e.done ? 'green' : ''}">${e.done ? '✅ Har gave' : 'Mangler gave'}</span>
      </span>
    </button>
    <div class="jul-body" id="lp-${e.id}">
      ${e.registries.map((g) => `<div class="friend-hint no-print">${ev(g.kind).icon} ${esc(e.name.split(' ')[0])} har en ønskeliste: <a href="${esc(g.url)}">${esc(g.title)}</a> (${fmtDate(g.eventDate)})</div>`).join('')}
      ${e.wishes.length ? `<div class="sub-head">🎁 Ønskelisten til ${esc(e.name.split(' ')[0])}</div>
        ${e.wishes.map((w) => {
          const st = w.claimedByMe ? 'mine' : w.claimed ? 'other' : 'free';
          return `<div class="wish ${st === 'other' ? 'claimed-other' : ''} ${w.received ? 'received' : ''}">
            <div class="wish-icon">${st === 'mine' ? '🤫' : st === 'other' ? '🔒' : w.priority === 1 ? '★' : '🎁'}</div>
            <div class="wish-main"><div class="wish-title">${esc(w.title)}</div>
              <div class="wish-meta">${[st === 'mine' && '<span class="badge green">Du har reservert</span>', st === 'other' && '<span class="badge">Tatt av en annen</span>',
                w.received && '<span class="badge green">Mottatt</span>', w.priority === 1 && st === 'free' && '<span class="badge gold">Ønsker seg mest</span>', w.price && esc(w.price),
                w.url && st !== 'other' && `<a href="${esc(w.url)}" target="_blank" rel="noopener noreferrer">Se gaven ↗</a>`].filter(Boolean).join(' · ')}</div>
              ${w.note ? `<div class="wish-meta">${esc(w.note)}</div>` : ''}</div>
            <div class="wish-actions no-print">
              ${st === 'free' ? `<button class="btn small" data-wclaim="${w.id}">Jeg kjøper denne</button>` : ''}
              ${st === 'mine' && !w.received ? `<button class="btn ghost small" data-wunclaim="${w.id}">Angre</button>` : ''}
            </div></div>`;
        }).join('')}` : e.friendId ? `<p class="muted small" style="padding:0 1.1rem">${esc(e.name.split(' ')[0])} har ingen ønsker på listen sin ennå.</p>` : ''}
      ${e.ideas.length ? `<div class="sub-head">💡 ${e.wishes.length ? 'Egne gaveideer' : 'Gaver'}</div>` : ''}
      ${e.ideas.map((g) => ideaRow(e, g)).join('')}
      ${!e.ideas.length && !e.wishes.length && !e.friendId ? '<p class="muted small" style="padding:0 1.1rem">Ingen gaver ennå.</p>' : ''}
      <div class="row spread no-print jul-foot">
        <button class="btn small secondary" data-add-idea="${e.id}">+ ${e.wishes.length ? 'Egen gaveidé' : 'Gave'}</button>
        <div class="row" style="gap:.3rem">
          <label class="budget"><span>Budsjett</span><input type="number" min="0" step="50" inputmode="numeric" value="${e.budget ?? ''}" placeholder="kr" data-budget="${e.id}" aria-label="Budsjett for ${esc(e.name)}"></label>
          ${over ? '<span class="badge gold">Over budsjett</span>' : ''}
          <button class="btn ghost small" data-remove-jul="${e.id}">Fjern fra listen</button>
        </div>
      </div>
    </div>
  </div>`;
}

// ---------- Ønskelister for anledninger (bryllup, bryllupsdag, jubileum …) ----------
const EVENT = {
  bryllup: { icon: '💍', label: 'Bryllup', date: 'Bryllupsdato', title: 'Kari og Ola gifter seg', after: 'etter bryllupet' },
  bryllupsdag: { icon: '💞', label: 'Bryllupsdag', date: 'Dato', title: 'Kari og Ola – 25 år som gift', after: 'etter dagen' },
  jubileum: { icon: '🎉', label: 'Jubileum', date: 'Dato', title: 'Kari fyller 50', after: 'etter dagen' },
  bursdag: { icon: '🎂', label: 'Bursdag', date: 'Dato', title: 'Emil fyller 10', after: 'etter dagen' },
  konfirmasjon: { icon: '🎓', label: 'Konfirmasjon', date: 'Dato', title: 'Konfirmasjon for Emil', after: 'etter dagen' },
  annet: { icon: '🎁', label: 'Annet', date: 'Dato', title: 'Innflytting hos Kari', after: 'etter dagen' },
};
const ev = (k) => EVENT[k] || EVENT.annet;
views.weddings = async (id) => {
  if (id) return views.weddingAdmin(id);
  const { registries, friendsLists } = await api('/api/registries');
  app.innerHTML = `
    <div class="row spread" style="margin-bottom:.4rem"><h1 style="margin:0">🎉 Ønskelister</h1>
      <button class="btn" id="new-reg">+ Ny ønskeliste</button></div>
    <p class="muted small">Lag en ønskeliste til bryllup, bryllupsdag, jubileum eller en annen stor dag. Vennene dine ser den her i appen, og du kan sende lenken til hvem som helst – de trenger ikke konto. Du ser ikke hvem som har reservert hva før etter dagen.</p>
    <div class="grid grid-2" style="align-items:start">
      <div class="stack">
        <h2 style="margin:0">Mine ønskelister</h2>
        ${registries.length ? registries.map((g) => `<a class="card list-card" href="#/onskelister/${g.id}">
          <b class="list-name">${ev(g.kind).icon} ${esc(g.title)}</b>
          <div class="muted small">${fmtDate(g.eventDate)} · ${g.daysLeft > 0 ? `${g.daysLeft} dager igjen` : g.daysLeft === 0 ? 'I dag! 🥂' : 'Gjennomført'}</div>
          <div class="small muted" style="margin-top:.4rem">${ev(g.kind).label} · ${g.items} ${g.items === 1 ? 'gave' : 'gaver'} · ${esc(g.couple.join(' og '))}${g.visibleFriends ? ' · synlig for venner' : ' · bare med lenke'}</div></a>`).join('')
        : `<section class="card"><div class="empty"><div class="big">🎉</div>Du har ingen ønskelister ennå.</div></section>`}
        ${friendsLists.length ? `<h2 style="margin:.6rem 0 0">Fra vennene dine</h2>${friendsLists.map(friendListCard).join('')}` : ''}
      </div>
      <section class="card"><h2>Slik fungerer det</h2>
        <ol class="small" style="padding-left:1.1rem;margin:0">
          <li>Velg anledning og dato, og legg gjerne til partneren din som medeier.</li>
          <li>Legg inn gavene. Lim inn en lenke, så hentes navn og pris automatisk.</li>
          <li>Velg antall, f.eks. 12 tallerkener, eller la gjestene spleise på dyre gaver.</li>
          <li>Vennene dine får beskjed og ser listen i appen. Send lenken til alle andre på e-post eller SMS.</li>
          <li>Etter dagen ser du hvem som ga hva, til takkekortene.</li>
        </ol></section>
    </div>
    ${registryDialog()}`;
  $('#new-reg').onclick = () => openRegistryDialog();
};
function friendListCard(g) {
  return `<a class="card list-card" href="${esc(g.url)}">
    <b class="list-name">${ev(g.kind).icon} ${esc(g.title)}</b>
    <div class="muted small">${esc(g.couple.join(' og '))} · ${fmtDate(g.eventDate)}${g.daysLeft > 0 ? ` · om ${g.daysLeft} dager` : g.daysLeft === 0 ? ' · i dag!' : ''}</div></a>`;
}
function registryDialog() {
  return `<dialog id="reg-dlg"><form id="reg-form" novalidate>
    <h2 id="reg-dlg-title">Ny ønskeliste</h2>
    <div class="field"><label>Anledning</label><div class="segmented">${Object.entries(EVENT).map(([k, e]) =>
      `<label><input type="radio" name="kind" value="${k}"><span>${e.icon} ${e.label}</span></label>`).join('')}</div></div>
    <div class="field"><label for="rg-title">Navn på listen</label><input id="rg-title" name="title" maxlength="100"></div>
    <div class="field"><label for="rg-date" id="rg-date-label">Dato</label><input id="rg-date" name="eventDate" type="date"></div>
    <div class="field"><label for="rg-partner">Medeier <span class="hint">(valgfritt – f.eks. partneren din. Må ha konto, og kan redigere listen)</span></label><input id="rg-partner" name="partnerEmail" type="email" placeholder="E-post"></div>
    <div class="field"><label class="check"><input type="checkbox" name="visibleFriends" checked><span><b>Synlig for alle vennene mine</b> i appen. De får beskjed når listen er laget. Uten avkrysning ser bare de som får lenken, listen.</span></label></div>
    <div class="field"><label for="rg-msg">Hilsen til gjestene <span class="hint">(valgfritt)</span></label><textarea id="rg-msg" name="message" maxlength="1500" placeholder="F.eks. Det aller viktigste er at dere kommer! Her er noen ideer om dere ønsker å gi en gave."></textarea></div>
    <div class="row" style="justify-content:flex-end"><button type="button" class="btn secondary" data-close>Avbryt</button><button class="btn">Lagre</button></div>
  </form></dialog>`;
}
function openRegistryDialog(g) {
  const dlg = $('#reg-dlg'), f = $('#reg-form');
  f.reset(); formError(f, '');
  $('#reg-dlg-title').textContent = g ? 'Endre ønskelisten' : 'Ny ønskeliste';
  const setKind = (k) => {
    $(`input[name=kind][value="${k}"]`, f).checked = true;
    $('#rg-date-label').textContent = ev(k).date;
    f.elements.title.placeholder = `F.eks. ${ev(k).title}`;
  };
  $$('input[name=kind]', f).forEach((r) => r.onchange = () => setKind(r.value));
  if (g) {
    f.elements.title.value = g.title; f.elements.eventDate.value = g.eventDate; f.elements.message.value = g.message || '';
    f.elements.partnerEmail.value = g.partner?.email || ''; f.elements.visibleFriends.checked = g.visibleFriends; setKind(g.kind);
  } else setKind('bryllup');
  $('[data-close]', f).onclick = () => dlg.close();
  f.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const body = formData(f); body.visibleFriends = f.elements.visibleFriends.checked;
      if (g) { await api(`/api/registries/${g.id}`, { method: 'PUT', body }); dlg.close(); toast('Lagret'); views.weddingAdmin(g.id); }
      else {
        const r = await api('/api/registries', { method: 'POST', body });
        dlg.close(); if (r.warning) toast(r.warning); else toast(body.visibleFriends ? 'Ønskelisten er laget, og vennene dine har fått beskjed 🎉' : 'Ønskelisten er laget 🎉');
        location.hash = `#/onskelister/${r.id}`;
      }
    } catch (err) { formError(f, err.message); }
  };
  dlg.showModal(); f.elements.title.focus();
}
views.weddingAdmin = async (id) => {
  const { registry: g, items } = await api(`/api/registries/${id}`);
  const text = `Hei! Her er ønskelisten for «${g.title}». Du kan reservere en gave uten å lage konto: ${g.shareUrl}`;
  app.innerHTML = `
    <p><a href="#/onskelister" class="small">← Ønskelister</a></p>
    <div class="xmas-head">
      <div><h1 style="margin:0">${ev(g.kind).icon} ${esc(g.title)}</h1>
        <p class="muted small" style="margin:.3rem 0 0">${fmtDate(g.eventDate)} · ${g.daysLeft > 0 ? `${g.daysLeft} dager igjen` : g.daysLeft === 0 ? 'Gratulerer med dagen! 🥂' : 'Gjennomført'} · ${esc(g.couple.join(' og '))}</p></div>
      <div class="row"><a class="btn ghost small" href="#/onskeliste/${esc(g.shareUrl.split('/').pop())}">Se som gjest</a>
        <button class="btn ghost small" id="edit-reg">Endre</button>${g.isOwner ? '<button class="btn ghost small" id="del-reg">Slett</button>' : ''}</div>
    </div>
    ${!g.partner && g.isOwner ? `<div class="invite-banner" style="margin-top:1rem">Tips: Legg til en medeier under «Endre», f.eks. partneren din, så kan dere begge redigere listen.</div>` : ''}
    <div class="grid" style="grid-template-columns: minmax(0,2fr) minmax(260px,1fr); align-items:start; margin-top:1rem" id="reg-grid">
      <div class="stack">
        <section class="card wish-list">
          <div class="jul-toolbar"><h2 style="margin:0">Gaver (${items.length})</h2><button class="btn small" id="add-item">+ Gave</button></div>
          ${items.length ? items.map((i) => `<div class="wish prio-${i.priority}">
            <div class="wish-icon">${i.spleis ? '🤝' : i.priority === 1 ? '★' : '🎁'}</div>
            <div class="wish-main"><div class="wish-title">${esc(i.title)}</div>
              <div class="wish-meta">${[i.spleis ? '<span class="badge">Spleis</span>' : i.qty > 1 ? `<span class="badge">Ønsker ${i.qty} stk</span>` : '',
                i.price && esc(i.price), i.priority === 1 && '<span class="badge gold">Ønsker oss mest</span>',
                i.url && `<a href="${esc(i.url)}" target="_blank" rel="noopener noreferrer">${esc(new URL(i.url).hostname.replace(/^www\./, ''))} ↗</a>`].filter(Boolean).join(' · ')}</div>
              ${i.note ? `<div class="wish-meta">${esc(i.note)}</div>` : ''}
              ${g.revealed ? `<div class="givers">${i.givers.length ? i.givers.map((x) => `🎁 <b>${esc(x.name)}</b>${x.amount ? ` – ${kr(x.amount)}` : x.qty > 1 ? ` – ${x.qty} stk` : ''}${x.email ? ` <span class="muted">(${esc(x.email)})</span>` : ''}`).join('<br>') : '<span class="muted">Ingen reserverte denne</span>'}</div>` : ''}
            </div>
            <div class="wish-actions"><button class="btn ghost small" data-edit-item="${i.id}">Endre</button><button class="btn ghost small" data-del-item="${i.id}">Fjern</button></div>
          </div>`).join('') : '<div class="empty"><div class="big">📝</div>Ingen gaver ennå. Legg til den første!</div>'}
        </section>
        ${g.revealed ? '' : `<p class="muted small">🤫 Du ser ikke hva gjestene har reservert før ${ev(g.kind).after}. Da dukker det opp hvem som ga hva, til takkekortene.</p>`}
      </div>
      <aside class="stack">
        <section class="card share-box"><h2>Del med gjestene</h2>
          <p class="muted small">Gjestene trenger ikke konto. Legg gjerne lenken i invitasjonen.</p>
          <div class="share-link"><input readonly value="${esc(g.shareUrl)}" id="share-url" aria-label="Lenke til ønskelisten"><button class="btn small" id="copy-link">Kopier</button></div>
          <div class="row" style="margin-top:.8rem">
            <a class="btn secondary small" href="mailto:?subject=${encodeURIComponent(`Ønskeliste – ${g.title}`)}&body=${encodeURIComponent(text)}">✉️ E-post</a>
            <a class="btn secondary small" href="sms:?&body=${encodeURIComponent(text)}">💬 SMS</a>
          </div>
          <button class="btn ghost small" id="new-reg-link" style="margin-top:.6rem">Lag ny lenke</button>
        </section>
        ${g.message ? `<section class="card"><h3>Hilsen til gjestene</h3><p class="small" style="white-space:pre-line;margin:0">${esc(g.message)}</p></section>` : ''}
      </aside>
    </div>
    ${registryDialog()}${itemDialog()}`;
  if (matchMedia('(max-width: 760px)').matches) $('#reg-grid').style.gridTemplateColumns = '1fr';
  $('#copy-link').onclick = async () => { try { await navigator.clipboard.writeText(g.shareUrl); } catch { $('#share-url').select(); document.execCommand('copy'); } toast('Lenken er kopiert'); };
  $('#new-reg-link').onclick = async () => { if (!confirm('Lage ny lenke? Den gamle slutter å virke for gjestene.')) return; await api(`/api/registries/${g.id}/new-link`, { method: 'POST', body: {} }); views.weddingAdmin(g.id); };
  $('#edit-reg').onclick = () => openRegistryDialog(g);
  $('#del-reg')?.addEventListener('click', async () => {
    if (!confirm('Slette ønskelisten og alle reservasjonene for godt?')) return;
    await api(`/api/registries/${g.id}`, { method: 'DELETE', body: {} }); toast('Ønskelisten er slettet'); location.hash = '#/onskelister';
  });
  $('#add-item').onclick = () => openItemDialog(g.id);
  $$('[data-edit-item]').forEach((b) => b.onclick = () => openItemDialog(g.id, items.find((i) => i.id === Number(b.dataset.editItem))));
  $$('[data-del-item]').forEach((b) => b.onclick = async () => {
    if (!confirm('Fjerne gaven fra ønskelisten?')) return;
    await api(`/api/registry-items/${b.dataset.delItem}`, { method: 'DELETE', body: {} }); views.weddingAdmin(g.id);
  });
};
function itemDialog() {
  return `<dialog id="item-dlg"><form id="item-form" novalidate>
    <h2 id="item-dlg-title">Ny gave</h2>
    <input type="hidden" name="id">
    ${urlField('it-url')}
    <div class="field"><label for="it-title">Gave</label><input id="it-title" name="title" maxlength="200" placeholder="F.eks. Middagstallerken"></div>
    <div class="grid grid-2" style="gap:.8rem">
      <div class="field"><label for="it-price">Pris <span class="hint">(per stk)</span></label><input id="it-price" name="price" placeholder="F.eks. 249 kr"></div>
      <div class="field"><label for="it-qty">Antall ønsket</label><input id="it-qty" name="qty" type="number" min="1" max="100" value="1"></div>
    </div>
    <div class="field"><label class="check"><input type="checkbox" name="spleis" value="1"><span><b>Spleis</b> – gjestene kan bidra med et beløp til en dyr gave (f.eks. sofa eller bryllupsreise)</span></label></div>
    <div class="field"><label for="it-prio">Hvor mye ønsker dere den?</label><select id="it-prio" name="priority">
      ${Object.entries(PRIO).map(([v, t]) => `<option value="${v}" ${v === '2' ? 'selected' : ''}>${t.replace('meg', 'oss')}</option>`).join('')}</select></div>
    <div class="field"><label for="it-note">Kommentar <span class="hint">(farge, mønster …)</span></label><textarea id="it-note" name="note" maxlength="1000"></textarea></div>
    <div class="row" style="justify-content:flex-end"><button type="button" class="btn secondary" data-close>Avbryt</button><button class="btn">Lagre</button></div>
  </form></dialog>`;
}
function openItemDialog(regId, it) {
  const dlg = $('#item-dlg'), f = $('#item-form');
  f.reset(); formError(f, '');
  $('#item-dlg-title').textContent = it ? 'Endre gave' : 'Ny gave';
  f.elements.id.value = it?.id || '';
  if (it) { for (const k of ['title', 'url', 'price', 'qty', 'priority', 'note']) f.elements[k].value = it[k] ?? ''; f.elements.spleis.checked = it.spleis; }
  const syncQty = () => { f.elements.qty.disabled = f.elements.spleis.checked; if (f.elements.spleis.checked) f.elements.qty.value = 1; };
  f.elements.spleis.onchange = syncQty; syncQty();
  $('[data-close]', f).onclick = () => dlg.close();
  f.onsubmit = async (e) => {
    e.preventDefault();
    const body = formData(f); const id = body.id; delete body.id; body.spleis = f.elements.spleis.checked;
    try {
      await api(id ? `/api/registry-items/${id}` : `/api/registries/${regId}/items`, { method: id ? 'PUT' : 'POST', body });
      dlg.close(); toast(id ? 'Lagret' : 'Gaven er lagt til 🎁'); views.weddingAdmin(regId);
    } catch (err) { formError(f, err.message); }
  };
  bindLinkFetch(f);
  dlg.showModal(); (it ? f.elements.title : f.elements.url).focus();
}

// ---------- Ønskelisten slik gjestene ser den (ingen innlogging nødvendig) ----------
function guestStore(tok) { try { return JSON.parse(localStorage.getItem(`rg-${tok}`) || '[]'); } catch { return []; } }
function setGuestStore(tok, list) { try { localStorage.setItem(`rg-${tok}`, JSON.stringify(list)); } catch {} }
function guestInfo() { try { return JSON.parse(localStorage.getItem('guest') || 'null'); } catch { return null; } }
views.weddingPublic = async (tok) => {
  const cancel = routeQuery.get('angre');
  if (cancel) return weddingCancel(tok, cancel);
  let d;
  try { d = await api(`/api/r/${encodeURIComponent(tok)}`, { allow401: true }); }
  catch (e) { app.innerHTML = `<section class="card" style="max-width:520px;margin:2rem auto"><div class="empty"><div class="big">🎁</div>${esc(e.message)}</div></section>`; return; }
  const g = d.registry;
  const local = guestStore(tok);
  const mineFor = (i) => [...i.mine.map((m) => ({ qty: m.qty, amount: m.amount, cancelToken: m.cancel_token })), ...local.filter((m) => m.itemId === i.id)];
  app.innerHTML = `
    ${me ? '' : '<div class="guest-top"><a href="#/registrer" class="brand">🎁 Gaveplanlegger</a><a href="#/registrer" class="small">Lag din egen ønskeliste – gratis</a></div>'}
    <section class="wedding-hero">
      <div class="rings">${ev(g.kind).icon}</div>
      <h1>${esc(g.title)}</h1>
      <p class="wdate">${fmtDate(g.eventDate)}${g.daysLeft > 0 ? ` · om ${g.daysLeft} dager` : ''}</p>
      ${g.message ? `<p class="wmsg">${esc(g.message)}</p>` : ''}
    </section>
    ${d.isCouple ? '<div class="invite-banner">👀 Dette er slik gjestene ser listen. Dere ser ikke hva som er reservert. Det er en overraskelse!</div>' : ''}
    <section class="card wish-list" style="margin-top:1rem">
      ${d.items.length ? d.items.map((i) => {
        const mine = mineFor(i);
        const myQty = mine.reduce((a, m) => a + (m.qty || 0), 0), myAmount = mine.reduce((a, m) => a + (m.amount || 0), 0);
        const pct = i.spleis && i.target ? Math.min(100, Math.round(((i.raised || 0) / i.target) * 100)) : 0;
        return `<div class="wish ${i.full && !mine.length ? 'claimed-other' : ''}">
          <div class="wish-icon">${mine.length ? '🤫' : i.full ? '✅' : i.spleis ? '🤝' : i.priority === 1 ? '★' : '🎁'}</div>
          <div class="wish-main"><div class="wish-title">${esc(i.title)}</div>
            <div class="wish-meta">${[i.price && esc(i.price) + (i.qty > 1 ? ' per stk' : ''), i.priority === 1 && '<span class="badge gold">Ønsker seg mest</span>',
              !d.isCouple && !i.spleis && i.qty > 1 && `<span class="badge">${i.remaining} av ${i.qty} igjen</span>`,
              !d.isCouple && i.full && !mine.length && '<span class="badge">Allerede tatt</span>',
              mine.length && `<span class="badge green">Du har ${myAmount ? `bidratt med ${kr(myAmount)}` : `reservert${myQty > 1 ? ` ${myQty} stk` : ''}`}</span>`,
              i.url && `<a href="${esc(i.url)}" target="_blank" rel="noopener noreferrer">Se gaven ↗</a>`].filter(Boolean).join(' · ')}</div>
            ${i.note ? `<div class="wish-meta">${esc(i.note)}</div>` : ''}
            ${i.spleis && !d.isCouple ? `<div class="spleis"><div class="progress" style="max-width:none;margin:.4rem 0 .2rem"><span style="width:${pct}%"></span></div>
              <span class="small muted">${kr(i.raised)} av ${kr(i.target)} · ${i.givers} ${i.givers === 1 ? 'bidrag' : 'bidrag'}</span></div>` : ''}
          </div>
          <div class="wish-actions">
            ${d.isCouple ? '' : i.full ? '' : i.spleis
              ? `<div class="row" style="flex-wrap:nowrap;gap:.3rem"><input type="number" min="50" step="50" placeholder="kr" class="amount" data-amount-for="${i.id}" aria-label="Beløp" style="width:90px;padding:.4rem .5rem">
                 <button class="btn small" data-rclaim="${i.id}">Bidra</button></div>`
              : `${i.remaining > 1 ? `<select data-qty-for="${i.id}" aria-label="Antall" style="width:auto;padding:.35rem .5rem">${Array.from({ length: i.remaining }, (_, n) => `<option>${n + 1}</option>`).join('')}</select>` : ''}
                 <button class="btn small" data-rclaim="${i.id}">${mine.length ? 'Reserver flere' : 'Jeg kjøper denne'}</button>`}
            ${mine.filter((m) => m.cancelToken).map((m) => `<button class="btn ghost small" data-rcancel="${m.cancelToken}">Angre${m.amount ? ` ${kr(m.amount)}` : m.qty > 1 ? ` ${m.qty} stk` : ''}</button>`).join('')}
          </div></div>`;
      }).join('') : '<div class="empty"><div class="big">📝</div>Det er ikke lagt inn gaver ennå.</div>'}
    </section>
    <p class="muted small center">${esc(g.couple.join(' og '))} ser ikke hvem som har reservert hva før ${ev(g.kind).after}.</p>
    <div style="margin-top:1rem">${adSlot('onskeliste')}</div>
    <dialog id="guest-dlg"><form id="guest-form" novalidate>
      <h2>Hvem er gaven fra?</h2>
      <p class="muted small" style="margin-top:0">${esc(g.couple.join(' og '))} ser navnet ${ev(g.kind).after}, så de vet hvem de skal takke. Du trenger ikke konto.</p>
      <div class="field"><label for="gu-name">Navn</label><input id="gu-name" name="name" maxlength="100" autocomplete="name" placeholder="F.eks. Tante Olga og onkel Per"></div>
      <div class="field"><label for="gu-email">E-post <span class="hint">(valgfritt – du får en kvittering med lenke for å angre)</span></label><input id="gu-email" name="email" type="email" autocomplete="email"></div>
      <div class="row" style="justify-content:flex-end"><button type="button" class="btn secondary" data-close>Avbryt</button><button class="btn">Reserver</button></div>
      <p class="small center" style="margin-bottom:0">Har du konto? <a href="#/logg-inn" id="guest-login">Logg inn</a></p>
    </form></dialog>`;
  const refresh = () => views.weddingPublic(tok);
  const doClaim = async (itemId, extra) => {
    const it = d.items.find((x) => x.id === itemId);
    const body = { itemId, qty: Number($(`[data-qty-for="${itemId}"]`)?.value || 1), amount: Number($(`[data-amount-for="${itemId}"]`)?.value || 0), ...extra };
    if (it.spleis && !(body.amount >= 50)) return toast('Skriv inn et beløp på minst 50 kr.');
    try {
      const r = await api(`/api/r/${encodeURIComponent(tok)}/claim`, { method: 'POST', body, allow401: true });
      if (!me) setGuestStore(tok, [...guestStore(tok), { itemId, title: it.title, qty: r.qty, amount: r.amount, cancelToken: r.cancelToken }]);
      toast(r.amount ? `Takk for bidraget på ${kr(r.amount)}! 🎉` : `Reservert! Det er hemmelig til ${ev(g.kind).after.replace('etter ', '')} er over 🤫`);
      refresh();
    } catch (e) { toast(e.message); refresh(); }
  };
  $$('[data-rclaim]').forEach((b) => b.onclick = () => {
    const itemId = Number(b.dataset.rclaim);
    const it = d.items.find((x) => x.id === itemId);
    if (it.spleis && !(Number($(`[data-amount-for="${itemId}"]`)?.value) >= 50)) { $(`[data-amount-for="${itemId}"]`)?.focus(); return toast('Skriv inn et beløp på minst 50 kr.'); }
    if (me) return doClaim(itemId, {});
    const dlg = $('#guest-dlg'), f = $('#guest-form'); const gi = guestInfo();
    if (gi) { f.elements.name.value = gi.name || ''; f.elements.email.value = gi.email || ''; }
    $('[data-close]', f).onclick = () => dlg.close();
    $('#guest-login').onclick = () => { sessionStorage.setItem('after-login', location.hash); };
    f.onsubmit = (e) => {
      e.preventDefault();
      const body = formData(f);
      if (!body.name.trim()) return formError(f, 'Skriv navnet ditt.');
      try { localStorage.setItem('guest', JSON.stringify(body)); } catch {}
      dlg.close(); doClaim(itemId, body);
    };
    dlg.showModal(); f.elements.name.focus();
  });
  $$('[data-rcancel]').forEach((b) => b.onclick = async () => {
    if (!confirm('Angre reservasjonen?')) return;
    try { await api(`/api/r/${encodeURIComponent(tok)}/claim/${b.dataset.rcancel}`, { method: 'DELETE', body: {}, allow401: true }); toast('Reservasjonen er angret'); }
    catch (e) { toast(e.message); }
    setGuestStore(tok, guestStore(tok).filter((m) => m.cancelToken !== b.dataset.rcancel));
    refresh();
  });
};
async function weddingCancel(tok, cancel) {
  let c;
  try { c = await api(`/api/r/${encodeURIComponent(tok)}/claim/${encodeURIComponent(cancel)}`, { allow401: true }); }
  catch (e) { app.innerHTML = `<section class="card" style="max-width:520px;margin:2rem auto"><div class="empty"><div class="big">🎁</div>${esc(e.message)}<br><a href="#/onskeliste/${esc(tok)}">Til ønskelisten</a></div></section>`; return; }
  app.innerHTML = `<section class="card" style="max-width:520px;margin:2rem auto;text-align:center">
    <h2>Angre reservasjon?</h2>
    <p>Du har ${c.amount ? `bidratt med <b>${kr(c.amount)}</b> til` : `reservert${c.qty > 1 ? ` <b>${c.qty} stk</b> av` : ''}`} <b>${esc(c.title)}</b>.</p>
    <div class="row" style="justify-content:center"><a class="btn secondary" href="#/onskeliste/${esc(tok)}">Nei, behold</a><button class="btn" id="do-cancel">Ja, angre</button></div>
  </section>`;
  $('#do-cancel').onclick = async () => {
    try { await api(`/api/r/${encodeURIComponent(tok)}/claim/${encodeURIComponent(cancel)}`, { method: 'DELETE', body: {}, allow401: true }); toast('Reservasjonen er angret'); }
    catch (e) { toast(e.message); }
    setGuestStore(tok, guestStore(tok).filter((m) => m.cancelToken !== cancel));
    location.hash = `#/onskeliste/${tok}`;
  };
}

// ---------- Kontakt oss, tilbakemelding, personvern og admin ----------
const FB_KINDS = [['feil', '🐞 Feil'], ['forbedring', '💡 Forbedring'], ['sporsmal', '❓ Spørsmål']];
function feedbackFields(defaultKind = 'feil', withKontakt = false) {
  const kinds = withKontakt ? [['kontakt', '✉️ Henvendelse'], ...FB_KINDS] : FB_KINDS;
  return `<div class="field"><label>Hva gjelder det?</label><div class="segmented">${kinds.map(([v, l]) =>
      `<label><input type="radio" name="kind" value="${v}" ${v === defaultKind ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></div>
    <div class="field"><label for="fb-msg-${withKontakt ? 'k' : 'q'}">Melding</label><textarea id="fb-msg-${withKontakt ? 'k' : 'q'}" name="message" maxlength="4000" rows="5"
      placeholder="Beskriv gjerne hva du gjorde, hva du forventet, og hva som skjedde."></textarea></div>
    ${me ? '' : `<div class="grid grid-2" style="gap:.8rem">
      <div class="field"><label>Navn <span class="hint">(valgfritt)</span></label><input name="name" maxlength="100" autocomplete="name"></div>
      <div class="field"><label>E-post <span class="hint">– hvis du vil ha svar</span></label><input name="email" type="email" autocomplete="email"></div></div>`}
    <input name="website" tabindex="-1" autocomplete="off" class="hp" aria-hidden="true">`;
}
async function sendFeedback(form) {
  const body = formData(form);
  body.page = location.hash || '#/';
  await api('/api/feedback', { method: 'POST', body, allow401: true });
}
// Flytende knapp nederst til høyre – alltid tilgjengelig
function mountFeedbackButton() {
  if ($('#fb-btn')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <button id="fb-btn" class="fb-btn" aria-label="Gi tilbakemelding">💬 <span>Tilbakemelding</span></button>
    <dialog id="fb-dlg"><form id="fb-form" novalidate>
      <h2>Fant du en feil, eller har du en idé?</h2>
      <p class="muted small" style="margin-top:0">Vi leser alt. Siden du er på nå, sendes med automatisk.</p>
      <div id="fb-fields"></div>
      <div class="row" style="justify-content:flex-end"><button type="button" class="btn secondary" data-close>Avbryt</button><button class="btn">Send</button></div>
    </form></dialog>`);
  $('#fb-btn').onclick = () => {
    const dlg = $('#fb-dlg'), f = $('#fb-form');
    $('#fb-fields').innerHTML = feedbackFields('feil');
    formError(f, '');
    $('[data-close]', f).onclick = () => dlg.close();
    f.onsubmit = async (e) => {
      e.preventDefault();
      try { await sendFeedback(f); dlg.close(); toast('Takk! Meldingen er sendt 🙏'); } catch (err) { formError(f, err.message); }
    };
    dlg.showModal(); f.elements.message.focus();
  };
}
function publicTop() { return me ? '' : '<div class="guest-top"><a href="#/logg-inn" class="brand">🎁 Gaveplanlegger</a><a href="#/registrer" class="small">Lag din egen ønskeliste – gratis</a></div>'; }
const fill = (v, what) => v ? esc(v) : `<mark class="todo">[${what}]</mark>`;
views.contact = async () => {
  const s = site;
  app.innerHTML = `${publicTop()}
    <h1>Kontakt oss</h1>
    <div class="grid" style="grid-template-columns: minmax(0,2fr) minmax(240px,1fr); align-items:start" id="k-grid">
      <section class="card">
        <form id="k-form" novalidate>
          ${feedbackFields('kontakt', true)}
          <button class="btn">Send melding</button>
        </form>
      </section>
      <aside class="card"><h2>${esc(s.name)}</h2>
        <p class="small" style="margin:0">${[fill(s.owner, 'navn på eier'), s.orgnr && `Org.nr. ${esc(s.orgnr)}`, s.address && esc(s.address),
          s.email ? `<a href="mailto:${esc(s.email)}">${esc(s.email)}</a>` : fill('', 'e-post')].filter(Boolean).join('<br>')}</p>
        <p class="small muted">Vi svarer vanligvis innen et par dager. Fant du en feil? Bruk knappen «Tilbakemelding» nederst til høyre på alle sider, så får vi vite hvilken side det gjelder.</p>
        <p class="small"><a href="#/personvern">Personvernerklæring</a></p></aside>
    </div>`;
  if (matchMedia('(max-width: 760px)').matches) $('#k-grid').style.gridTemplateColumns = '1fr';
  $('#k-form').onsubmit = async (e) => {
    e.preventDefault(); formError(e.target, '');
    try { await sendFeedback(e.target); e.target.reset(); toast('Takk! Vi har mottatt meldingen din.'); }
    catch (err) { formError(e.target, err.message); }
  };
};
views.privacy = async () => {
  const s = site;
  app.innerHTML = `${publicTop()}
    <article class="card prose" style="max-width:760px;margin:0 auto">
      <h1>Personvernerklæring</h1>
      <p class="muted small">Sist oppdatert: ${fill(s.updated, 'dato')}</p>
      ${s.beta?.enabled ? '<p class="small">Tjenesten er i testversjon. Opplysningene dine behandles likevel etter denne erklæringen.</p>' : ''}
      ${!s.owner ? '<p class="todo-box">Utkast: Feltene merket med gult fylles ut i config.json under «owner» før lansering. Les gjennom teksten og tilpass den.</p>' : ''}
      <h2>Hvem er ansvarlig?</h2>
      <p>${fill(s.owner, 'navn på eier / foretak')}${s.orgnr ? `, org.nr. ${esc(s.orgnr)}` : ''}, er behandlingsansvarlig for personopplysningene i ${esc(s.name)}. Kontakt: ${s.email ? `<a href="mailto:${esc(s.email)}">${esc(s.email)}</a>` : fill('', 'e-post')}.</p>
      <h2>Hvilke opplysninger lagrer vi, og hvorfor?</h2>
      <ul>
        <li><b>Konto:</b> navn, e-post og kryptert passord. Valgfritt: fødselsdato, kjønn, mobilnummer, postnummer og brukernavn. Venner kan finne deg på e-post, mobilnummer og brukernavn, og på navn hvis du tillater det (kan slås av under Min profil). Postnummeret vises ikke for andre; det brukes bare til å søke opp butikker nær deg i Google Maps når du selv trykker på «I nærheten». For å gi deg en konto, vise bursdagen din til vennene dine (hvis du har lagt den inn) og sende varsler.</li>
        <li><b>Innhold du lager:</b> ønsker, lister, personer og gaveideer i planleggeren, ønskelister for anledninger og reservasjoner. For å levere tjenesten.</li>
        <li><b>Venner:</b> hvem du er venn med. Venner ser navnet ditt, bursdagen din og ønskelisten din.</li>
        <li><b>Gjester uten konto på ønskelister:</b> navn og eventuelt e-post når du reserverer. De som eier listen, ser navnet etter dagen.</li>
        <li><b>Tilbakemeldinger:</b> meldingen, eventuelt navn og e-post, siden du var på og nettlesertype. For å rette feil og svare deg.</li>
      </ul>
      <p>Behandlingsgrunnlaget er avtalen med deg (personvernforordningen art. 6 nr. 1 b) og, for annonser, samtykke (art. 6 nr. 1 a).</p>
      <h2>Informasjonskapsler (cookies) og annonser</h2>
      <p>Vi bruker én nødvendig informasjonskapsel for å holde deg innlogget. Tjenesten finansieres av annonser fra Google AdSense. Google kan bruke informasjonskapsler for å vise og måle annonser, og for personlig tilpassede annonser bare hvis du samtykker. Du kan endre samtykket når som helst.</p>
      <h2>Hvem behandler opplysningene for oss?</h2>
      <ul>
        <li><b>Render</b> (drift av servere, datasenter i Frankfurt, Tyskland).</li>
        <li><b>Resend</b> (utsending av e-post).</li>
        <li><b>Google</b> (annonser, se over).</li>
      </ul>
      <p>Vi har databehandleravtaler med leverandørene. Noen av dem er amerikanske selskaper. Overføring skjer etter EUs standardavtaler eller EU–USA-rammeverket for personvern.</p>
      <h2>Hvor lenge lagrer vi opplysningene?</h2>
      <p>Så lenge du har konto. Sletter du kontoen under «Min profil», slettes konto, ønsker, lister og reservasjoner med en gang. Sikkerhetskopier slettes etter ${s.backupDays ? s.backupDays : fill('', 'antall')} dager.</p>
      <h2>Dine rettigheter</h2>
      <p>Du kan be om innsyn, retting, sletting og å få utlevert opplysningene dine. Ta kontakt på ${s.email ? `<a href="mailto:${esc(s.email)}">${esc(s.email)}</a>` : fill('', 'e-post')}. Mener du at vi bryter reglene, kan du klage til <a href="https://www.datatilsynet.no" target="_blank" rel="noopener">Datatilsynet</a>.</p>
    </article>`;
};
views.admin = async () => {
  if (!me?.isAdmin) { location.hash = '#/'; return; }
  const filter = routeQuery.get('status') || '';
  const [{ feedback, kinds }, stats] = await Promise.all([api(`/api/admin/feedback${filter ? `?status=${filter}` : ''}`), api('/api/admin/stats')]);
  app.innerHTML = `
    <div class="row spread"><h1 style="margin:0">Admin</h1>
      <a class="btn secondary small" href="/api/admin/backup" download>⬇️ Last ned sikkerhetskopi</a></div>
    <p class="muted small">Ta en kopi jevnlig og lagre den et trygt sted, f.eks. en kryptert mappe. Filen inneholder alle brukernes data.</p>
    <div class="grid grid-4" style="margin-bottom:1rem">
      <div class="card stat"><b>${stats.users}</b>brukere (${stats.newUsersLast30} siste 30 d.)</div>
      <div class="card stat"><b>${stats.wishes}</b>ønsker</div>
      <div class="card stat"><b>${stats.giftLists}</b>lister i planleggeren</div>
      <div class="card stat"><b>${stats.registries}</b>ønskelister (anledninger)</div>
    </div>
    <section class="card" style="margin-bottom:1rem">
      <div class="row spread"><h2 style="margin:0">E-post</h2><button class="btn secondary small" id="test-email">Send test-e-post til meg</button></div>
      <p class="muted small" style="margin:.4rem 0 0">Sjekker at glemt passord, bursdagsvarsler og kvitteringer kan sendes. E-posten går til ${esc(me.email)}.</p>
      <div id="test-email-out"></div>
    </section>
    <section class="card" style="margin-bottom:1rem">
      <h2>Hjelp en bruker inn igjen</h2>
      <p class="muted small" style="margin-top:0">Har noen glemt passordet og ikke fått e-post? Lag en lenke for nytt passord (virker i 24 timer) og send den selv på SMS eller e-post.</p>
      <form id="reset-form" class="row" style="flex-wrap:nowrap" novalidate><input name="email" type="email" placeholder="Brukerens e-post"><button class="btn">Lag lenke</button></form>
      <div id="reset-out"></div>
    </section>
    <section class="card wish-list">
      <div class="jul-toolbar"><h2 style="margin:0">Tilbakemeldinger (${stats.feedbackNew} nye)</h2>
        <div class="row" style="gap:.3rem">${[['', 'Alle'], ['ny', 'Nye'], ['behandlet', 'Behandlet']].map(([v, l]) =>
          `<a class="btn ${filter === v ? '' : 'ghost'} small" href="#/admin${v ? `?status=${v}` : ''}">${l}</a>`).join('')}</div></div>
      ${feedback.length ? feedback.map((f) => `<div class="wish ${f.status === 'behandlet' ? 'received' : ''}">
        <div class="wish-icon">${(kinds[f.kind] || '✉️').split(' ')[0]}</div>
        <div class="wish-main">
          <div class="wish-meta"><b>${esc(kinds[f.kind] || f.kind)}</b> #${f.id} · ${esc(new Date(f.created_at + 'Z').toLocaleString('nb-NO', { dateStyle: 'medium', timeStyle: 'short' }))}
            · ${esc(f.name || 'anonym')}${f.email ? ` &lt;${esc(f.email)}&gt;` : ''}${f.page ? ` · side <code>${esc(f.page)}</code>` : ''}</div>
          <div class="fb-msg">${esc(f.message)}</div>
          <div class="wish-meta small">${esc(f.user_agent || '')}</div>
        </div>
        <div class="wish-actions">
          ${f.email ? `<a class="btn small secondary" href="mailto:${esc(f.email)}?subject=${encodeURIComponent(`Sv: ${kinds[f.kind] || 'Henvendelse'} #${f.id}`)}&body=${encodeURIComponent(`\n\n> ${f.message.split('\n').join('\n> ')}`)}">Svar</a>` : ''}
          <button class="btn ghost small" data-fb="${f.id}" data-st="${f.status === 'ny' ? 'behandlet' : 'ny'}">${f.status === 'ny' ? '✓ Behandlet' : 'Gjenåpne'}</button>
        </div></div>`).join('') : '<div class="empty">Ingen tilbakemeldinger her.</div>'}
    </section>`;
  $('#test-email').onclick = async (e) => {
    e.target.disabled = true; $('#test-email-out').innerHTML = '<p class="small muted">⏳ Sender …</p>';
    try {
      const r = await api('/api/admin/test-email', { method: 'POST', body: {} });
      $('#test-email-out').innerHTML = r.ok
        ? `<div class="invite-banner" style="margin-top:.8rem;background:var(--green-soft);border-color:#bfe0cb">✅ Sendt til <b>${esc(r.to)}</b> via ${esc(r.via)}. Sjekk innboksen (og søppelpost).</div>`
        : `<div class="error" style="margin-top:.8rem">❌ ${esc(r.error)}</div>`;
    } catch (err) { $('#test-email-out').innerHTML = `<div class="error" style="margin-top:.8rem">❌ ${esc(err.message)}</div>`; }
    e.target.disabled = false;
  };
  $('#reset-form').onsubmit = async (e) => {
    e.preventDefault(); formError(e.target, '');
    try {
      const r = await api('/api/admin/reset-link', { method: 'POST', body: formData(e.target) });
      const text = `Hei ${r.name.split(' ')[0]}! Her er lenken for å lage nytt passord på ${site.name}. Den virker i ${r.hours} timer: ${r.link}`;
      $('#reset-out').innerHTML = `<div class="invite-banner" style="margin-top:.8rem">Lenke for <b>${esc(r.name)}</b>:
        <div class="share-link" style="margin-top:.4rem"><input readonly value="${esc(r.link)}" id="reset-link"><button class="btn small" id="copy-reset">Kopier</button></div>
        <div class="row" style="margin-top:.5rem"><a class="btn small secondary" href="sms:${esc(r.phone)}?&body=${encodeURIComponent(text)}">💬 Send på SMS</a>
        <a class="btn small secondary" href="mailto:${esc(e.target.elements.email.value)}?subject=${encodeURIComponent('Nytt passord')}&body=${encodeURIComponent(text)}">✉️ Send på e-post</a></div>
        <p class="small muted" style="margin:.4rem 0 0">Send lenken bare til personen selv – den gir tilgang til kontoen.</p></div>`;
      $('#copy-reset').onclick = async () => { try { await navigator.clipboard.writeText(r.link); } catch { $('#reset-link').select(); document.execCommand('copy'); } toast('Lenken er kopiert'); };
    } catch (err) { formError(e.target, err.message); }
  };
  $$('[data-fb]').forEach((b) => b.onclick = async () => {
    await api(`/api/admin/feedback/${b.dataset.fb}`, { method: 'PUT', body: { status: b.dataset.st } }); await refreshMe(); views.admin();
  });
};

// ---------- Profil ----------
views.profile = async () => {
  app.innerHTML = `
    <h1>Min profil</h1>
    <div class="grid grid-2" style="align-items:start">
      <section class="card"><h2>Opplysninger</h2>
        <form id="p" novalidate>
          <div class="field"><label for="p-name">Navn</label><input id="p-name" name="name" value="${esc(me.name)}"></div>
          <div class="field"><label>E-post</label><input value="${esc(me.email)}" disabled></div>
          <div class="field"><label for="p-bd">Fødselsdato <span class="hint">(valgfritt – vennene dine får varsel før bursdagen din)</span></label><input id="p-bd" name="birthdate" type="date" value="${esc(me.birthdate || '')}"></div>
          <div class="field"><label for="p-g">Kjønn <span class="hint">(valgfritt)</span></label><select id="p-g" name="gender">
            ${[['', 'Ikke oppgitt'], ['kvinne', 'Kvinne'], ['mann', 'Mann'], ['annet', 'Annet']].map(([v, l]) => `<option value="${v}" ${(me.gender && me.gender !== 'ikke_oppgitt' ? me.gender : '') === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select></div>
          <div class="field"><label for="p-user">Brukernavn <span class="hint">(valgfritt – vises for vennene dine, og de kan søke deg opp på det)</span></label>
            <input id="p-user" name="username" value="${esc(me.username)}" placeholder="f.eks. jorn72" maxlength="30" autocapitalize="off"></div>
          <div class="field"><label for="p-phone">Mobil <span class="hint">(valgfritt – venner kan finne deg på nummeret)</span></label><input id="p-phone" name="phone" type="tel" value="${esc(me.phone)}"></div>
          <div class="field"><label for="p-postnr">Postnummer <span class="hint">(valgfritt – gir deg «Finn i nærheten» på ønskene til vennene dine)</span></label>
            <input id="p-postnr" name="postnr" inputmode="numeric" maxlength="4" autocomplete="postal-code" value="${esc(me.postnr)}" style="max-width:8rem"></div>
          <div class="field"><label class="check"><input type="checkbox" name="searchable" ${me.searchable ? 'checked' : ''}>
            <span>Andre kan finne meg ved å søke på navnet mitt (på e-post, mobil og brukernavn kan du alltid finnes)</span></label></div>
          <div class="field"><label class="check"><input type="checkbox" name="emailReminders" ${me.emailReminders ? 'checked' : ''}>
            <span>Send meg e-post når venner nærmer seg bursdag (14, 7 og 1 dag før)</span></label></div>
          <h3 style="margin-top:1.2rem">Bytt passord</h3>
          <div class="field"><label for="p-cur">Nåværende passord</label><input id="p-cur" name="currentPassword" type="password" autocomplete="current-password"></div>
          <div class="field"><label for="p-new">Nytt passord</label><input id="p-new" name="newPassword" type="password" autocomplete="new-password"></div>
          <button class="btn">Lagre endringer</button>
        </form></section>
      <div class="stack">
        <section class="card share-box">${shareBlock()}
          <p class="small muted" style="margin-top:1rem">Har lenken kommet på avveie? Lag en ny – den gamle slutter da å virke.</p>
          <button class="btn secondary small" id="new-link">Lag ny delingslenke</button></section>
        <section class="card"><h2>Konto</h2>
          <div class="row"><button class="btn secondary" id="logout">Logg ut</button><button class="btn ghost" id="delete">Slett kontoen min</button></div></section>
      </div>
    </div>`;
  bindShare();
  $('#p').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = formData(e.target); body.emailReminders = !!body.emailReminders; body.searchable = !!body.searchable;
    try { const r = await api('/api/me', { method: 'PUT', body }); me = r.user; toast('Lagret'); views.profile(); $('#avatar').textContent = initials(me.name); }
    catch (err) { formError(e.target, err.message); }
  });
  $('#new-link').onclick = async () => { if (!confirm('Lage ny lenke? Den gamle slutter å virke.')) return; me = (await api('/api/me/new-share-link', { method: 'POST', body: {} })).user; toast('Ny lenke laget'); views.profile(); };
  $('#logout').onclick = async () => { await api('/api/logout', { method: 'POST', body: {} }); me = null; showTopbar(false); location.hash = '#/logg-inn'; };
  $('#delete').onclick = async () => {
    const pw = prompt('Dette sletter kontoen, ønskelisten og alle reservasjonene dine for godt. Skriv passordet ditt for å bekrefte:');
    if (!pw) return;
    try { await api('/api/me', { method: 'DELETE', body: { password: pw } }); me = null; showTopbar(false); location.hash = '#/logg-inn'; toast('Kontoen er slettet'); }
    catch (err) { toast(err.message); }
  };
};

mountFeedbackButton();
router();
