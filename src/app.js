import { drawNames } from './draw.js';
import { packPublic, unpackPublic, seal, unseal, newKey, writeSecret } from './links.js';
import { local, shared } from './store.js';

const APP = 'Sprig';
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const view = () => $('#view');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
const baseUrl = () => location.origin + location.pathname;

// ---------- formatting ----------
function money(ev) {
  const c = ev.currency || '$';
  const f = (n) => `${c}${Number(n).toLocaleString()}`;
  if (ev.min && ev.max) return `${f(ev.min)}–${f(ev.max)}`;
  if (ev.max) return `Up to ${f(ev.max)}`;
  if (ev.min) return `At least ${f(ev.min)}`;
  return 'No budget set';
}
function niceDate(d) {
  if (!d) return 'Date not set';
  const dt = new Date(d + 'T12:00:00');
  return dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}
function daysUntil(d) {
  if (!d) return '';
  const ms = new Date(d + 'T12:00:00') - new Date(new Date().toDateString() + ' 12:00');
  const n = Math.round(ms / 86400000);
  if (n > 1) return `${n} days to go`;
  if (n === 1) return 'Tomorrow';
  if (n === 0) return 'Today!';
  return 'Past';
}
function linkify(text) {
  return esc(text).replace(/(https?:\/\/[^\s<]+)/g, (u) => {
    let host = u;
    try { host = new URL(u.replace(/&amp;/g, '&')).hostname.replace(/^www\./, ''); } catch {}
    return `<a href="${u}" target="_blank" rel="noopener noreferrer">${esc(host)} ↗</a>`;
  });
}
const initials = (n) => n.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const hue = (s) => [...s].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
const avatar = (name, size = '') => `<span class="avatar ${size}" style="--h:${hue(name)}">${esc(initials(name))}</span>`;

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 2200);
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  toast('Link copied');
}
function header(title, back = '#/') {
  return `<header class="bar"><a class="back" href="${back}" aria-label="Back">‹</a><span class="bar-title">${esc(title)}</span><span></span></header>`;
}

// ---------- routing ----------
async function route() {
  const hash = location.hash.slice(1) || '/';
  const [, page, arg] = hash.split('/');
  window.scrollTo(0, 0);
  try {
    if (!page) return renderHome();
    if (page === 'new') return renderEditor(null, arg);
    if (page === 'edit') return renderEditor(local.getEvent(arg));
    if (page === 'e') return renderEvent(arg);
    if (page === 'me') return await renderMe(arg);
    if (page === 'wish') return await renderWishLink(arg);
    if (page === 'board') return await renderBoard(arg);
    renderHome();
  } catch (err) {
    console.error(err);
    view().innerHTML = `${header(APP)}<main class="wrap"><div class="card center"><h2>That link didn't open</h2><p class="muted">It may be cut off. Ask the organizer to send it again.</p><a class="btn" href="#/">Go home</a></div></main>`;
  }
}
window.addEventListener('hashchange', route);

