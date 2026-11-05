// scanner.js — reads the current page and returns a clean, compact description of the form.
// Every element the agent may act on gets a stable data-am-id attribute, so later steps
// can target it exactly with [data-am-id="..."] (no more ambiguous selectors).

// Scans one frame. `prefix` keeps ids unique across frames ("" for the page itself, "1-", "2-" ...)
// Some older sites change built-in JavaScript (e.g. Prototype.js adds Array.prototype.toJSON), which can
// break how the page result comes back to the agent. So the result is turned into text inside the page
// with those changes switched off for a moment, and read back here. A page that is still loading or
// navigating is scanned again after a short wait instead of crashing the run.
const EMPTY = (frame) => ({ url: frame.url(), title: '', heading: '', fields: [], buttons: [], errors: [], captcha: false });
async function scanFrame(frame, prefix) {
  for (let attempt = 0; attempt < 4; attempt++) {
    let raw;
    try { raw = await scanFrameOnce(frame, prefix); } catch (e) { raw = null; }
    if (typeof raw === 'string') {
      try {
        const out = JSON.parse(raw);
        if (out && Array.isArray(out.fields) && Array.isArray(out.buttons)) return out;
      } catch { /* try again */ }
    }
    await new Promise((r) => setTimeout(r, 1000));
    await frame.waitForLoadState?.('domcontentloaded').catch(() => {});
  }
  return EMPTY(frame);
}

