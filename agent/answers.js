// answers.js — the student's own answers to questions a form asked ("Do you hold multiple nationalities?").
// They are saved once in the profile and reused on every form that asks the same question.

// A question in a normalized form, so "Gender: *" and "gender" are the same question
function normalizeQ(label) {
  return String(label || '')
    .toLowerCase()
    .replace(/\*/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .slice(0, 160);
}

/** The saved answer for this field, or null */
// A question that appears in several sections of the page ("Full name" of two referees) is matched only
// with its section ("References › Academic Referee › Full name"); other questions also by their text alone.
function answerFor(profile, field) {
  const list = profile?.answers || [];
  const q = normalizeQ(field.label);
  if (!q) return null;
  const qs = [field.section && normalizeQ(`${field.section} › ${field.label}`), !field.dup && q].filter(Boolean);
  for (const k of qs) {
    const a = list.find((x) => x.q === k && (x.value || x.path));
    if (a) return a;
  }
  return null;
}

module.exports = { normalizeQ, answerFor };