// ---------- home ----------
function renderHome() {
  const events = local.events();
  const joined = Object.entries(local.joined());
  view().innerHTML = `
  <main class="wrap home">
    <section class="hero">
      <div class="logo" aria-hidden="true">${sprigMark()}</div>
      <h1>${APP}</h1>
      <p class="lede">Draw names for a gift exchange. Everyone gets a private link. No app, no sign-up.</p>
      <a class="btn big" href="#/new" id="start">Start a gift exchange</a>
    </section>
    ${joined.length ? `<section><h2 class="section">Exchanges you're in</h2>
      ${joined.map(([eid, j]) => `<a class="row card link" href="#/me/${j.token}">
        ${avatar(j.me)}<span class="grow"><b>${esc(j.evName)}</b><small>As ${esc(j.me)} · ${esc(niceDate(j.date))} · tap to see who you drew</small></span><span class="chev">›</span></a>`).join('')}
    </section>` : ''}
    ${events.length ? `<section><h2 class="section">Exchanges you organize</h2>
      ${events.map((e) => `<a class="row card link" href="#/e/${e.id}">
        <span class="ev-dot">${e.pairs ? '✓' : e.people.length}</span><span class="grow"><b>${esc(e.name)}</b><small>${e.people.length} people · ${esc(niceDate(e.date))} · ${e.pairs ? 'Names drawn' : 'Not drawn yet'}</small></span><span class="chev">›</span></a>`).join('')}
    </section>` : ''}
    <section class="how">
      <h2 class="section">How it works</h2>
      <ol class="steps">
        <li><b>Set it up.</b> Name, date, and a budget range.</li>
        <li><b>Add people.</b> Mark couples who shouldn't draw each other.</li>
        <li><b>Draw.</b> Send each person their own private link.</li>
        <li><b>Wish lists.</b> Everyone adds ideas so their Santa knows what to get.</li>
      </ol>
    </section>
    <footer class="foot">Your events are saved on this device. <a href="#" id="backup">Back up</a> · <label class="linkish">Restore<input type="file" id="restore" accept="application/json" hidden></label></footer>
  </main>`;
  $('#backup').onclick = (e) => {
    e.preventDefault();
    const blob = new Blob([JSON.stringify({ app: 'sprig', events: local.events(), joined: local.joined() }, null, 1)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'sprig-backup.json' });
    a.click();
  };
  $('#restore').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const data = JSON.parse(await f.text());
    for (const ev of data.events || []) local.putEvent(ev);
    for (const [k, v] of Object.entries(data.joined || {})) local.putJoined(k, v);
    toast('Restored'); renderHome();
  };
}

function sprigMark() {
  return `<svg viewBox="0 0 64 64" width="64" height="64"><circle cx="32" cy="32" r="31" fill="var(--pine)"/>
  <path d="M32 50V20" stroke="var(--cream)" stroke-width="3" stroke-linecap="round"/>
  <path d="M32 30c-7-1-11-6-12-12 7 0 11 4 12 12zM32 38c7-1 11-6 12-12-7 0-11 4-12 12zM32 24c4-1 7-4 7-9-4 1-7 4-7 9z" fill="var(--cream)"/>
  <circle cx="26" cy="44" r="4" fill="var(--berry)"/><circle cx="33" cy="47" r="4" fill="var(--berry)"/><circle cx="28" cy="51" r="3.4" fill="var(--berry-d)"/></svg>`;
}