async function scanFrameOnce(frame, prefix) {
  return frame.evaluate((prefix) => {
   const __result = (() => {
    const PREFIX = prefix;
    // Like document.querySelectorAll, but also inside open shadow roots (SAP UI5 / Fiori web components)
    const deepAll = (sel) => {
      const out = [];
      const walk = (root) => {
        out.push(...root.querySelectorAll(sel));
        root.querySelectorAll('*').forEach((e) => e.shadowRoot && walk(e.shadowRoot));
      };
      walk(document);
      return out;
    };
    const up = (n) => n.parentElement || n.getRootNode()?.host || null; // step out of a shadow root too
    // ---------- helpers ----------
    const clean = (t, max = 100) =>
      (t || '').replace(/\s+/g, ' ').replace(/[\s:]+$/, '').trim().slice(0, max);

    const isVisible = (el) => {
      if (!el || !el.isConnected) return false;
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden') return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };

    // Text of a label without the text of any field/options inside it
    const ownText = (el) => {
      const copy = el.cloneNode(true);
      copy.querySelectorAll('input, select, textarea, option').forEach((n) => n.remove());
      return clean(copy.innerText || copy.textContent);
    };

    // Give an element a stable id (kept across re-scans of the same page)
    let next = window.__amNext || 1;
    const tag = (el, prefix) => {
      // a short token per page load keeps ids unique when a portal shows page 2 in the same frame
      window.__amDoc ||= Math.random().toString(36).slice(2, 6);
      if (!el.dataset.amId) el.dataset.amId = PREFIX + prefix + window.__amDoc + '_' + next++;
      window.__amNext = next;
      return el.dataset.amId;
    };

    const FIELD = 'input:not([type="hidden"]), select, textarea';
    const humanize = (s) => clean((s || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' '));

    // Splits a label into the question, the hint and the required star:
    //   "<b>Email Address:</b><br><span style="font-size:8pt">Please avoid hotmail…</span><span class="RequiredSign">*</span>"
    //     -> q "Email Address", hint "Please avoid hotmail…", star true
    //   "Are you currently <b>enrolled</b> in a Master programme? *"  -> the whole sentence (bold is not at the start)
    // Hints are <small>, hint/help/tooltip elements and smaller text; after a bold start, text after a line break.
    const HINT_SEL = 'small, .hint, .help, .description, [class*="tooltip"], [class*="hint"], [class*="help-block"]';
    const REQ_SEL = '[class*="required" i], .req, abbr[title*="required" i]';
    const splitLabel = (lab) => {
      if (!lab) return { q: '', hint: '', star: false };
      const base = parseFloat(getComputedStyle(lab).fontSize) || 16;
      const inLab = (e) => e && e !== lab && lab.contains(e);
      const skip = (p) => p.closest('input, select, textarea, option, script, style');
      const walker = document.createTreeWalker(lab, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
      const nodes = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
      const first = nodes.find((n) => n.nodeType === 3 && n.textContent.trim() && !skip(n.parentElement));
      const boldStart = !!first && inLab(first.parentElement.closest('b, strong'));
      let q = '', hint = '', star = lab.matches(REQ_SEL), passedBold = false, afterBreak = false;
      for (const n of nodes) {
        if (n.nodeType === 1) { if (n.tagName === 'BR' && passedBold) afterBreak = true; continue; }
        const p = n.parentElement;
        const t = n.textContent;
        if (skip(p)) continue;
        if (!t.trim()) { q += ' '; hint += ' '; continue; }
        if (inLab(p.closest(REQ_SEL)) || /^\s*\*+\s*$/.test(t)) { star = true; continue; }
        if (boldStart && !inLab(p.closest('b, strong'))) passedBold = true;
        const small = inLab(p.closest(HINT_SEL)) || parseFloat(getComputedStyle(p).fontSize) < base * 0.9;
        if (small || afterBreak) hint += t; else q += t;
      }
      if (/\*/.test(q)) star = true;
      q = clean(q.replace(/\*+/g, ' '), 160);
      hint = clean(hint.replace(/\*+/g, ' '), 160);
      return q ? { q, hint, star } : { q: hint, hint: '', star };
    };
    const withStar = (s) => (s.q ? s.q + (s.star ? ' *' : '') : '');
    // the labels named by aria-labelledby="q39 opt1-label"
    const fromIds = (ids) => withStar((ids || '').split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean)
      .map(splitLabel).reduce((a, s) => ({ q: clean(`${a.q} ${s.q}`, 160), hint: a.hint || s.hint, star: a.star || s.star }), { q: '', hint: '', star: false }));

    // Text that comes just BEFORE the field inside the same row/block, e.g. Bootstrap layouts:
    // <div class="row"><div class="col-3">Email</div><div class="col-9"><input></div></div>
    const textBefore = (el) => {
      let node = el;
      for (let depth = 0; depth < 8 && up(node) && up(node) !== document.body; depth++) {
        const parent = up(node);
        const kids = [...parent.children];
        for (let i = kids.indexOf(node) - 1; i >= 0; i--) {
          const k = kids[i];
          if (k.matches('script, style, br')) continue;
          if (k.matches(FIELD) || k.querySelector(FIELD)) return ''; // another field is in between
          if (k.matches('h1, h2, h3, h4, h5, h6')) return '';        // a section heading is not a label
          // the question without its hint ("<b>Email Address:</b> <small>Please avoid hotmail…</small> *")
          const t = withStar(splitLabel(k)) || clean(k.innerText);
          if (t) return t;
        }
        node = parent;
      }
      return '';
    };

    // Placeholder text, including the fake placeholders of React-Select style dropdowns
    const placeholderOf = (el) => {
      if (el.placeholder) return clean(el.placeholder);
      const box = el.closest('[class*="container"], [class*="select"]');
      const ph = box?.querySelector('[class*="placeholder"]');
      return ph ? clean(ph.innerText) : '';
    };

    // Returns { label, hint }: label = the field's question, hint = extra text such as the placeholder
    const describe = (el) => {
      let label = '';
      let labelHint = ''; // the small print of the label ("Please avoid hotmail…")
      if (el.id) {
        const l = (el.getRootNode().querySelector ? el.getRootNode() : document).querySelector(`label[for="${CSS.escape(el.id)}"]`)
          || document.querySelector(`label[for="${CSS.escape(el.id)}"], ui5-label[for="${CSS.escape(el.id)}"]`);
        if (l && ownText(l)) { const s = splitLabel(l); label = withStar(s); labelHint = s.hint; }
      }
      const host = el.getRootNode()?.host;
      if (!label && host?.id) {
        const hl = document.querySelector(`label[for="${CSS.escape(host.id)}"], ui5-label[for="${CSS.escape(host.id)}"]`);
        if (hl) label = clean(hl.innerText || hl.textContent);
      }
      if (!label && host && (host.getAttribute('accessible-name') || host.getAttribute('aria-label'))) {
        label = clean(host.getAttribute('accessible-name') || host.getAttribute('aria-label'));
      }
      if (!label && el.closest('label')) label = withStar(splitLabel(el.closest('label'))) || ownText(el.closest('label'));
      if (!label && el.getAttribute('aria-labelledby')) label = fromIds(el.getAttribute('aria-labelledby'));
      if (!label && el.getAttribute('aria-label')) label = clean(el.getAttribute('aria-label'));
      if (!label && el.id && document.getElementById(el.id + '-label')) {
        label = clean(document.getElementById(el.id + '-label').innerText);
      }
      if (!label) label = textBefore(el);

      let hint = placeholderOf(el) || labelHint;
      if (!label) { label = hint; hint = ''; }
      if (!label) label = humanize(el.name || el.id);
      if (hint && label.toLowerCase().includes(hint.toLowerCase())) hint = '';
      return { label, hint };
    };
    const labelOf = (el) => describe(el).label;

    // React-Select / autocomplete inputs: typed into, then an option is picked from a menu
    const isComboInput = (el) =>
      el.tagName === 'INPUT' &&
      (el.getAttribute('role') === 'combobox' ||
        el.getAttribute('aria-autocomplete') === 'list' ||
        /select__|-select|auto-?complete/i.test(el.closest('[class*="container"]')?.className || ''));

    const comboValue = (el) => {
      const box = el.closest('[class*="container"]') || el.parentElement;
      const v = box?.querySelector('[class*="singleValue"], [class*="single-value"], [class*="multiValue"], [class*="multi-value"]');
      return v ? clean(v.innerText, 60) : '';
    };

    // The question of a radio group, e.g. "Gender" for Male / Female
    const questionOf = (radio) => {
      const legend = radio.closest('fieldset')?.querySelector('legend');
      if (legend) return withStar(splitLabel(legend)) || clean(legend.innerText);

      const group = radio.closest('[role="radiogroup"], [role="group"]');
      if (group) {
        const by = fromIds(group.getAttribute('aria-labelledby'));
        if (by) return by;
        if (group.getAttribute('aria-label')) return clean(group.getAttribute('aria-label'));
      }

      const before = textBefore(radio);
      if (before) return before;

      let box = radio.parentElement;
      for (let i = 0; i < 4 && box; i++, box = box.parentElement) {
        const q = box.querySelector(
          ':scope > label:not([for]):not(:has(input)), :scope > p, :scope > span:not(:has(input)), :scope > .label'
        );
        if (q && clean(q.innerText)) return clean(q.innerText);
      }
      return clean(radio.name);
    };

    // Upload widgets (Plupload / mOxie and similar) put the real <input type=file> in a "shim" box laid over the
    // visible upload button, often far from its question in the page. The question belongs to the visible
    // element under the shim (or, when it is off screen, to the labelled field in the same upload box).
    const AUTO_ID = /^(html5|html4|flash|silverlight|moxie|o)\s+[0-9a-z]{8,}$|^[0-9a-z]{20,}$/i;
    const shimOf = (el) => el.closest('[class*="moxie-shim"], [class*="-shim"], [id$="_container"][style*="overflow: hidden"]');
    const uploadAnchor = (el) => {
      const shim = shimOf(el) || el.parentElement;
      let start = shim.parentElement || shim;
      const r = shim.getBoundingClientRect();
      if (r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth) {
        const hit = document.elementsFromPoint(r.left + Math.max(1, r.width / 2), r.top + Math.max(1, r.height / 2))
          .find((e) => !shim.contains(e) && e !== document.body && e !== document.documentElement);
        if (hit) start = hit;
      }
      // the visible part of the upload box: a labelled (often read-only) text box that shows the file name
      for (let box = start, i = 0; box && box !== document.body && i < 4; box = box.parentElement, i++) {
        const shown = [...box.querySelectorAll('input:not([type="file"]):not([type="hidden"]), textarea')]
          .find((f) => f.id && document.querySelector(`label[for="${CSS.escape(f.id)}"]`) || f.getAttribute('aria-labelledby'));
        if (shown) return shown;
      }
      return start;
    };

    // Section of a field: the headings above it ("6. References" > "Academic Referee" -> "References › Academic Referee").
    // Long one-page forms repeat questions ("First choice", "Full name") in several sections.
    const HEAD = 'h2, h3, h4, h5, h6, legend, [role="heading"]';
    const heads = deepAll(HEAD).filter((h) => isVisible(h) && clean(h.innerText, 80) && !h.closest('[role="dialog"], nav, header, footer'));
    const levelOf = (h) => (h.tagName === 'LEGEND' ? 7 : /^H\d$/.test(h.tagName) ? +h.tagName[1] : +(h.getAttribute('aria-level') || 4));
    const sectionOf = (el) => {
      const stack = [];
      for (const h of heads) {
        if (!(h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) || h.contains(el)) continue;
        const lv = levelOf(h);
        // a fieldset's legend only counts for the fields inside that fieldset
        if (h.tagName === 'LEGEND' && !h.parentElement?.contains(el)) continue;
        while (stack.length && stack[stack.length - 1].lv >= lv) stack.pop();
        stack.push({ lv, t: clean(h.innerText, 60).replace(/^[\dIVX]+[.)]\s*/, '') });
      }
      return stack.slice(-2).map((s) => s.t).join(' › ');
    };

    // read-only text boxes that open a calendar (jQuery UI, flatpickr, …): the agent fills them through the calendar
    const isPicker = (el) => el.readOnly && el.tagName === 'INPUT' &&
      (/datepicker|date-picker|flatpickr|datetimepicker|hasDatepicker/i.test(el.className) || /date|birth|dob/i.test(`${el.name} ${el.id}`));

    // ---------- fields ----------
    const fields = [];
    const radioGroups = {};
    const SKIP = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'search']);

    deepAll('input, textarea, select').forEach((el) => {
      const type = (el.type || el.tagName).toLowerCase();
      if (SKIP.has(type) || el.disabled || (el.readOnly && !isPicker(el))) return;

      // Styled radios/checkboxes are often invisible themselves but have a visible label.
      // File inputs are often hidden behind a styled "Upload CV" button: keep them if their box is visible.
      const shown =
        isVisible(el) ||
        [...(el.labels || [])].some(isVisible) ||
        (type === 'file' && isVisible(el.parentElement)) ||
        (type === 'file' && !!shimOf(el) && isVisible(shimOf(el).parentElement));
      if (!shown) return;

      const required = el.required || el.getAttribute('aria-required') === 'true';

      if (type === 'radio') {
        // Group radios by name. Portals like HEC give icon radios no common name: then the radios
        // that sit together in the same box (the nearest parent holding 2+ radios) are one question.
        let key = el.name;
        if (!key) {
          let box = el.parentElement;
          while (box && box !== document.body && box.querySelectorAll('input[type="radio"]').length < 2) box = up(box);
          key = box && box !== document.body ? 'box:' + (box.dataset.amGroup ||= String(Math.random()).slice(2, 9)) : tag(el, 'o');
        }
        let g = radioGroups[key];
        if (!g) {
          g = radioGroups[key] = {
            id: `g${Object.keys(radioGroups).length + 1}`,
            kind: 'radio',
            label: questionOf(el),
            required: false,
            options: [],
            filled: false,
            dialog: !!el.closest('[role="dialog"], mat-dialog-container, .cdk-overlay-pane, .modal.show, .modal[open], dialog[open]'),
          };
          const section = sectionOf(el);
          if (section) g.section = section;
          fields.push(g);
        }
        g.required ||= required || /\*/.test(g.label);
        if (/\*/.test(g.label)) g.label = g.label.replace(/\s*\*+\s*$/, '').replace(/\s+\*\s+/, ' ').replace(/[\s:]+$/, '').trim();
        g.filled ||= el.checked;
        g.options.push({ id: tag(el, 'o'), label: labelOf(el), checked: el.checked });
        return;
      }

      let { label, hint } = describe(el);
      let anchor = null; // the visible box of an upload widget
      if (type === 'file' && (shimOf(el) || AUTO_ID.test(label))) {
        anchor = uploadAnchor(el);
        const d = anchor.matches(FIELD) ? describe(anchor) : { label: textBefore(anchor), hint: '' };
        if (d.label && !AUTO_ID.test(d.label)) ({ label, hint } = d);
      }
      // many forms mark required questions only with a star: "Gender: *"
      const starred = /\*/.test(label) || /\*\s*$/.test(hint || '');
      label = label.replace(/\s*\*+\s*$/, '').replace(/\s+\*\s+/, ' ').replace(/[\s:]+$/, '').trim();
      const combo = isComboInput(el);
      const f = { id: tag(el, 'f'), kind: el.tagName === 'SELECT' ? 'select' : combo ? 'dropdown' : type, label, required: required || starred };

      if (hint) f.hint = hint;
      const section = sectionOf(el);
      if (section) f.section = section;
      if (isPicker(el)) f.picker = true;
      if (el.autocomplete && !['on', 'off'].includes(el.autocomplete)) f.autocomplete = el.autocomplete;
      if (el.maxLength > 0 && el.maxLength < 1000) f.maxLength = el.maxLength;

      if (combo) {
        f.value = comboValue(el);
        f.filled = !!f.value;
      } else if (type === 'checkbox') {
        f.filled = el.checked;
      } else if (type === 'file') {
        // upload widgets empty the real input and show the file name in their own box
        f.filled = el.files.length > 0 || !!(anchor?.matches(FIELD) && anchor.value.trim());
        if (el.accept) f.accept = el.accept;
      } else if (el.tagName === 'SELECT') {
        const opts = [...el.options].filter((o) => !o.disabled);
        const isPlaceholder = (o) => !o.value || /^[\W_]*(select|choose|please|pick)\b|^[\W_]*$|make your choice|select (one|an option)/i.test(o.text.trim());
        f.options = opts.filter((o) => !isPlaceholder(o)).map((o) => clean(o.text, 60));
        const cur = el.options[el.selectedIndex];
        f.value = cur && !isPlaceholder(cur) ? clean(cur.text, 60) : '';
        f.filled = !!f.value;
      } else {
        f.value = el.value;
        f.filled = el.value.trim() !== '';
      }

      f.dialog = !!el.closest('[role="dialog"], mat-dialog-container, .cdk-overlay-pane, .modal.show, .modal[open], dialog[open]');
      fields.push(f);
    });

    // Custom (non-native) dropdowns: React-Select, MUI, Ant Design, etc.
    // Angular Material (mat-select), ng-select, select2: not real <select> elements
    const DROPDOWN = '[role="combobox"], [aria-haspopup="listbox"], mat-select, .mat-mdc-select, ng-select, .select2-selection';
    const seenDrop = new Set();
    deepAll(DROPDOWN).forEach((el) => {
      if (el.matches('input, select, textarea') || !isVisible(el)) return;
      // an open list of options (not a field): Angular Material / ng-select panels, or any listbox around it
      if (el.closest('.mat-select-panel, .mat-mdc-select-panel, .ng-dropdown-panel, .select2-dropdown, .mat-autocomplete-panel')) return;
      if (el.parentElement?.closest('[role="listbox"]') && !el.matches('mat-select, .mat-mdc-select')) return;
      const box = el.closest('mat-select, .mat-mdc-select, ng-select, .select2-selection') || el;
      if (seenDrop.has(box)) return;
      seenDrop.add(box);
      if (box.querySelector('input[data-am-id]') && !box.matches('ng-select')) return; // listed via its inner input
      const ph = box.querySelector('.mat-select-placeholder, .mat-mdc-select-placeholder, .ng-placeholder, .select2-selection__placeholder');
      const valEl = box.querySelector('.mat-select-value-text, .mat-mdc-select-value-text, .ng-value-label, .ng-value, .select2-selection__rendered');
      const value = clean(valEl && !(ph && ph === valEl) ? valEl.innerText : (ph ? '' : box.innerText), 60);
      const ff = box.closest('mat-form-field, .mat-form-field, .form-group, .ng-select-container')?.querySelector('mat-label, label, .mat-form-field-label');
      const label = (ff && clean(ff.innerText)) || labelOf(box) || clean(ph?.innerText || '');
      fields.push({
        id: tag(box, 'f'),
        kind: 'dropdown',
        label,
        required: box.getAttribute('aria-required') === 'true' || box.hasAttribute('required') || /\*/.test(ff?.innerText || ''),
        value,
        filled: !!value && !/^(select|choose|please)/i.test(value),
        dialog: !!box.closest('[role="dialog"], mat-dialog-container, .cdk-overlay-pane, .modal.show, .modal[open], dialog[open]'),
      });
    });

    // ---------- buttons ----------
    const buttons = [];
    deepAll(
        'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"], ' +
        'a[class*="btn"], a[class*="button"], ui5-button' // links styled as buttons ("Apply Now"), UI5 buttons
      )
      .forEach((b) => {
        if (b.matches('button') && b.getRootNode()?.host?.matches?.('ui5-button')) return; // listed via its ui5-button
        if (!isVisible(b)) return;
        const text = clean(b.innerText || b.value || b.getAttribute('aria-label') || b.textContent, 60);
        if (!text) return;
        buttons.push({
          dialog: !!b.closest('[role="dialog"], mat-dialog-container, .cdk-overlay-pane, .modal.show, .modal[open], dialog[open]'),
          id: tag(b, 'b'),
          text,
          type: (b.getAttribute('type') || '').toLowerCase(),
          disabled: b.disabled || b.getAttribute('aria-disabled') === 'true',
        });
      });

    // ---------- validation errors ----------
    const errors = [];
    deepAll('.error, .error-message, .invalid-feedback, .field-error, .form-error, [role="alert"], [aria-live="assertive"]')
      .forEach((e) => {
        if (!isVisible(e)) return;
        // banners, announcements, news tickers and cookie notes also use role="alert": not form errors
        if (e.closest('header, nav, footer, marquee, [class*="announce"], [class*="banner"], [class*="ticker"], [class*="news"], [class*="cookie"]')) return;
        // instruction boxes ("Please provide complete education track record…", tips with a bulb icon)
        // are yellow/blue hints that are always on the page, not errors caused by the form
        const cls = [e, e.parentElement].map((x) => (x && typeof x.className === 'string' ? x.className : '')).join(' ');
        if (/alert-(warning|info|primary|secondary|light)|\b(hint|tip|note|info|instruction)s?\b/i.test(cls) && !/danger|error|invalid/i.test(cls)) return;
        const t = clean(e.innerText, 150);
        if (!t || /announcement|no announcement|welcome|news|cookie/i.test(t)) return;
        if (!/error|invalid|required|must|please (enter|select|fill|provide|choose|upload|correct)|not valid|incorrect|failed|missing|already (exists|registered|taken)|cannot be|can'?t be|should be|at least|too (short|long)/i.test(t)) return;
        if (!errors.includes(t)) errors.push(t);
      });

    // ---------- CAPTCHA (true only while it is on the page AND not yet solved) ----------
    const captchaOnPage = [
      ...document.querySelectorAll(
        '.g-recaptcha, iframe[src*="recaptcha"], iframe[src*="hcaptcha"], [data-sitekey], .cf-turnstile, iframe[src*="challenges.cloudflare"]'
      ),
    ].some(isVisible);
    const captchaSolved = [
      ...document.querySelectorAll('[name="g-recaptcha-response"], [name="h-captcha-response"], [name="cf-turnstile-response"]'),
    ].some((t) => (t.value || '').length > 20);
    const captcha = captchaOnPage && !captchaSolved;

    return {
      url: location.href,
      title: document.title,
      heading: clean(document.querySelector('h1, h2')?.innerText),
      fields,
      buttons,
      errors,
      captcha,
    };
   })();
    const __amStr = (v) => {
      let J = JSON;
      if (!/\[native code\]/.test(String(JSON.stringify))) {
        try { const f = document.createElement('iframe'); f.style.display = 'none'; (document.body || document.documentElement).appendChild(f); J = f.contentWindow.JSON; f.remove(); } catch (e) { /* keep JSON */ }
      }
      const saved = [Array.prototype.toJSON, Object.prototype.toJSON, String.prototype.toJSON];
      try { delete Array.prototype.toJSON; delete Object.prototype.toJSON; delete String.prototype.toJSON; return J.stringify(v); }
      finally { if (saved[0]) Array.prototype.toJSON = saved[0]; if (saved[1]) Object.prototype.toJSON = saved[1]; if (saved[2]) String.prototype.toJSON = saved[2]; }
    };
    return __amStr(__result);
  }, prefix);
}

// Many portals (SAP, older university systems) show the form inside frames: scan those too.
// Frames that are hidden or tiny (tracking, empty placeholders) are skipped.
async function scanPage(page) {
  const main = await scanFrame(page.mainFrame(), '');
  const frames = [page.mainFrame()];
  for (const frame of page.frames().filter((f) => f !== page.mainFrame())) {
    if (frame.isDetached() || /^about:|^javascript:/.test(frame.url()) || /EmptyDocument/i.test(frame.url())) continue;
    try {
      const box = await (await frame.frameElement()).boundingBox();
      if (!box || box.width < 80 || box.height < 60) continue;
      const n = frames.push(frame) - 1;
      const sub = await scanFrame(frame, `${n}-`);
      main.fields.push(...sub.fields);
      main.buttons.push(...sub.buttons);
      main.errors.push(...sub.errors);
      main.captcha ||= sub.captcha;
      if (!main.heading) main.heading = sub.heading;
    } catch { /* frame went away while scanning */ }
  }
  page.__amFrames = frames; // the executor finds "2-f5" in frame 2
  return main;
}

module.exports = scanPage;
