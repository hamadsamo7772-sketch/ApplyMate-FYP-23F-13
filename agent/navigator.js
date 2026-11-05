// navigator.js — gets from a programme's website to its application form, by itself.
//
// From the page it is on, the agent looks at the links and buttons and follows the one that
// leads towards applying ("Apply online", "How to apply", "Admissions", "Start application").
// Clear cases are decided by simple rules; when several links are equally good, the offline
// AI chooses (it sees only the link texts). It stops when it reaches:
//   - an application form (2+ fields to fill), or
//   - a sign-in / sign-up page (the student types the password), or
//   - a dead end (then it asks the student to open the form).

const scanPage = require('./scanner');
const execute = require('./executor');

const STRONG = /apply (now|online|here|today)|apply for (a |the )?(funding|scholarship|grant|programme|program)|online application|start (your |an |the |new )?application|new application|create (an )?application|application (form|portal)|begin (your )?application|submit (an |your )?application|continue (your )?application|my applications?/i;
// on funding portals (DAAD and others) the student's area is called "personal funding" etc.
const FUNDING = /personal funding|individual funding|scholarship application|funding application|my funding|new funding application/i;
const SIGN_UP = /create (an |your )?account|register( now)?$|^register|sign ?up|new (user|applicant)/i;
const SIGN_IN = /^(sign ?in|log ?in|login)\b|already have an account/i;
const MEDIUM = /^apply\b|\bapply\b|application|how to apply|admissions?|enrol|call for applications|applicant|candidature|bewerb|candidat|inscri|registration|get started|join (the |our )?programme/i;
const WEAK = /eligib|requirement|scholarship|funding|study with us|future students|prospective|portal|deadline|selection|programme|program|master|degree|international students/i;
const AVOID = /news|event|blog|staff|alumni|login help|faq|contact|privacy|cookie|imprint|legal|facebook|twitter|linkedin|instagram|youtube|x\.com|share|print|newsletter|subscribe|job|vacanc|career|tender|press|software|powered by|book a demo|request a demo|pricing|for institutions|for universities/i;
const CLOSED = /applications? (are|is) (now |currently )?closed|call (is )?closed|no longer accepting|application period has ended|deadline has passed/i;

// Fields that make a page "a form worth filling" (not a search box or a newsletter box)
// Site tools that are not part of the application: search boxes, filters, help widgets, newsletters
const NOT_FORM = /search|filter|newsletter|subscribe|keyword|service name|help library|chat/i;
function formFields(scan) {
  return (scan?.fields || []).filter((f) => !NOT_FORM.test(`${f.label} ${f.hint || ''}`) && f.kind !== 'checkbox');
}
const isSignIn = (scan) => (scan?.fields || []).some((f) => f.kind === 'password');

// "www.daad.de" and "portal.daad.de" are the same organisation; "decipherinc.com" is not
// "scholarship.hec.gov.pk" belongs to "hec.gov.pk" (not to every ".gov.pk" site); "portal.daad.de" to "daad.de"
const baseDomain = (u) => {
  try {
    const parts = new URL(u).hostname.split('.');
    const sld = parts[parts.length - 2] || '';
    const n = /^(gov|edu|ac|co|com|org|net)$/.test(sld) && (parts[parts.length - 1] || '').length === 2 ? 3 : 2;
    return parts.slice(-n).join('.');
  } catch { return ''; }
};

/** Is the page already an application form or a portal sign-in? */
async function isFormPage(page) {
  const scan = await scanPage(page);
  if (isSignIn(scan)) return 'sign-in';
  if (formFields(scan).length >= 2) return 'form';
  return '';
}

// Every link/button with where it goes. Links hidden inside closed dropdown menus count too
// (the agent opens their address directly); embedded forms (iframes) are listed as well.
async function candidates(page) {
  const lists = [];
  for (const frame of page.frames()) {
    if (frame !== page.mainFrame() && (frame.isDetached() || /^about:|EmptyDocument/i.test(frame.url()))) continue;
    lists.push(await linksIn(frame).catch(() => []));
  }
  return lists.flat().filter(Boolean);
}

