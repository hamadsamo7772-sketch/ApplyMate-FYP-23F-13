// test-scrapers.js — check the live sources from the command line (no database needed)
//   npm run test-scrapers          (hidden browser)
//   npm run test-scrapers-show     (you can watch the browser open Rozee)
if (process.argv.includes('--show')) process.env.SCRAPER_SHOW = 'true';
const { officialScholarships } = require('./official-status');
const { scrapeErasmus } = require('./erasmus');
const { jobFromLink } = require('./job-link');
const { scoreOpportunity } = require('../match');

const profile = {
  address: { city: 'Sukkur' },
  education: { lastDegree: 'BS Computer Science', program: 'MS Computer Science' },
  job: { currentTitle: 'Web Development Teacher' },
  preferences: {
    degreeLevel: 'Masters',
    studyField: 'computer science',
    jobKeywords: 'web developer, react',
    preferredCities: 'Sukkur, Karachi, Remote',
  },
};

function show(list, n = 8) {
  const ranked = list
    .map((o) => ({ ...o, match: scoreOpportunity(o, profile) }))
    .filter((o) => !o.match.expired)
    .sort((a, b) => b.match.score - a.match.score);
  for (const o of ranked.slice(0, n)) {
    console.log(`  [${String(o.match.score).padStart(3)}] ${o.title}`);
    console.log(`        ${[o.org, o.location, o.level, o.status && `status: ${o.status}`, o.deadline, o.salary].filter(Boolean).join(' | ')}`);
    console.log(`        ${o.match.reasons.join('; ')}`);
    console.log(`        ${o.url}`);
  }
}

async function section(title, fn) {
  console.log(`\n${title}`);
  try {
    const list = await fn();
    console.log(`  found ${list.length}`);
    show(list);
  } catch (e) {
    console.log('  ❌', e.message);
  }
}

(async () => {
  await section('🎓 OFFICIAL PROGRAMMES (Fulbright, Chevening, Stipendium Hungaricum, DAAD)', async () => {
    const { list, errors } = await officialScholarships({ live: true });
    if (errors.length) console.log('  ⚠ live status check failed:', errors.join('; '));
    return list;
  });
  await section('🇪🇺 ERASMUS MUNDUS (official EU catalogue)', scrapeErasmus);
  // Rozee.pk blocks automated browsers (Cloudflare), so jobs are added by link
  await section('💼 JOBS added by link (example Rozee links)', async () => [
    jobFromLink('https://www.rozee.pk/systems-limited-react-developer-karachi-jobs-1870001'),
    jobFromLink('https://www.rozee.pk/abc-tech-web-developer-sukkur-jobs-1870002'),
  ]);
})();
