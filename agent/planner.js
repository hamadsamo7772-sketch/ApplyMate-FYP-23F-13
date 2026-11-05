// planner.js — decides what the agent should do next on the current page.
//
// How it works:
//   1. Simple rules map obvious fields (autocomplete="email", type="tel", ...)  -> no LLM needed
//   2. The local LLM maps the remaining fields to profile KEYS (it never sees the values)
//   3. Code turns each mapping into an action with the real value from profile.json
//   4. If nothing is left to fill, it picks the next step: click "Next", or stop and hand
//      control to the user (CAPTCHA, errors, missing data, or the final Submit).

const PROFILE_KEYS = require('./profile-keys');
const { answerFor } = require('./answers');
const KEYS = Object.keys(PROFILE_KEYS);

// ---------------------------------------------------------------- rules (no LLM)

const AUTOCOMPLETE = {
  email: 'personal.email',
  tel: 'personal.phone',
  'tel-national': 'personal.phone',
  name: 'personal.fullName',
  'given-name': 'personal.firstName',
  'family-name': 'personal.lastName',
  bday: 'personal.dateOfBirth',
  sex: 'personal.gender',
  'street-address': 'address.street',
  'address-line1': 'address.street',
  'address-level2': 'address.city',
  'address-level1': 'address.province',
  country: 'address.country',
  'country-name': 'address.country',
};

