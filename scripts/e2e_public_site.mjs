import puppeteer from 'puppeteer-core';

const BASE = 'http://127.0.0.1:8973/';
const browser = await puppeteer.launch({
  executablePath: '/snap/bin/chromium', headless: 'new',
  args: ['--no-sandbox', '--disable-gpu'],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

const ok = [];
const bad = [];
const check = (name, cond, extra = '') => (cond ? ok : bad).push(`${name}${extra ? ' — ' + extra : ''}`);

await page.goto(BASE, { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 600));

// 1. Live view renders cards
const cards = await page.$$eval('.card', els => els.length);
check('live view renders action cards', cards > 0, `${cards} cards`);

// 2. Every proof link points at a real tx explorer URL
const proofs = await page.$$eval('a.proof', as => as.map(a => a.href));
const badProof = proofs.filter(h => !/^https:\/\/cardanoscan\.io\/transaction\/[0-9a-f]{64}$/.test(h));
check('proof links are well-formed tx URLs', badProof.length === 0,
  `${proofs.length} links, ${badProof.length} malformed`);

// 3. Click a card -> detail view loads with a position panel
await page.click('.card');
await new Promise(r => setTimeout(r, 700));
const detailH1 = await page.$eval('.detail-head h1', e => e.textContent.trim()).catch(() => null);
const hasPosition = await page.$$eval('.panel h2', hs => hs.some(h => /BEACN's position/i.test(h.textContent)));
check('card click opens the decision detail', !!detailH1, detailH1 ? detailH1.slice(0, 40) : 'no h1');
check('detail shows BEACN\'s position panel', hasPosition);

// 4. Record view paginates (must NOT dump all 150 on one page)
await page.goto(BASE + '#/record', { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 700));
const recCards = await page.$$eval('.card', els => els.length);
check('record view is paginated', recCards > 0 && recCards <= 25, `${recCards} cards on page 1`);
const height = await page.evaluate(() => document.body.scrollHeight);
check('record page height is sane (was 43,000px)', height < 12000, `${height}px`);

// 5. Filter by vote=YES returns only YES votes
await page.select('#f-vote', 'YES');
await new Promise(r => setTimeout(r, 400));
const yesVotes = await page.$$eval('.stance-cell .vote', els =>
  els.filter(e => e.closest('.stance-cell').querySelector('.lbl')?.textContent.includes('on-chain'))
     .map(e => e.textContent.trim()));
check('filter vote=YES yields only YES', yesVotes.length > 0 && yesVotes.every(v => v === 'YES'),
  `${yesVotes.length} cards: ${[...new Set(yesVotes)].join(',')}`);

// 6. Method view loads the live scoring contract from a real decision
await page.goto(BASE + '#/method', { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 900));
const contract = await page.$eval('#contract', e => e.textContent).catch(() => '');
check('method page loads the live weighting contract', /ecosystem benefit|weights|YES requires/i.test(contract));

// 6b. The weighting system renders the REAL published weights, grouped correctly.
const wtext = await page.evaluate(() => document.body.innerText);
check('method page renders directional weights and limits separately',
  /DIRECTIONAL WEIGHTS/i.test(wtext) && /LIMITS/i.test(wtext));
check('method page shows the real treasury base penalty (-0.1)', /-0\.1\b/.test(wtext));

// 7. The verifier actually verifies. This is the load-bearing claim of the whole site: if these
//    checks can go green on a broken hash — or red on a good one — the site is lying to people.
await page.goto(BASE + '#/verify', { waitUntil: 'networkidle0' });
await page.waitForFunction(
  () => { const s = document.getElementById('v-status'); return s && !/running/i.test(s.className); },
  { timeout: 20000 },
).catch(() => {});
const vstatus = await page.$eval('#v-status', e => e.textContent.trim()).catch(() => '');
check('verify view runs its checks and passes on a real decision', /passed/i.test(vstatus), vstatus);

const passed = await page.$$eval('.check.pass', els => els.length);
check('all three integrity checks pass in-browser', passed === 3, `${passed}/3 green`);

// The computed hash must equal the on-chain one AND be a real 64-hex digest — a verifier that
// compares "" to "" would also show green.
const anchorRows = await page.$$eval('#v-anchor .hrow', rows =>
  rows.map(r => [r.querySelector('.k')?.textContent.trim(), r.querySelector('.v')?.textContent.trim()]));
const onchain = (anchorRows.find(r => r[0] === 'on-chain') || [])[1] || '';
const computed = (anchorRows.find(r => r[0] === 'computed') || [])[1] || '';
check('anchor check compares real 64-hex hashes', /^[0-9a-f]{64}$/.test(computed) && computed === onchain,
  `${computed.slice(0, 16)}… vs ${onchain.slice(0, 16)}…`);

// Negative control: corrupt one byte of the rationale and the anchor check MUST go red.
const flipped = await page.evaluate(async () => {
  const { blake2b256Hex } = await import('./verify.js');
  const bytes = new TextEncoder().encode('rationale');
  const good = blake2b256Hex(bytes);
  bytes[0] ^= 0x01;
  return good !== blake2b256Hex(bytes);
});
check('a single flipped byte changes the hash (verifier is not a no-op)', flipped);

// 7. No horizontal overflow anywhere
for (const [w, h, label] of [[390, 844, 'mobile'], [1440, 900, 'desktop']]) {
  await page.setViewport({ width: w, height: h });
  await page.goto(BASE + '#/record', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 500));
  const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check(`no horizontal overflow (${label})`, !over);
}

console.log('\nPASS:');
ok.forEach(s => console.log('  ✓ ' + s));
if (bad.length) { console.log('\nFAIL:'); bad.forEach(s => console.log('  ✗ ' + s)); }
console.log('\nconsole/page errors: ' + (errors.length ? errors.join(' | ') : 'none'));
await browser.close();
process.exit(bad.length || errors.length ? 1 : 0);