// ---------- create / edit ----------
function nextYear(d) {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  return `${Number(y) + 1}-${m}-${day}`;
}
function renderEditor(ev, fromId) {
  const from = fromId ? local.getEvent(fromId) : null;
  const editing = !!ev;
  const base = ev || (from ? {
    name: from.name.replace(/\b(20\d\d)\b/, (y) => String(Number(y) + 1)),
    date: nextYear(from.date), min: from.min, max: from.max, currency: from.currency, note: from.note,
  } : { currency: '$' });
  const peopleText = from ? from.people.map((p) => p.name).join('\n') : '';
  view().innerHTML = `${header(editing ? 'Edit details' : from ? 'Reuse exchange' : 'New exchange', editing ? `#/e/${ev.id}` : '#/')}
  <main class="wrap">
    ${from ? `<div class="note">Copying <b>${esc(from.name)}</b>: same people, rules${from.people.some((p) => p.items?.length) ? ' and wish lists' : ''}. Nothing is drawn yet.</div>` : ''}
    <form id="evform" class="card form" autocomplete="off">
      <label>Name<input name="name" required maxlength="60" placeholder="Family Christmas 2026" value="${esc(base.name)}"></label>
      <label>Exchange date<input name="date" type="date" value="${esc(base.date)}"></label>
      <fieldset class="budget"><legend>Budget per gift</legend>
        <select name="currency" aria-label="Currency">${['$', '€', '£', 'C$', 'A$', '¥', '₹'].map((c) => `<option ${c === base.currency ? 'selected' : ''}>${c}</option>`).join('')}</select>
        <input name="min" type="number" min="0" inputmode="numeric" placeholder="Min" value="${esc(base.min)}" aria-label="Minimum">
        <span class="dash">to</span>
        <input name="max" type="number" min="0" inputmode="numeric" placeholder="Max" value="${esc(base.max)}" aria-label="Maximum">
      </fieldset>
      <label>Note for everyone <span class="opt">optional</span><textarea name="note" rows="2" maxlength="300" placeholder="Bring gifts to Grandma's. Wrap them!">${esc(base.note)}</textarea></label>
      ${editing ? '' : `<label>Who's in? <span class="opt">one name per line</span><textarea name="people" rows="5" placeholder="Garrett&#10;Sam&#10;Alex&#10;Jordan">${esc(peopleText)}</textarea></label>`}
      ${from ? `<label class="check"><input type="checkbox" name="carry" checked> Carry over wish lists</label>
        ${from.pairs ? `<label class="check"><input type="checkbox" name="avoid" checked> Don't repeat last year's matches</label>` : ''}` : ''}
      <p class="err" id="formerr" role="alert"></p>
      <button class="btn big" type="submit">${editing ? 'Save' : 'Continue'}</button>
    </form>
  </main>`;
  $('#evform').onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const min = fd.get('min') ? Number(fd.get('min')) : null;
    const max = fd.get('max') ? Number(fd.get('max')) : null;
    if (min != null && max != null && min > max) { $('#formerr').textContent = 'The minimum is higher than the maximum.'; return; }
    const fields = { name: fd.get('name').trim(), date: fd.get('date'), min, max, currency: fd.get('currency'), note: fd.get('note').trim() };
    if (editing) {
      Object.assign(ev, fields); local.putEvent(ev); location.hash = `#/e/${ev.id}`; return;
    }
    const names = String(fd.get('people') || '').split('\n').map((s) => s.trim()).filter(Boolean);
    const carry = fd.get('carry') === 'on';
    const idMap = {};
    const people = [];
    for (const n of names) {
      if (people.some((p) => p.name.toLowerCase() === n.toLowerCase())) continue;
      const old = from?.people.find((p) => p.name.toLowerCase() === n.toLowerCase());
      const p = { id: uid(), name: n, key: newKey(), items: carry && old ? [...(old.items || [])] : [] };
      if (old) idMap[old.id] = p.id;
      people.push(p);
    }
    const map = (pairs) => (pairs || []).map(([a, b]) => [idMap[a], idMap[b]]).filter(([a, b]) => a && b);
    const newEv = {
      id: uid(), ...fields, people, createdAt: Date.now(), orgKey: newKey(),
      exclusions: from ? map(from.exclusions) : [],
      avoid: from?.pairs && fd.get('avoid') === 'on' ? map(Object.entries(from.pairs)) : [],
      from: from?.id || null, round: 0, pairs: null, tokens: {}, sent: {},
    };
    local.putEvent(newEv);
    location.hash = `#/e/${newEv.id}`;
  };
}

