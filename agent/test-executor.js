// test-executor.js — one full round on a test form: scan -> plan -> FILL -> scan again
// Usage: node test-executor.js
//        node test-executor.js test-forms/other.html
const path = require('path');
const { chromium } = require('playwright');
const scanPage = require('./scanner');
const planActions = require('./planner');
const execute = require('./executor');
const profile = require('./profile.json');

(async () => {
  const file = process.argv[2] || 'test-forms/form1.html';
  const url = 'file:///' + path.resolve(file).replace(/\\/g, '/');

  const { warmUp, askJSON } = require('./llm');
  await warmUp();

  const browser = await chromium.launch({ headless: process.env.AGENT_HEADLESS === "true", channel: process.env.BROWSER_CHANNEL || 'msedge' });
  const page = await browser.newPage();
  await page.goto(url);

  const memory = {};
  const plan = await planActions(await scanPage(page), profile, memory, askJSON);

  console.log(`\nEXECUTING ${plan.actions.length} ACTIONS`);
  const results = await execute(page, plan.actions);
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n${ok}/${results.length} actions succeeded`);

  // Scan again to confirm what is really filled on the page now
  const after = await scanPage(page);
  console.log('\nPAGE AFTER FILLING');
  for (const f of after.fields) {
    const shown = f.kind === 'radio' ? f.options.find((o) => o.checked)?.label || '' : f.value ?? '';
    console.log(`  ${f.filled ? '✅' : '⬜'} ${f.label.padEnd(42)} ${shown}`);
  }

  console.log('\nThe browser stays open for 15 seconds so you can look at the form...');
  await page.waitForTimeout(15000);
  await browser.close();
})();
