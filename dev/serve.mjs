// Local dev server: serves the app, and (with --store) an in-memory copy of
// the shared store at /api so you can test synced wish lists offline.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { handle } from '../worker/store-core.js';

const root = new URL('..', import.meta.url).pathname;
const port = Number(process.env.PORT || 8787);
const mem = new Map();
const kv = { get: async (k) => mem.get(k) ?? null, put: async (k, v) => { mem.set(k, v); } };
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  if (url.pathname.startsWith('/api/')) {
    const body = ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : await new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); });
    const r = await handle(new Request(new URL(url.pathname.slice(4) + url.search, url), { method: req.method, headers: req.headers, body }), kv);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    return res.end(await r.text());
  }
  let p = normalize(decodeURIComponent(url.pathname));
  if (p.endsWith('/')) p += 'index.html';
  try {
    const data = await readFile(join(root, p));
    res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('not found'); }
}).listen(port, () => console.log(`Sprig on http://localhost:${port}`));
