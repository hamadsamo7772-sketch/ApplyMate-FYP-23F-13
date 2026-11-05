// debug-page.js — shows what the scanner sees on a page. Nothing is typed, ticked or clicked.
//
// Usage:  node agent/debug-page.js <url>          open the page, click to any page yourself,
//                                                 press Enter to scan (again), type q to quit
//         node agent/debug-page.js <url> --now    scan once right after loading, then close (no typing needed)
const readline = require('readline');
const openBrowser = require('./browser');
const scanPage = require('./scanner');

const path = require('path');
const fs = require('fs');

// a web address, or a local practice form (relative to here or to the agent folder)
const toUrl = (t) => {
  if (!t || /^(https?|file):/i.test(t)) return t;
  const file = fs.existsSync(path.resolve(t)) ? path.resolve(t) : path.resolve(__dirname, t);
  return 'file:///' + file.replace(/\\/g, '/');
};
const url = toUrl(process.argv[2]);
const now = process.argv.includes('--now');
if (!url) {
  console.log('Usage: node agent/debug-page.js <url> [--now]');
  process.exit(1);
}

const cut = (s, n) => { s = String(s ?? ''); return s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n); };

async function show(page) {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(800);
  const scan = await scanPage(page);
  console.log(`\n${scan.url}\n${scan.heading || scan.title}`);
  console.log(`${'id'.padEnd(10)} ${'kind'.padEnd(9)} ${'req'.padEnd(4)} ${'opts'.padEnd(5)} ${'filled'.padEnd(7)} label`);
  for (const f of scan.fields) {
    const opts = f.options ? String(f.options.length) : '';
    console.log(`${cut(f.id, 10)} ${cut(f.kind, 9)} ${(f.required ? 'yes' : '').padEnd(4)} ${opts.padEnd(5)} ${(f.filled ? "yes" : "").padEnd(7)} ${f.section ? `${f.section} › ` : ""}${f.label}${f.hint ? `  [hint: ${f.hint}]` : ''}`);
    if (f.kind === 'radio') console.log(`${''.padEnd(39)}↳ ${f.options.map((o) => o.label).join(' / ')}`);
  }
  console.log(`${scan.fields.length} fields, ${scan.fields.filter((f) => f.required).length} required. ` +
    `Buttons: ${scan.buttons.map((b) => b.text).join(' | ') || '(none)'}`);
  if (scan.errors.length) console.log(`Errors on the page: ${scan.errors.join(' | ')}`);
}

(async () => {
  const { browser, page } = await openBrowser(url);
  try {
    if (now) return await show(page);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    for (;;) {
      const answer = await new Promise((r) => rl.question('\nGo to the page you want in the browser, then press Enter to scan (q = quit): ', r));
      if (answer.trim().toLowerCase() === 'q') break;
      // the student may have moved on to a new tab
      const pages = browser.pages();
      await show(pages[pages.length - 1] || page).catch((e) => console.log(`Could not scan: ${e.message.split('\n')[0]}`));
    }
    rl.close();
  } finally {
    await browser.close().catch(() => {});
  }
})();