// Labels that mean the same thing on almost every international application form.
// Matched before the LLM: faster, and these fields are too important to guess.
const LABEL_RULES = [
  // combined and education questions of long international forms (checked first: they contain other topic words)
  [/post ?code.*(town|city)|zip.*(town|city)|(town|city).*post ?code/i, 'address.postalTown'],
  [/dates? of attendance|attendance dates|period of stud(y|ies)/i, 'education.attendance'],
  [/country of .*(university entrance|school leaving|secondary school)/i, 'eduInter.country'],
  [/date of .*(university entrance|school leaving|secondary school)/i, 'eduInter.endDate'],
  [/location of (the )?university|^(country|location) of (the )?(first )?(college|university|institution)|university country/i, 'education.institutionCountry'],
  [/^name of (the )?(first )?(college|university|institution)/i, 'education.institution'],
  [/^degree ?\/ ?program(me)?$|^(degree|programme|program) (title|name)$|^degree programme$/i, 'education.lastDegree'],
  [/date of (the )?final exam|final exam(ination)? date/i, 'education.endDate'],
  [/starting semester|start(ing)? (semester|year) at|semester of (enrol|admission)/i, 'education.startDate'],
  [/language of instruction|medium of instruction|teaching language/i, 'languages.instruction'],
  [/^street\b.*\b(house|number|nr|no)\b|^(house|flat)\b.*\bstreet\b|^address line ?1$/i, 'address.street'],
  // "Midlde Name" (a real typo on the HEC portal) is still the middle name, never the first name
  [/^mi[a-z]{0,3}d[a-z]{0,3}e name|middle name/i, 'personal.middleName'],
  [/^(funding|scholarship|grant) ?programme$|^programme$|funding programme|programme applied for/i, 'opportunity.programme'],
  [/^target country$|host country|destination country|country of (the )?(stay|study abroad)/i, 'opportunity.targetCountry'],
  [/^(applicant )?status$|applicant status|status group|academic status/i, 'opportunity.applicantStatus'],
  [/country of (residence|domicile)|current country|resident in/i, 'address.country'],
  [/place of birth|city of birth|birth ?place/i, 'personal.placeOfBirth'],
  [/country of birth/i, 'personal.countryOfBirth'],
  [/passport (no|number|nr)/i, 'personal.passportNumber'],
  [/passport (valid|expir)/i, 'personal.passportExpiry'],
  [/marital|family status/i, 'personal.maritalStatus'],
  [/^(title|salutation|form of address)$/i, 'personal.title'],
  [/citizenship|nationality/i, 'personal.nationality'],
  [/mother tongue|native language|first language/i, 'languages.motherTongue'],
  [/english/i, 'languages.english'],
  [/german/i, 'languages.german'],
  [/post ?code|postal code|zip/i, 'address.postalCode'],
  [/best (possible )?grade|maximum grade|grading scale/i, 'education.gradeScale'],
  [/studied from|start of (studies|study)|studies (started|from)/i, 'education.startDate'],
  [/studied until|end of (studies|study)|graduation date|date of graduation/i, 'education.endDate'],
  [/motivation|statement of purpose/i, 'statements.motivation'],
  [/career (goals|plans)|plans after/i, 'statements.careerGoals'],
  [/^(first|given) names?(\(s\))?$|^first name|^given name|forename/i, 'personal.firstName'],
  [/^surname|^last name|^family name/i, 'personal.lastName'],
  [/date of birth|birth ?date|^dob$/i, 'personal.dateOfBirth'],
  [/^(gender|sex)$/i, 'personal.gender'],
  [/place of study|city of (study|the university)|university city|study location/i, 'education.institutionCity'],
  [/country of (study|the university)|university country/i, 'education.institutionCountry'],
  [/^(university|institution|college|higher education institution|name of (the )?(university|institution))$/i, 'education.institution'],
  [/^subject$|field of study|^major$|discipline|subject of stud/i, 'education.fieldOfStudy'],
  [/degree obtained|highest degree|^degree( title)?$|academic degree|qualification obtained/i, 'education.lastDegree'],
  [/final grade|^c?gpa$|grade point|overall grade|final mark/i, 'education.cgpa'],
  [/^(street|street and (house )?number|address line ?1?|postal address|home address|address)$/i, 'address.street'],
  [/^(city|town|city of residence|place of residence)$/i, 'address.city'],
  [/^(province|state|region)$/i, 'address.province'],
  [/domicile/i, 'personal.domicile'],
  [/^country$/i, 'address.country'],
  [/^father('?s)? name|^guardian/i, 'personal.fatherName'],
  // the student's own phone / email (not a parent's, referee's or emergency contact's)
  [/^(?!.*(father|mother|guardian|parent|referee|reference|emergency|spouse)).*(tele?phone|\bphone|\bmobile|\bcell\b|whats ?app|contact (number|no))/i, 'personal.phone'],
  [/^(?!.*(father|mother|guardian|parent|referee|reference|emergency|spouse)).*\be-?mail\b/i, 'personal.email'],
];

// While the agent adds ONE degree (education history pop-up), these labels mean that degree's data
const ENTRY_RULES = [
  [/qualification level|level of (education|qualification)|degree level|education level/i, 'edu.level'],
  [/incomplete|currently (studying|enrolled)|in progress|not (yet )?completed/i, 'edu.incomplete'],
  [/start date|from date|^from$|date of (admission|enrolment)/i, 'edu.startDate'],
  [/end date|to date|^to$|completion date|date of (completion|passing)|passing year|year of passing/i, 'edu.endDate'],
  [/name on (degree|certificate)/i, 'edu.nameOnDegree'],
  [/awarding (institute|body|university)|^board|board of|degree awarding|university \/ board|^university$/i, 'edu.board'],
  [/school|college|campus|institute name|^institute$/i, 'edu.school'],
  [/sector|public \/ private|institute type/i, 'edu.sector'],
  [/program(me)? title|degree title|^degree$|^program(me)?$|certificate title/i, 'edu.programTitle'],
  [/discipline|subject|major|group|specialization|field of study/i, 'edu.discipline'],
  [/roll (number|no)|registration/i, 'edu.rollNumber'],
  [/obtained cgpa|^cgpa$|cgpa obtained|^gpa$/i, 'edu.cgpa'],
  [/total cgpa|out of|cgpa scale|maximum cgpa/i, 'edu.cgpaScale'],
  [/obtained marks|marks obtained/i, 'edu.obtainedMarks'],
  [/total marks|maximum marks/i, 'edu.totalMarks'],
  [/^country/i, 'edu.country'],
  [/^city/i, 'edu.city'],
];

// "Matric" in the profile = "Secondary School Certificate / Matriculation / O - level" on HEC, etc.
const LEVEL_MATCH = {
  matric: 'matric|secondary school certificate|\\bssc\\b|o.?-?\\s*level',
  intermediate: 'intermediate|higher secondary|\\bhssc\\b|a.?-?\\s*level|f\\.?sc|f\\.?a\\b',
  bachelor: 'bachelor|\\bbs\\b|\\bba\\b|\\bbsc\\b|undergraduate',
  master: 'master|\\bms\\b|m\\.?phil|\\bmsc\\b|\\bma\\b|postgraduate',
};

function ruleKey(field, profile) {
  if (profile?.edu) {
    const label = String(field.label || '').replace(/\(.*?\)|[*:]/g, '').trim();
    for (const [re, key] of ENTRY_RULES) if (re.test(label)) return key;
  }
  // sites copy autocomplete="country" onto unrelated fields: only trust it when the question agrees
  if (field.autocomplete && AUTOCOMPLETE[field.autocomplete] && keyFits(field, AUTOCOMPLETE[field.autocomplete])) return AUTOCOMPLETE[field.autocomplete];
  if (field.kind === 'email') return 'personal.email';
  if (field.kind === 'tel') return 'personal.phone';
  if (field.kind === 'file') {
    // a button that only says "Browse File" / "Upload": its section or the page heading says which document
    const generic = /^(browse|choose|select|upload|attach|add)\b.{0,12}$/i.test(String(field.label || '').trim());
    const t = `${field.label} ${field.hint || ''}${generic ? ` ${field.section || ''} ${field.pageHeading || ''}` : ''}`;
    const FILES = [
      [/curriculum|\bcv\b|r[ée]sum[ée]/i, 'documents.cv'],
      [/passport/i, 'documents.passport'],
      [/language (cert|test|proof)|ielts|toefl|testdaf|goethe/i, 'documents.languageCert'],
      [/transcript|mark ?sheet|grades|records of (study|achievement)/i, 'documents.transcript'],
      [/degree|diploma|certificate of (graduation|degree)/i, 'documents.degree'],
      [/motivation|statement of purpose|cover letter/i, 'documents.motivationLetter'],
      [/cnic|identity card|national id/i, 'documents.cnicCopy'],
      [/photo|picture|portrait/i, 'documents.photo'],
    ];
    return FILES.find(([re]) => re.test(t))?.[1] || null;
  }
  const label = String(field.label || '').replace(/\(.*?\)|[*:]/g, '').trim();
  // a box called just "Name" whose placeholder says "First Name" / "Last Name"
  if (/^name$/i.test(label) && field.hint) {
    if (/first|given|fore/i.test(field.hint)) return 'personal.firstName';
    if (/last|sur|family/i.test(field.hint)) return 'personal.lastName';
  }
  // "English test score" etc. are not the level: only short labels for languages
  for (const [re, key] of LABEL_RULES) {
    if (/^languages\.(english|german)$/.test(key) && !/skill|level|knowledge|proficien|^(english|german)$/i.test(label)) continue;
    if (re.test(label)) return key;
  }
  return null;
}

// ---- does a profile key fit the question? (the model's choice is checked, never trusted) ----
// Personal data may only go into a field whose question names it.
const STRICT_TOPIC = {
  'personal.fullName': /name/i, 'personal.firstName': /name/i, 'personal.middleName': /name/i,
  'personal.lastName': /name/i, 'personal.fatherName': /name|father|guardian|parent/i,
  'personal.gender': /gender|\bsex\b/i, 'personal.nationality': /nationalit|citizen/i,
  'personal.email': /e-?mail/i, 'personal.phone': /phone|mobile|\bcell|whats ?app|contact (number|no)|\btel/i,
  'personal.dateOfBirth': /birth|\bdob\b/i, 'personal.cnic': /cnic|\bnic\b|identity|b-?form|national id/i,
  'personal.passportNumber': /passport/i, 'personal.passportExpiry': /passport/i,
};
// words that say nothing about the topic of a question
const STOP = new Set(['your', 'what', 'which', 'with', 'from', 'that', 'this', 'have', 'been', 'date', 'number', 'other',
  'please', 'current', 'enter', 'give', 'select', 'upload', 'file', 'applicant', 'student', 'there', 'where', 'when',
  'will', 'would', 'their', 'about', 'into', 'only', 'also', 'more', 'than', 'does', 'name', 'names', 'here', 'last', 'first']);
const topicWords = (t) => new Set(String(t || '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/)
  .filter((w) => w.length >= 4 && !STOP.has(w)).map((w) => w.slice(0, 5)));

function keyFits(field, key) {
  if (field.kind === 'file' || key.startsWith('documents.')) return field.kind === 'file' && key.startsWith('documents.');
  const label = String(field.label || '');
  if (STRICT_TOPIC[key]) {
    return STRICT_TOPIC[key].test(label) || (key === 'personal.email' && field.kind === 'email') || (key === 'personal.phone' && field.kind === 'tel');
  }
  const topic = topicWords(`${key.split('.').pop()} ${PROFILE_KEYS[key] || ''}`);
  return [...topicWords(label)].some((w) => topic.has(w));
}

// ---- questions the model never answers ----
// Essays and long texts: only the student's own saved statements / answers go in there
const ESSAY = /motivat|statement|essay|abstract|reasons? for|why (do|did|are|would|have)|describe|explain|circumstances|disabilit|personal problems|cover letter|tell us|research (proposal|interest)|\bmax(imum)?\.? ?\d+ ?(characters|chars|words)/i;
const isEssay = (f) => !['select', 'radio', 'checkbox', 'file', 'dropdown'].includes(f.kind) &&
  ((f.kind === 'textarea' && !/address|affiliation|position|institution/i.test(f.label)) || (f.maxLength > 300) || ESSAY.test(f.label));
// Preferences and rankings: only the student can choose ("Fifth choice", "How did you hear about us?")
const PREFERENCE = /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+(st|nd|rd|th))\s+(choice|preference|priority|option)\b|\b(choice|preferences?|priority|priorities|ranking)\b|which (university|universities|track|speciali[sz]ation|programme|program|mobility)|how did you (hear|come to know|learn|find)|where did you (hear|learn|find)|\btrack\b|speciali[sz]ation|mobility (path|track|scheme)/i;
const isPreference = (f) => PREFERENCE.test(f.label || '') || /preferen|\bchoices?\b/i.test(f.section || '');

// Answers the model gives that mean "I don't know"
const JUNK = /^(ask|none|null|nil|n\/?a|na|unknown|not (applicable|available|known|provided|specified|sure)|undefined|tbd|no answer|-+|\?+|\.+)$/i;

// ---- a value must look right for its field ----
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const looksPhone = (v) => /^[+()\d\s.-]+$/.test(v) && v.replace(/\D/g, '').length >= 9 &&
  !/^\d{4}-\d{2}-\d{2}$|^\d{1,2}[-.]\d{1,2}[-.]\d{4}$/.test(v.trim());
const isPhoneField = (f) => f.kind === 'tel' || /tele?phone|\bphone|\bmobile|\bcell\b|whats ?app|contact (number|no)|\bfax\b/i.test(f.label || '');
const isEmailField = (f) => f.kind === 'email' || /e-?mail/i.test(f.label || '');
function valueFits(f, key, value) {
  const v = String(value || '').trim();
  if (!v) return false;
  if (isEmailField(f)) return EMAIL_RE.test(v);         // an email field takes only an email address
  if (/@/.test(v)) return false;                         // ...and an email address goes nowhere else
  if (key === 'personal.phone' || isPhoneField(f)) return isPhoneField(f) && looksPhone(v);
  if (looksPhone(v) && /name|date|birth|city|town|country|place|nationality|gender|sex/i.test(f.label || '')) return false;
  if (/name/i.test(f.label || '') && /\d{3,}/.test(v)) return false;
  return true;
}

// ---- repeated numbered fields ("Language 1".."Language 5", "Name referee 1") come from lists in the profile ----
const NUMBERED = /\b(language|referee|reference|recommender)s?\b\D{0,12}?(\d)\b|\b(\d)(?:st|nd|rd|th)?\s*(language|referee|reference|recommender)\b/i;
const REFEREE_PART = /name|institution|position|title|organi[sz]ation|affiliation|university|employer|e-?mail|phone|tel|address/i;
function numbered(field) {
  const m = NUMBERED.exec(String(field.label || ''));
  if (m) {
    const what = (m[1] || m[4]).toLowerCase();
    return { list: what === 'language' ? 'languages' : 'referees', n: +(m[2] || m[3]) };
  }
  // "References › Academic Referee › Full name": the number of the referee section on the page (set by planActions)
  if (field.refN && REFEREE_PART.test(field.label || '')) return { list: 'referees', n: field.refN };
  return null;
}
// which part of a referee a question asks for
function refereePart(label, r) {
  if (/e-?mail/i.test(label)) return r.email || '';
  if (/phone|\btel/i.test(label)) return r.phone || '';
  const pos = /position|title|job/i.test(label), inst = /institution|organi[sz]ation|affiliation|university|employer/i.test(label), addr = /address/i.test(label);
  if (pos || inst || addr) return [pos && r.position, inst && r.institution, addr && r.address].filter(Boolean).join(', ');
  return /name|referee|reference|recommender/i.test(label) ? r.name || '' : '';
}
const partOf = (label) => (/e-?mail/i.test(label) ? 'email' : /phone|\btel/i.test(label) ? 'phone' : /position|title|job|institution|organi|affiliation|address|university|employer/i.test(label) ? 'where' : 'name');
const CEFR = ['reading', 'writing', 'speaking', 'listening'];
function listValue(field, profile) {
  const nf = numbered(field);
  if (!nf) return '';
  if (nf.list === 'languages') {
    // "Spanish: Reading B1, Writing B1, Speaking B2, Listening B2"
    const l = (profile.languages?.others || []).filter((x) => x?.language)[nf.n - 1];
    if (!l) return '';
    const levels = CEFR.filter((k) => l[k]).map((k) => `${k[0].toUpperCase()}${k.slice(1)} ${l[k]}`);
    return levels.length ? `${l.language}: ${levels.join(', ')}` : l.language;
  }
  const label = String(field.label || '');
  const r = (profile.referees || []).filter((x) => x?.name)[nf.n - 1];
  if (r) return refereePart(label, r);
  // not in the profile list yet: a saved answer for the same referee and the same part ("E-mail address referee 1")
  const saved = (profile.answers || []).find((a) => a.kind !== 'file' && a.value && (() => {
    const an = numbered({ label: a.label });
    return an && an.list === 'referees' && an.n === nf.n && partOf(a.label) === partOf(label);
  })());
  return saved?.value || '';
}

// Honeypots: invisible "trap" fields that only bots fill. Never touch them.
const HONEYPOT = /do not fill|don't fill|leave (this )?(blank|empty)|honeypot|bot trap/i;

const CONSENT = /agree|accept|terms|privacy|consent|confirm|declare|certify|acknowledge/i;
const MARKETING = /newsletter|subscribe|marketing|offers|promotion|updates by email/i;
const NEXT_BUTTON = /^(next|continue|proceed|weiter|next step|save (and|&) (continue|next))\b/i;
const SUBMIT_BUTTON = /submi(t|ssion)|final|apply|send|finish|complete|confirm|register|sign up|create account|pay|^save\b/i;
// "Save progress" / "Save draft" only stores the answers on the portal: it is neither the next step nor the final submit
const SAVE_ONLY = /save (my )?(progress|draft|for later|and (exit|close|return))|^save$|save as draft|continue later/i;
// the button that really sends the application (preferred over a plain "Save")
const FINAL_BUTTON = /final submission|submit|send (my |the )?application|apply now|finish|complete (the )?application/i;
const LOGIN_BUTTON = /^(log ?in|sign ?in|login)\b/i;
// one-time codes sent by email / SMS: only the user has them
const CODE_FIELD = /verification code|verify code|one[- ]time|\botp\b|security code|code (we )?sent|enter (the )?code|pin code/i;

// A real website (not the local demo portals or a file on this computer)
const isLive = (url) => /^https?:/i.test(url || '') && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(url || '');

// ---------------------------------------------------------------- LLM mapping

// Word stems of a text, to compare options with what we know about the student ("linguistics" ~ "linguistic")
const stems = (t) => new Set(String(t || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4).map((w) => w.slice(0, 5)));
const overlap = (text, known) => [...stems(text)].filter((w) => known.has(w)).length;

// Long lists (100+ fields of study, countries): the model sees only the options closest to the student's facts
function shortlist(opts, known, n = 15) {
  const other = opts.filter((o) => /^other\b/i.test(o.trim()));
  const best = opts.map((o) => ({ o, s: overlap(o, known) })).filter((x) => x.s > 0 && !other.includes(x.o))
    .sort((a, b) => b.s - a.s).slice(0, n).map((x) => x.o);
  return [...best, ...other];
}

const fullLabel = (f) => (f.section ? `${f.section} › ${f.label}` : f.label);

function describeField(f, i, known = new Set()) {
  let d = `${i + 1}. "${fullLabel(f)}" (${f.kind}`;
  if (f.hint) d += `, hint: "${f.hint}"`;
  if (f.options?.length) {
    const opts = f.options.map((o) => (typeof o === 'string' ? o : o.label));
    if (opts.length > 40) {
      const near = shortlist(opts, known);
      d += near.length
        ? `: ${opts.length} options; the ones closest to the facts are ${near.join(' / ')}`
        : `: ${opts.length} options, none of them close to the facts`;
    } else {
      d += `: ${opts.slice(0, 14).join(' / ')}${opts.length > 14 ? ' / ...' : ''}`;
    }
  }
  if (f.required) d += ', required';
  return d + ')';
}

// What the offline model may know about the student to answer a question itself.
// Only general facts: never CNIC, passport number, phone, email, date of birth or the street address
// (those are filled by key, the model never sees them). The model runs on this computer (Ollama).
function factsOf(profile) {
  const p = profile || {};
  const g = (o, k) => (o && o[k] ? String(o[k]) : '');
  const facts = [];
  const add = (k, v) => v && facts.push(`- ${k}: ${v}`);
  add('Nationality (only one)', g(p.personal, 'nationality'));
  add('Gender', g(p.personal, 'gender'));
  add('Country of residence', g(p.address, 'country'));
  add('City of residence', g(p.address, 'city'));
  add('Place of birth', [g(p.personal, 'placeOfBirth'), g(p.personal, 'countryOfBirth')].filter(Boolean).join(', '));
  const degrees = [['Matric / O-level', p.eduMatric], ['Intermediate / A-level', p.eduInter], ["Bachelor's", p.eduBachelor], ["Master's", p.eduMaster]]
    .filter(([, d]) => d && (d.board || d.school || d.programTitle));
  for (const [name, d] of degrees) {
    const status = d.incomplete === 'Yes' ? `in progress, not yet graduated (expected ${String(d.endDate || '').slice(0, 4) || 'later'})` : 'completed';
    add(`${name} degree`, `${[d.programTitle, d.discipline && `field: ${d.discipline}`, d.school || d.board, [d.city, d.country].filter(Boolean).join(', ')].filter(Boolean).join('; ')} (${status})`);
  }
  add("Number of Bachelor's degrees", p.eduBachelor && (p.eduBachelor.school || p.eduBachelor.programTitle) ? '1' : (degrees.length ? '0' : ''));
  add("Master's degrees", p.eduMaster && (p.eduMaster.school || p.eduMaster.programTitle) ? (p.eduMaster.incomplete === 'Yes' ? 'currently enrolled in one' : 'completed one') : (degrees.length ? 'none, not enrolled in any' : ''));
  add('Mother tongue', g(p.languages, 'motherTongue'));
  add('English level', g(p.languages, 'english'));
  add('English test', [g(p.languages, 'englishTest'), g(p.languages, 'englishScore')].filter(Boolean).join(' '));
  add('Work experience (years)', g(p.job, 'experienceYears'));
  add('Previous scholarships', g(p.preferences, 'previousScholarships'));
  for (const a of (p.answers || []).filter((x) => x.kind !== 'file').slice(-40)) add(`Student answered "${a.label}"`, a.value);
  return facts.join('\n') || '- (no facts saved yet)';
}

// The model thinks about each field: which saved profile data belongs there, or what the answer is
// from the facts above, or that the student must be asked. Never a guess.
async function llmDecide(fields, profile, ask) {
  // FIXED part first (Ollama re-uses it between calls), CHANGING part (facts and fields) last.
  const prompt = `You are helping a student fill an application form (scholarship or job).
For each form field decide ONE of these:
  {"key": "<profile key>"}   the student's saved data for that key belongs in the field (the value is filled in by code)
  {"answer": "<text>"}      you can answer with certainty from the STUDENT FACTS below. For a choice field
                            (select / radio), copy one of the listed options exactly. If none of the options
                            fits the facts, use "ask": never pick the nearest option.
  {"ask": true}             the facts do not say: the student will be asked. Use this for essays, motivation texts,
                            referees, opinions and anything you would have to guess.
Rules:
- Think about what the question really asks. A key fits only if its meaning answers the question
  (e.g. "language of instruction" is a language, not a degree name; "University City and Country" is a place).
- Yes/No questions about the student's situation (more than one nationality? another Bachelor's? enrolled in a Master's?)
  are answered from the facts when the facts make it clear.
- A single name field (not split into first/last) is personal.fullName.
- File upload fields can only use documents.* keys, or "ask".
- Never invent names, numbers, dates or scores.

Profile keys (key: meaning):
${KEYS.map((k) => `- ${k}: ${PROFILE_KEYS[k]}`).join('\n')}

STUDENT FACTS:
${factsOf(profile)}

Form fields:
${fields.map((f, i) => describeField(f, i, stems(factsOf(profile)))).join('\n')}

Answer with a JSON array of exactly ${fields.length} objects, one per field, in the same order.
Every object starts with "n" (the field's number above) and "field" (the first three words of that field's question, after any "›"),
so each answer can be checked against its field.`;

  if (process.env.DEBUG_PROMPT) console.log('\n----- PROMPT -----\n' + prompt + '\n------------------\n');

  const schema = {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        n: { type: 'integer' }, field: { type: 'string' },
        key: { type: 'string', enum: [...KEYS, 'none'] }, answer: { type: 'string' }, ask: { type: 'boolean' },
      },
      required: ['n', 'field'],
    },
    minItems: fields.length,
    maxItems: fields.length,
  };
  const out = await ask(prompt, schema);
  const asDecision = (d) => {
    if (d?.key && KEYS.includes(d.key)) return { key: d.key };
    const answer = typeof d?.answer === 'string' ? d.answer.trim() : '';
    // the model sometimes writes the key name as the answer ("personal.email"): that is the key, never the text
    if (KEYS.includes(answer)) return { key: answer };
    if (answer && !JUNK.test(answer) && !/^[a-z]+\.[a-zA-Z]+$/.test(answer)) return { answer: answer.slice(0, 200) };
    return { ask: true };
  };
  // answers can get out of step with the fields: take each one only by its number AND its question
  const byNumber = {};
  for (const d of Array.isArray(out) ? out : []) if (Number.isInteger(d?.n)) byNumber[d.n] = d;
  return fields.map((f, i) => {
    const d = byNumber[i + 1];
    return d && sameQuestion(d.field, fullLabel(f)) ? asDecision(d) : null; // null = answered for another field
  });
}

