// match.js — scores how well an opportunity fits the user's profile (0–100),
// with human-readable reasons ("Masters level", "matches: web developer").
// Simple, explainable rules: easy to justify at the defense and to evaluate.

const STOP = new Set(['and', 'or', 'the', 'of', 'in', 'for', 'a', 'an', 'to', 'with', 'bs', 'ms', 'bsc', 'msc', 'mphil', 'degree', 'program', 'programme']);

// "web developer, react" -> ["web developer", "react", "web", "developer"]
function keywords(...texts) {
  const phrases = texts
    .filter(Boolean)
    .flatMap((t) => String(t).toLowerCase().split(/[,;/]+/))
    .map((p) => p.replace(/\b(bs|ms|bsc|msc|mphil|phd)\b/g, '').replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 1);
  const words = phrases.flatMap((p) => p.split(' ')).filter((w) => w.length > 2 && !STOP.has(w));
  return [...new Set([...phrases, ...words])];
}

// ["computer science", "computer", "science"] -> ["computer science"] (for showing reasons)
const tidy = (hits) => hits.filter((h) => !hits.some((o) => o !== h && o.includes(h)));

// "comput" matches "computer" (a stem), but a short word like "art" must be a whole word ("artificial" is not art)
const has = (text, word) => {
  const w = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(word.length <= 4 ? `\\b${w}s?\\b` : `\\b${w}`, 'i').test(text);
};

const LEVELS = {
  bachelors: /bachelor|undergraduate/i,
  masters: /master|postgraduate|mba|msc|\bma\b/i,
  phd: /phd|doctoral|doctorate/i,
  'short course': /short course|training|fellowship|exchange/i,
};

// A deadline like "15 Jan 2027" or "1 April 2027 (annual)" -> Date, or null
function parseDeadline(text) {
  const m = String(text || '').match(/(\d{1,2})\s+([A-Za-z]{3,})\.?,?\s+(\d{4})/);
  if (!m) return null;
  const d = new Date(`${m[1]} ${m[2].slice(0, 3)} ${m[3]}`);
  return isNaN(d) ? null : d;
}

// What a programme TITLE looks like for the user's subject. (EU categories are too broad:
// "Information Science and Engineering" covers every engineering programme.)
const FIELD_GROUPS = [
  [/computer|software|data|\bai\b|artificial|information tech|\bit\b|cyber/i,
    /data|software|comput|informati|\bai\b|artificial intelligence|intelligent|cyber|digital|machine learning|robot|network|algorithm/i],
  [/electr|power|energy|telecom/i, /electr|power|energy|renewable|telecom|photonic/i],
  [/mechan|civil|construct|industrial|manufactur|chemical eng|petroleum|mining/i, /mechan|civil|construct|structur|materials|manufactur|industrial|process|engineering/i],
  [/architect|urban|planning/i, /architect|urban|planning|landscape|built environment|city/i],
  [/business|management|econom|finance|account|commerce|bba|mba|marketing|supply chain/i, /business|econom|management|finance|entrepreneur|marketing|supply chain|innovation|tourism/i],
  [/medic|health|mbbs|nurs|bio|pharm|dental|public health|nutrition/i, /health|medic|bio|pharm|nurs|nutrition|epidemiolog|infect|vaccin|neuro|food/i],
  [/environment|climate|agri|water|forest|geolog|geograph/i, /environment|climate|agri|water|sustainab|forest|soil|earth|geo|marine|ocean|biodivers/i],
  [/math|physic|chemi|statistic|astro/i, /math|physic|chemi|statistic|quantum|astro|nano|optic|photonic|material/i],
  [/law|politic|international relation|public admin|governance|social|sociolog|psycholog|anthropolog|peace|gender|develop/i,
    /law|politic|social|psycholog|governance|public policy|human rights|peace|migration|development|gender|security|international/i],
  [/educat|english|linguist|language|literature|history|philosoph|islamic|media|journal|communication/i,
    /educat|language|linguist|literature|cultur|history|heritage|philosoph|religio|media|journal|communication|translation/i],
  [/\barts?\b|design|film|music|fashion|textile|performing/i, /\barts?\b|design|film|music|fashion|textile|performing|creative|visual/i],
];

// Degree names students write in short form ("BSCS", "MS CS", "BSIT", "BBA") in full words, so they match programmes
const ABBREVIATIONS = [
  [/\b(?:bs|ms|m\.?phil|phd|b\.?sc|m\.?sc)?\s*-?\s*cs\b/gi, ' computer science '],
  [/\b(?:bs|ms)?\s*-?\s*(?:it|i\.t\.)\b/gi, ' information technology '],
  [/\b(?:bs|ms)?\s*-?\s*se\b/gi, ' software engineering '],
  [/\b(?:bs|ms)?\s*-?\s*ds\b/gi, ' data science '],
  [/\b(?:bs|ms)?\s*-?\s*ai\b/gi, ' artificial intelligence '],
  [/\b(?:bs|ms|be|b\.?e\.?)?\s*-?\s*ee\b/gi, ' electrical engineering '],
  [/\b(?:bba|mba)\b/gi, ' business administration '],
];
const expandField = (t) => ABBREVIATIONS.reduce((s, [re, full]) => s.replace(re, full), String(t || '')).replace(/\s+/g, ' ').trim();