// the links come back as text (see scanner.js: some old sites change built-in JavaScript)
async function linksIn(frame) {
  const raw = await frame.evaluate(() => {
    const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const out = [];
    const CLICKABLE = 'a, button, [role="button"], input[type="button"], [role="tab"], [role="menuitem"], [role="link"], [role="option"], [onclick], li[tabindex], span[tabindex], div[tabindex], ' +
      'ui5-button, ui5-link, ui5-li, ui5-tab, ui5-side-navigation-item, ui5-shellbar-item, ui5-card, ui5-tile';
    const deepAll = (sel) => {
      const out = [];
      const walk = (root) => { out.push(...root.querySelectorAll(sel)); root.querySelectorAll('*').forEach((e) => e.shadowRoot && walk(e.shadowRoot)); };
      walk(document);
      return out;
    };
    deepAll(CLICKABLE).forEach((el, i) => {
      if (el.closest('a, button') && el.closest('a, button') !== el && !el.matches('a, button')) return; // inside a link already listed
      const shown = visible(el);
      const text = (el.innerText || el.textContent || el.value || el.getAttribute('text') || el.getAttribute('aria-label') || el.title || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      const href = el.href && /^https?:/.test(el.href) ? el.href.split('#')[0] : '';
      if (!shown && !href) return; // a hidden button can't be clicked
      if (!text && !href) return;
      if (!href && text.length > 60) return; // a whole clickable panel, not a link
      const id = `${Math.random().toString(36).slice(2, 8)}${i}`;
      el.dataset.amNav = id;
      out.push({ nav: id, text, href, tag: el.tagName.toLowerCase(), hidden: !shown });
    });
    const __amStr = (v) => {
      let J = JSON;
      if (!/\[native code\]/.test(String(JSON.stringify))) {
        try { const f = document.createElement('iframe'); f.style.display = 'none'; (document.body || document.documentElement).appendChild(f); J = f.contentWindow.JSON; f.remove(); } catch (e) { /* keep JSON */ }
      }
      const saved = [Array.prototype.toJSON, Object.prototype.toJSON, String.prototype.toJSON];
      try { delete Array.prototype.toJSON; delete Object.prototype.toJSON; delete String.prototype.toJSON; return J.stringify(v); }
      finally { if (saved[0]) Array.prototype.toJSON = saved[0]; if (saved[1]) Object.prototype.toJSON = saved[1]; if (saved[2]) String.prototype.toJSON = saved[2]; }
    };
    return __amStr(out);
  });
  try { const list = JSON.parse(raw); return Array.isArray(list) ? list.filter((c) => c && typeof c === 'object') : []; } catch { return []; }
}

// the route saved for this scholarship (link texts in order); set by findForm
let preferred = () => false;

// knownAccount: the student already has an account on this portal -> sign in, don't register again
function score(c, here, knownAccount) {
  if (c.text && preferred(c.text)) return 30; // the saved route says: click this next
  if (c.text && SIGN_IN.test(c.text)) return knownAccount ? 12 : 5;
  if (c.text && SIGN_UP.test(c.text)) return knownAccount ? 0 : 11;
  if (!c.text || AVOID.test(c.text) || /^mailto:|^tel:/.test(c.href) || /\.(pdf|docx?|zip|jpg|png)$/i.test(c.href)) return 0;
  let n = 0;
  if (STRONG.test(c.text)) n += 10;
  else if (FUNDING.test(c.text)) n += 9;
  else if (MEDIUM.test(c.text)) n += 6;
  else if (WEAK.test(c.text)) n += 2;
  if (/apply|application|admission|dreamapply|portal|register|signup|sign-up/i.test(c.href)) n += 3;
  if (/dreamapply|apply\.|portal\.|admissions?\./i.test(c.href) && c.href && new URL(c.href).host !== new URL(here).host) n += 2; // separate application portal
  if (c.tag !== 'a' || /btn|button/i.test(c.text)) n += 1;
  if (c.hidden) n -= 1; // in a closed menu: fine, but a visible button is a better sign
  return /cancel|back|close/i.test(c.text) ? 0 : n;
}

async function askWhich(ask, here, options) {
  const prompt = `You are helping a student reach the ONLINE APPLICATION FORM of a scholarship / study programme.
The browser is on: ${here}
Which link is the best next step towards the application form (or the application portal's sign-in)?
Prefer: apply online, application portal, start application, how to apply, admissions.
Avoid: news, events, PDFs, contact, general information.

Links:
${options.map((o, i) => `${i + 1}. "${o.text}"${o.href ? ` -> ${o.href}` : ''}`).join('\n')}

Answer with the number of the best link.`;
  const n = await ask(prompt, { type: 'integer', minimum: 1, maximum: options.length });
  return options[Math.max(0, Math.min(options.length - 1, (Number(n) || 1) - 1))];
}


// ---- new tabs: some portals open the application in a new window; continue there ----
async function adoptNewTab(page, before, log) {
  const pages = page.context().pages().filter((p) => p !== page && !before.has(p) && !p.isClosed());
  const tab = pages.find((p) => !/^about:blank$/.test(p.url())) || pages[0];
  if (!tab) return false;
  await tab.waitForLoadState('domcontentloaded').catch(() => {});
  const url = tab.url();
  if (!/^https?:/.test(url)) return false;
  log(`  🗂 The site opened a new tab; continuing there → ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await tab.close().catch(() => {});
  return true;
}

// ---- a recorded route (from "npm run teach" or an earlier run): do exactly these steps ----
// step = "Personal Funding" | { type: 'click', text } | { type: 'select', label, value } | { type: 'fill', label, value }
async function doStep(page, step, log, settle) {
  const st = typeof step === 'string' ? { type: 'click', text: step } : step;
  const deadline = Date.now() + 15000; // slow portals: wait up to 15 s for the element to appear
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      try {
        if (st.type === 'click') {
          const cands = [
            frame.getByRole('link', { name: st.text, exact: true }),
            frame.getByRole('button', { name: st.text, exact: true }),
            frame.getByRole('tab', { name: st.text, exact: true }),
            frame.getByRole('menuitem', { name: st.text, exact: true }),
            frame.getByText(st.text, { exact: true }),
            // the card's text may also contain an icon, a line break or a short description
            frame.getByRole('link', { name: st.text }),
            frame.getByRole('button', { name: st.text }),
            frame.getByText(st.text),
          ];
          for (const c of cands) {
            const el = c.first();
            if (await el.isVisible({ timeout: 200 }).catch(() => false)) {
              const before = new Set(page.context().pages());
              await el.click({ timeout: 5000 });
              await page.waitForTimeout(1200);
              await adoptNewTab(page, before, log);
              await settle(page);
              return true;
            }
          }
        } else {
          const field = frame.getByLabel(st.label, { exact: false }).first();
          if (await field.isVisible({ timeout: 200 }).catch(() => false)) {
            if (st.type === 'select') await field.selectOption({ label: st.value }).catch(async () => field.selectOption(st.value));
            else await field.fill(st.value);
            await settle(page);
            return true;
          }
        }
      } catch { /* try the next frame / wait */ }
    }
    await page.waitForTimeout(1000);
  }
  return false;
}

async function replay(page, steps, { log, settle }) {
  // Do ALL recorded steps: on portals like DAAD the programme is chosen in a pop-up list on the
  // selection page, so the agent must not stop just because that page already has fields.
  if ((await isFormPage(page)) === 'sign-in') return true; // the student logs in first; the route comes after
  for (const [i, step] of steps.entries()) {
    const label = typeof step === 'string' ? step : step.text || `${step.label} = ${step.value}`;
    const ok = await doStep(page, step, log, settle);
    if (ok) { log(`  🧭 Saved route ${i + 1}/${steps.length}: “${label}”`); continue; }
    // the step is not on the page: fine if we are already on the form (e.g. the portal skipped a page)
    if (await isFormPage(page)) { log(`  ↪ Saved route step “${label}” not needed: the form is already open`); return true; }
    log(`  ⚠ Saved route step “${label}” was not on the page`);
    return false;
  }
  return !!(await isFormPage(page));
}

// ---- when stuck: a snapshot of what the agent could see, so the route can be fixed ----
async function snapshot(page) {
  const frames = [];
  for (const f of page.frames()) {
    const info = await f.evaluate(() => {
      let shadowHosts = 0;
      const texts = [];
      const walk = (root) => {
        root.querySelectorAll('*').forEach((e) => {
          if (e.shadowRoot) { shadowHosts++; walk(e.shadowRoot); }
        });
        root.querySelectorAll('a, button, [role], [onclick], input, select, textarea, label, h1, h2, h3, ui5-button, ui5-link, ui5-li, ui5-input, ui5-select').forEach((e) => {
          const t = (e.innerText || e.textContent || e.getAttribute('aria-label') || e.getAttribute('placeholder') || e.getAttribute('name') || '').replace(/\s+/g, ' ').trim().slice(0, 60);
          if (texts.length < 150) texts.push(`${e.tagName.toLowerCase()}${e.getAttribute('role') ? `[${e.getAttribute('role')}]` : ''}${e.type ? `(${e.type})` : ''}: ${t}`);
        });
      };
      walk(document);
      return { title: document.title, shadowHosts, elements: document.querySelectorAll('*').length, texts };
    }).catch((e) => ({ error: e.message.split('\n')[0] }));
    let box = null;
    try { box = f === page.mainFrame() ? null : await (await f.frameElement()).boundingBox(); } catch { /* detached */ }
    frames.push({ url: f.url().split('?')[0], box, ...info });
  }
  return { url: page.url().split('?')[0], tabs: page.context().pages().map((p) => p.url().split('?')[0]), frames };
}

/**
 * Moves the page towards the application form.
 * @returns {{ arrived: boolean, reason: 'form'|'sign-in'|'dead-end'|'closed-note', message?: string, closedNote?: string }}
 */
async function findForm(page, { ask, log = console.log, maxHops = 6, dismissCookies, settle, hasAccount = () => false, hints = [], prefer = [], steps = [], stayOnSite = false } = {}) {
  if (steps.length) {
    await settle(page);
    if (await replay(page, steps, { log, settle })) {
      const kind = await isFormPage(page);
      return { arrived: true, reason: kind, closedNote: '', trail: steps.map((x) => (typeof x === 'string' ? x : x.text || x.label)), entryUrl: '' };
    }
    // the recorded route starts after login: if its first step is missing, the student is probably signed out
    const signIn = (await candidates(page)).find((c) => c.text && SIGN_IN.test(c.text) && (!c.href || baseDomain(c.href) === baseDomain(page.url())));
    if (signIn) {
      log(`  🔑 Not signed in: opening “${signIn.text}”`);
      if (signIn.href) await page.goto(signIn.href, { waitUntil: 'domcontentloaded' }).catch(() => {});
      else for (const frame of page.frames()) { const el = await frame.$(`[data-am-nav="${signIn.nav}"]`).catch(() => null); if (el) { await el.click().catch(() => {}); break; } }
      await settle(page);
      if ((await isFormPage(page)) === 'sign-in') return { arrived: true, reason: 'sign-in', closedNote: '', trail: [], entryUrl: '' };
    }
    if ((await isFormPage(page)) === 'sign-in') return { arrived: true, reason: 'sign-in', closedNote: '', trail: [], entryUrl: '' };
    // with a recorded route the agent does not wander around the internet: the student shows it the page once
    return {
      arrived: false, reason: 'dead-end', closedNote: '', trail: [],
      message: 'This is not the page where the saved route starts. Please log in to the portal (or open your dashboard) in the browser window, then press continue.',
    };
  }
  const norm = (t) => String(t || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const wanted = prefer.map(norm).filter(Boolean);
  const clicked = new Set(); // texts already clicked in this search: never click the same thing twice
  preferred = (text) => wanted.includes(norm(text)) && !clicked.has(norm(text));
  const visited = new Set();
  const leftHints = [...hints]; // application links found earlier on the programme's website
  const trail = [];             // the links followed, so a successful route can be saved and reused
  const home = baseDomain(page.url());
  let guesses = 0;              // AI guesses without a clear "Apply" link: at most 2, then ask the student
  let entryUrl = '';            // the portal page with "Sign in / Create account": the same for every student
  let closedNote = '';

  for (let hop = 0; hop <= maxHops; hop++) {
    await settle(page);
    const cookie = dismissCookies && (await dismissCookies(page));
    if (cookie) { log(`  🍪 Closed the cookie banner ("${cookie}")`); await settle(page); }

    const scan = await scanPage(page);
    const here = page.url();
    visited.add(here.split('#')[0]);

    if (isSignIn(scan)) return { arrived: true, reason: 'sign-in', closedNote, trail, entryUrl };
    if (formFields(scan).length >= 2) return { arrived: true, reason: 'form', closedNote, trail, entryUrl };

    // a start page of a form tool: one choice that is already made ("I want to fill in a new form")
    // and a Next / Start button. Choosing a new form is harmless, so the agent continues with Next.
    const choices = scan.fields.filter((f) => !NOT_FORM.test(`${f.label} ${f.hint || ''}`));
    const startBtn = scan.buttons.find((b) => !b.disabled && /^(next|continue|start|begin|weiter|proceed)\b|^(start|fill in) (a |the )?(new )?(form|application)/i.test(b.text.replace(/[>»›→\s]+$/, '').trim()) && !/submit|send|finish/i.test(b.text));
    if (startBtn && choices.length <= 2 && choices.every((f) => ['radio', 'select', 'checkbox'].includes(f.kind) && f.filled) && !clicked.has(norm(startBtn.text))) {
      clicked.add(norm(startBtn.text));
      log(`  ▶ Start page of the form: ${choices.length ? 'keeping the selected choice and ' : ''}clicking “${startBtn.text}”`);
      await execute(page, [{ action: 'click', target: startBtn.id, label: startBtn.text }], () => {});
      trail.push(startBtn.text);
      continue;
    }

    const text = await page.evaluate(() => document.body.innerText.slice(0, 20000)).catch(() => '');
    if (!closedNote && CLOSED.test(text)) {
      closedNote = `This website says: “${text.match(CLOSED)[0]}”. Check the deadline before you finish.`;
      log(`  ⚠ ${closedNote}`);
    }

    // slow portals build their menus with scripts: if nothing useful is there yet, wait and look again
    let all = [];
    for (let wait = 0; wait < 12; wait++) {
      all = (await candidates(page)).filter((c) => (!c.href || !visited.has(c.href)) && !clicked.has(norm(c.text)));
      const useful = all.some((c) => c.text && (score(c, here, hasAccount(new URL(here).hostname)) >= 5 || preferred(c.text)));
      if (useful || (wait >= 2 && all.filter((c) => c.text).length >= 3)) break;
      if (wait >= 5 && all.filter((c) => c.text).length >= 1) break; // something is there, just nothing useful
      if (wait === 0) log('  ⏳ The page is still loading its menu, waiting…');
      await page.waitForTimeout(1500);
      if (await isFormPage(page)) break;
    }
    const already = await isFormPage(page);
    if (already) return { arrived: true, reason: already, closedNote, trail, entryUrl };
    const known = hasAccount(new URL(here).hostname);
    const offSite = (c) => c.href && baseDomain(c.href) !== home && baseDomain(c.href) !== baseDomain(here);
    let ranked = all
      .map((c) => ({ ...c, s: score(c, here, known) }))
      .filter((c) => (stayOnSite ? !offSite(c) : true) && c.s >= (offSite(c) ? 9 : 5))
      .sort((a, b) => b.s - a.s);

    // nothing obvious: try an application link found earlier on this programme's website
    if (!ranked.length) {
      let hint;
      do { hint = leftHints.shift(); } while (hint && (visited.has(hint.href) || (stayOnSite && baseDomain(hint.href) !== home)));
      if (hint) ranked = [{ text: hint.text || 'application link', href: hint.href, s: 5 }];
    }
    // still nothing: let the offline AI read all the links on the page
    if (!ranked.length && ask && guesses < 2) {
      guesses++;
      const seen = new Set();
      const pool = all
        .filter((c) => c.text && !AVOID.test(c.text) && !/^mailto:|^tel:/.test(c.href) && !/\.(pdf|docx?|zip|jpg|png)$/i.test(c.href))
        .filter((c) => !offSite(c) && !/survey|feedback|questionnaire|shop|donat/i.test(`${c.text} ${c.href}`))
        .filter((c) => { const k = c.href || c.text; if (seen.has(k)) return false; seen.add(k); return true; })
        .map((c) => ({ ...c, s: score(c, here, known) }))
        .sort((a, b) => b.s - a.s)
        .slice(0, 40);
      if (pool.length) {
        try {
          const choice = await askWhich(ask, here, pool);
          log(`  🧠 No obvious “Apply” link; the offline AI read ${pool.length} links and chose “${choice.text}”`);
          ranked = [choice];
        } catch { /* fall through to dead end */ }
      }
    }
    if (!ranked.length) {
      const sample = all.filter((c) => c.text).slice(0, 25).map((c) => c.text).join(' | ');
      log(`  ⚠ No link towards the application. Links on this page: ${sample || '(none)'}`);
      return {
        arrived: false, reason: 'dead-end', closedNote,
        trail,
        message: 'I could not find the application form on this website. Please open the application form (or the portal’s sign-in page) in the browser window, then press continue. ApplyMate will remember the way for every student after you.',
      };
    }

    // a clear winner -> take it; several equally good -> let the offline AI choose
    let pick = ranked[0];
    const tied = ranked.filter((c) => c.s >= ranked[0].s - 1).slice(0, 8);
    if (tied.length > 1 && ask) {
      try {
        pick = await askWhich(ask, here, tied);
        log(`  🧠 ${tied.length} possible links, the offline AI chose “${pick.text}”`);
      } catch { /* keep the rule-based pick */ }
    }

    log(`  🧭 ${preferred(pick.text) ? 'Saved route: ' : ''}Following “${pick.text}”${pick.href ? ` → ${pick.href}` : ''}`);
    trail.push(pick.text);
    clicked.add(norm(pick.text));
    entryUrl = SIGN_IN.test(pick.text || '') || SIGN_UP.test(pick.text || '') ? here : '';
    if (pick.href) {
      visited.add(pick.href);
      await page.goto(pick.href, { waitUntil: 'domcontentloaded' }).catch((e) => log(`  ⚠ ${e.message.split('\n')[0]}`));
    } else {
      // a button: click it (may open the form on the same page or a new tab)
      const before = new Set(page.context().pages());
      let clicked = false;
      for (const frame of page.frames()) {
        const el = await frame.$(`[data-am-nav="${pick.nav}"]`).catch(() => null);
        if (el) { await el.click().catch(() => {}); clicked = true; break; }
      }
      if (!clicked) log('  ⚠ That button disappeared before it could be clicked');
      await page.waitForTimeout(2500);
      await adoptNewTab(page, before, log);
    }
  }
  return {
    arrived: false, reason: 'dead-end', closedNote, trail,
    message: 'I followed several links but did not reach the application form. Please open it in the browser window, then press continue. ApplyMate will remember the way for every student after you.',
  };
}

module.exports = { NOT_FORM, findForm, formFields, isFormPage, replay, snapshot, adoptNewTab };
