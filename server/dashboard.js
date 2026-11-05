// dashboard.js — everything the home screen needs in one request
const express = require('express');
const { requireAuth } = require('./auth');
const { Opportunity, Track, Application } = require('./models');
const { scoreOpportunity } = require('./match');
const { notify } = require('./notify');

const router = express.Router();
router.use(requireAuth);

// What scholarship forms ask for, by Profile section (the same sections as the Profile page).
// Optional extras (middle name, title, Master's, work, job keywords) do not count.
const DEGREE = (n) => [['programTitle', `${n}: programme`], ['board', `${n}: board / university`], ['endDate', `${n}: passing date`]];
const NEEDED = [
  ['personal', 'Personal details', [['fullName', 'Full name'], ['firstName', 'First name'], ['lastName', 'Last name'],
    ['fatherName', "Father's name"], ['gender', 'Gender'], ['dateOfBirth', 'Date of birth'], ['email', 'Email'], ['phone', 'Phone'],
    ['cnic', 'CNIC'], ['nationality', 'Nationality'], ['placeOfBirth', 'Place of birth'], ['countryOfBirth', 'Country of birth'],
    ['passportNumber', 'Passport number'], ['passportExpiry', 'Passport valid until']]],
  ['address', 'Address', [['street', 'Postal address'], ['city', 'City'], ['province', 'Province'], ['postalCode', 'Postal code'], ['country', 'Country']]],
  ['education', 'Education', [['lastDegree', 'Highest degree'], ['institution', 'University'], ['cgpa', 'CGPA'], ['fieldOfStudy', 'Subject / major'],
    ['institutionCity', 'University city'], ['institutionCountry', 'University country'], ['startDate', 'Studies started'], ['endDate', 'Graduation date']]],
  ['eduMatric', 'Matric / O-level', DEGREE('Matric')],
  ['eduInter', 'Intermediate / A-level', DEGREE('Intermediate')],
  ['eduBachelor', 'Bachelor’s', DEGREE('Bachelor’s')],
  ['languages', 'Languages', [['motherTongue', 'Mother tongue'], ['english', 'English level']]],
  ['statements', 'Statements', [['motivation', 'Motivation statement']]],
  ['preferences', 'What you’re looking for', [['degreeLevel', 'Scholarship level'], ['studyField', 'Field of study']]],
  ['documents', 'Documents', [['cv', 'CV'], ['transcript', 'Transcript'], ['degree', 'Degree certificate'], ['passport', 'Passport copy'], ['photo', 'Photo']]],
];

function completeness(profile) {
  const p = profile?.toObject ? profile.toObject() : profile || {};
  const has = (section, key) => (section === 'documents' ? !!p.documents?.[key]?.path : !!String(p[section]?.[key] ?? '').trim());
  const missing = [];
  const sections = [];
  let total = 0;
  for (const [id, title, fields] of NEEDED) {
    const empty = fields.filter(([k]) => !has(id, k));
    total += fields.length;
    missing.push(...empty.map(([k, label]) => ({ key: `${id}.${k}`, label })));
    if (empty.length) sections.push({ id, title, missing: empty.length, total: fields.length });
  }
  return {
    percent: Math.round(((total - missing.length) / total) * 100),
    missing,
    sections, // e.g. { id: 'languages', title: 'Languages', missing: 2, total: 2 }
    documents: NEEDED.find(([id]) => id === 'documents')[2].filter(([k]) => has('documents', k)).length,
  };
}

// Deadline reminders: tracker entries due within 7 days (once per entry per day)
async function deadlineReminders(user, tracks) {
  const today = new Date().toISOString().slice(0, 10);
  for (const t of tracks) {
    if (!t.deadline || ['submitted', 'interview', 'accepted', 'rejected'].includes(t.stage)) continue;
    const days = Math.ceil((new Date(t.deadline) - Date.now()) / 86400000);
    if (days < 0 || days > 7) continue;
    await notify(user._id, {
      kind: 'deadline',
      title: days === 0 ? 'Deadline today' : `Deadline in ${days} day${days === 1 ? '' : 's'}`,
      body: t.opportunity?.title || 'An opportunity in your tracker',
      link: '/app/tracker',
      key: `deadline:${t._id}:${today}`,
      email: true,
    });
  }
}

router.get('/', async (req, res) => {
  const user = req.user;
  const tracks = await Track.find({ user: user._id }).populate('opportunity').lean();
  await deadlineReminders(user, tracks);

  const filter = { $or: [{ addedBy: { $exists: false } }, { addedBy: null }, { addedBy: user._id }], source: { $ne: 'demo' } };
  const opps = await Opportunity.find(filter).limit(400).lean();
  const ranked = opps
    .map((o) => ({ ...o, match: scoreOpportunity(o, user.profile) }))
    .filter((o) => !o.match.expired && o.status !== 'closed')
    .sort((a, b) => b.match.score - a.match.score);

  const stageCount = {};
  for (const t of tracks) stageCount[t.stage] = (stageCount[t.stage] || 0) + 1;

  const upcoming = tracks
    .filter((t) => t.deadline && new Date(t.deadline) >= new Date(Date.now() - 86400000))
    .sort((a, b) => new Date(a.deadline) - new Date(b.deadline))
    .slice(0, 5)
    .map((t) => ({ _id: t._id, title: t.opportunity?.title, deadline: t.deadline, stage: t.stage }));

  const runs = await Application.find({ user: user._id }).sort({ createdAt: -1 }).limit(5).populate('opportunity', 'title type').lean();

  res.json({
    name: user.name,
    profile: completeness(user.profile),
    stages: stageCount,
    tracked: tracks.length,
    topScholarships: ranked.filter((o) => o.type === 'scholarship' && o.match.suitable !== false && o.match.score >= 40).slice(0, 3),
    topJobs: ranked.filter((o) => o.type === 'job' && o.match.score >= 40).slice(0, 3),
    upcoming,
    runs: runs.map((r) => ({ _id: r._id, title: r.opportunity?.title, type: r.opportunity?.type, status: r.status, createdAt: r.createdAt })),
  });
});

module.exports = { router, completeness };