// ---------- organizer dashboard ----------
function inviteText(ev, p, url) {
  return `🎁 ${ev.name}: ${p.name}, your Secret Santa name is ready! Open your private link (only you can see who you got): ${url}`;
}
function shareRow(ev, p) {
  const url = `${baseUrl()}#/me/${ev.tokens[p.id]}`;
  const text = inviteText(ev, p, url);
  const u = encodeURIComponent;
  return `<li class="share-row" data-pid="${p.id}">
    <div class="row">${avatar(p.name)}<span class="grow"><b>${esc(p.name)}</b><small class="status">${ev.seen?.[p.id] ? '<span class="ok">✓ Opened</span>' : ev.sent?.[p.id] ? 'Link shared' : 'Not sent yet'}</small></span>
    <button class="btn sm" data-share="${p.id}">Send link</button></div>
    <div class="share-opts">
      <button class="chip" data-copy="${p.id}">Copy link</button>
      <a class="chip" data-mark="${p.id}" href="https://wa.me/?text=${u(text)}" target="_blank" rel="noopener">WhatsApp</a>
      <a class="chip" data-mark="${p.id}" href="sms:?&body=${u(text)}">Text</a>
      <a class="chip" data-mark="${p.id}" href="mailto:?subject=${u(`${ev.name}: your Secret Santa`)}&body=${u(text)}">Email</a>
      <a class="chip ghost" href="#/me/${ev.tokens[p.id]}" data-self="${p.id}">This is me</a>
    </div></li>`;
}
function renderEvent(id) {
  const ev = local.getEvent(id);
  if (!ev) { location.hash = '#/'; return; }
  const name = (pid) => ev.people.find((p) => p.id === pid)?.name || '?';
  const drawn = !!ev.pairs;
  view().innerHTML = `${header(ev.name)}
  <main class="wrap">
    <section class="card summary">
      <div class="sum-top"><div><h1 class="ev-name">${esc(ev.name)}</h1>
      <p class="chips"><span class="pill">📅 ${esc(niceDate(ev.date))}</span><span class="pill">🎁 ${esc(money(ev))}</span>${ev.date ? `<span class="pill soft">${daysUntil(ev.date)}</span>` : ''}</p></div>
      <a class="btn sm ghost" href="#/edit/${ev.id}">Edit</a></div>
      ${ev.note ? `<p class="muted">${esc(ev.note)}</p>` : ''}
    </section>

    ${drawn && ev.stale ? `<div class="note warn" id="stalebanner">You changed the group after drawing. <b>Redraw</b> so everyone gets a fresh, fair link.</div>` : ''}

    <section class="card" id="people">
      <h2>People <span class="count">${ev.people.length}</span></h2>
      <ul class="list">${ev.people.map((p) => `<li>
        <div class="row">${avatar(p.name)}<span class="grow"><b>${esc(p.name)}</b><small>${p.items?.length ? `${p.items.length} wish${p.items.length > 1 ? 'es' : ''}` : 'No wish list yet'}</small></span>
        <button class="icon" data-wish="${p.id}" aria-label="Wish list for ${esc(p.name)}">✎</button>
        <button class="icon danger" data-remove="${p.id}" aria-label="Remove ${esc(p.name)}">✕</button></div>
        <div class="wish-edit" id="we-${p.id}" hidden></div></li>`).join('')}</ul>
      <form id="addp" class="inline"><input name="n" placeholder="Add a name" maxlength="40" aria-label="Add a name" required><button class="btn sm">Add</button></form>
    </section>

    <section class="card" id="rules">
      <h2>Who shouldn't draw whom?</h2>
      <p class="muted small">Couples, roommates, or anyone who'd rather not get each other.</p>
      <ul class="list pairs">${ev.exclusions.map(([a, b], i) => `<li class="row"><span class="grow">${esc(name(a))} <span class="x">✕</span> ${esc(name(b))}</span><button class="icon danger" data-unex="${i}" aria-label="Remove rule">✕</button></li>`).join('') || '<li class="muted small empty">No rules yet.</li>'}</ul>
      ${ev.people.length >= 2 ? `<form id="addx" class="inline pairform">
        <select name="a" aria-label="First person">${ev.people.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
        <span class="x">✕</span>
        <select name="b" aria-label="Second person">${ev.people.map((p, i) => `<option value="${p.id}" ${i === 1 ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
        <button class="btn sm">Add</button></form>` : ''}
      ${ev.avoid?.length ? `<label class="check small"><input type="checkbox" id="avoidToggle" ${ev.avoidOff ? '' : 'checked'}> Don't repeat last year's ${ev.avoid.length} matches</label>` : ''}
    </section>

    <section class="card draw" id="draw">
      ${drawn ? `<h2>Names are drawn 🎉</h2>
        <p class="muted small">Send each person their own link. It shows only who <i>they</i> got. Nobody, including you, sees the full list.</p>
        <ul class="list shares">${ev.people.filter((p) => ev.tokens[p.id]).map((p) => shareRow(ev, p)).join('')}</ul>
        <button class="btn ghost" id="redraw">Redraw names</button>`
      : `<h2>Ready to draw?</h2>
        <p class="muted small">${ev.people.length < 3 ? 'Add at least 3 people.' : `${ev.people.length} people, ${ev.exclusions.length} rule${ev.exclusions.length === 1 ? '' : 's'}.`}</p>
        <p class="err" id="drawerr" role="alert"></p>
        <button class="btn big" id="drawbtn" ${ev.people.length < 3 ? 'disabled' : ''}>Draw names</button>`}
    </section>

    <section class="card" id="wishes">
      <h2>Wish lists</h2>
      <p class="muted small">${shared.enabled ? 'Wish lists sync automatically.' : 'People add wish lists from their own link and share them. Open a shared wish-list link on this phone to save it here.'}</p>
      <div class="btnrow"><button class="btn sm ghost" id="shareboard">Share all wish lists</button></div>
    </section>

    <section class="actions">
      <a class="btn ghost" href="#/new/${ev.id}">Reuse for next year</a>
      <button class="btn ghost danger" id="delete">Delete exchange</button>
    </section>
  </main>`;

  const save = (changedGroup) => { if (changedGroup && ev.pairs) ev.stale = true; local.putEvent(ev); renderEvent(id); };

  $('#addp').onsubmit = (e) => {
    e.preventDefault();
    const n = new FormData(e.target).get('n').trim();
    if (!n) return;
    if (ev.people.some((p) => p.name.toLowerCase() === n.toLowerCase())) { toast(`${n} is already in`); return; }
    ev.people.push({ id: uid(), name: n, key: newKey(), items: [] });
    save(true);
    $('#addp input').focus();
  };
  $$('[data-remove]').forEach((b) => b.onclick = () => {
    const pid = b.dataset.remove;
    if (!confirm(`Remove ${name(pid)}${ev.pairs ? '? You will need to redraw.' : '?'}`)) return;
    ev.people = ev.people.filter((p) => p.id !== pid);
    ev.exclusions = ev.exclusions.filter(([a, c]) => a !== pid && c !== pid);
    ev.avoid = (ev.avoid || []).filter(([a, c]) => a !== pid && c !== pid);
    delete ev.tokens[pid];
    save(true);
  });
  $$('[data-wish]').forEach((b) => b.onclick = () => {
    const pid = b.dataset.wish;
    const box = $(`#we-${pid}`);
    if (!box.hidden) { box.hidden = true; return; }
    const p = ev.people.find((x) => x.id === pid);
    box.hidden = false;
    wishEditor(box, p.items || [], (items) => {
      p.items = items; p.itemsAt = Date.now(); local.putEvent(ev);
      box.closest('li').querySelector('.grow small').textContent = items.length ? `${items.length} wish${items.length > 1 ? 'es' : ''}` : 'No wish list yet';
    }, `${p.name}'s wish list`);
  });
  $('#addx')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const a = fd.get('a'), b = fd.get('b');
    if (a === b) { toast('Pick two different people'); return; }
    if (ev.exclusions.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) { toast('That rule already exists'); return; }
    ev.exclusions.push([a, b]);
    save(true);
  });
  $$('[data-unex]').forEach((b) => b.onclick = () => { ev.exclusions.splice(Number(b.dataset.unex), 1); save(true); });
  $('#avoidToggle')?.addEventListener('change', (e) => { ev.avoidOff = !e.target.checked; save(true); });

  const doDraw = async () => {
    const res = drawNames(ev.people, { exclusions: ev.exclusions, avoid: ev.avoidOff ? [] : ev.avoid || [] });
    if (!res.ok) {
      const err = $('#drawerr');
      if (err) err.textContent = res.reason; else alert(res.reason);
      return false;
    }
    ev.pairs = res.pairs;
    ev.round = (ev.round || 0) + 1;
    ev.drawnAt = Date.now();
    ev.stale = false;
    ev.sent = {};
    ev.seen = {};
    ev.tokens = {};
    const group = ev.people.map((p) => p.name);
    for (const p of ev.people) {
      const to = ev.people.find((x) => x.id === res.pairs[p.id]);
      const payload = {
        v: 1, eid: ev.id, round: ev.round,
        ev: { name: ev.name, date: ev.date, min: ev.min, max: ev.max, currency: ev.currency, note: ev.note },
        me: { id: p.id, name: p.name, items: p.items || [] },
        to: { id: to.id, name: to.name, items: to.items || [] },
        group,
      };
      ev.tokens[p.id] = await seal(payload, p.key);
    }
    local.putEvent(ev);
    shared.setRound(ev.id, ev.round, await writeSecret(ev.orgKey)).catch(() => {});
    return true;
  };
  $('#drawbtn')?.addEventListener('click', async () => {
    if (await doDraw()) { renderEvent(id); toast('Names drawn!'); $('#draw').scrollIntoView({ behavior: 'smooth' }); }
  });
  $('#redraw')?.addEventListener('click', async () => {
    if (!confirm('Redraw names? Everyone will need their new link. Old links will show the old draw.')) return;
    if (await doDraw()) { renderEvent(id); toast('Redrawn. Send the new links.'); $('#draw').scrollIntoView(); }
  });

  const markSent = (pid) => { ev.sent[pid] = Date.now(); local.putEvent(ev); const s = $(`[data-pid="${pid}"] .status`); if (s && !ev.seen?.[pid]) s.textContent = 'Link shared'; };
  $$('[data-share]').forEach((b) => b.onclick = async () => {
    const p = ev.people.find((x) => x.id === b.dataset.share);
    const url = `${baseUrl()}#/me/${ev.tokens[p.id]}`;
    if (navigator.share) {
      try { await navigator.share({ title: `${ev.name}: Secret Santa`, text: inviteText(ev, p, '').trim(), url }); markSent(p.id); return; } catch (err) { if (err.name === 'AbortError') return; }
    }
    b.closest('.share-row').classList.toggle('open');
  });
  $$('[data-copy]').forEach((b) => b.onclick = () => { const pid = b.dataset.copy; copy(`${baseUrl()}#/me/${ev.tokens[pid]}`); markSent(pid); });
  $$('[data-mark]').forEach((a) => a.addEventListener('click', () => markSent(a.dataset.mark)));
  $$('[data-self]').forEach((a) => a.addEventListener('click', (e) => {
    if (!confirm('Only open your own link. Opening someone else\'s spoils their surprise.')) e.preventDefault();
  }));

  $('#shareboard').onclick = async () => {
    const data = { eid: ev.id, ev: ev.name, lists: ev.people.map((p) => ({ pid: p.id, name: p.name, items: p.items || [] })) };
    const url = `${baseUrl()}#/board/${await packPublic(data)}`;
    if (navigator.share) { try { await navigator.share({ title: `${ev.name} wish lists`, url }); return; } catch (err) { if (err.name === 'AbortError') return; } }
    copy(url);
  };
  $('#delete').onclick = () => { if (confirm(`Delete ${ev.name}? This can't be undone.`)) { local.deleteEvent(ev.id); location.hash = '#/'; } };

  // Live status and wish lists from the shared store.
  if (shared.enabled) {
    shared.get(ev.id).then((doc) => {
      let changed = false;
      ev.seen ??= {};
      for (const p of ev.people) {
        const r = doc.people?.[p.id];
        if (!r) continue;
        if (r.items && (r.at || 0) > (p.itemsAt || 0)) { p.items = r.items; p.itemsAt = r.at; changed = true; }
        if (r.seenAt && (r.seenRound || 0) >= ev.round && !ev.seen[p.id]) { ev.seen[p.id] = r.seenAt; changed = true; }
      }
      if (changed) { local.putEvent(ev); if (location.hash === `#/e/${id}`) renderEvent(id); }
    }).catch(() => {});
  }
}

