// applications.js — start the agent on an opportunity and follow it live from the web app.
//
// The agent runs on THIS computer and opens a visible browser window. The web page polls
// GET /api/applications/:id every second to show progress. When the agent needs the user
// (CAPTCHA, essay, upload confirmation, final submit), it waits until the user answers
// with POST /api/applications/:id/respond.

const express = require('express');
const { requireAuth } = require('./auth');
const { Application, Opportunity, User } = require('./models');
const { agentProfile, setAnswer } = require('./profile');
const { normalizeQ } = require('../agent/answers');
const runAgent = require('../agent/index');
const { advance } = require('./tracker');
const { notify } = require('./notify');
const { ensureAssistant, friendlyError } = require('./assistant');
const { cleanQuestions } = require('./questions');

const router = express.Router();
router.use(requireAuth);

// Live state of runs (only one agent at a time: there is one browser on this laptop)
const live = new Map(); // applicationId -> { log, status, pause, resolve }
let active = null;      // { id, browser }

const STATUS_FROM_RESULT = {
  'ready-to-submit': 'ready',
  'stopped-by-user': 'stopped',
  'browser-closed': 'stopped',
};

// Save the address of the application form for everyone. Only public-looking addresses are kept:
// no query parameters such as session tokens, and no pages that look personal (/application/83742/edit).
// Login services (Microsoft, Google, SAP, Okta ...) and single-use sign-in links are never saved:
// their addresses carry a one-time code (SAMLRequest, Signature, state) that expires.
const LOGIN_SERVICE = /b2clogin\.com|login\.microsoftonline|accounts\.google|okta\.com|auth0\.com|onelogin|keycloak|\/saml|\/sso\b|\/oauth|\/openid|\/adfs/i;
const ONE_TIME_PARAM = /saml|signature|sigalg|relaystate|nonce|code_challenge|state|token|ticket|session|redirect_uri|client_id/i;

function publicUrl(raw) {
  try {
    const u = new URL(raw);
    if (!/^https?:$/.test(u.protocol) || /^(localhost|127\.0\.0\.1)$/.test(u.hostname)) return null;
    if (LOGIN_SERVICE.test(u.href) || [...u.searchParams.keys()].some((k) => ONE_TIME_PARAM.test(k))) return null;
    if (u.pathname.split('/').some((seg) => /^\d{5,}$/.test(seg) || /^[0-9a-f-]{16,}$/i.test(seg))) return null;
    for (const k of [...u.searchParams.keys()]) {
      if (/token|session|sid|auth|key|code|state|ticket|user|email|id$/i.test(k)) u.searchParams.delete(k);
    }
    u.hash = '';
    return u.href;
  } catch { return null; }
}

async function saveRoute(opportunityId, url, { kind, by, trail = [], fallback }) {
  // e.g. portal.daad.de redirected to a Microsoft login page: save portal.daad.de, which always starts a fresh login
  const formUrl = publicUrl(url) || (fallback && publicUrl(fallback));
  if (!formUrl) return;
  const o = await Opportunity.findById(opportunityId);
  if (!o) return;
  if (o.route?.formUrl === formUrl) {
    o.route.uses = (o.route.uses || 0) + 1;
    o.route.fails = 0;
  } else {
    o.route = { formUrl, kind, by, trail: by === 'saved route' ? o.route?.trail || [] : trail, foundAt: new Date(), uses: 1, fails: 0 };
  }
  await o.save();
}

async function rememberQuestions(opportunityId, questions) {
  const o = await Opportunity.findById(opportunityId);
  if (!o) return;
  const list = [...(o.formQuestions || [])];
  for (const q of questions) {
    if (list.some((x) => normalizeQ(x.label) === normalizeQ(q.label))) continue;
    list.push({ label: q.label, kind: q.kind, options: (q.options || []).slice(0, 60), required: !!q.required, hint: q.hint || '' });
  }
  o.formQuestions = cleanQuestions(list).slice(0, 80);
  await o.save();
}

