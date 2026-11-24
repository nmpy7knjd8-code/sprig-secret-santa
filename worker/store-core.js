// Shared wish-list store logic, used by the Cloudflare Worker and the local
// test server. kv: { get(key) -> string|null, put(key, string) }.
// Document per exchange: { people: {pid: {name, items, at, seenAt, seenRound}}, meta: {round}, locks: {pid: hash} }
// Writes are first-come locked to a secret derived from each person's private link.

async function sha(s) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const ok = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: cors({ 'content-type': 'application/json' }) });
function cors(h = {}) {
  return { ...h, 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,PUT,POST,OPTIONS', 'access-control-allow-headers': 'content-type' };
}
const ID = /^[a-z0-9_]{3,40}$/i;

export async function handle(request, kv) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors() });
  const url = new URL(request.url);
  const [, w, eid, pid, action] = url.pathname.split('/');
  if (w !== 'w' || !ID.test(eid || '')) return ok({ error: 'not found' }, 404);
  const key = `ev:${eid}`;
  const doc = JSON.parse((await kv.get(key)) || '{"people":{},"meta":{},"locks":{}}');
  const publicDoc = () => ({ people: doc.people, meta: doc.meta });

  if (request.method === 'GET' && !pid) return ok(publicDoc());
  if (!ID.test(pid || '')) return ok({ error: 'bad id' }, 400);
  const body = await request.json().catch(() => ({}));
  if (typeof body.secret !== 'string' || body.secret.length < 20) return ok({ error: 'secret required' }, 401);
  const lockId = pid === '_meta' ? '_meta' : pid;
  const hash = await sha(body.secret);
  if (doc.locks[lockId] && doc.locks[lockId] !== hash) return ok({ error: 'forbidden' }, 403);
  doc.locks[lockId] = hash;

  if (pid === '_meta' && request.method === 'PUT') {
    doc.meta.round = Number(body.round) || 0;
  } else if (action === 'seen' && request.method === 'POST') {
    doc.people[pid] = { ...doc.people[pid], seenAt: Date.now(), seenRound: doc.meta.round || 0 };
  } else if (!action && request.method === 'PUT') {
    const items = Array.isArray(body.items) ? body.items.slice(0, 50).map((t) => String(t).slice(0, 300)) : [];
    doc.people[pid] = { ...doc.people[pid], name: String(body.name || '').slice(0, 60), items, at: Number(body.at) || Date.now() };
  } else return ok({ error: 'bad request' }, 400);

  const text = JSON.stringify(doc);
  if (text.length > 100_000) return ok({ error: 'too large' }, 413);
  await kv.put(key, text);
  return ok(publicDoc());
}