// ---------- wish list editor ----------
function wishEditor(box, items, onSave, title = 'My wish list') {
  const list = [...items];
  const paint = () => {
    box.innerHTML = `<div class="wishlist edit">
      ${title ? `<h3>${esc(title)}</h3>` : ''}
      <ul class="items">${list.map((t, i) => `<li><span class="grow">${linkify(t)}</span><button class="icon danger" data-del="${i}" aria-label="Remove">✕</button></li>`).join('') || '<li class="muted small empty">Nothing yet. Add ideas, sizes, links.</li>'}</ul>
      <form class="inline"><input name="t" maxlength="200" placeholder="Add a wish or paste a link" aria-label="Add a wish"><button class="btn sm">Add</button></form></div>`;
    $('form', box).onsubmit = (e) => {
      e.preventDefault();
      const t = new FormData(e.target).get('t').trim();
      if (!t) return;
      list.push(t); onSave([...list]); paint(); $('input', box).focus();
    };
    $$('[data-del]', box).forEach((b) => b.onclick = () => { list.splice(Number(b.dataset.del), 1); onSave([...list]); paint(); });
  };
  paint();
}
const wishView = (items) => items?.length
  ? `<ul class="items">${items.map((t) => `<li>${linkify(t)}</li>`).join('')}</ul>`
  : '<p class="muted small empty">No wishes yet.</p>';