// "Language 1" vs the model's "field": "Language 1:" -> same; "Your full first" -> not the same
function sameQuestion(echo, label) {
  const words = (t) => String(t || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const l = words(label);
  const e = words(echo).slice(0, 4);
  if (!l.length) return true; // untitled field: only the number can be checked
  if (!e.length) return false;
  // the first words must be in the question; numbers ("1", "2") must be the same
  const nums = (ws) => ws.filter((w) => /^\d+$/.test(w)).join(',');
  return e.filter((w) => l.includes(w)).length >= Math.min(2, e.length) && (!nums(e) || nums(e) === nums(l));
}

// Decides every field, checking each answer: answers that belong to another field are asked again
// one by one, and a key must fit the question (personal data only where the question names it).
async function decideFields(fields, profile, ask) {
  let decisions = await llmDecide(fields, profile, ask);
  for (const [i, f] of fields.entries()) {
    if (decisions[i]) continue;
    try { decisions[i] = (await llmDecide([f], profile, ask))[0]; } catch { decisions[i] = null; }
  }
  // numbers and email addresses in a free answer must come from the facts: the model may not invent them
  const facts = factsOf(profile).toLowerCase();
  const invented = (a) => (String(a).match(/\d{3,}|[^\s@]+@[^\s@]+/g) || []).some((x) => !facts.includes(x.toLowerCase()));
  // an "answer" that is just one of the questions on the page is no answer
  const { normalizeQ } = require('./answers');
  const questionsHere = new Set(fields.map((f) => normalizeQ(f.label)));
  return fields.map((f, i) => {
    const d = decisions[i] || { ask: true };
    if (d.key && !keyFits(f, d.key)) return { ask: true };
    if (d.answer && (invented(d.answer) || questionsHere.has(normalizeQ(d.answer)))) return { ask: true };
    return d;
  });
}

// ---------------------------------------------------------------- helpers

function getValue(profile, key) {
  const v = key.split('.').reduce((o, k) => o?.[k], profile);
  if (v) return String(v);
  // values made of two others: "Post Code, Town", "Dates of attendance (2019-2023)"
  if (key === 'address.postalTown') {
    const pc = getValue(profile, 'address.postalCode'), town = getValue(profile, 'address.city');
    return pc && town ? `${pc}, ${town}` : null;
  }
  if (key === 'education.attendance') {
    const s = getValue(profile, 'education.startDate'), e = getValue(profile, 'education.endDate');
    return s && e ? `${String(s).slice(0, 4)}-${String(e).slice(0, 4)}` : null;
  }
  // the student's answers to other forms count too ("City of Birth" on one form = "City/Place of birth" here)
  const fromAnswer = savedFor(profile, key);
  if (fromAnswer) return fromAnswer;
  if (key === 'education.institutionCountry') {
    const city = getValue(profile, 'education.institutionCity'); // "Sukkur, Pakistan"
    if (city && city.includes(',')) return city.split(',').pop().trim();
  }
  if (key === 'personal.fullName') {
    const { firstName, lastName } = profile.personal || {};
    if (firstName || lastName) return [firstName, lastName].filter(Boolean).join(' ');
  }
  // the summary education keys fall back to the highest degree in the education history
  const top = [profile.eduMaster, profile.eduBachelor, profile.eduInter, profile.eduMatric].find((d) => d && (d.school || d.board || d.programTitle));
  if (top && key.startsWith('education.')) {
    const fb = {
      'education.institution': top.school || top.board, 'education.fieldOfStudy': top.discipline, 'education.lastDegree': top.programTitle,
      'education.institutionCity': top.city, 'education.institutionCountry': top.country, 'education.cgpa': top.cgpa,
      'education.gradeScale': top.cgpaScale, 'education.startDate': top.startDate, 'education.endDate': top.endDate,
    }[key];
    if (fb) return String(fb);
  }
  return null;
}

// A saved answer whose question means this key (by the label rules), e.g. "What is your mother tongue?" -> languages.motherTongue
function savedFor(profile, key) {
  for (const a of profile?.answers || []) {
    const file = a.kind === 'file';
    if (file ? !a.path : !a.value) continue;
    if (key.startsWith('documents.') !== file) continue;
    const k = ruleKey({ label: a.label, kind: file ? 'file' : 'text' }, {});
    if (k === key) return file ? a.path : String(a.value);
  }
  return null;
}

// ---- formatting values to fit the field ----

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// profile dates are stored as YYYY-MM-DD; write them the way THIS field expects
function formatDate(iso, field) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m || field.kind === 'date') return iso; // <input type="date"> always takes YYYY-MM-DD
  const [, y, mo, d] = m;
  // the format may also be in the question itself: "Starting Semester (mm/yyyy)", "Date of final exam (dd/mm/yyyy)"
  const sample = `${field.value || ''} ${field.hint || ''} ${(String(field.label || '').match(/\(([^)]*)\)/) || [])[1] || ''}`;
  if (/\bmm\s*[\/.-]\s*yyyy\b/i.test(sample) && !/dd/i.test(sample)) return `${mo}/${y}`;                  // 09/2019

  if (/\d{1,2} [A-Za-z]{3,} \d{4}/.test(sample)) return `${d} ${MONTHS[+mo - 1]} ${y}`; // 21 Jul 2003
  if (/choose a date/i.test(sample)) return `${+mo}/${+d}/${y}`;                          // Angular Material
  if (/\d{4}-\d{2}-\d{2}/.test(sample) || /yyyy-mm-dd/i.test(sample)) return iso;
  if (/mm[\/.-]dd/i.test(sample)) return `${mo}/${d}/${y}`;                             // MM/DD/YYYY
  const sep = /dd-mm|\d{2}-\d{2}-\d{4}/i.test(sample) ? '-' : '/';
  return `${d}${sep}${mo}${sep}${y}`;                                                   // DD/MM/YYYY (Pakistan)
}

