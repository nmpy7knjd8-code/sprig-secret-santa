// Cloudflare Worker entry. Needs a KV namespace bound as SPRIG.
import { handle } from './store-core.js';
export default {
  fetch(request, env) {
    return handle(request, {
      get: (k) => env.SPRIG.get(k),
      put: (k, v) => env.SPRIG.put(k, v, { expirationTtl: 60 * 60 * 24 * 400 }),
    });
  },
};