// ---------- participant ----------
async function renderMe(token) {
  const { data: d, key } = await unseal(token);
  const prev = local.joined()[d.eid];
  const superseded = prev && prev.round > d.round;
  if (!superseded) local.putJoined(d.eid, { token, round: d.round, evName: d.ev.name, date: d.ev.date, me: d.me.name, to: d.to.name, at: Date.now() });
  const mine = local.myWish(d.eid);
  let myItems = mine && mine.pid === d.me.id ? mine.items : d.me.items || [];
  const revealed = !!prev && prev.round === d.round && prev.revealed;
  const ev = { ...d.ev };

  // Best-known giftee wish list: link snapshot < cached wish link < shared store.
  const cached = local.cachedWish(d.eid, d.to.id);
  let theirItems = cached?.items || d.to.items || [];

  view().innerHTML = `<header class="bar"><a class="back" href="#/" aria-label="Home">‹</a><span class="bar-title">${esc(ev.name)}</span><span></span></header>
  <main class="wrap me">
    ${superseded ? `<div class="note warn">This is an old link. The organizer redrew names; use your newest link.</div>` : ''}
    <section class="card reveal-card ${revealed ? 'revealed' : ''}" id="reveal">
      <p class="hi">Hi ${esc(d.me.name)}!</p>
      <p class="muted">You're the Secret Santa for…</p>
      <div class="tag">
        <div class="tag-front"><button class="btn big" id="revealbtn">Tap to reveal</button><small class="muted">Make sure nobody's looking 👀</small></div>
        <div class="tag-back">${avatar(d.to.name, 'xl')}<p class="giftee" id="giftee">${esc(d.to.name)}</p><small class="muted">Keep it secret!</small></div>
      </div>
    </section>

    <section class="card">
      <div class="facts">
        <div><small>Budget</small><b>${esc(money(ev))}</b></div>
        <div><small>Exchange</small><b>${esc(niceDate(ev.date))}</b></div>
      </div>
      ${ev.note ? `<p class="muted small">${esc(ev.note)}</p>` : ''}
      <p class="muted small">In the group: ${d.group.map(esc).join(', ')}</p>
    </section>

    <section class="card ${revealed ? '' : 'locked'}" id="theirs">
      <h2>${esc(d.to.name)}'s wish list</h2>
      <div id="theirlist">${wishView(theirItems)}</div>
      ${shared.enabled ? '' : `<p class="muted small">If ${esc(d.to.name)} shares an updated list in the group chat, open it on this phone and it shows up here.</p>`}
    </section>

    <section class="card" id="mine"></section>
  </main>`;

  const reveal = () => {
    $('#reveal').classList.add('revealed'); $('#theirs').classList.remove('locked');
    const j = local.joined(); if (j[d.eid] && j[d.eid].round === d.round) { j[d.eid].revealed = true; local.putJoined(d.eid, j[d.eid]); }
  };
  $('#revealbtn').onclick = reveal;

  const secret = await writeSecret(key);
  const mineBox = $('#mine');
  const paintMine = () => {
    mineBox.innerHTML = `<div class="we"></div><div class="mine-foot">${shared.enabled
      ? '<p class="muted small">Your Santa sees this list automatically.</p>'
      : `<p class="muted small">Your Santa is someone in the group, so share your list with everyone. It doesn't reveal who you drew.</p>
         <button class="btn" id="sharewish">Share my wish list</button>`}</div>`;
    wishEditor($('.we', mineBox), myItems, async (items) => {
      myItems = items;
      local.putMyWish(d.eid, { pid: d.me.id, items, at: Date.now() });
      if (shared.enabled) {
        try { await shared.putWish(d.eid, d.me.id, { name: d.me.name, items, at: Date.now() }, secret); toast('Saved. Your Santa can see it.'); }
        catch { toast('Saved on this phone (sync failed)'); }
      }
    }, 'My wish list');
    $('#sharewish')?.addEventListener('click', async () => {
      const url = `${baseUrl()}#/wish/${await packPublic({ eid: d.eid, pid: d.me.id, name: d.me.name, ev: d.ev.name, items: myItems, at: Date.now() })}`;
      const text = `🎁 My wish list for ${d.ev.name}`;
      if (navigator.share) { try { await navigator.share({ title: text, text, url }); return; } catch (err) { if (err.name === 'AbortError') return; } }
      copy(url);
    });
  };
  paintMine();

  if (shared.enabled) {
    shared.seen(d.eid, d.me.id, secret).catch(() => {});
    shared.get(d.eid).then((doc) => {
      if (doc.meta?.round > d.round && !superseded) {
        $('main').insertAdjacentHTML('afterbegin', '<div class="note warn">The organizer redrew names. Ask for your new link.</div>');
      }
      const theirs = doc.people?.[d.to.id];
      if (theirs?.items && (theirs.at || 0) >= (cached?.at || 0)) $('#theirlist').innerHTML = wishView(theirs.items);
      const own = doc.people?.[d.me.id];
      if (own?.items && (own.at || 0) > (local.myWish(d.eid)?.at || 0)) { myItems = own.items; paintMine(); }
    }).catch(() => {});
  }
}

