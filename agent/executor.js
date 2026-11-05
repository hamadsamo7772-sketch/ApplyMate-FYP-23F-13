// executor.js â€” performs the planner's actions on the page and checks each one worked.
// Targets come from scanner.js: every element has data-am-id, so [data-am-id="f3"] is
// always exactly one element.

const path = require('path');
const fs = require('fs');

// Safety net: even if the planner gets it wrong, never click a final-submit button.
const NEXT_BUTTON = /^(next|continue|proceed|weiter|next step|save (and|&) (continue|next))\b/i;
const SUBMIT_BUTTON = /submi(t|ssion)|final|apply|send|finish|complete|confirm|register|sign up|pay/i;
// "Save progress" / "Save draft" stores the student's answers on the portal: also only the student does that
const SAVE_ONLY = /save (my )?(progress|draft|for later|and (exit|close|return))|^save$|save as draft|continue later/i;

const sel = (id) => `[data-am-id="${id}"]`;
// ids like "2-f5" live in frame 2 of the last scan (see scanner.js); plain ids are on the page itself
const where = (page, id) => {
  const m = /^(\d+)-/.exec(String(id));
  return (m && page.__amFrames?.[+m[1]]) || page;
};

// Sites often reformat what you type: 80000 -> "80,000", 1234512345671 -> "12345-1234567-1".
// Compare only letters and digits so those still count as correct.
const sameValue = (a, b) =>
  String(a).toLowerCase().replace(/[^a-z0-9]/g, '') === String(b).toLowerCase().replace(/[^a-z0-9]/g, '');

// Date fields with a calendar (Angular Material, jQuery UI, ...) accept different formats.
// The profile stores YYYY-MM-DD; try the common formats until the field keeps the date.
const isDateKey = (key) => /date|dateOfBirth|Expiry/i.test(key || '');
function dateVariants(iso, first) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return [iso];
  const [, y, mo, d] = m;
  const all = [first, `${+mo}/${+d}/${y}`, `${d}/${mo}/${y}`, `${y}-${mo}-${d}`, `${d}-${mo}-${y}`, `${mo}/${d}/${y}`];
  return [...new Set(all.filter(Boolean))];
}
const sameDate = (shown, iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m || !shown) return false;
  const digits = String(shown).replace(/[^0-9]/g, ' ').trim().split(/\s+/).map(Number);
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const hasMonth = digits.includes(mo) || String(shown).toLowerCase().includes(MONTHS[mo - 1]);
  return digits.includes(y) && digits.includes(d) && hasMonth;
};

// A read-only box that opens a calendar (jQuery UI, flatpickr): typing is impossible, so the date is set
// through the calendar itself (it writes the date in the site's own format), or else into the box directly.
async function pickDate(page, a) {
  const root = where(page, a.target);
  const loc = root.locator(sel(a.target));
  await root.evaluate(([s, iso, text]) => {
    const el = document.querySelector(s);
    if (!el) return '';
    const [y, m, d] = (iso || '').split('-').map(Number);
    const $ = window.jQuery;
    if (iso && $ && $.fn && $.fn.datepicker && $(el).hasClass('hasDatepicker')) $(el).datepicker('setDate', new Date(y, m - 1, d));
    else if (iso && el._flatpickr) el._flatpickr.setDate(new Date(y, m - 1, d), true);
    else el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return String(el.value || '');
  }, [sel(a.target), a.iso || '', a.value]).catch(() => '');
  const now = await loc.inputValue().catch(() => '');
  if (!now || (a.iso && !sameDate(now, a.iso))) throw new Error(`the calendar did not take the date ${a.iso || a.value}`);
  a.value = now;
}

async function fill(page, a) {
  if (a.picker) return pickDate(page, a);
  const loc = where(page, a.target).locator(sel(a.target));

  if (isDateKey(a.key) && a.iso) {
    for (const v of dateVariants(a.iso, a.value)) {
      await loc.fill('');
      await loc.fill(v);
      await loc.press('Tab').catch(() => {});           // close the calendar, let the site parse the date
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(250);
      const now = await loc.inputValue().catch(() => '');
      const invalid = (await loc.getAttribute('aria-invalid').catch(() => '')) === 'true';
      if (now && !invalid && sameDate(now, a.iso)) { a.value = now; return; }
    }
    throw new Error(`the date field did not accept ${a.iso} in any common format`);
  }

  await loc.fill(a.value);

  // Some fields (masks, custom inputs) ignore fill(); type it key by key instead
  if (!sameValue(await loc.inputValue(), a.value)) {
    await loc.fill('');
    await loc.pressSequentially(a.value, { delay: 30 });
  }
  const now = await loc.inputValue();
  if (!sameValue(now, a.value)) throw new Error(`field shows "${now}" instead of "${a.value}"`);
}

