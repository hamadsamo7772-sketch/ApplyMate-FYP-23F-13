// questionText.js — a form's question in words a student reads at a glance.
//   "Please upload a photo of yourself here for identification. This may be a passport photo…"
//      -> title "Photo of yourself", hint "For identification. This may be a passport photo…"
//   "Enrolment preferences › Second semester (Host university) › First choice"
//      -> title "First choice", context "Second semester (Host university)"
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function questionParts(label) {
  const parts = String(label || '').split(' › ');
  let q = parts.pop().trim();
  const context = parts.slice(-1)[0] || '';
  let hint = '';

  q = q.replace(/^optional:\s*/i, '');
  // "(max 3000 characters)" is a hint, not part of the question
  const limit = q.match(/\s*\((max(imum)?\.?\s*\d+\s*(characters|chars|words))\)/i);
  if (limit) { q = q.replace(limit[0], ''); hint = cap(limit[1]); }
  // "Proof of residence Please revise…", "Recommendation letter (1) :in english: advisable…", "Special needs: Special needs refer…"
  const cut = q.search(/[.?!](\s|$)|\s:|:\s|\s(Please|If|This|We)\s/);
  if (cut > 3) {
    hint = [q.slice(cut).replace(/^[\s.:?!]+/, '').trim(), hint].filter(Boolean).join(' · ');
    q = q.slice(0, cut + (q[cut] === '?' ? 1 : 0));
  }
  q = q.replace(/^please\s+(upload|provide|enter|indicate|add|attach|state|give)\s+((your|any|an|a|the)\s+)?/i, '')
    .replace(/\s+(here|below)\b.*$/i, (m) => { const rest = m.replace(/^\s+(here|below)\b\s*/i, ''); if (rest) hint = `${cap(rest)}${hint ? `. ${hint}` : ''}`; return ''; })
    .replace(/[\s:*]+$/, '')
    .trim();
  const title = q.length > 80 ? `${q.slice(0, 80).replace(/\s+\S*$/, '')}…` : q;
  return { title: cap(title), context, hint: cap(hint) };
}
