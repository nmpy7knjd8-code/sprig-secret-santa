// Storage. Organizer data and personal data live on the device (localStorage).
// Wish lists can additionally sync through a pluggable shared store.
import { STORE_URL } from './config.js';

const LS = globalThis.localStorage;
const read = (k, d) => {
  try { return JSON.parse(LS.getItem(k)) ?? d; } catch { return d; }
};
const write = (k, v) => LS.setItem(k, JSON.stringify(v));

export const local = {
  events: () => read('sprig.events', []),
  saveEvents: (list) => write('sprig.events', list),
  getEvent: (id) => read('sprig.events', []).find((e) => e.id === id),
  putEvent(ev) {
    const list = read('sprig.events', []);
    const i = list.findIndex((e) => e.id === ev.id);
    ev.updatedAt = Date.now();
    if (i >= 0) list[i] = ev; else list.unshift(ev);
    write('sprig.events', list);
  },
  deleteEvent: (id) => write('sprig.events', read('sprig.events', []).filter((e) => e.id !== id)),

  joined: () => read('sprig.joined', {}),
  putJoined(eid, rec) { const j = read('sprig.joined', {}); j[eid] = rec; write('sprig.joined', j); },

  myWish: (eid) => read('sprig.mywish', {})[eid],
  putMyWish(eid, rec) { const m = read('sprig.mywish', {}); m[eid] = rec; write('sprig.mywish', m); },

  // Others' wish lists this device has seen via wish-list links.
  cachedWish: (eid, pid) => (read('sprig.wishes', {})[eid] || {})[pid],
  cacheWish(eid, pid, rec) {
    const w = read('sprig.wishes', {});
    w[eid] ??= {};
    const cur = w[eid][pid];
    if (!cur || (rec.at || 0) >= (cur.at || 0)) w[eid][pid] = rec;
    write('sprig.wishes', w);
  },
};

/** Shared store adapter. Shape: get(eid), putWish(eid,pid,rec,secret), seen(eid,pid,secret), setRound(eid,round,secret). */
class RemoteStore {
  constructor(url) { this.url = url.replace(/\/$/, ''); this.enabled = true; }
  async get(eid) {
    const r = await fetch(`${this.url}/w/${encodeURIComponent(eid)}`);
    if (!r.ok) throw new Error(`store ${r.status}`);
    return r.json();
  }
  async send(path, body, method = 'PUT') {
    const r = await fetch(`${this.url}/w/${path}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`store ${r.status}`);
    return r.json();
  }
  putWish(eid, pid, rec, secret) { return this.send(`${eid}/${pid}`, { ...rec, secret }); }
  seen(eid, pid, secret) { return this.send(`${eid}/${pid}/seen`, { secret }, 'POST'); }
  setRound(eid, round, secret) { return this.send(`${eid}/_meta`, { round, secret }); }
}

class NoStore {
  enabled = false;
  async get() { return { people: {}, meta: {} }; }
  async putWish() {}
  async seen() {}
  async setRound() {}
}

export const shared = STORE_URL ? new RemoteStore(STORE_URL) : new NoStore();
