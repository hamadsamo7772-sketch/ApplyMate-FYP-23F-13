// official-status.js — turns the programme catalogue into opportunities, with a status:
//   open      applications are open now
//   closed    this cycle is over (shows when the next one usually opens)
//   upcoming  opens soon (within 60 days)
//   varies    each course has its own deadline (DAAD EPOS)
// If a programme has `statusCheck`, its official page is read live and overrides the dates.

const programs = require('../catalog/programs');

const DAY = 24 * 60 * 60 * 1000;
const fmt = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

function statusFromDates(p, now = new Date()) {
  const c = p.cycle || {};
  if (c.varies) return { status: 'varies', deadline: 'Varies by course' };
  const opens = c.opens && new Date(c.opens);
  const closes = c.closes && new Date(`${c.closes}T23:59:59`);
  const when = c.text || `${fmt(c.opens)} – ${fmt(c.closes)}`;
  if (opens && now < opens) {
    return { status: opens - now < 60 * DAY ? 'upcoming' : 'closed', deadline: `${c.label}: ${when}` };
  }
  if (closes && now <= closes) return { status: 'open', deadline: `${c.label}: ${when}` };
  return { status: 'closed', deadline: `${c.label} (${when}) is closed` };
}

async function liveStatus(check) {
  const res = await fetch(check.url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ApplyMate-FYP/0.3' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = (await res.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  if (check.closed.test(text)) return 'closed';
  if (check.open.test(text)) return 'open';
  return null; // page didn't say clearly
}

// routes recorded with "npm run teach" (one per programme)
function recordedRoutes() {
  try { return JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'catalog', 'routes.json'), 'utf8')); } catch { return {}; }
}

function toOpportunity(p, s, extra = {}) {
  const rec = recordedRoutes()[p.key];
  return {
    type: 'scholarship',
    source: 'official',
    sourceKey: p.key,
    title: p.title,
    org: p.org,
    url: p.infoUrl,
    applyUrl: rec?.startUrl || p.applyUrl,
    presetTrail: p.presetTrail || [],
    presetSteps: rec?.steps || [],
    portal: p.portal || null,
    location: p.location,
    level: p.levels.join(' / '),
    levels: p.levels,
    deadline: s.deadline,
    status: s.status,
    statusNote: s.status === 'open' ? '' : p.nextCycle,
    opensAt: p.cycle?.opens ? new Date(p.cycle.opens) : null,
    closesAt: p.cycle?.closes ? new Date(`${p.cycle.closes}T23:59:59`) : null,
    fieldsAll: p.fields === 'all',
    fieldWords: Array.isArray(p.fields) ? p.fields : [],
    fieldNote: p.fieldNote,
    eligibility: p.eligibility,
    requires: p.requires || {},
    documents: p.documents || [],
    howToApply: p.howToApply || [],
    covers: p.covers,
    verified: p.verified,
    description: `${p.covers}. ${p.fieldNote}.`,
    tags: p.levels,
    ...extra,
  };
}

/** The official programmes as opportunities. live=true also reads official pages. */
async function officialScholarships({ live = false } = {}) {
  const out = [];
  const errors = [];
  for (const p of programs) {
    let s = statusFromDates(p);
    let checkedLive = false;
    if (live && p.statusCheck) {
      try {
        const st = await liveStatus(p.statusCheck);
        if (st) {
          s = { ...s, status: st };
          checkedLive = true;
        }
      } catch (err) {
        errors.push(`${p.key}: ${err.message}`);
      }
    }
    out.push(toOpportunity(p, s, checkedLive ? { liveCheckedAt: new Date() } : {}));
  }
  return { list: out, errors };
}

module.exports = { officialScholarships, statusFromDates };