async function select(page, a) {
  const loc = where(page, a.target).locator(sel(a.target));
  await loc.selectOption({ label: a.value });
}

// Some sites change the browser's built-in JavaScript, so running our own code on an element
// (locator.evaluate) can fail there. Use Playwright's own actions wherever one exists.
async function check(page, a) {
  const root = where(page, a.target);
  const loc = root.locator(sel(a.target));
  const id = await loc.getAttribute('id').catch(() => null);
  // styled radios/checkboxes hide the real input under a picture: try the input, then its label, then a forced click
  const tries = [
    () => loc.check({ force: true, timeout: 3000 }),
    ...(id ? [() => root.locator(`label[for="${id.replace(/"/g, '\\"')}"]`).first().click({ timeout: 3000 })] : []),
    () => loc.click({ force: true, timeout: 3000 }),
  ];
  for (const t of tries) {
    await t().catch(() => {});
    await page.waitForTimeout(150);
    if (await loc.isChecked().catch(() => false)) return;
  }
  throw new Error('still not checked');
}

const UPLOAD_ERROR = /failed to (fetch|upload)|upload failed|error (while )?uploading|file (is )?too (large|big)|invalid file|file type not allowed|unsupported file/i;

async function upload(page, a) {
  const file = path.resolve(__dirname, a.value);
  if (!fs.existsSync(file)) throw new Error(`file not found: ${file}`);
  const root = where(page, a.target);
  const loc = root.locator(sel(a.target));

  // The upload box around the input: the nearest parent that also holds the widget's visible text box.
  // Upload widgets (Plupload) may replace the hidden input after a file is chosen, so the box is
  // remembered by its id (taken before uploading) when it has one.
  const TEXT_BOX = 'input:not([type="hidden"]):not([type="file"]), textarea';
  let box = loc.locator('xpath=ancestor::*[3]');
  for (let n = 1; n <= 5; n++) {
    const parent = loc.locator(`xpath=ancestor::*[${n}]`);
    if (!(await parent.locator(TEXT_BOX).count().catch(() => 0))) continue;
    const id = await parent.getAttribute('id', { timeout: 1000 }).catch(() => null);
    box = id ? root.locator(`[id="${id.replace(/"/g, '\\"')}"]`) : parent;
    break;
  }
  // what the box shows: its text and the values of its text boxes (many widgets show the file name there)
  const shown = async () => {
    const parts = [await box.innerText({ timeout: 1000 }).catch(() => '')];
    const inputs = box.locator(TEXT_BOX);
    const n = Math.min(await inputs.count().catch(() => 0), 6);
    for (let i = 0; i < n; i++) parts.push(await inputs.nth(i).inputValue({ timeout: 1000 }).catch(() => ''));
    return parts.join(' ');
  };
  const before = await shown();
  await loc.setInputFiles(file); // works on hidden inputs too
  const name = path.basename(file).toLowerCase();
  const stem = name.replace(/\.[^.]+$/, '');
  for (let wait = 0; wait < 8; wait++) {
    await page.waitForTimeout(wait ? 1000 : 1500); // many sites start uploading straight away
    const after = await shown();
    const err = after.match(UPLOAD_ERROR);
    if (err && !before.match(UPLOAD_ERROR)) throw new Error(`the site says: "${err[0]}"`);
    // a plain file input keeps the file itself (its value ends with the file name); widgets show the name in their box
    const value = (await loc.inputValue({ timeout: 1000 }).catch(() => '')).toLowerCase();
    if (value.includes(name) || after.toLowerCase().includes(stem)) return;
  }
  throw new Error('the file name did not appear after uploading');
}

