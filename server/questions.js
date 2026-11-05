// questions.js — keeps the list of questions a form asked (Opportunity.formQuestions) clean:
// no broken labels from upload widgets ("html5 1k6f2ng3…"), no leftovers of older scans, no duplicates.
const { normalizeQ } = require('../agent/answers');

const AUTO_ID = /^(html5|html4|flash|silverlight|moxie|o)\s+[0-9a-z]{8,}$|^[0-9a-z]{20,}$/i;
const lastPart = (label) => String(label || '').split(' › ').pop();
// the question without the explanation that older scans glued to it ("Special needs: Special needs refer to…")
const questionOnly = (label) => normalizeQ(lastPart(label).split(/:\s/)[0]);

function isJunk(q) {
  const label = String(q?.label || '').trim();
  if (!label || AUTO_ID.test(label)) return true;
  if (/^[a-z]+$/.test(label)) return true; // one lower-case word ("enrolled"): a word picked out of a question
  return false;
}

/** The list without broken labels and duplicates; the version with a section ("Second semester › First choice") wins. */
function cleanQuestions(list = []) {
  const good = list.filter((q) => !isJunk(q));
  const sectioned = new Set(good.filter((q) => q.label.includes(' › ')).map((q) => normalizeQ(lastPart(q.label))));
  const seen = new Set();
  const out = [];
  for (const q of good) {
    const plain = !q.label.includes(' › ');
    if (plain && sectioned.has(normalizeQ(q.label))) continue; // "First choice" when "First semester › First choice" is there
    const key = q.label.includes(' › ') ? normalizeQ(q.label) : questionOnly(q.label);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
  }
  return out;
}

module.exports = { cleanQuestions, isJunk };
