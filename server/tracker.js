// tracker.js — the user's application tracker: one entry per opportunity they care about.
// Stages follow the real application journey; the agent moves an entry forward automatically
// (started -> in progress, form filled -> ready to submit) and the user moves it after that.

const express = require('express');
const { requireAuth } = require('./auth');
const { Track, Opportunity, Application } = require('./models');
const { scoreOpportunity } = require('./match');

const STAGES = ['saved', 'in_progress', 'ready', 'submitted', 'interview', 'accepted', 'rejected'];
const ORDER = Object.fromEntries(STAGES.map((s, i) => [s, i]));

/** Create the entry if needed, and move it forward (never backwards automatically). */
async function advance(userId, opportunityId, stage, note) {
  let t = await Track.findOne({ user: userId, opportunity: opportunityId });
  if (!t) {
    t = new Track({ user: userId, opportunity: opportunityId, stage, history: [{ stage, note }] });
    return t.save();
  }
  if (ORDER[stage] > ORDER[t.stage] && !['rejected', 'accepted'].includes(t.stage)) {
    t.stage = stage;
    t.history.push({ stage, note });
    await t.save();
  }
  return t;
}

const router = express.Router();
router.use(requireAuth);

async function withDetails(tracks, user) {
  const ids = tracks.map((t) => t._id);
  const runs = await Application.find({ track: { $in: ids } }).sort({ createdAt: -1 }).select('track status createdAt').lean();
  return tracks.map((t) => ({
    ...t,
    match: t.opportunity ? scoreOpportunity(t.opportunity, user.profile) : null,
    runs: runs.filter((r) => String(r.track) === String(t._id)),
  }));
}

router.get('/', async (req, res) => {
  const tracks = await Track.find({ user: req.user._id }).sort({ updatedAt: -1 }).populate('opportunity').lean();
  res.json({ tracks: await withDetails(tracks, req.user), stages: STAGES });
});

// POST { opportunityId }  -> save to tracker
router.post('/', async (req, res) => {
  const o = await Opportunity.findById(req.body?.opportunityId);
  if (!o) return res.status(404).json({ error: 'Opportunity not found.' });
  const t = await advance(req.user._id, o._id, 'saved', 'Saved from ' + (o.type === 'job' ? 'Jobs' : 'Scholarships'));
  res.json({ track: t });
});

// PATCH { stage?, notes?, deadline? }
router.patch('/:id', async (req, res) => {
  const t = await Track.findOne({ _id: req.params.id, user: req.user._id });
  if (!t) return res.status(404).json({ error: 'Not found.' });
  const { stage, notes, deadline } = req.body || {};
  if (stage && STAGES.includes(stage) && stage !== t.stage) {
    t.stage = stage;
    t.history.push({ stage, note: 'Changed by you' });
  }
  if (notes !== undefined) t.notes = String(notes).slice(0, 4000);
  if (deadline !== undefined) t.deadline = deadline ? new Date(deadline) : undefined;
  await t.save();
  const full = await Track.findById(t._id).populate('opportunity').lean();
  res.json({ track: (await withDetails([full], req.user))[0] });
});

router.delete('/:id', async (req, res) => {
  await Track.deleteOne({ _id: req.params.id, user: req.user._id });
  res.json({ ok: true });
});

module.exports = { router, advance, STAGES };
