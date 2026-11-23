// Quick UI smoke test (Playwright, Node): loads every screen at desktop and iPhone size, records JS errors, takes screenshots.
//   node tests/e2e/smoke.cjs [baseUrl] [outDir]
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.argv[2] || 'http://127.0.0.1:8000';
const OUT = process.argv[3] || path.join(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });

async function run(name, contextOptions) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...contextOptions, locale: 'km-KH', deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push('PAGEERROR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') problems.push('CONSOLE ' + m.text()); });
  page.on('requestfailed', (r) => problems.push('REQFAIL ' + r.url() + ' ' + (r.failure() || {}).errorText));
  page.on('response', (r) => { if (r.status() >= 500) problems.push('HTTP' + r.status() + ' ' + r.url()); });

  await page.goto(BASE + '/');
  await page.waitForSelector('text=គម្រោងរបស់ខ្ញុំ');
  await page.screenshot({ path: path.join(OUT, `${name}_home.png`), fullPage: false });

  // create a project through the UI using the sample lyrics button
  await page.click('text=＋ គម្រោងថ្មី');
  await page.click('text=ប្រើទំនុកគំរូ ៤ បន្ទាត់');
  await page.click('text=បង្កើតគម្រោង');
  await page.waitForURL(/#\/p\/.+\/lyrics/);
  await page.waitForSelector('.section-card textarea');
  const lyricsText = await page.inputValue('.section-card textarea');
  if (lyricsText.split('\n').length !== 4) problems.push('LYRICS: expected 4 lines, got ' + JSON.stringify(lyricsText));
  await page.screenshot({ path: path.join(OUT, `${name}_lyrics.png`) });
  const pid = page.url().match(/#\/p\/([^/]+)/)[1];

  for (const tab of ['music', 'cover', 'karaoke', 'publish']) {
    await page.goto(`${BASE}/#/p/${pid}/${tab}`);
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(OUT, `${name}_${tab}.png`), fullPage: tab === 'music' });
  }
  await browser.close();
  return problems;
}

(async () => {
  let all = [];
  for (const [name, opts] of [['desktop', { viewport: { width: 1280, height: 900 } }], ['iphone', devices['iPhone 13']]]) {
    const p = await run(name, opts);
    console.log(`[${name}] problems: ${p.length}`);
    p.forEach((x) => console.log('   ', x));
    all = all.concat(p);
  }
  process.exit(all.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
