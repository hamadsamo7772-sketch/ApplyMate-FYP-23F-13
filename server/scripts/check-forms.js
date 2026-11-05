// check-forms.js — "npm run check-forms": can the agent reach the application form of every open scholarship?
//
// For each scholarship with status "open" it opens the start page in the agent's browser and runs only the
// navigator (agent/navigator.js findForm), the same way a real run starts. Dry run: nothing on the form is
// filled or clicked. findForm stops as soon as it sees a form or a sign-in page; on the way it may close a
// cookie banner and follow "Apply" links. Recorded routes are replayed only up to their first fill/select step.
//
// The result is saved on the opportunity: formCheck { result: 'reachable'|'sign-in'|'not-found', url, checkedAt, ms, reason }

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });
const mongoose = require('mongoose');
const { Opportunity } = require('../models');
const openBrowser = require('../../agent/browser');
const { findForm } = require('../../agent/navigator');
const { dismissCookies } = require('../../agent/index');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/applymate';
const LIMIT_MS = 90000; // per programme
const RESULT = { form: 'reachable', 'sign-in': 'sign-in' };

// same as settle() in agent/index.js
async function settle(page) {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(800);
}

// the offline AI breaks ties between links, as in a real run; without it the navigator uses its rules only
async function loadAsk() {
  try {
    const llm = require('../../agent/llm');
    await Promise.race([llm.warmUp(), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 30000))]);
    return llm.askJSON;
  } catch (err) {
    console.log(`ℹ Offline AI not available (${err.message.split('\n')[0]}); using the navigator's rules only.\n`);
    return undefined;
  }
}

// the same start page and route a real run would use (server/applications.js startRun)
function routeFor(o) {
  const preset = o.presetSteps?.length ? o.presetSteps : o.presetTrail || [];
  const steps = [];
  for (const st of preset) {
    if (typeof st === 'object' && st.type && st.type !== 'click') break; // dry run: never fill or select
    steps.push(st);
  }
  const route = o.route?.formUrl && (o.route.fails || 0) < 3 ? o.route : null;
  return {
    start: (!o.presetSteps?.length && route?.formUrl) || o.applyUrl || o.url,
    steps,
    cutShort: steps.length < preset.length,
    prefer: [...(o.presetTrail || []), ...(route?.trail || [])],
    hints: (o.details?.applyLinks || []).filter((l) => /^https?:/.test(l.href)),
    stayOnSite: !!(o.presetSteps?.length || o.presetTrail?.length),
  };
}

async function checkOne(context, o, ask) {
  const r = routeFor(o);
  const lines = [];
  const log = (l) => lines.push(String(l).trim());
  const page = await context.newPage();
  const started = Date.now();
  let nav;
  try {
    await page.goto(r.start, { waitUntil: 'domcontentloaded' });
    let timer;
    // after a timeout the page is closed; the navigator then fails on its own, which is caught here
    const search = findForm(page, { ask, log, dismissCookies, settle, hints: r.hints, prefer: r.prefer, steps: r.steps, stayOnSite: r.stayOnSite })
      .catch((err) => ({ arrived: false, reason: 'error', message: err.message.split('\n')[0] }));
    nav = await Promise.race([
      search,
      new Promise((resolve) => { timer = setTimeout(() => resolve({ arrived: false, reason: 'timeout' }), LIMIT_MS); }),
    ]);
    clearTimeout(timer);
  } catch (err) {
    nav = { arrived: false, reason: 'error', message: err.message.split('\n')[0] };
  }
  const ms = Date.now() - started;
  const url = page.isClosed() ? '' : page.url();
  // close this page and any tabs the site opened, so the next check starts clean
  for (const p of context.pages()) if (p !== context.pages()[0]) await p.close().catch(() => {});

  const result = (nav.arrived && RESULT[nav.reason]) || 'not-found';
  let reason = '';
  if (result === 'not-found') {
    const seen = lines.filter((l) => /⚠|🧭|🧠/.test(l)).slice(-4).join(' / ');
    const why = nav.reason === 'timeout' ? `Stopped after ${LIMIT_MS / 1000} s.` : nav.message || `Navigator result: ${nav.reason}.`;
    reason = [why, seen && `Navigator saw: ${seen}`].filter(Boolean).join(' ');
  }
  if (r.cutShort) reason = `${reason} (Recorded route has fill/select steps; only the clicks before them were replayed.)`.trim();
  return { result, url, checkedAt: new Date(), ms, reason, closedNote: nav.closedNote || '' };
}

async function main() {
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
  const all = await Opportunity.find({ type: 'scholarship', status: 'open' }).lean();
  if (!all.length) {
    console.log('No open scholarships in the database. Start the server and open the Scholarships page once.');
    return;
  }

  // the demo portal is served by the ApplyMate server: skip it if the server isn't running
  const demoUp = await fetch(`http://localhost:${process.env.PORT || 5000}/api/health`, { signal: AbortSignal.timeout(3000) }).then((r) => r.ok, () => false);
  const list = all.filter((o) => o.source !== 'demo' || demoUp);
  if (list.length < all.length) console.log('ℹ Skipping the demo portal: the ApplyMate server is not running.\n');

  const ask = await loadAsk();
  const { browser } = await openBrowser('about:blank');
  const rows = [];
  try {
    for (const [i, o] of list.entries()) {
      process.stdout.write(`[${i + 1}/${list.length}] ${o.title} … `);
      const check = await checkOne(browser, o, ask);
      console.log(`${check.result} (${(check.ms / 1000).toFixed(1)} s)`);
      await Opportunity.updateOne({ _id: o._id }, { $set: { formCheck: check } });
      rows.push({ o, check });
    }
  } finally {
    await browser.close().catch(() => {});
  }

  console.log('\nForm check summary (dry run: nothing was filled or submitted)\n');
  console.table(rows.map(({ o, check }) => ({
    Programme: o.title.length > 48 ? `${o.title.slice(0, 47)}…` : o.title,
    Result: { reachable: 'Form reachable', 'sign-in': 'Sign-in needed first', 'not-found': 'Form not found yet' }[check.result],
    Time: `${(check.ms / 1000).toFixed(1)} s`,
    'Final URL': check.url,
  })));
  const counts = rows.reduce((c, { check }) => ({ ...c, [check.result]: (c[check.result] || 0) + 1 }), {});
  console.log(`Reachable: ${counts.reachable || 0}, sign-in first: ${counts['sign-in'] || 0}, not found: ${counts['not-found'] || 0}`);

  const notes = rows.filter(({ check }) => check.reason || check.closedNote);
  if (notes.length) {
    console.log('\nWhat the navigator saw:');
    for (const { o, check } of notes) console.log(`\n• ${o.title}\n  ${[check.reason, check.closedNote].filter(Boolean).join('\n  ')}`);
  }
}

main()
  .catch((err) => { console.error('❌', err.message); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
