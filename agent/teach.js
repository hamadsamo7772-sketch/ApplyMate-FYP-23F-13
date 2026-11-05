// teach.js — the ApplyMate team records the route to a scholarship's application form ONCE.
// Afterwards the agent repeats it by itself for every student.
//
//   npm run teach -- daad-fine-art          (a programme key from server/catalog/programs.js)
//   npm run teach -- daad-fine-art https://portal.daad.de/    (optional: start address)
//
// 1. A browser window opens. Log in yourself if the portal asks (your password is never recorded).
// 2. Press Enter, then click your way to the application form like a student would.
// 3. On each form page press Enter: the page's fields are read (names only, never values).
// 4. Type "done": the route is saved in server/catalog/routes.json, and a report for the
//    profile mapping is saved in agent/runs/teach-<programme>-<time>.json
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const openBrowser = require('./browser');
const scanPage = require('./scanner');
const { dismissCookies } = require('./index');

const key = process.argv[2];
const programs = require('../server/catalog/programs');
const program = programs.find((p) => p.key === key);
const startUrl = process.argv[3] || program?.applyUrl;
if (!key || !startUrl) {
  console.log('Usage: npm run teach -- <programme key> [start address]');
  console.log('Programme keys:', programs.map((p) => p.key).join(', '));
  process.exit(1);
}

const ROUTES = path.join(__dirname, '..', 'server', 'catalog', 'routes.json');
const ask = (q) => new Promise((r) => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, (a) => { rl.close(); r(a.trim()); }); });

const { RECORDER } = require('./recorder');

// field names in a downloaded PDF form (some portals use a PDF form to fill and upload)
async function pdfFields(file) {
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), verbosity: 0 }).promise;
    const fields = (await doc.getFieldObjects()) || {};
    await doc.destroy();
    return Object.entries(fields).map(([name, list]) => ({ name, type: list[0]?.type, options: list[0]?.items?.map((i) => i.displayValue) }));
  } catch (e) { return [{ error: e.message }]; }
}

(async () => {
  console.log(`\n🎓 Teaching the route for: ${program ? program.title : key}\n   Start: ${startUrl}`);
  const { browser, page } = await openBrowser(startUrl);
  const ctx = page.context();
  const steps = [];
  let recording = false;
  await ctx.exposeBinding('__amRecord', (_src, step) => {
    if (!recording) return;
    const last = steps[steps.length - 1];
    if (last && JSON.stringify(last) === JSON.stringify(step)) return;
    if (step.type === 'click' && last?.type === 'click' && last.text === step.text) return;
    steps.push(step);
    console.log(`   ● recorded: ${step.type === 'click' ? `click “${step.text}”` : `${step.label} = ${step.value}`}`);
  });
  await ctx.addInitScript(RECORDER);
  const inject = async () => { for (const f of page.frames()) await f.evaluate(RECORDER).catch(() => {}); };
  page.on('framenavigated', () => inject());

  const downloads = [];
  page.on('download', async (d) => {
    const dir = path.join(__dirname, 'runs', 'downloads');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, d.suggestedFilename());
    await d.saveAs(file).catch(() => {});
    const entry = { file: path.basename(file) };
    if (/\.pdf$/i.test(file)) entry.fields = await pdfFields(file);
    downloads.push(entry);
    console.log(`   ⬇ downloaded ${entry.file}${entry.fields ? ` (${entry.fields.length} PDF form fields)` : ''}`);
  });

  await ask('\nSTEP 1  Log in yourself if the portal asks. When you see the portal’s start page, press Enter… ');
  recording = true;
  await inject();
  console.log('\nSTEP 2  Now click your way to the application form exactly as a student would.');
  console.log('        (e.g. Personal Funding → Application → choose programme, country, status → Continue)');
  await ask('        When the FIRST page of the application form is open, press Enter… ');

  const route = [...steps];
  const scans = [];
  for (let n = 1; ; n++) {
    await dismissCookies(page);
    const scan = await scanPage(page);
    const safe = {
      page: n, url: scan.url.split('?')[0], heading: scan.heading || scan.title, captcha: scan.captcha,
      fields: scan.fields.map(({ value, id, ...f }) => ({ ...f, options: f.options?.slice(0, 25).map((o) => (typeof o === 'string' ? o : o.label)) })),
      buttons: scan.buttons.map((b) => b.text),
    };
    scans.push(safe);
    console.log(`\n📄 Page ${n}: ${safe.heading}  (${safe.fields.length} fields)`);
    for (const f of safe.fields) console.log(`   - [${f.kind}${f.required ? ', required' : ''}] ${f.label}${f.options ? `  (${f.options.slice(0, 4).join(' / ')}${f.options.length > 4 ? ' / …' : ''})` : ''}`);
    const a = await ask('\nSTEP 3  Go to the next form page with the form’s own Next/Continue (never Submit) and press Enter to read it, or type "done": ');
    if (/^d(one)?$/i.test(a)) break;
  }

  console.log('\nThe route the agent will repeat for every student:');
  route.forEach((s, i) => console.log(`   ${i + 1}. ${s.type === 'click' ? `click “${s.text}”` : `${s.type} ${s.label} = ${s.value}`}`));
  const ok = await ask('\nSave this route? (y = yes, or type the numbers of steps to remove, e.g. "2 5"): ');
  let finalRoute = route;
  if (/^\d/.test(ok)) {
    const drop = new Set(ok.split(/[\s,]+/).map(Number));
    finalRoute = route.filter((_, i) => !drop.has(i + 1));
  }
  if (/^n/i.test(ok)) finalRoute = null;

  if (finalRoute) {
    const all = fs.existsSync(ROUTES) ? JSON.parse(fs.readFileSync(ROUTES, 'utf8')) : {};
    all[key] = { startUrl, steps: finalRoute, recordedAt: new Date().toISOString().slice(0, 10) };
    fs.writeFileSync(ROUTES, JSON.stringify(all, null, 2));
    console.log(`\n✅ Route saved in server/catalog/routes.json (restart the server to use it).`);
  }
  fs.mkdirSync(path.join(__dirname, 'runs'), { recursive: true });
  const report = path.join(__dirname, 'runs', `teach-${key}-${Date.now()}.json`);
  fs.writeFileSync(report, JSON.stringify({ programme: key, startUrl, route: finalRoute || route, pages: scans, downloads }, null, 2));
  console.log(`📝 Field report for the profile mapping: ${path.relative(process.cwd(), report)}  (send this file to the team)\n`);
  await browser.close().catch(() => {});
})().catch((e) => { console.error('❌', e.message); process.exit(1); });