// Pakistani numbers are stored as 03xxxxxxxxx; adapt to +92 / 10-digit fields
function formatPhone(phone, field) {
  let digits = phone.replace(/[^\d]/g, '');
  if (digits.startsWith('92')) digits = '0' + digits.slice(2);
  if (/\+92/.test(field.hint || '')) return '+92' + digits.replace(/^0/, '');
  if (field.maxLength && digits.length > field.maxLength && digits.startsWith('0')) return digits.slice(1);
  return phone;
}

function formatValue(key, value, field) {
  if (key === 'personal.dateOfBirth' || /date$|Expiry$/i.test(key)) return formatDate(value, field);
  if (key === 'personal.phone') return formatPhone(value, field);
  return value;
}

// Does <input type="file" accept="..."> allow this file? e.g. accept="image/*" rejects cv.pdf
function acceptsFile(accept, file) {
  const ext = (file.split('.').pop() || '').toLowerCase();
  const IMAGE = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'];
  return accept.split(',').map((t) => t.trim().toLowerCase()).some((t) =>
    t === '*/*' || t === '.' + ext ||
    (t === 'image/*' && IMAGE.includes(ext)) ||
    (t === 'application/pdf' && ext === 'pdf') ||
    (t.endsWith('/' + ext)));
}

const isDateField = (f) => f.kind === 'date' || /\bdate\b|birth|\bdob\b/i.test(`${f.label} ${f.hint || ''}`);