function scoreScholarship(o, p) {
  const reasons = [];
  let score = 0;
  // the student's subject in full words: "CS" / "BSCS" / "MS CS" -> "computer science"
  p = { ...p, preferences: { ...p.preferences, studyField: expandField(p.preferences?.studyField) },
    education: { ...p.education, program: expandField(p.education?.program), lastDegree: expandField(p.education?.lastDegree) } };

  // 1. level (Masters / PhD / Bachelors)
  const level = (p.preferences?.degreeLevel || '').toLowerCase();
  const levels = (o.levels?.length ? o.levels : [o.level || '']).join(' ');
  if (level && LEVELS[level]?.test(levels)) {
    score += 35;
    reasons.push(`${p.preferences.degreeLevel} level`);
  } else if (level) {
    reasons.push(`offered for ${o.level} (you chose ${p.preferences.degreeLevel})`);
  }

  // 2. field of study
  const field = [p.preferences?.studyField, p.education?.program, p.education?.lastDegree].filter(Boolean).join(' ');
  // generic words like "science" would match almost every programme, so they don't count
  const GENERIC = /^(science|sciences|studies|study|management|engineering|technology|arts|master|masters)$/;
  const kws = keywords(p.preferences?.studyField, p.education?.program, p.education?.lastDegree).filter((k) => !GENERIC.test(k));
  const text = `${o.title} ${o.fieldNote || ''} ${(o.tags || []).join(' ')} ${(o.fieldWords || []).join(' ')}`;
  const hits = kws.filter((k) => has(text, k));
  const group = FIELD_GROUPS.find(([mine]) => mine.test(field));
  if (o.fieldsAll) {
    score += 25;
    reasons.push('all fields accepted');
  } else if (hits.length) {
    score += 30;
    reasons.push(`field: ${tidy(hits).slice(0, 2).join(', ')}`);
  } else if (group && group[1].test(o.title)) {
    score += 25;
    reasons.push('related to your field');
  } else if (o.fieldNote) {
    reasons.push(`subject: ${o.fieldNote.split(',')[0]}`);
  }

  // 3. Pakistani applicants: every supported programme accepts them
  score += 15;
  reasons.push('open to Pakistani applicants');

  // 4. timing
  if (o.status === 'open') { score += 25; reasons.push('applications open now'); }
  else if (o.status === 'upcoming') { score += 15; reasons.push('opens soon'); }
  else if (o.status === 'varies') { score += 10; reasons.push('deadline set per course'); }
  else if (o.status === 'closed') { reasons.push('closed now, prepare for the next cycle'); }
  else {
    const deadline = parseDeadline(o.deadline);
    if (deadline && deadline < new Date()) return { score: 0, reasons: ['deadline passed'], expired: true };
    if (deadline) { score += 15; reasons.push(`deadline ${o.deadline}`); }
  }

  // 5. hard conditions: things that make the programme NOT suitable for this student
  const blockers = [];
  const req = o.requires || {};
  if (level && levels.trim() && !LEVELS[level]?.test(levels)) blockers.push(`for ${o.level || levels} applicants (you are looking for ${p.preferences.degreeLevel})`);
  if (!o.fieldsAll && field && !hits.length && !(group && group[1].test(`${o.title} ${o.fieldNote || ''}`)) && (o.fieldNote || o.fieldWords?.length)) {
    blockers.push(`subject is ${o.fieldNote || 'a different field'}`);
  }
  const years = parseFloat(p.job?.experienceYears || '0') || 0;
  if (req.minExperienceYears && years < req.minExperienceYears) blockers.push(`needs ${req.minExperienceYears}+ years of work experience`);
  if (req.academic && !/lecturer|professor|teacher|faculty|academic|instructor|research(er)? (fellow|associate)/i.test(p.job?.currentTitle || '')) {
    blockers.push('only for university teachers / academics');
  }
  if (req.formerHolder && !new RegExp(req.formerHolder, 'i').test(p.preferences?.previousScholarships || '')) {
    blockers.push(`only for former ${req.formerHolder} scholarship holders`);
  }
  // with an empty profile we cannot judge: then everything counts as suitable
  const judged = !!(level || field);
  const suitable = !judged || blockers.length === 0;
  if (!suitable) score = Math.min(score, 30);

  return { score: Math.min(100, score), reasons, suitable, blockers };
}

function scoreJob(o, p) {
  const reasons = [];
  let score = 0;

  const kws = keywords(p.preferences?.jobKeywords, p.job?.currentTitle, p.preferences?.studyField);
  const inTitle = kws.filter((k) => has(o.title, k));
  const inText = kws.filter((k) => !inTitle.includes(k) && has(`${o.description} ${o.org}`, k));
  if (inTitle.length) {
    score += Math.min(60, 30 + inTitle.length * 10);
    reasons.push(`title: ${tidy(inTitle).slice(0, 3).join(', ')}`);
  }
  if (inText.length) {
    score += Math.min(15, inText.length * 5);
    reasons.push(`mentions: ${tidy(inText).slice(0, 3).join(', ')}`);
  }

  const cities = keywords(p.preferences?.preferredCities, p.address?.city);
  const where = `${o.location} ${o.description}`;
  const city = cities.find((c) => has(where, c));
  if (city) {
    score += 25;
    reasons.push(`location: ${city}`);
  }
  return { score: Math.min(100, score), reasons };
}

function scoreOpportunity(o, profile) {
  const p = profile?.toObject ? profile.toObject() : profile || {};
  if (o.source === 'demo') return { score: 100, reasons: ['local demo portal for testing the agent'], suitable: true, blockers: [] };
  return o.type === 'scholarship' ? scoreScholarship(o, p) : { suitable: true, blockers: [], ...scoreJob(o, p) };
}

module.exports = { scoreOpportunity, keywords, parseDeadline };
