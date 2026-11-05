// opportunities.js — scholarships and jobs from the platforms in the FYP proposal:
//   Fulbright, Chevening, Stipendium Hungaricum, DAAD  -> official programme catalogue (+ live status check)
//   Erasmus Mundus                                     -> live, official EU catalogue (EACEA RSS)
//   Rozee.pk                                           -> jobs added by link (Rozee blocks automated browsers)
const express = require('express');
const { requireAuth } = require('./auth');
const { Opportunity } = require('./models');
const { scoreOpportunity } = require('./match');
const { officialScholarships } = require('./scrapers/official-status');
const { scrapeErasmus } = require('./scrapers/erasmus');
const { jobFromLink } = require('./scrapers/job-link');
const { fetchDetails } = require('./scrapers/details');

const router = express.Router();
router.use(requireAuth);

// Local demo portals: always available, so the agent can be shown even without internet.
// Their forms live in agent/test-forms and are served by this server at /demo/...
const demoListings = () => {
  const base = `http://localhost:${process.env.PORT || 5000}/demo`;
  return [
    {
      type: 'scholarship',
      title: 'International Exchange Scholarship 2027 (Demo Portal)',
      org: 'ApplyMate demo portal',
      url: `${base}/form2.html`,
      location: 'Local practice form, 3 pages',
      level: 'Masters / Exchange',
      status: 'open',
      deadline: 'Always open (demo)',
      description: 'Practice application: 3 steps, a field that appears later, a statement of purpose and a simulated CAPTCHA. Nothing is sent anywhere.',
    },
    {
      type: 'job',
      title: 'Junior MERN Developer (Demo Portal)',
      org: 'Demo Tech',
      url: `${base}/job-demo.html`,
      location: 'Sukkur',
      salary: 'PKR 60,000 – 90,000',
      description: 'Practice job application in the style of a Pakistani job portal: CV upload, expected salary, gender, email, CNIC and an anti-bot trap field. Nothing is sent anywhere.',
    },
  ];
};

async function upsert(o) {
  return Opportunity.updateOne(
    { source: o.source, url: o.url },
    { $set: { ...o, applyUrl: o.applyUrl || o.url, fetchedAt: new Date() } },
    { upsert: true }
  );
}

async function saveAll(list) {
  let added = 0;
  for (const o of list) if ((await upsert(o)).upsertedCount) added++;
  return added;
}

// Always present: demo portals + the official programme catalogue (status from dates)
let seeded = false;
async function ensureBaseListings() {
  if (!seeded) {
    // sources used by an earlier version of ApplyMate
    await Opportunity.deleteMany({ source: { $in: ['scholars4dev', 'mustakbil'] } });
    seeded = true;
  }
  for (const d of demoListings()) {
    await Opportunity.updateOne({ source: 'demo', title: d.title }, { $set: { ...d, source: 'demo', applyUrl: d.url } }, { upsert: true });
  }
  const { list } = await officialScholarships({ live: false });
  for (const o of list) {
    // keep a status that was confirmed live in the last 12 hours
    const prev = await Opportunity.findOne({ source: 'official', url: o.url }).lean();
    if (prev?.liveCheckedAt && Date.now() - new Date(prev.liveCheckedAt) < 12 * 3600e3) o.status = prev.status;
    await upsert(o);
  }
}

const ORDER = { demo: 0, official: 1, erasmus: 2, rozee: 1, link: 1 };

// GET /api/opportunities?type=scholarship|job  -> ranked for this user
router.get('/', async (req, res) => {
  await ensureBaseListings();
  const filter = req.query.type ? { type: req.query.type } : {};
  // jobs added by link are private to the user who added them
  filter.$or = [{ addedBy: { $exists: false } }, { addedBy: null }, { addedBy: req.user._id }];
  const all = await Opportunity.find(filter).sort({ fetchedAt: -1 }).limit(400).lean();

  const ranked = all
    .map((o) => ({ ...o, match: scoreOpportunity(o, req.user.profile) }))
    .filter((o) => !o.match.expired)
    .sort((a, b) => (a.source === 'demo' ? -1 : b.source === 'demo' ? 1 : b.match.score - a.match.score || ORDER[a.source] - ORDER[b.source]));

  res.json({ opportunities: ranked });
});

// GET /api/opportunities/:id  -> one listing with details read from the programme's own website
//   (cached for 3 days; ?fresh=1 reads the website again)
router.get('/:id', async (req, res) => {
  const o = await Opportunity.findById(req.params.id).catch(() => null);
  if (!o || (o.addedBy && String(o.addedBy) !== String(req.user._id))) return res.status(404).json({ error: 'Listing not found.' });
  const stale = !o.detailsAt || Date.now() - o.detailsAt > 3 * 86400e3 || req.query.fresh;
  if (o.type === 'scholarship' && o.source !== 'demo' && stale) {
    o.details = await fetchDetails(o.url).catch((e) => ({ error: e.message }));
    o.detailsAt = new Date();
    await o.save().catch(() => {});
  }
  const plain = o.toObject();
  res.json({ opportunity: { ...plain, match: scoreOpportunity(plain, req.user.profile) } });
});

// POST /api/opportunities/refresh { type? }  -> read the live sources for this user's profile
router.post('/refresh', async (req, res) => {
  const profile = req.user.profile?.toObject ? req.user.profile.toObject() : req.user.profile || {};
  const which = req.body?.type;
  const report = {};

  const sources = [
    ['scholarship', 'Official programmes (Fulbright, Chevening, Stipendium Hungaricum, DAAD)', async () => {
      const { list, errors } = await officialScholarships({ live: true });
      return { list, note: errors.length ? `live check failed for ${errors.map((e) => e.split(':')[0]).join(', ')}; using cycle dates` : '' };
    }],
    ['scholarship', 'Erasmus Mundus catalogue (EACEA)', async () => ({ list: await scrapeErasmus() })],
  ].filter(([type]) => !which || which === type);

  for (const [type, name, run] of sources) {
    try {
      const { list, note } = await run();
      report[name] = { type, found: list.length, added: await saveAll(list), note };
    } catch (err) {
      report[name] = { type, error: err.message.split('\n')[0] };
    }
  }
  res.json({ report });
});

// POST /api/opportunities/from-link { url, title?, org? }  -> a job the user found on Rozee.pk
router.post('/from-link', async (req, res) => {
  let job;
  try {
    job = jobFromLink(req.body?.url, req.body || {});
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  job.addedBy = req.user._id;
  await upsert(job);
  const saved = await Opportunity.findOne({ source: job.source, url: job.url }).lean();
  res.json({ opportunity: { ...saved, match: scoreOpportunity(saved, req.user.profile) } });
});

// DELETE /api/opportunities/:id  -> remove a job the user added by link
router.delete('/:id', async (req, res) => {
  const r = await Opportunity.deleteOne({ _id: req.params.id, addedBy: req.user._id });
  if (!r.deletedCount) return res.status(404).json({ error: 'Only jobs you added yourself can be removed.' });
  res.json({ ok: true });
});

module.exports = { router, ensureBaseListings };