// Find the option that matches a profile value: exact match first, then "all words match".
// "Male" must not match "Female", so we compare whole words, not substrings.
function matchOption(options, value) {
  // "graduates" = "graduate": compare words without a plural s
  const words = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean).map((w) => (w.length > 3 ? w.replace(/s$/, '') : w));
  const labels = options.map((o) => (typeof o === 'string' ? o : o.label));
  const v = words(value);

  const exact = labels.findIndex((l) => words(l).join(' ') === v.join(' '));
  if (exact >= 0) return exact;

  const hits = labels
    .map((l, i) => ({ i, w: words(l) }))
    .filter(({ w }) => w.length && (v.every((x) => w.includes(x)) || w.every((x) => v.includes(x))));
  if (hits.length === 1) return hits[0].i;
  if (hits.length > 1) return -1; // ambiguous -> let the user decide

  // long names (funding programmes): the option sharing most words, if clearly the best
  // nationality words: "Pakistani" -> "Pakistan", "Indian" -> "India", "German" -> "Germany"
  if (v.length === 1 && v[0].length >= 5) {
    const stem = v[0].replace(/(ian|ese|ish|i|an|n)$/, '');
    const nat = labels.map((l, i) => ({ i, w: words(l) })).filter(({ w }) => w.length === 1 && stem.length >= 4 && w[0].startsWith(stem) && Math.abs(w[0].length - v[0].length) <= 3);
    if (nat.length === 1) return nat[0].i;
  }

  if (v.length >= 3) {
    const scored = labels.map((l, i) => {
      const w = words(l);
      const common = v.filter((x) => w.includes(x)).length;
      return { i, r: common / Math.max(v.length, w.length) };
    }).sort((a, b) => b.r - a.r);
    if (scored[0]?.r >= 0.6 && (!scored[1] || scored[0].r - scored[1].r >= 0.15)) return scored[0].i;
  }
  return -1;
}

