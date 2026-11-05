// test-scanner.js — opens a test form and prints what the scanner sees
// Usage: node test-scanner.js            (uses test-forms/form1.html)
//        node test-scanner.js test-forms/other.html
const path = require('path');
const { chromium } = require('playwright');
const scanPage = require('./scanner');

(async () => {
  const file = process.argv[2] || 'test-forms/form1.html';
  const url = 'file:///' + path.resolve(file).replace(/\\/g, '/');

  const browser = await chromium.launch({ headless: false, channel: process.env.BROWSER_CHANNEL || 'msedge' });
  const page = await browser.newPage();
  await page.goto(url);

  const scan = await scanPage(page);

  console.log(`\nPage: ${scan.heading}   |   CAPTCHA: ${scan.captcha}\n`);
  console.log('FIELDS');
  for (const f of scan.fields) {
    const extra = f.options
      ? '  options: ' + f.options.map((o) => (typeof o === 'string' ? o : o.label)).join(' / ')
      : '';
    console.log(
      `  ${f.id.padEnd(4)} ${f.kind.padEnd(9)} ${(f.required ? 'required' : '').padEnd(9)}` +
      `${f.filled ? 'filled  ' : 'empty   '} "${f.label}"${extra}`
    );
  }
  console.log('\nBUTTONS');
  for (const b of scan.buttons) console.log(`  ${b.id.padEnd(4)} "${b.text}" ${b.type}`);
  console.log('\nERRORS:', scan.errors.length ? scan.errors : 'none');

  await page.waitForTimeout(3000);
  await browser.close();
})();
