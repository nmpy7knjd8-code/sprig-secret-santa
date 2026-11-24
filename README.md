# Sprig: Secret Santa name draw

A mobile-first web app for gift exchanges. Open it from a link; no download, no account.

- Create an exchange: name, date, budget **min and max**, note.
- Add people, mark pairs who must not draw each other.
- Draw names. Each person gets a **private link** that shows only who they drew.
- Share links via the phone's share sheet, Copy, WhatsApp, Text, or Email.
- Wish lists: everyone keeps one; their Santa sees it.
- Remove no-shows and redraw. Run several exchanges. **Reuse for next year** keeps people, rules,
  and wish lists, and can avoid repeating last year's matches.

## How it works without a server

The draw runs on the organizer's phone (`src/draw.js`: exact feasibility check by bipartite
matching, then uniform random sampling; impossible rule sets are explained in plain words).
Each person's assignment is sealed with AES-GCM into the `#fragment` of their link. Fragments are
never sent to any server, so GitHub Pages only serves static files and never sees names.

Organizer data lives in the organizer's browser (`localStorage`; Back up / Restore on the home page).

Wish lists, in link-only mode, travel as links: a person taps **Share my wish list** and drops it
in the group chat. Opening it saves it on that phone; the Santa's page and the organizer's
event pick it up. Lists the organizer types (or carries over from last year) are baked into
the Santa's private link.

## Optional: live shared wish lists

Set `STORE_URL` in `src/config.js` to a deployed copy of `worker/` (Cloudflare Worker + KV, free
tier). Then wish lists sync automatically and the organizer sees "✓ Opened" per person.
Writes are locked per person with a secret derived from their private link.

```
cd worker
npx wrangler login
npx wrangler kv namespace create SPRIG   # paste the id into wrangler.toml
npx wrangler deploy                      # prints https://sprig-store.<you>.workers.dev
```

## Develop and test

```
node dev/serve.mjs                 # app + in-memory store at http://localhost:8787 (/api)
npm test                           # draw algorithm unit tests
node tests/e2e.mjs                 # organizer + 4 participants, link-only mode
MODE=shared node tests/e2e.mjs     # same, with the shared store
BASE=https://<live-url>/ node tests/e2e.mjs
```
E2E needs Playwright (`npm i -D playwright`).
