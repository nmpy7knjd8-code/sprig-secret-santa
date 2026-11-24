// End-to-end: organizer + 4 participants, one exclusion, in separate browsers.
// MODE=link (no server, default) or MODE=shared (local store at /api).
// BASE defaults to the local dev server.
import { chromium, devices } from 'playwright';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://localhost:8787/';
const MODE = process.env.MODE || 'link';
const SHOTS = process.env.SHOTS || '';
const phone = { ...devices['iPhone 13'], defaultBrowserType: undefined };
delete phone.defaultBrowserType;
const browser = await chromium.launch();
const log = (...a) => console.log(`[${MODE}]`, ...a);

async function ctx() {
  const c = await browser.newContext({ ...phone, permissions: ['clipboard-read', 'clipboard-write'] });
  if (MODE === 'shared') {
    await c.route('**/src/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: `export const STORE_URL = '${new URL('/api', BASE)}';` }));
  }
  // Headless has no share sheet; make sure the fallback path is used.
  await c.addInitScript(() => { delete Navigator.prototype.share; });
  const page = await c.newPage();
  page.on('pageerror', (e) => { throw e; });
  page.on('dialog', (d) => d.accept());
  return page;
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false }); };

// ---- Organizer ----
const org = await ctx();
await org.goto(BASE);
await org.getByRole('link', { name: 'Start a gift exchange' }).click();
await org.getByLabel('Name', { exact: true }).fill('Family Christmas 2026');
await org.getByLabel('Exchange date').fill('2026-12-24');
await org.getByLabel('Minimum').fill('25');
await org.getByLabel('Maximum').fill('50');
await org.getByLabel('Note for everyone').fill("Gifts under the tree at Mom's. Wrap them!");
await org.getByLabel(/Who's in/).fill('Garrett\nSam\nAlex\nJordan\nRiley');
await org.getByRole('button', { name: 'Continue' }).click();
await org.waitForSelector('#people');
assert.equal(await org.locator('#people .list > li').count(), 5);

// Exclusion: Sam and Alex are a couple.
await org.selectOption('#addx select[name=a]', { label: 'Sam' });
await org.selectOption('#addx select[name=b]', { label: 'Alex' });
await org.click('#addx button');
await org.waitForSelector('#rules .pairs li:has-text("Sam")');
log('exclusion added');

// Organizer types a wish list on Riley's behalf (Riley isn't techy).
await org.click('[aria-label="Wish list for Riley"]');
await org.fill('#people .wish-edit input', 'Warm socks, size L');
await org.click('#people .wish-edit button.btn');
await shot(org, '01-organizer-setup');

await org.click('#drawbtn');
await org.waitForSelector('text=Names are drawn');
const links = {};
for (const li of await org.locator('.share-row').all()) {
  const name = (await li.locator('b').first().textContent()).trim();
  links[name] = await li.locator('[data-self]').getAttribute('href');
}
assert.equal(Object.keys(links).length, 5);
// Copy-link fallback puts the full URL on the clipboard.
await org.click('.share-row:has-text("Sam") [data-share]');
await org.click('.share-row:has-text("Sam") [data-copy]');
const clip = await org.evaluate(() => navigator.clipboard.readText());
assert.ok(clip.endsWith(links.Sam), 'copied link matches');
const wa = await org.locator('.share-row:has-text("Sam") a:has-text("WhatsApp")').getAttribute('href');
assert.match(wa, /^https:\/\/wa\.me\/\?text=/);
await shot(org, '02-organizer-drawn');
log('drawn; links collected');

// The organizer page must not reveal who drew whom.
const orgText = await org.locator('main').innerText();
assert.ok(!/giving to|drew/i.test(orgText.replace(/drawn/gi, '')), 'organizer view leaks no pairs');

// ---- Participants (each on their own phone) ----
const people = ['Garrett', 'Sam', 'Alex', 'Jordan', 'Riley'];
const pages = {};
const drew = {};
for (const n of people) {
  const p = await ctx();
  await p.goto(new URL(links[n], BASE).href);
  await p.waitForSelector('#revealbtn');
  assert.match(await p.locator('.hi').textContent(), new RegExp(n));
  await p.click('#revealbtn');
  drew[n] = (await p.locator('#giftee').textContent()).trim();
  pages[n] = p;
}
log('assignments seen by participants:', JSON.stringify(drew));
assert.deepEqual(Object.values(drew).sort(), [...people].sort(), 'everyone drawn exactly once');
for (const n of people) assert.notEqual(drew[n], n, `${n} drew themselves`);
assert.notEqual(drew.Sam, 'Alex');
assert.notEqual(drew.Alex, 'Sam');

// Riley's Santa sees the wish list the organizer typed.
const rileySanta = people.find((n) => drew[n] === 'Riley');
assert.match(await pages[rileySanta].locator('#theirlist').innerText(), /Warm socks/);

// Jordan writes a wish list; Jordan's Santa must be able to see it.
const jp = pages.Jordan;
await jp.fill('#mine input', 'A good paperback mystery');
await jp.click('#mine form button');
await jp.fill('#mine input', 'https://example.com/cozy-mug');
await jp.click('#mine form button');
await jp.waitForSelector('#mine li:has-text("example.com")');
const jordanSanta = people.find((n) => drew[n] === 'Jordan');
const sp = pages[jordanSanta];
if (MODE === 'link') {
  await jp.click('#sharewish');
  await jp.waitForSelector('#toast.show');
  const wishUrl = await jp.evaluate(() => navigator.clipboard.readText());
  assert.match(wishUrl, /#\/wish\//);
  // Jordan posts it in the group chat; their Santa and the organizer open it.
  await sp.goto(wishUrl);
  await sp.waitForSelector("text=That's who you're shopping for");
  await org.goto(wishUrl);
  await org.waitForSelector('text=Saved to Family Christmas 2026');
  await sp.goto(new URL(links[jordanSanta], BASE).href);
} else {
  await jp.waitForTimeout(400);
  await sp.reload();
}
await sp.waitForSelector('#theirlist li:has-text("paperback")');
log(`${jordanSanta} sees Jordan's wish list`);
await sp.waitForTimeout(400);
await shot(sp, '03-participant-reveal');
await sp.evaluate(() => document.querySelector('#theirs').scrollIntoView());
await shot(sp, '04-participant-wishlist');

if (MODE === 'shared') {
  await org.goto(new URL(`#/e/${await org.evaluate(() => JSON.parse(localStorage['sprig.events'])[0].id)}`, BASE).href);
  await org.reload();
  await org.waitForSelector('.share-row:has-text("Jordan") .ok');
  assert.match(await org.locator('#people').innerText(), /Jordan\s+2 wishes/);
  log('organizer sees opened receipts and synced wish list');
}

// ---- Remove a no-show and redraw ----
const evId = await org.evaluate(() => JSON.parse(localStorage['sprig.events'])[0].id);
await org.goto(new URL(`#/e/${evId}`, BASE).href);
await org.click('[aria-label="Remove Riley"]');
await org.waitForSelector('#stalebanner');
await org.click('#redraw');
await org.waitForSelector('text=Redrawn');
assert.equal(await org.locator('.share-row').count(), 4);
const newSam = await org.locator('.share-row:has-text("Sam") [data-self]').getAttribute('href');
await pages.Sam.goto(new URL(newSam, BASE).href);
await pages.Sam.click('#revealbtn');
const samNew = await pages.Sam.locator('#giftee').textContent();
assert.ok(!['Sam', 'Alex', 'Riley'].includes(samNew.trim()));
// Sam's old link now says it's outdated on Sam's phone.
await pages.Sam.goto(new URL(links.Sam, BASE).href);
await pages.Sam.waitForSelector('text=This is an old link');
log('removed no-show and redrew');

// ---- Impossible configuration ----
await org.goto(new URL('#/new', BASE).href);
await org.getByLabel('Name', { exact: true }).fill('Tiny office swap');
await org.getByLabel(/Who's in/).fill('Ann\nBen\nCal');
await org.getByRole('button', { name: 'Continue' }).click();
await org.waitForSelector('#addx');
await org.selectOption('#addx select[name=a]', { label: 'Ann' });
await org.selectOption('#addx select[name=b]', { label: 'Ben' });
await org.click('#addx button');
await org.click('#drawbtn');
await org.waitForSelector('#drawerr:not(:empty)');
log('impossible message:', await org.locator('#drawerr').textContent());
await shot(org, '05-impossible');

// Min > max is rejected.
await org.goto(new URL(`#/edit/${evId}`, BASE).href);
await org.getByLabel('Minimum').fill('80');
await org.getByRole('button', { name: 'Save' }).click();
assert.match(await org.locator('#formerr').textContent(), /minimum/);

// ---- Reuse next year: wish lists carry over, last year's matches avoided ----
await org.goto(new URL(`#/e/${evId}`, BASE).href);
await org.getByRole('link', { name: 'Reuse for next year' }).click();
assert.equal(await org.getByLabel('Name', { exact: true }).inputValue(), 'Family Christmas 2027');
assert.equal(await org.getByLabel('Exchange date').inputValue(), '2027-12-24');
assert.equal(await org.getByLabel('Minimum').inputValue(), '25');
await org.getByRole('button', { name: 'Continue' }).click();
await org.waitForSelector('#people');
const peopleTxt = await org.locator('#people').innerText();
assert.match(peopleTxt, /Jordan\s+2 wishes/, 'wish lists carried over');
assert.match(await org.locator('#rules').innerText(), /Sam\s*✕\s*Alex/);
assert.ok(await org.locator('#avoidToggle').isChecked());
await org.click('#drawbtn');
await org.waitForSelector('text=Names are drawn');
const ev27 = await org.evaluate(() => JSON.parse(localStorage['sprig.events'])[0]);
const ev26 = await org.evaluate((id) => JSON.parse(localStorage['sprig.events']).find((e) => e.id === id), evId);
const nm = (ev, id) => ev.people.find((p) => p.id === id).name;
for (const [g, r] of Object.entries(ev27.pairs)) {
  const gName = nm(ev27, g), rName = nm(ev27, r);
  const lastG = ev26.people.find((p) => p.name === gName);
  assert.notEqual(nm(ev26, ev26.pairs[lastG.id]), rName, `${gName} repeated last year`);
}
await org.goto(BASE);
assert.equal(await org.locator('.home .card.link').count(), 3);
await shot(org, '00-home');
log('reuse carried wish lists and avoided repeats');

await browser.close();
log('ALL E2E CHECKS PASSED');