// An answer the model worked out for a choice field counts only when it IS one of the options:
// the same words, or the only option that starts with it ("Yes" -> "Yes, I will upload the certificate below.")
function exactOption(options, value) {
  const norm = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const labels = options.map((o) => (typeof o === 'string' ? o : o.label));
  const v = norm(value);
  if (!v) return -1;
  const same = labels.findIndex((l) => norm(l) === v);
  if (same >= 0) return same;
  const starts = labels.map((l, i) => ({ l: norm(l), i })).filter(({ l }) => l.startsWith(`${v} `));
  return starts.length === 1 ? starts[0].i : -1;
}

// A list of categories (fields of study, sectors…): the chosen option must share a word with the student's facts,
// otherwise the model only took the nearest one. Yes/No and sentence-like options are not checked.
function looksGuessed(options, idx, profile) {
  const labels = options.map((o) => (typeof o === 'string' ? o : o.label));
  if (labels.length < 4 || labels.some((l) => l.split(/\s+/).length > 5)) return false;
  return overlap(labels[idx], stems(factsOf(profile))) === 0;
}

// ---------------------------------------------------------------- main

/**
 * @param scan    result of scanner.js
 * @param profile profile.json
 * @param memory  object kept between steps (pass the same one every time)
 * @param ask     LLM function (defaults to llm.js askJSON)
 * @returns { actions, notes, stop }  stop = null or { reason, message }
 */
