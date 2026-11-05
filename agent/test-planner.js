// test-planner.js — scans a test form and shows what the planner WOULD do (nothing is filled)
// Usage: node test-planner.js
//        node test-planner.js test-forms/other.html
//        $env:DEBUG_PROMPT=1; node test-planner.js     (also prints the prompt sent to the LLM)
const path = require('path');
const { chromium } = require('playwright');
const scanPage = require('./scanner');
const planActions = require('./planner');
const profile = require('./profile.json');

(async () => {
  const file = process.argv[2] || 'test-forms/form1.html';
  const url = 'file:///' + path.resolve(file).replace(/\\/g, '/');

  const { warmUp, askJSON } = require('./llm');
  await warmUp();

  const browser = await chromium.launch({ headless: process.env.AGENT_HEADLESS === "true", channel: process.env.BROWSER_CHANNEL || 'msedge' });
  const page = await browser.newPage();
  await page.goto(url);

  const scan = await scanPage(page);
  const memory = {};

  const start = Date.now();
  const plan = await planActions(scan, profile, memory, askJSON);
  console.log(`\nPlanning took ${((Date.now() - start) / 1000).toFixed(1)}s\n`);

  console.log('FIELD -> PROFILE KEY');
  for (const f of scan.fields) {
    const key = memory.keyCache[`${f.kind}|${f.label}`] || (f.kind === 'checkbox' ? '(checkbox rule)' : '');
    console.log(`  ${f.id.padEnd(4)} ${f.label.padEnd(42)} -> ${key}`);
  }

  console.log('\nACTIONS');
  for (const a of plan.actions) {
    console.log(`  ${a.action.padEnd(7)} ${a.target.padEnd(4)} ${a.label}${a.value ? `  =  ${a.value}` : ''}`);
  }

  if (plan.notes.length) console.log('\nNOTES\n  ' + plan.notes.join('\n  '));
  if (plan.needsUser?.length) console.log('\nNEEDS USER\n  ' + plan.needsUser.join('\n  '));
  if (plan.questions?.length) console.log('\nASK THE STUDENT\n  ' + plan.questions.map((q) => `${q.label}${q.required ? ' (required)' : ''}: ${q.reason}`).join('\n  '));
  console.log('\nSTOP:', plan.stop ? `${plan.stop.reason} - ${plan.stop.message}` : 'no (continue after these actions)');

  await page.waitForTimeout(2000);
  await browser.close();
})();