async function startRun(app, opportunity, user, formUrl) {
  const target = formUrl || opportunity.applyUrl || opportunity.url;
  const id = app._id.toString();
  const state = { log: [], status: 'running', pause: null, resolve: null };
  live.set(id, state);

  // close the browser of the previous run (it was left open for reviewing/submitting)
  if (active?.browser) await active.browser.close().catch(() => {});
  active = { id, browser: null };

  const log = (line) => {
    state.log.push(String(line).replace(/^\n+/, ''));
    if (state.log.length > 500) state.log.shift();
  };

  const onPause = (stop) =>
    new Promise((resolve) => {
      state.status = 'waiting';
      state.pause = { kind: stop.kind || 'action', reason: stop.reason, message: stop.message, ...(stop.questions ? { questions: stop.questions } : {}) };
      // remember which questions this programme's form asks (no answers), for the "Before you apply" list
      if (stop.questions?.length) rememberQuestions(opportunity._id, stop.questions).catch(() => {});
      state.resolve = (answer) => {
        state.status = 'running';
        state.pause = null;
        state.resolve = null;
        resolve(answer);
      };
      Application.updateOne({ _id: id }, { status: 'waiting', pause: state.pause, log: state.log })
        .catch((err) => console.log(`⚠ could not save run ${id}: ${err.message}`));
      notify(user._id, {
        kind: 'agent-waiting',
        title: stop.kind === 'confirm' ? 'The agent needs your permission' : 'The agent needs you',
        body: `${opportunity.title}: ${String(stop.message).split('\n')[0]}`,
        link: `/app/applications/${id}`,
        email: true,
      }).catch(() => {});
    });

  log(`Starting the agent on ${target}`);

  // application links found on the programme's website (detail page) help the agent find the form
  const hints = (opportunity.details?.applyLinks || []).filter((l) => /^https?:/.test(l.href));
  // a route saved by an earlier run (by any student) takes the agent straight to the form
  // (a route saved by an older version may be a one-time login link: ignore and forget it)
  if (opportunity.route?.formUrl && !publicUrl(opportunity.route.formUrl)) {
    await Opportunity.updateOne({ _id: opportunity._id }, { $unset: { route: 1 } }).catch(() => {});
    opportunity.route = undefined;
  }
  const route = opportunity.route?.formUrl && (opportunity.route.fails || 0) < 3 ? opportunity.route : null;
  const onFormFound = (url, info) => saveRoute(opportunity._id, url, info).catch(() => {});
  const onRouteFailed = () => Opportunity.updateOne({ _id: opportunity._id }, { $inc: { 'route.fails': 1 } }).catch(() => {});
  // the opportunity's own details, for "funding programme / target country / applicant status" fields
  const level = user.profile?.preferences?.degreeLevel || (opportunity.levels || [])[0] || '';
  const portal = opportunity.portal || {};
  const profile = {
    ...agentProfile(user),
    opportunity: {
      programme: portal.programme || opportunity.title,
      targetCountry: portal.targetCountry || opportunity.location || '',
      applicantStatus: portal.status?.[level] || portal.status?.default || '',
    },
  };
  // the offline AI must be running first (it is started on this computer if needed)
  ensureAssistant(log)
    .then((ok) => {
      if (!ok) throw new Error('assistant-unavailable: the offline AI (Ollama) is not reachable');
      return runAgent(target, { profile, log, onPause, hints, knownForm: opportunity.presetSteps?.length ? null : route?.formUrl,
        // a route recorded by the ApplyMate team is followed step by step; a route learned by an earlier run
        // only guides which links to prefer (the agent still checks each page itself)
        knownSteps: opportunity.presetSteps?.length ? opportunity.presetSteps : opportunity.presetTrail || [],
        knownTrail: [...(opportunity.presetTrail || []), ...(route?.trail || [])],
        stayOnSite: !!(opportunity.presetSteps?.length || opportunity.presetTrail?.length),
        onFormFound, onRouteFailed });
    })
    .then(({ summary, browser }) => {
      active.browser = browser; // keep it open so the user can review and submit
      state.status = STATUS_FROM_RESULT[summary.result] || 'incomplete';
      // MongoDB does not allow "." or "$" in key names, and field labels often contain them,
      // so the field -> profile key mapping is stored as a list
      const fieldMapping = Object.entries(summary.fieldMapping || {}).map(([field, key]) => ({ field, key }));
      state.result = { message: summary.message, summary: { ...summary, fieldMapping } };
      log(state.status === 'ready' ? '✅ Done. Review the form in the browser window and submit it yourself.' : `Finished: ${summary.result}`);
      if (state.status === 'ready') {
        advance(user._id, opportunity._id, 'ready', 'Form filled by the agent').catch(() => {});
        notify(user._id, {
          kind: 'agent-ready',
          title: 'Form ready for you to submit',
          body: `${opportunity.title}: ${summary.actionsOk}/${summary.actions} actions done. Review it in the browser window and submit it yourself.`,
          link: `/app/applications/${id}`,
          email: true,
        }).catch(() => {});
      }
    })
    .catch((err) => {
      state.status = 'failed';
      // the technical reason stays in the log; the student sees a plain explanation
      log(`❌ ${err.message.split('\n')[0]}`);
      state.result = { message: friendlyError(err.message) };
      notify(user._id, { kind: 'agent-failed', title: 'The agent could not finish', body: `${opportunity.title}: ${state.result.message}`, link: `/app/applications/${id}` }).catch(() => {});
    })
    .finally(() => {
      Application.updateOne({ _id: id }, { status: state.status, pause: null, log: state.log, result: state.result })
        .catch((err) => console.log(`⚠ could not save run ${id}: ${err.message}`));
      if (active?.id === id && !active.browser) active = null;
    });
}