async function renderWishLink(str) {
  const w = await unpackPublic(str);
  local.cacheWish(w.eid, w.pid, { name: w.name, items: w.items, at: w.at });
  // If this device organizes that exchange, update the person's list there too.
  const ev = local.getEvent(w.eid);
  let note = '';
  if (ev) {
    const p = ev.people.find((x) => x.id === w.pid);
    if (p && (w.at || 0) >= (p.itemsAt || 0)) { p.items = w.items; p.itemsAt = w.at; local.putEvent(ev); note = `Saved to ${esc(ev.name)}.`; }
  }
  const j = local.joined()[w.eid];
  if (j && j.to === w.name) note = `That's who you're shopping for! It's saved on your page.`;
  view().innerHTML = `${header(w.ev || 'Wish list', j ? `#/me/${j.token}` : ev ? `#/e/${ev.id}` : '#/')}
  <main class="wrap"><section class="card">
    <div class="row">${avatar(w.name, 'lg')}<span class="grow"><small class="muted">${esc(w.ev)}</small><h1 class="ev-name">${esc(w.name)}'s wish list</h1></span></div>
    ${wishView(w.items)}
    ${note ? `<p class="note">${note}</p>` : '<p class="muted small">Saved on this phone. If you drew this person, it shows on your Secret Santa page.</p>'}
  </section></main>`;
}

async function renderBoard(str) {
  const b = await unpackPublic(str);
  for (const l of b.lists) if (l.items?.length) local.cacheWish(b.eid, l.pid, { name: l.name, items: l.items, at: b.at || 1 });
  const j = local.joined()[b.eid];
  view().innerHTML = `${header(`${b.ev} wish lists`, j ? `#/me/${j.token}` : '#/')}
  <main class="wrap">${b.lists.map((l) => `<section class="card"><div class="row">${avatar(l.name)}<h2 class="grow">${esc(l.name)}</h2></div>${wishView(l.items)}</section>`).join('')}</main>`;
}

route();
