// Sprig name draw: a random assignment giver -> receiver where nobody draws
// themselves and no forbidden (giver, receiver) pair is used.
// Pure module: no DOM, no storage. Works in browsers and Node.

/** Cryptographically strong rng in [0, 1). */
export function secureRandom() {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return buf[0] / 2 ** 32;
}

/** Small seeded PRNG (mulberry32) for tests. */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Build the allowed-receivers table.
 * exclusions: [[a, b]] pairs that must not draw each other (both directions).
 * avoid: [[giver, receiver]] one-way pairs to avoid (e.g. last year's draw).
 */
export function allowedTable(ids, exclusions = [], avoid = []) {
  const blocked = new Set();
  const key = (g, r) => `${g}\u0000${r}`;
  for (const [a, b] of exclusions) {
    blocked.add(key(a, b));
    blocked.add(key(b, a));
  }
  for (const [g, r] of avoid) blocked.add(key(g, r));
  const table = new Map();
  for (const g of ids) {
    table.set(g, ids.filter((r) => r !== g && !blocked.has(key(g, r))));
  }
  return table;
}

// Kuhn's augmenting-path bipartite matching. Returns Map giver -> receiver
// (possibly partial). Order of exploration is randomized by rng.
function matchAll(ids, table, rng) {
  const ownerOf = new Map(); // receiver -> giver
  const tryGiver = (g, seen) => {
    for (const r of shuffle(table.get(g), rng)) {
      if (seen.has(r)) continue;
      seen.add(r);
      if (!ownerOf.has(r) || tryGiver(ownerOf.get(r), seen)) {
        ownerOf.set(r, g);
        return true;
      }
    }
    return false;
  };
  for (const g of shuffle(ids, rng)) tryGiver(g, new Set());
  const result = new Map();
  for (const [r, g] of ownerOf) result.set(g, r);
  return result;
}

/** Explain why no valid draw exists, in plain words. */
function explainImpossible(ids, table, nameOf, partial) {
  for (const g of ids) {
    if (table.get(g).length === 0) {
      return `${nameOf(g)} has nobody left to draw. Remove one of ${nameOf(g)}'s exclusions.`;
    }
  }
  // Receivers nobody can draw.
  for (const r of ids) {
    if (!ids.some((g) => table.get(g).includes(r))) {
      return `Nobody is allowed to draw ${nameOf(r)}. Remove one of ${nameOf(r)}'s exclusions.`;
    }
  }
  if (ids.length === 3) {
    return 'With only 3 people, any rule makes a draw impossible. Add a 4th person or remove the rule.';
  }
  const stuck = ids.filter((g) => !partial.has(g)).map(nameOf);
  return `These rules can't all be met at once (stuck on ${stuck.join(', ')}). Remove an exclusion and try again.`;
}

/**
 * Draw names.
 * people: [{id, name}]
 * opts: { exclusions, avoid, rng, tries }
 * Returns { ok: true, pairs: {giverId: receiverId} } or { ok: false, reason }.
 */
export function drawNames(people, opts = {}) {
  const { exclusions = [], avoid = [], rng = secureRandom, tries = 5000 } = opts;
  const ids = people.map((p) => p.id);
  const names = new Map(people.map((p) => [p.id, p.name]));
  const nameOf = (id) => names.get(id) ?? id;
  if (new Set(ids).size !== ids.length) return { ok: false, reason: 'Two people share the same id.' };
  if (ids.length < 3) return { ok: false, reason: 'Add at least 3 people to draw names.' };

  const table = allowedTable(ids, exclusions, avoid);

  // 1) Exact feasibility check via maximum matching.
  const probe = matchAll(ids, table, rng);
  if (probe.size < ids.length) {
    return { ok: false, reason: explainImpossible(ids, table, nameOf, probe) };
  }

  // 2) Uniform sampling: shuffle receivers until every pair is allowed.
  //    Each accepted permutation is equally likely among all valid draws.
  const allowedSet = new Map([...table].map(([g, rs]) => [g, new Set(rs)]));
  for (let t = 0; t < tries; t++) {
    const perm = shuffle(ids, rng);
    if (ids.every((g, i) => allowedSet.get(g).has(perm[i]))) {
      return { ok: true, pairs: Object.fromEntries(ids.map((g, i) => [g, perm[i]])), method: 'uniform' };
    }
  }
  // 3) Heavily constrained groups: randomized matching (always valid).
  return { ok: true, pairs: Object.fromEntries(probe), method: 'matching' };
}

/** Check a finished draw against the rules. Returns list of problems. */
export function validateDraw(people, pairs, exclusions = [], avoid = []) {
  const ids = people.map((p) => p.id);
  const table = allowedTable(ids, exclusions, avoid);
  const problems = [];
  const received = new Set();
  for (const g of ids) {
    const r = pairs[g];
    if (r === undefined) problems.push(`${g} drew nobody`);
    else if (r === g) problems.push(`${g} drew themselves`);
    else if (!table.get(g).includes(r)) problems.push(`${g} -> ${r} breaks a rule`);
    if (received.has(r)) problems.push(`${r} was drawn twice`);
    received.add(r);
  }
  if (Object.keys(pairs).length !== ids.length) problems.push('wrong number of pairs');
  return problems;
}
