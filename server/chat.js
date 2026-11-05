// chat.js — "Ask ApplyMate": a chatbot that answers ONLY about the scholarships and jobs on this portal.
//
// How it stays on topic and honest (retrieval-augmented generation, RAG):
//   1. Retrieve: find the listings in MongoDB that fit the question (keywords + the user's match scores).
//   2. Generate: the offline model (qwen3:4b) answers from those listings only, and says which ones it used.
//   3. Guard: the model also reports whether the question is in scope; if not, a fixed polite reply is sent.
// Only basic profile details are used (level, field, city, degree) — never CNIC, phone or documents.

const express = require('express');
const { requireAuth } = require('./auth');
const { Opportunity, Track } = require('./models');
const { scoreOpportunity } = require('./match');
const { ensureBaseListings } = require('./opportunities');
const { askJSON } = require('../agent/llm');

const router = express.Router();
router.use(requireAuth);

const OUT_OF_SCOPE =
  'I can only help with the scholarships and jobs on ApplyMate, and with using the portal. ' +
  'Try asking about deadlines, eligibility, which scholarships fit you, or jobs in your city.';

const STOP = new Set(('a an the and or of in on for to with is are was be can i me my you your it this that what which who when where how ' +
  'do does did any there their them please tell about show give list find want need get have has some more most best good ' +
  'scholarship scholarships job jobs portal applymate available').split(' '));

