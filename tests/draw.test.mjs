import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawNames, validateDraw, seededRandom } from '../src/draw.js';

const P = (...names) => names.map((n) => ({ id: n.toLowerCase(), name: n }));

test('no one draws themselves and everyone is drawn exactly once', () => {
  for (let n = 3; n <= 30; n++) {
    const people = Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
    for (let s = 0; s < 20; s++) {
      const r = drawNames(people, { rng: seededRandom(n * 100 + s) });
      assert.equal(r.ok, true);
      assert.deepEqual(validateDraw(people, r.pairs), []);
    }
  }
});

test('exclusions are honored in both directions', () => {
  const people = P('Ann', 'Ben', 'Cal', 'Dee', 'Eve');
  const exclusions = [['ann', 'ben'], ['cal', 'dee']];
  for (let s = 0; s < 500; s++) {
    const r = drawNames(people, { exclusions, rng: seededRandom(s) });
    assert.equal(r.ok, true);
    assert.deepEqual(validateDraw(people, r.pairs, exclusions), []);
    assert.notEqual(r.pairs.ann, 'ben');
    assert.notEqual(r.pairs.ben, 'ann');
    assert.notEqual(r.pairs.cal, 'dee');
    assert.notEqual(r.pairs.dee, 'cal');
  }
});

test('one-way avoid pairs (last year) are honored', () => {
  const people = P('Ann', 'Ben', 'Cal', 'Dee');
  const avoid = [['ann', 'ben'], ['ben', 'cal'], ['cal', 'dee'], ['dee', 'ann']];
  for (let s = 0; s < 200; s++) {
    const r = drawNames(people, { avoid, rng: seededRandom(s) });
    assert.equal(r.ok, true);
    assert.deepEqual(validateDraw(people, r.pairs, [], avoid), []);
  }
});

test('fewer than 3 people is refused', () => {
  assert.equal(drawNames(P('Ann', 'Ben')).ok, false);
  assert.equal(drawNames(P('Ann')).ok, false);
});

test('impossible: someone excluded from everyone', () => {
  const people = P('Ann', 'Ben', 'Cal', 'Dee');
  const r = drawNames(people, { exclusions: [['ann', 'ben'], ['ann', 'cal'], ['ann', 'dee']] });
  assert.equal(r.ok, false);
  assert.match(r.reason, /Ann/);
});

test('impossible: two couples among four plus cross exclusion (Hall violation)', () => {
  // 3 people, each excluded with one other => only cycles remain? Build a case
  // where every giver has options but no full assignment exists.
  const people = P('Ann', 'Ben', 'Cal', 'Dee');
  // Ann, Ben, Cal can only draw Dee.
  const exclusions = [['ann', 'ben'], ['ann', 'cal'], ['ben', 'cal']];
  const r = drawNames(people, { exclusions });
  assert.equal(r.ok, false);
  assert.ok(r.reason.length > 10);
});

test('impossible: 3 people where one pair is excluded', () => {
  // With 3 people the only derangements are the two 3-cycles, each of which
  // uses both directions between some pair... actually each uses A->B or B->A.
  const people = P('Ann', 'Ben', 'Cal');
  const r = drawNames(people, { exclusions: [['ann', 'ben']] });
  assert.equal(r.ok, false);
});

test('tightly constrained but possible groups still succeed', () => {
  // 6 people, three couples: valid draws exist.
  const people = P('A1', 'A2', 'B1', 'B2', 'C1', 'C2');
  const exclusions = [['a1', 'a2'], ['b1', 'b2'], ['c1', 'c2']];
  for (let s = 0; s < 300; s++) {
    const r = drawNames(people, { exclusions, rng: seededRandom(s) });
    assert.equal(r.ok, true);
    assert.deepEqual(validateDraw(people, r.pairs, exclusions), []);
  }
});

test('randomness: every valid assignment shows up with roughly equal frequency', () => {
  // 4 people, no rules: 9 derangements, each should be ~1/9.
  const people = P('Ann', 'Ben', 'Cal', 'Dee');
  const counts = new Map();
  const N = 18000;
  const rng = seededRandom(42);
  for (let i = 0; i < N; i++) {
    const r = drawNames(people, { rng });
    const k = JSON.stringify(r.pairs);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  assert.equal(counts.size, 9);
  // Chi-square goodness of fit, 8 dof; 26.12 is the 0.999 critical value.
  const exp = N / 9;
  const chi = [...counts.values()].reduce((s, c) => s + (c - exp) ** 2 / exp, 0);
  assert.ok(chi < 26.12, `chi-square ${chi.toFixed(2)} too high`);
});

test('randomness: each giver gets each allowed receiver fairly (with exclusion)', () => {
  const people = P('Ann', 'Ben', 'Cal', 'Dee', 'Eve');
  const exclusions = [['ann', 'ben']];
  const rng = seededRandom(7);
  const seen = {};
  for (let i = 0; i < 5000; i++) {
    const r = drawNames(people, { exclusions, rng });
    for (const [g, x] of Object.entries(r.pairs)) {
      seen[g] ??= new Set();
      seen[g].add(x);
    }
  }
  assert.deepEqual([...seen.ann].sort(), ['cal', 'dee', 'eve']);
  assert.deepEqual([...seen.cal].sort(), ['ann', 'ben', 'dee', 'eve']);
});

test('default rng (crypto) works and two draws differ eventually', () => {
  const people = P('Ann', 'Ben', 'Cal', 'Dee', 'Eve', 'Fay');
  const keys = new Set();
  for (let i = 0; i < 50; i++) keys.add(JSON.stringify(drawNames(people).pairs));
  assert.ok(keys.size > 5);
});

test('large group with many exclusions stays fast and valid', () => {
  const people = Array.from({ length: 60 }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
  const exclusions = [];
  for (let i = 0; i < 60; i += 2) exclusions.push(['p' + i, 'p' + (i + 1)]);
  const t = Date.now();
  const r = drawNames(people, { exclusions });
  assert.equal(r.ok, true);
  assert.deepEqual(validateDraw(people, r.pairs, exclusions), []);
  assert.ok(Date.now() - t < 2000);
});

test('near-impossible star constraints fall back to matching and stay valid', () => {
  // 8 people; everyone except p0 is excluded from almost everyone.
  const people = Array.from({ length: 8 }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
  const exclusions = [];
  for (let i = 1; i < 8; i++) for (let j = i + 1; j < 8; j++) if (j !== i + 1 && !(i === 1 && j === 7)) exclusions.push(['p' + i, 'p' + j]);
  const r = drawNames(people, { exclusions, rng: seededRandom(3) });
  if (r.ok) assert.deepEqual(validateDraw(people, r.pairs, exclusions), []);
  else assert.ok(r.reason);
});