async function dropdown(page, a) {
  // Custom dropdowns (React-Select, MUI, Angular Material, ng-select, select2):
  // open it, type into its search box if it has one, click the matching option
  const root = where(page, a.target);
  const loc = root.locator(sel(a.target));
  await loc.click();
  await page.waitForTimeout(400);

  const search = root.locator('.cdk-overlay-container input:visible, .mat-select-search-input:visible, .ng-dropdown-panel input:visible, .select2-search__field:visible').first();
  if (await loc.locator('xpath=self::input').count()) {
    await loc.pressSequentially(a.search || a.value, { delay: 40 });
  } else if (await search.count()) {
    await search.pressSequentially(a.search || a.value, { delay: 40 });
  } else if (await loc.locator('input').count()) {
    await loc.locator('input').first().pressSequentially(a.search || a.value, { delay: 40 }); // ng-select
  }
  await page.waitForTimeout(700);

  const OPTION = '[role="option"], mat-option, .mat-option, .mat-mdc-option, .ng-option, .select2-results__option, [class*="option"]';
  const want = a.match ? new RegExp(a.match, 'i') : a.value;
  const options = root.locator(OPTION).filter({ hasText: want });
  const exact = a.match ? options : options.filter({ hasText: new RegExp(`^\\s*${a.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i') });
  const pick = (await exact.count()) ? exact.first() : options.first();

  if (!(await pick.count())) {
    await page.keyboard.press('Escape');
    throw new Error(`no option "${a.value}" in the list`);
  }
  const picked = (await pick.innerText().catch(() => a.value)).trim();
  await pick.click();
  await page.waitForTimeout(400);

  // Check: the dropdown should now show the chosen value
  const box = loc.locator('xpath=ancestor-or-self::*[self::mat-select or self::ng-select or contains(@class, "mat-mdc-select") or contains(@class, "select2-selection") or contains(@class, "container")][1]');
  const shown = [
    await loc.innerText({ timeout: 1000 }).catch(() => ''),
    await loc.inputValue({ timeout: 1000 }).catch(() => ''),
    await ((await box.count()) ? box : loc.locator('xpath=..')).innerText({ timeout: 1000 }).catch(() => ''),
  ].join(' ').trim();
  const norm = (t) => t.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!norm(shown).includes(norm(picked).slice(0, 25)) && !norm(shown).includes(norm(a.value))) throw new Error(`dropdown shows "${shown}"`);
  a.value = picked;
}

async function click(page, a) {
  const loc = where(page, a.target).locator(sel(a.target));
  const text = ((await loc.innerText().catch(() => '')) || (await loc.inputValue().catch(() => ''))).trim();

  if ((SUBMIT_BUTTON.test(text) && !NEXT_BUTTON.test(text)) || SAVE_ONLY.test(text)) {
    throw new Error(`refused to click "${text}" â€” final submission is the user's job`);
  }
  try {
    await loc.click({ timeout: 8000 });
  } catch (err) {
    // something covers the button (a message pop-up, a toast, a loading layer): wait once, then try again
    await page.waitForTimeout(2000);
    try { await loc.click({ timeout: 5000 }); } catch {
      throw new Error('the button is covered by something on the page (a pop-up or message)');
    }
  }
}

const HANDLERS = { fill, select, check, upload, dropdown, click };

/**
 * Run the actions one by one. A failed action does not stop the others.
 * @returns array of { ...action, ok, error }
 */
async function execute(page, actions, log = console.log) {
  const results = [];

  for (const a of actions) {
    const handler = HANDLERS[a.action];
    const value = a.action === 'upload' ? path.basename(a.value) : a.value; // file name only, not the full path
    const shown = `${a.action.padEnd(8)} ${a.label}${value && a.action !== 'click' ? ` = ${value}` : ''}`;

    try {
      if (!handler) throw new Error(`unknown action "${a.action}"`);
      await handler(page, a);
      log(`  âœ… ${shown}`);
      results.push({ ...a, ok: true });
    } catch (err) {
      const msg = err.message.split('\n')[0];
      log(`  âŒ ${shown}  â†’  ${msg}`);
      results.push({ ...a, ok: false, error: msg });
    }

    await page.waitForTimeout(150); // let the page's own scripts react (show/hide fields etc.)
  }

  return results;
}

module.exports = execute;