async function planActions(scan, profile, memory, ask) {
  ask = ask || require('./llm').askJSON;
  memory.keyCache ||= {}; // "kind|label" -> profile key (so the LLM is asked once per field)
  memory.attempts ||= {}; // field id -> how many times we tried to fill it
  memory.clicks ||= {};   // "url|button" -> how many times we clicked it

  const actions = [];
  const notes = [];

  // errors matter only where there is a form to fix (a dashboard message is not a form error)
  if (scan.errors.length && scan.fields.some((f) => !/search|filter|keyword/i.test(f.label))) {
    return { actions, notes, needsUser: [], stop: { reason: 'errors', message: `The page shows errors:\n- ${scan.errors.join('\n- ')}` } };
  }

  // A sign-in page: the student logs in (or creates the account) themselves.
  // The browser keeps them signed in, so next time the agent starts on the application itself.
  const hasPassword = scan.fields.some((f) => f.kind === 'password');
  const plainFields = scan.fields.filter((f) => !['password', 'checkbox'].includes(f.kind) && !/search|filter|service name|help library/i.test(`${f.label} ${f.hint || ''}`));
  if (isLive(scan.url) && hasPassword && plainFields.length <= 2 && scan.buttons.some((b) => LOGIN_BUTTON.test(b.text))) {
    return {
      actions, notes, needsUser: [],
      stop: {
        reason: 'login',
        message: 'This portal asks you to sign in. Type your email and password in the browser window and log in, ' +
          'then press continue: the agent opens the application form itself. It never sees or stores your password.',
      },
    };
  }

  // Fields still empty that we haven't already tried twice.
  // Exception: date fields that came PRE-FILLED (pickers often default to today) are checked once.
  memory.seen ||= {};
  const todo = scan.fields.filter((f) => !f.filled || (!memory.seen[f.id] && isDateField(f) && f.kind !== 'checkbox'));
  for (const f of scan.fields) memory.seen[f.id] = true;
  // Long forms repeat questions in several sections ("Academic Referee › Full name", "Second semester › First choice"):
  // such questions are named with their section, and referee sections are numbered in page order
  const { normalizeQ } = require('./answers');
  const seenQ = {};
  for (const f of scan.fields) seenQ[normalizeQ(f.label)] = (seenQ[normalizeQ(f.label)] || 0) + 1;
  const refSections = [...new Set(scan.fields.map((f) => f.section).filter((s) => /\b(referees?|references?|recommend\w*)\b/i.test(s || '')))];
  for (const f of scan.fields) {
    f.dup = seenQ[normalizeQ(f.label)] > 1;
    if (refSections.includes(f.section)) f.refN = refSections.indexOf(f.section) + 1;
    f.qLabel = (f.dup || f.refN) && f.section ? `${f.section} › ${f.label}` : f.label;
    if (f.kind === 'file' && scan.fields.filter((x) => x.kind === 'file').length === 1) f.pageHeading = scan.heading || scan.title || '';
  }
  const stuck = todo.filter((f) => (memory.attempts[f.id] || 0) >= 2);
  const open = todo.filter((f) => (memory.attempts[f.id] || 0) < 2);

  // 0. Trap fields: skip completely
  for (const f of open.filter((f) => HONEYPOT.test(`${f.label} ${f.hint || ''}`))) {
    notes.push(`Skipped trap field "${f.label}" (anti-bot honeypot)`);
  }
  // site tools (search boxes, filters, help widgets) are not part of the application: leave them alone
  const SITE_TOOL = /search|filter|newsletter|subscribe|keyword|service name|help library/i;
  const safe = open.filter((f) => !HONEYPOT.test(`${f.label} ${f.hint || ''}`) && !SITE_TOOL.test(`${f.label} ${f.hint || ''}`));

  const live = isLive(scan.url);
  const needsUser = []; // problems with REQUIRED fields -> the user must step in
  const nameOf = (f) => (f.hint ? `${f.label} (${f.hint})` : f.label);
  const problem = (f, msg) =>
    f.required ? needsUser.push(`"${nameOf(f)}" (${msg})`) : notes.push(`Left empty: "${nameOf(f)}" (${msg})`);

  // Passwords and one-time codes are never filled by the agent
  const personalOnly = (f) => f.kind === 'password' || CODE_FIELD.test(`${f.label} ${f.hint || ''}`);
  for (const f of safe.filter(personalOnly)) {
    if (f.kind === 'password') needsUser.push(`"${nameOf(f)}" (type your password yourself: the agent never handles passwords)`);
    else needsUser.push(`"${nameOf(f)}" (enter the code you received by email or SMS)`);
  }

  // 1. Checkboxes: never newsletters. Terms and declarations are ticked only on the local demo
  //    portals; on a real website they are a legal statement, so the student ticks them.
  for (const f of safe.filter((f) => f.kind === 'checkbox')) {
    const yesNo = ruleKey(f, profile);
    if (yesNo && !CONSENT.test(f.label)) {
      if (/^(yes|true|1)$/i.test(String(getValue(profile, yesNo) || ''))) actions.push({ action: 'check', target: f.id, label: f.label, key: yesNo });
      continue;
    }
    if (CONSENT.test(f.label) && !MARKETING.test(f.label)) {
      if (live) problem(f, 'read it and tick it yourself');
      else actions.push({ action: 'check', target: f.id, label: f.label });
    } else {
      notes.push(`Skipped checkbox "${f.label}"`);
    }
  }

  // 2. Decide for every other field: the student's saved answer -> cache -> rules -> the offline model thinks
  const others = safe.filter((f) => f.kind !== 'checkbox' && !personalOnly(f));
  // the options are part of the question: two untitled groups (e.g. icon radios) must not share an answer
  const cacheId = (f) => `${f.kind}|${f.section || ''}|${f.label}|${f.hint || ''}${f.options ? '|' + f.options.map((o) => (typeof o === 'string' ? o : o.label)).slice(0, 6).join('/') : ''}`;
  const asDecision = (c) => (typeof c === 'string' ? (c === 'none' ? { ask: true } : { key: c }) : c);
  const askLLM = [];

  for (const f of others) {
    if (answerFor(profile, f)) continue;
    if (numbered(f)) continue; // "Language 2", "Referee 1": from the profile's lists, never from the model
    if (memory.keyCache[cacheId(f)] !== undefined) continue;
    const k = ruleKey(f, profile);
    if (k) memory.keyCache[cacheId(f)] = k;
    // the model thinks only about REQUIRED fields that are not essays or preferences (those are the student's)
    else if (f.required && !isEssay(f) && !isPreference(f)) askLLM.push(f);
    else memory.keyCache[cacheId(f)] = { ask: true };
  }

  for (let i = 0; i < askLLM.length; i += 12) { // max 12 fields per call, so the model can think about each
    const batch = askLLM.slice(i, i + 12);
    try {
      const decisions = await decideFields(batch, profile, ask);
      batch.forEach((f, j) => (memory.keyCache[cacheId(f)] = decisions[j] || { ask: true }));
    } catch (err) {
      console.log(`⚠ LLM decision failed: ${err.message}`);
      batch.forEach((f) => (memory.keyCache[cacheId(f)] = { ask: true }));
    }
  }

  // questions only the student can answer: required ones stop the agent, optional ones are offered too
  const questions = [];
  const unresolved = (f, msg) => {
    questions.push({
      id: f.id, label: f.qLabel || f.label, hint: f.hint || '', required: !!f.required, reason: msg,
      kind: f.kind === 'file' ? 'file' : ['select', 'radio', 'dropdown'].includes(f.kind) && f.options?.length ? 'choice' : f.kind === 'textarea' || isEssay(f) ? 'long' : 'text',
      options: (f.options || []).map((o) => (typeof o === 'string' ? o : o.label)).filter((o) => o && !/please (make|select|choose)|^-+$|^select\b|^choose\b/i.test(o)).slice(0, 300),
    });
  };

  // 3. Turn decisions into actions with real values

  for (const f of others) {
    const saved = answerFor(profile, f);
    // "Language 1".."Language 5", "Name referee 1": item 1 of the profile's list goes into field 1, and so on
    if (!saved && numbered(f)) {
      const v = listValue(f, profile);
      if (v && !['select', 'radio', 'dropdown', 'file', 'checkbox'].includes(f.kind)) {
        if (!(f.filled && f.value === v)) actions.push({ action: 'fill', target: f.id, value: v, key: 'list', label: nameOf(f) });
      } else if (f.required) unresolved(f, 'needs your answer');
      continue;
    }
    const decision = saved ? null : asDecision(memory.keyCache[cacheId(f)]);
    // optional fields: only rules, saved answers and checked keys; the model never guesses them, and
    // if nothing fits they stay empty without a word
    if (!saved && !f.required && (decision.ask || decision.answer)) continue;
    // essays only from the student's own statements; preferences (choices, rankings) only from the student
    if (!saved && ((isEssay(f) && !String(decision.key || '').startsWith('statements.')) || isPreference(f))) {
      if (f.required) unresolved(f, isEssay(f) ? 'needs your own text' : 'is your choice');
      continue;
    }
    let key = saved ? 'answer' : decision.key || 'answer';
    let raw;
    if (saved) raw = f.kind === 'file' ? saved.path : saved.value;
    else if (decision.ask) { unresolved(f, 'needs your answer'); continue; }
    else if (decision.answer) raw = decision.answer;
    else {
      raw = getValue(profile, decision.key);
      if (!raw) {
        if (f.required) unresolved(f, `your profile has no ${PROFILE_KEYS[decision.key]?.split(',')[0] || decision.key}`);
        continue;
      }
    }
    let value = saved || decision.answer ? String(raw) : formatValue(key, raw, f);
    // "City and Country" in one box: add the country that belongs to the city
    const COUNTRY_OF = { 'address.city': 'address.country', 'education.institutionCity': 'education.institutionCountry', 'personal.placeOfBirth': 'personal.countryOfBirth' };
    if (!saved && COUNTRY_OF[key] && /\bcity\b.*\b(and|&|,|\/)\s*country\b/i.test(f.label)) {
      const c = getValue(profile, COUNTRY_OF[key]);
      if (c && !value.toLowerCase().includes(c.toLowerCase())) value = `${value}, ${c}`;
    }
    if (f.kind === 'file' && !saved && key === 'answer') { unresolved(f, 'needs a document from you'); continue; }

    if (f.filled && f.value === value) continue; // pre-filled and already correct
    // the value must look right for the field: an email only in an email field, a phone number only in a phone field
    if (f.kind !== 'file' && !valueFits(f, key, value)) {
      if (f.required) unresolved(f, 'needs your answer');
      continue;
    }
    if (f.maxLength && value.length > f.maxLength && !['select', 'radio', 'file'].includes(f.kind)) {
      problem(f, value.length > 80
        ? `your saved text has ${value.length} characters, this field allows ${f.maxLength}: shorten it in the field`
        : `"${value}" is longer than the field allows (${f.maxLength})`);
      continue;
    }
    const label = nameOf(f);
    const why = saved ? 'your saved answer' : decision.answer ? 'worked out from your profile' : undefined;

    if ((f.kind === 'select' || f.kind === 'radio') && decision?.answer) {
      // worked out by the model: it must be one of the real options, and not just the nearest one
      const idx = exactOption(f.options, value);
      if (idx < 0 || looksGuessed(f.options, idx, profile)) {
        unresolved(f, idx < 0 ? `no option matches "${value}"` : 'none of the options clearly fits your profile');
        continue;
      }
      if (f.kind === 'select') actions.push({ action: 'select', target: f.id, value: f.options[idx], key, label, why });
      else actions.push({ action: 'check', target: f.options[idx].id, value: f.options[idx].label, key, label, why });
    } else if (f.kind === 'select' || f.kind === 'radio') {
      let idx = matchOption(f.options, value);
      if (idx < 0 && key === 'edu.level' && LEVEL_MATCH[profile.edu?.levelKey]) {
        const re = new RegExp(LEVEL_MATCH[profile.edu.levelKey], 'i');
        idx = f.options.findIndex((o) => re.test(typeof o === 'string' ? o : o.label));
      }
      if (idx < 0) {
        if (!f.label) { notes.push(`Skipped untitled choice (${(f.options || []).map((o) => o.label || o).join(' / ')})`); continue; }
        unresolved(f, `no option matches "${value}"`);
        continue;
      }
      if (f.kind === 'select') {
        actions.push({ action: 'select', target: f.id, value: f.options[idx], key, label, why });
      } else {
        actions.push({ action: 'check', target: f.options[idx].id, value: f.options[idx].label, key, label, why });
      }
    } else if (f.kind === 'file') {
      if (f.accept && !acceptsFile(f.accept, value)) {
        unresolved(f, `this field only accepts ${f.accept}, your file is ${require('path').basename(value)}`);
        continue;
      }
      actions.push({ action: 'upload', target: f.id, value, key, label });
    } else if (f.kind === 'dropdown') {
      const lvl = key === 'edu.level' ? LEVEL_MATCH[profile.edu?.levelKey] : null;
      actions.push({ action: 'dropdown', target: f.id, value, key, label, why, ...(lvl ? { match: lvl, search: value } : {}) });
    } else {
      const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined;
      actions.push({ action: 'fill', target: f.id, value, key, label, why, ...(iso && f.kind !== 'date' ? { iso } : {}), ...(f.picker ? { picker: true } : {}) });
    }
  }

  for (const f of stuck) problem(f, 'could not fill it, see the error above');

  // Count attempts, so a field that refuses to fill doesn't loop forever
  for (const a of actions) {
    const fieldId = scan.fields.find((f) => f.id === a.target || f.options?.some((o) => o.id === a.target))?.id;
    if (fieldId) memory.attempts[fieldId] = (memory.attempts[fieldId] || 0) + 1;
  }

  if (actions.length) return { actions, notes, needsUser, questions, stop: null };

  // required questions only the student can answer: ask them all at once, in ApplyMate
  if (questions.some((q) => q.required)) {
    const req = questions.filter((q) => q.required);
    return {
      actions, notes, needsUser, questions,
      stop: {
        reason: 'questions', kind: 'questions', questions,
        message: `This page asks ${req.length} required question${req.length === 1 ? '' : 's'} your profile cannot answer yet. ` +
          'Answer below: your answers are saved in your profile and used on every form that asks the same.' +
          (needsUser.length ? `\nAlso do these in the browser window:\n- ${needsUser.join('\n- ')}` : ''),
      },
    };
  }

  // 4. Nothing left to fill -> decide the next step
  if (needsUser.length) {
    return { actions, notes, needsUser, stop: { reason: 'needs-user', message: `Please fill these yourself:\n- ${needsUser.join('\n- ')}` } };
  }

  const buttons = scan.buttons.filter((b) => !b.disabled);
  // On a real sign-up page, "Continue" creates the account: that click is the student's
  const next = isLive(scan.url) && hasPassword ? null : buttons.find((b) => NEXT_BUTTON.test(b.text) && !SAVE_ONLY.test(b.text));

  if (next) {
    if (scan.captcha) {
      return { actions, notes, needsUser, stop: { reason: 'captcha', message: 'Please solve the CAPTCHA in the browser, then the agent will continue.' } };
    }
    // wizards (HEC) keep the same address and button text on every step: the visible fields tell the steps apart
    const clickId = `${scan.url}|${next.text}|${scan.fields.map((f) => f.label).join(",")}`;
    memory.clicks[clickId] = (memory.clicks[clickId] || 0) + 1;
    if (memory.clicks[clickId] > 2) {
      return { actions, notes, needsUser, stop: { reason: 'stuck', message: `Clicked "${next.text}" twice but the page did not move on.` } };
    }
    return { actions: [{ action: 'click', target: next.id, label: next.text }], notes, needsUser, stop: null };
  }

  const NOT_SUBMIT = /^(search|filter|go|find|reset|clear|log ?out|sign ?out|help|login|log ?in)$/i;
  const candidatesSubmit = buttons.filter((b) => !NOT_SUBMIT.test(b.text) && !SAVE_ONLY.test(b.text) && (b.type === 'submit' || SUBMIT_BUTTON.test(b.text)));
  const submit = candidatesSubmit.find((b) => FINAL_BUTTON.test(b.text)) || candidatesSubmit[0];
  if (submit) {
    return {
      actions, notes, needsUser,
      stop: {
        reason: 'ready-to-submit',
        message:
          (notes.some((n) => n.startsWith('Left empty'))
            ? `I filled what I could (some optional fields are left empty, see notes above). Please review the form`
            : `All fields are filled. Please review the form`) +
          (scan.captcha ? ', solve the CAPTCHA,' : '') +
          ` and click "${submit.text}" yourself.`,
      },
    };
  }

  const blocked = scan.buttons.find(
    (b) => b.disabled && (NEXT_BUTTON.test(b.text) || SUBMIT_BUTTON.test(b.text) || b.type === 'submit')
  );
  if (blocked) {
    return {
      actions, notes, needsUser,
      stop: {
        reason: 'no-next-step',
        message: `The "${blocked.text}" button is disabled. The site may still be waiting for something ` +
          `(e.g. the CV upload to finish, or a field I could not fill). Please check the page.`,
      },
    };
  }

  return { actions, notes, needsUser, stop: { reason: 'no-next-step', message: 'Nothing left to fill and no Next/Submit button found. Please continue manually.' } };
}

module.exports = planActions;
module.exports.matchOption = matchOption; // exported for tests