const words = (t) => (String(t || '').toLowerCase().match(/[a-z0-9+#]+/g) || []).filter((w) => w.length > 1 && !STOP.has(w));

function intentOf(q) {
  const s = q.toLowerCase();
  return {
    type: /scholar|fund|study abroad|master|phd|degree|erasmus|fulbright|chevening|daad|hungar/.test(s) && !/\bjobs?\b|salary|hiring/.test(s)
      ? 'scholarship'
      : /\bjobs?\b|salary|hiring|vacanc|intern|developer|engineer|teacher|rozee/.test(s) && !/scholar/.test(s)
        ? 'job'
        : null,
    forMe: /\b(me|my|i|suit|fit|eligible|recommend|best|should)\b/.test(s),
    open: /\bopen\b|apply now|currently|right now/.test(s),
    demo: /demo|practice|test/.test(s),
  };
}

// Score each listing against the question; fall back to the user's best matches
function retrieve(question, history, all) {
  const intent = intentOf(question);
  // short follow-ups ("what about its deadline?") also use the previous question
  const lastUser = [...history].reverse().find((m) => m.role === 'user')?.content || '';
  const qWords = words(question).length >= 2 ? words(question) : [...words(question), ...words(lastUser)];

  // the demo portals are for practising the agent, not real recommendations
  const pool = all.filter((o) => (!intent.type || o.type === intent.type) && (o.source !== 'demo' || intent.demo));
  const scored = pool.map((o) => {
    const title = words(`${o.title} ${o.org}`);
    const body = words([o.description, o.location, o.level, (o.levels || []).join(' '), o.fieldNote, (o.tags || []).join(' '),
      o.salary, (o.eligibility || []).join(' '), o.covers, o.status].join(' '));
    let s = 0;
    for (const w of qWords) {
      if (title.some((t) => t.startsWith(w) || w.startsWith(t) && t.length > 3)) s += 5; // named in the title
      else if (body.some((t) => t.startsWith(w))) s += 1;
    }
    if (intent.open && o.status === 'open') s += 6;
    if (intent.forMe) s += o.match.suitable === false ? -5 : o.match.score / 25; // best fits first, unsuitable last
    return { o, s };
  });

  let hits = scored.filter((x) => x.s >= 1).sort((a, b) => b.s - a.s || b.o.match.score - a.o.match.score);
  if (!hits.length) hits = scored.sort((a, b) => b.o.match.score - a.o.match.score); // generic question
  return { intent, items: hits.slice(0, 6).map((x) => x.o) };
}

const line = (v) => String(v || '').replace(/\s+/g, ' ').trim();

function describe(o, i) {
  return [
    `[L${i + 1}] ${o.type.toUpperCase()}: ${line(o.title)}`,
    o.org && `  by: ${line(o.org)}`,
    o.location && `  location: ${line(o.location)}`,
    (o.levels?.length || o.level) && `  level: ${line(o.levels?.join(', ') || o.level)}`,
    o.status && `  status: ${o.status}${o.statusNote ? ` (${line(o.statusNote)})` : ''}`,
    o.deadline && `  deadline: ${line(o.deadline)}`,
    o.salary && `  salary: ${line(o.salary)}`,
    o.covers && `  covers: ${line(o.covers)}`,
    o.eligibility?.length && `  eligibility: ${o.eligibility.map(line).join('; ')}`,
    o.description && `  about: ${line(o.description).slice(0, 380)}`,
    o.match.suitable === false
      ? `  NOT suitable for this student: ${o.match.blockers.join('; ')}`
      : `  fit for this student: ${o.match.score}% (${o.match.reasons.join('; ')})`,
  ].filter(Boolean).join('\n');
}

function aboutStudent(p = {}) {
  const parts = [
    p.preferences?.degreeLevel && `wants: ${p.preferences.degreeLevel}`,
    p.preferences?.studyField && `field: ${p.preferences.studyField}`,
    p.education?.lastDegree && `degree: ${p.education.lastDegree}`,
    p.education?.cgpa && `CGPA: ${p.education.cgpa}`,
    p.address?.city && `city: ${p.address.city}`,
    p.preferences?.preferredCities && `preferred cities: ${p.preferences.preferredCities}`,
    p.preferences?.jobKeywords && `job interests: ${p.preferences.jobKeywords}`,
    p.job?.experienceYears && `experience: ${p.job.experienceYears} years`,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : 'profile not filled in yet';
}

// Fixed part first so Ollama can reuse it between questions (prompt caching)
const RULES = `You are "Ask ApplyMate", the assistant inside ApplyMate, a portal where Pakistani students find scholarships and jobs and an AI agent fills the application forms.

SCOPE. In scope: the scholarships and jobs listed on ApplyMate (deadlines, eligibility, level, fields, location, salary, what they cover, which fit the student), the student's own saved applications, and how to use ApplyMate (profile, CV import, tracker, "Apply with agent", notifications).
Out of scope: everything else (general knowledge, coding help, homework, news, other websites, personal advice not about these listings). For out-of-scope questions set inScope=false and leave answer empty.
Greetings and thanks are in scope: reply briefly and offer help.

RULES.
- Use ONLY the facts in LISTINGS, MY APPLICATIONS and STUDENT below. Never invent scholarships, jobs, dates, amounts or requirements.
- If the listings do not contain the answer, say so plainly and suggest opening the official page.
- Never recommend a listing marked "NOT suitable for this student"; if asked about it, explain why it does not fit.
- Mention listings by their exact title. Put the codes of the listings you used in "used" (for example ["L1","L3"]).
- Keep answers short: 2 to 5 sentences, or a few lines starting with "- ". Plain text, no markdown headings or bold.
- How ApplyMate works: the agent fills forms from the profile, pauses for essays and CAPTCHAs, asks before uploading, and never submits; the student submits. The AI runs offline on this computer.`;

const SCHEMA = {
  type: 'object',
  properties: {
    inScope: { type: 'boolean' },
    answer: { type: 'string', maxLength: 900 },
    used: { type: 'array', items: { type: 'string', enum: ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'] }, maxItems: 4 },
  },
  required: ['inScope', 'answer', 'used'],
};

// What the browser needs to draw a listing card
const card = (o) => ({
  _id: o._id, type: o.type, title: o.title, org: o.org, url: o.url, status: o.status,
  deadline: o.deadline, location: o.location, salary: o.salary, score: o.match.score, demo: o.source === 'demo',
});

// POST /api/chat { message, history: [{role:'user'|'assistant', content}] }
router.post('/', async (req, res) => {
  const message = String(req.body?.message || '').trim().slice(0, 500);
  if (!message) return res.status(400).json({ error: 'Type a question first.' });
  const history = (Array.isArray(req.body?.history) ? req.body.history : [])
    .filter((m) => m && ['user', 'assistant'].includes(m.role))
    .slice(-6)
    .map((m) => ({ role: m.role, content: String(m.content || '').slice(0, 600) }));

  await ensureBaseListings();
  const profile = req.user.profile?.toObject ? req.user.profile.toObject() : req.user.profile || {};
  const visible = await Opportunity.find({ $or: [{ addedBy: { $exists: false } }, { addedBy: null }, { addedBy: req.user._id }] }).lean();
  const all = visible.map((o) => ({ ...o, match: scoreOpportunity(o, profile) })).filter((o) => !o.match.expired);
  const { items } = retrieve(message, history, all);

  const tracks = await Track.find({ user: req.user._id }).populate('opportunity', 'title').sort({ updatedAt: -1 }).limit(8).lean();
  const myApps = tracks.length
    ? tracks.map((t) => `- ${t.opportunity?.title || 'listing'}: ${t.stage.replace('_', ' ')}${t.deadline ? `, my deadline ${new Date(t.deadline).toDateString()}` : ''}`).join('\n')
    : '- none saved yet';

  const real = all.filter((o) => o.source !== 'demo');
  const sch = real.filter((o) => o.type === 'scholarship');
  const counts = `${sch.length} scholarships (open now: ${sch.filter((o) => o.status === 'open').length}, ` +
    `deadline set per course: ${sch.filter((o) => o.status === 'varies').length}, closed until next cycle: ${sch.filter((o) => o.status === 'closed').length}) ` +
    `and ${real.filter((o) => o.type === 'job').length} jobs, plus 2 demo practice forms`;

  const prompt = `${RULES}

TODAY: ${new Date().toDateString()}
PORTAL: ${counts}
STUDENT: ${aboutStudent(profile)}
MY APPLICATIONS:
${myApps}
LISTINGS (most relevant to the question):
${items.map(describe).join('\n')}

CONVERSATION SO FAR:
${history.map((m) => `${m.role === 'user' ? 'Student' : 'ApplyMate'}: ${m.content}`).join('\n') || '(new conversation)'}

Student: ${message}`;

  try {
    const out = await askJSON(prompt, SCHEMA, { timeoutMs: 120000, retries: 0 });
    if (!out?.inScope) return res.json({ answer: OUT_OF_SCOPE, cards: [], inScope: false });
    const used = [...new Set(out.used || [])].map((c) => items[+c.slice(1) - 1]).filter(Boolean);
    res.json({ answer: String(out.answer || '').trim() || 'I could not find that in the listings.', cards: used.map(card), inScope: true });
  } catch (err) {
    // Ollama not running: still useful — show the listings that fit the question
    res.json({
      answer: 'The offline AI model is not running right now (start Ollama), so I can’t write an answer. These listings match your question:',
      cards: items.slice(0, 3).map(card),
      inScope: true,
      offline: true,
    });
  }
});

module.exports = { router, retrieve, intentOf };