// POST /api/applications { opportunityId }
router.post('/', async (req, res) => {
  const busy = [...live.values()].some((s) => s.status === 'running' || s.status === 'waiting');
  if (busy) return res.status(409).json({ error: 'The agent is already working on another application. Finish or stop it first.' });

  const opportunity = await Opportunity.findById(req.body?.opportunityId);
  if (!opportunity) return res.status(404).json({ error: 'Opportunity not found.' });

  // explicit permission (proposal: "seeks the user's explicit permission before auto-filling")
  if (req.body?.consent !== true) {
    return res.status(400).json({ error: 'Please confirm that the agent may fill this form with your profile data.' });
  }
  // optional: the real application form link (e.g. the portal page after the programme's info page)
  let formUrl = '';
  if (req.body?.formUrl) {
    try {
      const u = new URL(String(req.body.formUrl).trim());
      if (!/^https?:$/.test(u.protocol)) throw new Error();
      formUrl = u.href;
    } catch {
      return res.status(400).json({ error: 'The application form link must be a full web address starting with https://' });
    }
  }
  // read the programme's website first if nobody opened its detail page yet (gives the agent the apply links)
  if (opportunity.type === 'scholarship' && opportunity.source !== 'demo' && !opportunity.details) {
    try {
      const { fetchDetails } = require('./scrapers/details');
      opportunity.details = await fetchDetails(opportunity.url);
      opportunity.detailsAt = new Date();
      await opportunity.save();
    } catch { /* the agent can still search the website itself */ }
  }
  const track = await advance(req.user._id, opportunity._id, 'in_progress', 'Agent started');
  const app = await Application.create({ user: req.user._id, opportunity: opportunity._id, track: track._id, formUrl: formUrl || undefined });
  await startRun(app, opportunity, req.user, formUrl);
  res.json({ id: app._id });
});

// GET /api/applications  -> this user's history
router.get('/', async (req, res) => {
  const apps = await Application.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50).populate('opportunity').lean();
  res.json({
    applications: apps.map((a) => ({ ...a, ...(live.has(a._id.toString()) ? pick(live.get(a._id.toString())) : {}) })),
  });
});

const pick = (s) => ({ status: s.status, pause: s.pause, log: s.log, result: s.result });

// GET /api/applications/:id  -> live progress
router.get('/:id', async (req, res) => {
  const app = await Application.findOne({ _id: req.params.id, user: req.user._id }).populate('opportunity').lean();
  if (!app) return res.status(404).json({ error: 'Not found.' });
  const s = live.get(req.params.id);
  res.json({ application: { ...app, ...(s ? pick(s) : {}) } });
});

// POST /api/applications/:id/respond { answer: true|false }
//   for a normal pause: true = "I did it, continue", false = "stop the agent"
//   for a confirmation (kind 'confirm'): true = yes, false = no
//   for questions (kind 'questions'): { answer: true, answers: [{ label, kind, value }] } -> saved in the profile
//   (documents are uploaded first with POST /api/profile/answers/file) and handed to the agent
router.post('/:id/respond', async (req, res) => {
  const s = live.get(req.params.id);
  if (!s?.resolve) return res.status(400).json({ error: 'The agent is not waiting for an answer.' });
  if (s.pause?.kind === 'questions' && req.body?.answer) {
    const user = await User.findById(req.user._id);
    for (const a of req.body.answers || []) {
      if (a?.label && a.kind !== 'file' && String(a.value ?? '').trim()) setAnswer(user, { label: a.label, kind: a.kind, value: String(a.value).trim() });
    }
    await user.save();
    const asked = new Set((s.pause.questions || []).map((q) => normalizeQ(q.label)));
    const given = (user.profile.answers || []).filter((a) => asked.has(a.q)).map((a) => (a.toObject ? a.toObject() : a));
    s.resolve(given.length ? given : true);
    return res.json({ ok: true, saved: given.length });
  }
  s.resolve(!!req.body?.answer);
  res.json({ ok: true });
});

module.exports = { router };
