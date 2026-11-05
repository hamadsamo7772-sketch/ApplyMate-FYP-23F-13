// entries.js — lists the student adds one by one, e.g. HEC's education history:
//   [Add Education] -> pop-up with steps (Next, Next ...) -> [Add Education] (saves it) -> next degree
//
// For every degree in the profile's education history that the page does not list yet, the agent
// opens the pop-up, fills it with THAT degree's data (profile.edu = the degree), and saves it.
// Saving an entry only stores the student's profile on the portal: it is not submitting an application.

const scanPage = require('./scanner');
const planActions = require('./planner');
const execute = require('./executor');

const ADD_BUTTON = /^\+?\s*add (new )?(education|qualification|degree|academic record|educational record)s?$/i;
const SAVE_BUTTON = /^(add|save|update|submit) (education|qualification|degree|record)s?$|^(save|add|update|ok|done)$/i;

// Degrees in the order portals expect them (lowest to highest)
const LEVELS = [
  { key: 'matric', section: 'eduMatric', name: 'Matric / O-level', listed: /matric|secondary school certificate|o\s*-?\s*level/i },
  { key: 'intermediate', section: 'eduInter', name: 'Intermediate / A-level', listed: /intermediate|higher secondary|a\s*-?\s*level/i },
  { key: 'bachelor', section: 'eduBachelor', name: "Bachelor's", listed: /bachelor/i },
  { key: 'master', section: 'eduMaster', name: "Master's / MS / MPhil", listed: /master|m\.?phil|\bms\b/i },
];

/** The degrees from the profile, as the "edu" data the planner uses for one pop-up */
function degreesOf(profile) {
  const full = profile.personal?.fullName || [profile.personal?.firstName, profile.personal?.lastName].filter(Boolean).join(' ');
  return LEVELS
    .map((l) => ({ ...l, data: profile[l.section] || {} }))
    .filter((l) => l.data.board || l.data.school || l.data.programTitle)
    .map((l) => ({
      ...l,
      edu: {
        levelKey: l.key,
        level: l.data.level || l.name,
        nameOnDegree: l.data.nameOnDegree || full,
        ...l.data,
        incomplete: l.data.incomplete === 'Yes' ? 'Yes' : '',
      },
    }));
}

/** Is this a page that lists entries with an "Add …" button (and no open pop-up)? */
function addButtonOf(scan) {
  if (scan.fields.some((f) => f.dialog) || scan.buttons.some((b) => b.dialog && SAVE_BUTTON.test(b.text))) return null;
  return scan.buttons.find((b) => !b.disabled && ADD_BUTTON.test(b.text)) || null;
}

/**
 * Adds every missing degree. Returns { added, problems } or null if the page has no "Add" list.
 * ctx = { page, profile, ask, log, onPause, settle, keyCache }
 */
async function fillEntries(scan, ctx) {
  const { page, profile, ask, log, onPause, settle } = ctx;
  if (!addButtonOf(scan)) return null;
  const text = await page.evaluate(() => document.body.innerText).catch(() => '');
  const missing = degreesOf(profile).filter((d) => !d.listed.test(text));
  if (!missing.length) return { added: 0, problems: [] };

  log(`\n━━━━━ EDUCATION HISTORY  |  adding ${missing.map((d) => d.name).join(', ')}`);
  let added = 0;
  const problems = [];

  for (const degree of missing) {
    const current = await scanPage(page);
    const add = addButtonOf(current);
    if (!add) { problems.push(`could not find the Add button for ${degree.name}`); break; }
    log(`\n  ➕ ${degree.name}: opening “${add.text}”`);
    await execute(page, [{ action: 'click', target: add.id, label: add.text }], log);
    await settle(page);

    // the pop-up: fill each step with THIS degree's data, click Next, finally save
    const entryProfile = { ...profile, edu: degree.edu };
    const memory = { keyCache: ctx.keyCache };
    let saved = false;
    for (let step = 0; step < 15 && !saved; step++) {
      await settle(page);
      const full = await scanPage(page);
      const inDialog = full.fields.some((f) => f.dialog) || full.buttons.some((b) => b.dialog);
      const scan = inDialog ? { ...full, fields: full.fields.filter((f) => f.dialog), buttons: full.buttons.filter((b) => b.dialog) } : full;
      const plan = await planActions(scan, entryProfile, memory, ask);
      for (const n of plan.notes) log(`    ℹ ${n}`);

      if (plan.actions.length) {
        await execute(page, plan.actions, (l) => log(`  ${l}`));
        continue;
      }
      if (plan.stop?.reason === 'needs-user' || plan.stop?.reason === 'errors' || plan.stop?.reason === 'captcha') {
        log(`\n⏸  ${plan.stop.reason.toUpperCase()}: ${degree.name}: ${plan.stop.message}`);
        if (!(await onPause({ ...plan.stop, message: `${degree.name}: ${plan.stop.message}` }))) return { added, problems, stopped: true };
        memory.attempts = {};
        continue;
      }
      // nothing left to fill in this pop-up: save the entry
      const saveBtn = [...scan.buttons].reverse().find((b) => !b.disabled && SAVE_BUTTON.test(b.text));
      if (!saveBtn) { problems.push(`${degree.name}: no save button in the pop-up`); break; }
      await execute(page, [{ action: 'click', target: saveBtn.id, label: saveBtn.text }], (l) => log(`  ${l}`));
      await settle(page);
      const after = await page.evaluate(() => document.body.innerText).catch(() => '');
      saved = degree.listed.test(after) && !(await scanPage(page)).fields.some((f) => f.dialog);
      log(saved ? `  ✅ ${degree.name} added to the education history` : `  ⚠ ${degree.name} was not saved yet (the portal may want more)`);
      if (!saved) {
        if (!(await onPause({ kind: 'action', reason: 'needs-user', message: `${degree.name}: the portal did not save it. Check the pop-up for a red field, fix it and save it, then continue.` }))) return { added, problems, stopped: true };
        const again = await page.evaluate(() => document.body.innerText).catch(() => '');
        saved = degree.listed.test(again);
      }
    }
    if (saved) added++;
  }
  return { added, problems };
}

module.exports = { fillEntries, addButtonOf, degreesOf };
