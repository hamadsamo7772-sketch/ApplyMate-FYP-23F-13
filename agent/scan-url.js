// scan-url.js — look at a real application form WITHOUT filling anything.
// Use it to check whether the agent understands a portal, and send the result to the team.
//
//   node agent/scan-url.js https://apply.example.org/
//
// 1. A browser window opens (the same one the agent uses, so you stay logged in afterwards).
// 2. Log in / open the application form yourself if needed.
// 3. Press Enter here: the current page is scanned and saved to agent/runs/scan-<site>-<time>.json
//    Only field NAMES and types are saved, never what is typed in them.
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const openBrowser = require('./browser');
const scanPage = require('./scanner');
const { dismissCookies } = require('./index');

const url = process.argv[2];
if (!url) {
  console.log('Usage: node agent/scan-url.js <address of the application form>');
  process.exit(1);
}
const wait = (q) => new Promise((r) => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, (a) => { rl.close(); r(a.trim()); }); });

(async () => {
  const { browser, page } = await openBrowser(url);
  let n = 0;
  for (;;) {
    const a = await wait('\nOpen the form page in the browser (log in yourself if needed), then press Enter to scan it (q = quit): ');
    if (a.toLowerCase() === 'q') break;
    const cookie = await dismissCookies(page);
    if (cookie) { console.log(`🍪 closed cookie banner ("${cookie}")`); await page.waitForTimeout(800); }
    const scan = await scanPage(page);
    // keep only the structure: no values
    const safe = {
      url: scan.url.split('?')[0], title: scan.title, heading: scan.heading, captcha: scan.captcha, errors: scan.errors,
      fields: scan.fields.map(({ value, ...f }) => ({ ...f, options: f.options?.slice(0, 12).map((o) => (typeof o === 'string' ? o : o.label)) })),
      buttons: scan.buttons.map((b) => ({ text: b.text, type: b.type, disabled: b.disabled })),
    };
    console.log(`\n${safe.heading || safe.title}  (${safe.url})`);
    console.log(`${safe.fields.length} fields, ${safe.buttons.length} buttons, CAPTCHA: ${safe.captcha ? 'yes' : 'no'}`);
    for (const f of safe.fields) console.log(`  - [${f.kind}${f.required ? ', required' : ''}] ${f.label}${f.hint ? `  (hint: ${f.hint})` : ''}${f.options ? `  options: ${f.options.slice(0, 5).join(' / ')}${f.options.length > 5 ? ' / …' : ''}` : ''}`);
    console.log(`  buttons: ${safe.buttons.map((b) => b.text).join(' | ')}`);
    fs.mkdirSync(path.join(__dirname, 'runs'), { recursive: true });
    const host = new URL(safe.url).hostname.replace(/^www\./, '');
    const file = path.join(__dirname, 'runs', `scan-${host}-${Date.now()}-${++n}.json`);
    fs.writeFileSync(file, JSON.stringify(safe, null, 2));
    console.log(`\nSaved: ${path.relative(process.cwd(), file)}  (send this file to the team)`);
  }
  await browser.close().catch(() => {});
})().catch((e) => { console.error('❌', e.message); process.exit(1); });
