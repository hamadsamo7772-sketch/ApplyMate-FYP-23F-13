// index.js — the ApplyMate form-filling agent.
//
// Loop:  scan the page -> plan -> fill -> scan again ...
// It pauses and hands control to the user for: CAPTCHA, page errors, missing data,
// and the FINAL SUBMIT (the agent never submits an application by itself).
//
// Usage:  node index.js                          (test-forms/form2.html)
//         node index.js test-forms/form1.html
//         node index.js https://example.com/apply

const path = require('path');
const fs = require('fs');
const readline = require('readline');

const openBrowser = require('./browser');
const scanPage = require('./scanner');
const planActions = require('./planner');
const execute = require('./executor');
const { findForm, formFields, isFormPage, snapshot } = require('./navigator');
const { fillEntries, addButtonOf } = require('./entries');

const MAX_STEPS = 25;

// Portals where the student already has an account (kept with the browser data, on this computer)
const ACCOUNTS_FILE = path.join(__dirname, '.browser-data', 'applymate-accounts.json');
const readAccounts = () => { try { return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8')); } catch { return {}; } };
const hasAccount = (host) => !!readAccounts()[host];
function rememberAccount(host) {
  try {
    fs.mkdirSync(path.dirname(ACCOUNTS_FILE), { recursive: true });
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify({ ...readAccounts(), [host]: new Date().toISOString() }, null, 2));
  } catch { /* not important */ }
}

function toUrl(target) {
  if (/^https?:\/\//i.test(target) || target.startsWith('file:')) return target;
  // a local file: relative to where you are, or else relative to the agent folder
  const file = fs.existsSync(path.resolve(target)) ? path.resolve(target) : path.resolve(__dirname, target);
  return 'file:///' + file.replace(/\\/g, '/');
}

// Default pause: wait for the user to press Enter in the terminal
function askYesNo(message) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(`\n❓ ${message} (y/n): `, (answer) => {
      rl.close();
      resolve(/^y/i.test(answer.trim()));
    })
  );
}

function askUser(message) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(`\n🙋 ${message}\n   Press Enter when done (or type q to stop): `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() !== 'q');
    })
  );
}

// Real websites often cover the form with a cookie banner. Prefer "reject / only necessary";
// accept only when the banner offers nothing else. Only buttons inside a cookie/consent box count.
async function dismissCookies(page) {
  return page.evaluate(() => {
    const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const inBanner = (el) => {
      for (let n = el, i = 0; n && i < 8; n = n.parentElement, i++) {
        if (/cookie|consent|gdpr|onetrust|cookiebot|cc-window|cc_banner|privacy-banner|usercentrics/i.test(`${n.id} ${n.className}`)) return true;
        if (i >= 2 && /cookie/i.test(n.innerText || '') && (n.innerText || '').length < 1500) return true;
      }
      return false;
    };
    const buttons = [...document.querySelectorAll('button, [role="button"], a, input[type="button"], input[type="submit"]')]
      .filter((b) => visible(b) && inBanner(b));
    const text = (b) => (b.innerText || b.value || b.getAttribute('aria-label') || '').trim();
    const pick =
      buttons.find((b) => /^(reject( all)?|decline( all)?|deny|only (essential|necessary)|(use )?(strictly )?necessary( cookies)?( only)?|essential( cookies)? only)\b/i.test(text(b))) ||
      buttons.find((b) => /^(accept( all)?( cookies)?|allow( all)?( cookies)?|i agree|agree|got it|ok(ay)?|understood)\b/i.test(text(b)));
    if (!pick) return '';
    pick.click();
    return text(pick).slice(0, 40);
  }).catch(() => '');
}

async function settle(page) {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  // portals often build their menus and forms with scripts after the page "loads"
  await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(800);
}

/**
 * Runs the agent on one form.
 * options.profile - the user's profile (default: profile.json, for command-line tests)
 * options.ask     - LLM function (default: llm.js askJSON)
 * options.log     - where progress lines go (default: console.log)
 * options.onPause - async (stop) => true to continue / false to quit (default: terminal)
 *                   stop.kind === 'confirm' -> true = yes, false = no (the run continues)
 */
