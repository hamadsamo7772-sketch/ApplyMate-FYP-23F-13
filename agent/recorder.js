// recorder.js — script that runs inside every page and frame during "npm run teach"
// Runs inside every page and frame: notes what the team member clicks or chooses
const RECORDER = `(() => {
  if (window.__amRec) return; window.__amRec = true;
  const clean = (t) => (t || '').replace(/\\s+/g, ' ').trim();
  const CL = 'a,button,[role=button],[role=tab],[role=link],[role=menuitem],[role=option],[role=row],[onclick],ui5-button,ui5-link,ui5-li,ui5-tab,ui5-side-navigation-item,li,td,span,label';
  // hidden helper texts for screen readers are not what the user clicked
  const HELPER = /press the space ?bar|to select a row|to activate|press enter|use arrow keys|selected$|not selected$/i;
  const visibleText = (el) => clean(el.innerText || '') || clean(el.getAttribute && (el.getAttribute('text') || el.getAttribute('title')) || '');
  document.addEventListener('click', (e) => {
    const p = e.composedPath().filter((n) => n && n.getAttribute);
    // a row in a table / list (e.g. SAP "Search: Funding programme"): record the row's first real cell
    const row = p.find((n) => n.matches('[role=row], tr, ui5-li, [role=option], li[role]'));
    if (row) {
      const cells = [...row.querySelectorAll('[role=gridcell], td, [role=cell], .sapMListTblCell, .sapMText, span')]
        .map((c) => clean(c.innerText)).filter((t) => t && t.length > 2 && !HELPER.test(t) && !/^\d+$/.test(t));
      const t = cells[0] || visibleText(row);
      if (t && t.length <= 120 && !HELPER.test(t)) { window.__amRecord({ type: 'click', text: t }); return; }
    }
    const el = p.find((n) => n.matches(CL)) || p[0];
    if (!el || el.matches('input, textarea')) return;
    const t = visibleText(el) || clean(el.getAttribute('aria-label') || el.value);
    if (!t || t.length > 80 || /@/.test(t) || HELPER.test(t)) return;
    window.__amRecord({ type: 'click', text: t });
  }, true);
  document.addEventListener('change', (e) => {
    const el = e.composedPath()[0];
    if (!el || !el.tagName) return;
    const lab = el.labels && el.labels[0] ? clean(el.labels[0].innerText) : clean(el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.name || el.id);
    if (el.tagName === 'SELECT') window.__amRecord({ type: 'select', label: lab, value: clean(el.options[el.selectedIndex] && el.options[el.selectedIndex].text) });
    else if (/^(text|search)$/.test(el.type) && el.value && !/@|\\d{5,}/.test(el.value)) window.__amRecord({ type: 'fill', label: lab, value: el.value });
  }, true);
})();`;

module.exports = { RECORDER };
