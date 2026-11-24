// Encode data into URL fragments. Fragments (#...) are never sent to a server,
// so a private link carries its own data.

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function unb64url(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}
const deflate = (b) => pipe(b, new CompressionStream('deflate-raw'));
const inflate = (b) => pipe(b, new DecompressionStream('deflate-raw'));

/** Public (unencrypted, compressed) payload for shareable links. */
export async function packPublic(obj) {
  return b64url(await deflate(enc.encode(JSON.stringify(obj))));
}
export async function unpackPublic(str) {
  return JSON.parse(dec.decode(await inflate(unb64url(str))));
}

export function newKey() {
  return b64url(crypto.getRandomValues(new Uint8Array(16)));
}

async function aesKey(keyB64) {
  return crypto.subtle.importKey('raw', unb64url(keyB64), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** Private payload: AES-GCM sealed; token = key.ciphertext */
export async function seal(obj, keyB64) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await deflate(enc.encode(JSON.stringify(obj)));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(keyB64), data));
  const all = new Uint8Array(iv.length + ct.length);
  all.set(iv);
  all.set(ct, iv.length);
  return `${keyB64}.${b64url(all)}`;
}
export async function unseal(token) {
  const [keyB64, body] = token.split('.');
  const all = unb64url(body);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, await aesKey(keyB64), all.slice(12));
  return { data: JSON.parse(dec.decode(await inflate(new Uint8Array(pt)))), key: keyB64 };
}

/** Write secret for the shared wish-list store, derived from a person's key. */
export async function writeSecret(keyB64) {
  const h = await crypto.subtle.digest('SHA-256', enc.encode(`sprig-write:${keyB64}`));
  return b64url(new Uint8Array(h));
}