async function runAgent(target, options = {}) {
  const started = Date.now();
  const profile = options.profile || require('./profile.json');
  const log = options.log || console.log;
  const onPause =
    options.onPause ||
    ((stop) => (stop.kind === 'confirm' ? askYesNo(stop.message) : askUser('Your turn: do this in the browser.')));

  let ask = options.ask;
  if (!ask) {
    const llm = require('./llm');
    await llm.warmUp();
    ask = llm.askJSON;
  }

  const { browser, page } = options.page ? { page: options.page } : await openBrowser(toUrl(target));
  if (options.page) await page.goto(toUrl(target));

  const memory = {};
  const stats = { steps: 0, actions: 0, ok: 0, failed: [], pauses: [], llmCalls: 0, llmSeconds: 0 };
  const timedAsk = async (...args) => {
    const t = Date.now();
    try { return await ask(...args); } finally {
      stats.llmCalls++;
      stats.llmSeconds += (Date.now() - t) / 1000;
    }
  };

  let finalStop = null;
  let lastPause = ''; // to notice when the user pressed Enter but nothing changed

  // ---- find the application form by itself (programme website -> admissions -> apply -> portal) ----
  // options.knownForm: a route saved by an earlier run (any student) -> try it first
  // options.onFormFound(url, { kind, by, trail }): called when the form / portal sign-in is reached
  let navigations = 0;
  let passwordHost = '';
  stats.notes = [];
  let lastOpened = toUrl(target); // the last address the agent itself opened (a safe fallback to save)
  page.on('framenavigated', (f) => { if (f === page.mainFrame() && !/login|signin|saml|sso|oauth|b2c/i.test(f.url())) lastOpened = f.url(); });
  let inApplication = false; // reached the real form: never search for the route again in this run
  const found = (kind, by, trail = [], entryUrl = '') => {
    stats.formUrl = page.url();
    if (kind === 'form') inApplication = true;
    try { options.onFormFound?.(entryUrl || page.url(), { kind, by, trail, fallback: lastOpened }); } catch { /* not important */ }
  };
  // the recorded route (npm run teach / earlier runs) is replayed once, after the student is signed in
  let stepsUsed = false;
  const stepsFor = () => (stepsUsed ? [] : options.knownSteps || []);
  const runFind = async (opts) => {
    const steps = stepsFor();
    // a scholarship with a recorded route never sends the agent to other websites
    const stayOnSite = options.stayOnSite ?? !!((options.knownSteps || []).length || (options.knownTrail || []).length);
    const nav = await findForm(page, { ask: timedAsk, log, dismissCookies, settle, hasAccount, prefer: options.knownTrail || [], steps, stayOnSite, ...opts });
    if (nav.arrived && steps.length && nav.reason === 'form') stepsUsed = true;
    return nav;
  };
  const navigate = async () => {
    navigations++;
    if (navigations === 1 && options.knownForm) {
      log(`\n━━━━━ FINDING THE APPLICATION FORM  |  saved route`);
      log(`  📍 Using the route saved by an earlier run → ${options.knownForm}`);
      await page.goto(options.knownForm, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await settle(page);
      const cookie = await dismissCookies(page);
      if (cookie) { log(`  🍪 Closed the cookie banner ("${cookie}")`); await settle(page); }
      let kind = await isFormPage(page);
      if (!kind) {
        // the saved page is the portal's entry ("Sign in / Create account"): choose for THIS student
        const nav = await runFind({ maxHops: 3 });
        if (nav.arrived) kind = nav.reason;
      }
      if (kind) {
        log(kind === 'sign-in' ? '  ✅ Reached the portal’s sign-in / sign-up page' : '  ✅ Reached the application form');
        found(kind, 'saved route', [], options.knownForm);
        return true;
      }
      log('  ⚠ The saved route did not lead to the form any more, searching from the programme’s website');
      try { options.onRouteFailed?.(); } catch { /* not important */ }
      await page.goto(toUrl(target), { waitUntil: 'domcontentloaded' }).catch(() => {});
    }
    log(`\n━━━━━ FINDING THE APPLICATION FORM  |  ${page.url()}`);
    let nav = await runFind({ hints: options.hints || [] });
    if (nav.closedNote) stats.notes.push(nav.closedNote);
    if (nav.arrived) {
      log(nav.reason === 'sign-in' ? '  ✅ Reached the portal’s sign-in / sign-up page' : '  ✅ Reached the application form');
      found(nav.reason, 'agent', nav.entryUrl ? nav.trail.slice(0, -1) : nav.trail, nav.entryUrl);
      return true;
    }
    // save what the agent could see, so the route can be fixed (no personal values: texts of links/labels only)
    try {
      const snap = await snapshot(page);
      fs.mkdirSync(path.join(__dirname, 'runs'), { recursive: true });
      const file = path.join(__dirname, 'runs', `debug-${Date.now()}.json`);
      fs.writeFileSync(file, JSON.stringify(snap, null, 2));
      log(`  🔎 Saved what the agent could see on this page: ${path.relative(path.join(__dirname, '..'), file)}`);
    } catch { /* not important */ }
    // the student shows the way once; ApplyMate remembers it for everyone
    for (let tries = 0; tries < 2; tries++) {
      log(`\n⏸  NOT-FOUND: ${nav.message}`);
      stats.pauses.push('form-not-found');
      if (!(await onPause({ kind: 'action', reason: 'form-not-found', message: nav.message }))) return false;
      await settle(page);
      const kind = await isFormPage(page);
      if (kind) {
        log(`  ✅ You opened the ${kind === 'sign-in' ? 'portal’s sign-in page' : 'application form'}: ApplyMate saved this route for the next students`);
        found(kind, 'student');
        return true;
      }
      nav = { message: 'This page does not look like an application form yet. Please open the form (or the portal’s sign-in page), then press continue.' };
    }
    return true; // carry on with whatever page is open
  };
  if (!(await navigate())) finalStop = { reason: 'stopped-by-user' };

  for (let step = 1; step <= MAX_STEPS && !finalStop; step++) {
    if (page.isClosed()) { finalStop = { reason: 'browser-closed' }; break; }
    stats.steps = step;
    await settle(page);
    const cookie = await dismissCookies(page);
    if (cookie) {
      log(`  🍪 Closed the cookie banner ("${cookie}")`);
      await settle(page);
    }

    let scan = await scanPage(page);
    // e.g. after the student logged in, the portal shows a dashboard: go on to the application
    const hasNext = scan.buttons.some((b) => !b.disabled && /^(next|continue|proceed|next step|save (and|&) (continue|next))\b/i.test(b.text));
    // a wizard step with nothing to fill but a Next button (e.g. HEC "Employment Details"): just go on
    if (!formFields(scan).length && !scan.fields.some((f) => f.kind === 'password') && !addButtonOf(scan) && !inApplication && !(hasNext && stats.formUrl) && !(stats.formUrl && formFields(scan).length + scan.fields.filter((f) => f.kind === 'checkbox').length > 0) && navigations < 3) {
      if (!(await navigate())) { finalStop = { reason: 'stopped-by-user' }; break; }
      await settle(page);
      scan = await scanPage(page);
    }
    // the student got past a password page on this portal -> they have an account here
    const host = /^https?:/.test(scan.url) ? new URL(scan.url).hostname : '';
    if (scan.fields.some((f) => f.kind === 'password')) passwordHost = host;
    else if (host && host === passwordHost) { rememberAccount(host); passwordHost = ''; }
    const pageSig = `${scan.url}|${scan.buttons.map((b) => b.text).join(',')}`;
    if (memory.lastSig && memory.lastSig !== pageSig && !addButtonOf(scan)) memory.entriesDone = false;
    memory.lastSig = pageSig;
    const filled = scan.fields.filter((f) => f.filled).length;
    log(`\n━━━━━ STEP ${step}  |  ${scan.heading || scan.title}  |  ${filled}/${scan.fields.length} fields filled`);

    // signed in, but the saved route was not followed yet (e.g. HEC: dashboard -> "Hungarian Scholarship Program")
    if (!inApplication && !stepsUsed && (options.knownSteps || []).length && !scan.fields.some((f) => f.kind === 'password') && navigations < 3 && formFields(scan).length < 2) {
      if (!(await navigate())) { finalStop = { reason: 'stopped-by-user' }; break; }
      await settle(page);
      scan = await scanPage(page);
    }
    // a list the student adds to one by one (e.g. "Add Education"): add every missing degree first
    if (addButtonOf(scan) && !memory.entriesDone) {
      memory.keyCache ||= {};
      const res = await fillEntries(scan, { page, profile, ask: timedAsk, log, onPause, settle, keyCache: memory.keyCache });
      memory.entriesDone = true;
      if (res?.stopped) { finalStop = { reason: 'stopped-by-user' }; break; }
      if (res) {
        for (const p of res.problems) stats.failed.push(p);
        if (res.added) { stats.actions += res.added; stats.ok += res.added; }
        continue; // scan the list page again, then go on with Next
      }
    }
    // a message pop-up with no fields ("Saved successfully" / OK): acknowledge it, unless it is about submitting
    const dlgButtons = scan.buttons.filter((b) => b.dialog && !b.disabled);
    if (dlgButtons.length && !scan.fields.some((f) => f.dialog)) {
      const dlgText = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"], mat-dialog-container, .cdk-overlay-pane, .modal.show, dialog[open], .swal2-popup')].map((d) => d.innerText).join(' ')).catch(() => '');
      const ack = dlgButtons.find((b) => /^(ok|okay|close|got it|dismiss|continue|proceed)$/i.test(b.text));
      if (ack && !/submit|final|declar|cannot be (changed|edited)|irreversible|delete|remove/i.test(dlgText)) {
        log(`  💬 Closed the message “${dlgText.replace(/\s+/g, ' ').trim().slice(0, 80)}” with “${ack.text}”`);
        await execute(page, [{ action: 'click', target: ack.id, label: ack.text }], log);
        continue;
      }
    }
    // a pop-up is open: work only inside it (never click "Next" on the page behind it)
    if (scan.fields.some((f) => f.dialog)) {
      scan = { ...scan, fields: scan.fields.filter((f) => f.dialog), buttons: scan.buttons.filter((b) => b.dialog) };
    }
    const plan = await planActions(scan, profile, memory, timedAsk);
    for (const n of plan.notes) log(`  ℹ ${n}`);

    // ---- the agent has to stop: hand control to the user ----
    if (plan.stop) {
      log(`\n⏸  ${plan.stop.reason.toUpperCase()}: ${plan.stop.message}`);
      stats.pauses.push(plan.stop.reason);

      if (plan.stop.reason === 'ready-to-submit') { finalStop = plan.stop; break; }

      // Same pause on the same unchanged page again -> the agent can't go further here
      const pauseKey = `${plan.stop.reason}|${scan.url}|${filled}|${scan.buttons.map((b) => b.text).join()}`;
      if (pauseKey === lastPause) {
        log('   Nothing changed since the last pause, so the agent stops here.');
        finalStop = plan.stop;
        break;
      }
      lastPause = pauseKey;

      const goOn = await onPause(plan.stop);
      if (!goOn) { finalStop = { reason: 'stopped-by-user' }; break; }
      // answers typed in ApplyMate: used right away (the server also saved them in the profile)
      if (Array.isArray(goOn)) {
        const { normalizeQ } = require('./answers');
        profile.answers = [...(profile.answers || []).filter((a) => !goOn.some((n) => normalizeQ(n.label) === a.q)),
          ...goOn.map((a) => ({ ...a, q: normalizeQ(a.label) }))];
        log(`  ✍ You answered ${goOn.length} question${goOn.length === 1 ? '' : 's'}; saved in your profile for the next forms`);
        lastPause = '';
      }
      memory.attempts = {}; // the user may have fixed things; allow fresh tries
      continue;
    }

    // ---- ask before sending documents to a real website: once per website in a run ----
    // the answer (yes = upload all documents this form asks for, no = upload none) holds for the whole run
    let actions = plan.actions;
    const isLiveSite = /^https?:/i.test(page.url()) && !/^https?:\/\/(localhost|127\.0\.0\.1)/i.test(page.url());
    const uploads = actions.filter((a) => a.action === 'upload');
    if (isLiveSite && uploads.length) {
      const host = new URL(page.url()).host;
      memory.uploadOk ||= {};
      if (memory.uploadOk[host] === undefined) {
        const files = [...new Set(uploads.map((a) => path.basename(a.value)))].join(', ');
        memory.uploadOk[host] = await onPause({
          kind: 'confirm', reason: 'confirm-upload',
          message: `May the agent upload your documents to ${host}? Now: ${files}. ` +
            'If you say yes, it also uploads the other documents this form asks for, without asking again.',
        });
        log(memory.uploadOk[host] ? `  ✔ You allowed uploads to ${host} for this application` : `  ⏭ You chose not to upload documents to ${host}`);
      }
      if (!memory.uploadOk[host]) {
        for (const a of uploads) memory.attempts[a.target] = 99;
        actions = actions.filter((a) => a.action !== 'upload');
      }
    }

    // ---- do the actions ----
    const results = await execute(page, actions, log);
    stats.actions += results.length;
    stats.ok += results.filter((r) => r.ok).length;
    stats.failed.push(...results.filter((r) => !r.ok).map((r) => `${r.label}: ${r.error}`));
    for (const r of results) {
      if (!r.ok && /^no option/.test(r.error)) memory.attempts[r.target] = 99; // retrying won't help
    }

    if (actions.some((a) => a.action === 'click')) await settle(page);
  }

  if (!finalStop) finalStop = { reason: 'max-steps', message: `Stopped after ${MAX_STEPS} steps.` };

  // ---- summary (also saved to runs/ for the evaluation chapter; no personal values) ----
  const summary = {
    form: target,
    finishedAt: new Date().toISOString(),
    result: finalStop.reason,
    message: finalStop.message || '',
    totalSeconds: +((Date.now() - started) / 1000).toFixed(1),
    llmCalls: stats.llmCalls,
    llmSeconds: +stats.llmSeconds.toFixed(1),
    steps: stats.steps,
    actions: stats.actions,
    actionsOk: stats.ok,
    failed: stats.failed,
    pauses: stats.pauses,
    fieldMapping: memory.keyCache || {},
    notes: stats.notes,
    formUrl: stats.formUrl || '',
  };

  fs.mkdirSync(path.join(__dirname, 'runs'), { recursive: true });
  const logFile = path.join(__dirname, 'runs', `run-${Date.now()}.json`);
  fs.writeFileSync(logFile, JSON.stringify(summary, null, 2));

  log('\n━━━━━ SUMMARY');
  log(`  Result:   ${summary.result}`);
  log(`  Time:     ${summary.totalSeconds}s total (${summary.llmSeconds}s in ${summary.llmCalls} LLM calls)`);
  log(`  Actions:  ${summary.actionsOk}/${summary.actions} succeeded`);
  if (summary.failed.length) log(`  Failed:   ${summary.failed.join('; ')}`);
  log(`  Log:      ${path.relative(process.cwd(), logFile)}`);

  return { summary, browser, page };
}

module.exports = runAgent;
module.exports.dismissCookies = dismissCookies;

// ---- run from the command line ----
if (require.main === module) {
  const target = process.argv[2] || 'test-forms/form2.html';
  runAgent(target)
    .then(async ({ browser, summary }) => {
      if (summary.result === 'ready-to-submit') {
        console.log('\n✅ Agent finished. Review the form in the browser and submit it yourself.');
      }
      await askUser('The browser stays open so you can review/submit.');
      if (browser) await browser.close().catch(() => {});
    })
    .catch((err) => {
      console.error('\n❌ ERROR:', err.message);
      process.exit(1);
    });
}
