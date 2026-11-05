// details.js — reads a programme's own website and extracts what a student needs to know:
// a short summary, requirements / eligibility, documents, deadlines, scholarship info,
// and the link that leads to the application. Rule-based (fast, explainable); results are
// cached on the listing so each website is read at most once every few days.
//
// It reads the programme's home page plus up to 3 linked pages that look relevant
// ("Admission", "How to apply", "Eligibility", "Scholarships"), politely, one at a time.

const cheerio = require('cheerio');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ApplyMate-FYP/0.7 (student project)';

const SECTIONS = [
  ['requirements', /requirement|eligib|admission criteria|who can apply|entry|prerequisite|qualification/i],
  ['documents', /document|what to (submit|upload|send)|application package|supporting/i],
  ['deadlines', /deadline|important dates|timeline|calendar|key dates/i],
  ['scholarship', /scholarship|funding|financial|fees|tuition|stipend|grant/i],
  ['howToApply', /how to apply|application (procedure|process)|apply now|applying/i],
];
const RELEVANT_LINK = /admission|apply|application|eligib|requirement|scholarship|funding|how to/i;
const APPLY_LINK = /apply|application|admission|portal|register|dreamapply|submit your/i;
const DATE = /\b(\d{1,2}(st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+20\d\d|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(st|nd|rd|th)?,?\s+20\d\d)\b/gi;

const clean = (t) => String(t || '').replace(/\s+/g, ' ').trim();

async function getPage(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(20000), redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (!/html/i.test(res.headers.get('content-type') || '')) throw new Error('not a web page');
  return { url: res.url, html: await res.text() };
}

// Text under each heading, as short bullet points
function sectionsOf($) {
  const out = {};
  $('h1, h2, h3, h4, strong, summary, button[aria-controls]').each((_, h) => {
    const title = clean($(h).text());
    if (!title || title.length > 80) return;
    const kind = SECTIONS.find(([, re]) => re.test(title))?.[0];
    if (!kind) return;
    const items = [];
    // walk the following siblings until the next heading
    let n = $(h).closest('h1,h2,h3,h4').length ? $(h).closest('h1,h2,h3,h4') : $(h).parent();
    for (let i = 0, el = n.next(); i < 8 && el.length && !el.is('h1,h2,h3'); i++, el = el.next()) {
      if (el.is('ul, ol')) el.find('li').each((_, li) => items.push(clean($(li).text())));
      else {
        const t = clean(el.text());
        if (t && clean(el.find('a').text()).length >= t.length * 0.8) continue; // just a row of links
        if (t) items.push(...t.split(/(?<=[.!?])\s+(?=[A-Z])/));
      }
      if (items.length >= 8) break;
    }
    const good = items.map((t) => t.slice(0, 260)).filter((t) => t.length > 15 && t.length < 260);
    if (good.length) out[kind] = [...new Set([...(out[kind] || []), ...good])].slice(0, 8);
  });
  return out;
}

function summaryOf($) {
  const meta = clean($('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content'));
  if (meta.length > 60) return meta.slice(0, 500);
  const p = $('main p, article p, p').toArray().map((e) => clean($(e).text())).find((t) => t.length > 120);
  return (p || meta || '').slice(0, 500);
}

function linksOf($, base) {
  return $('a[href]').toArray().map((a) => {
    let href = '';
    try { href = new URL($(a).attr('href'), base).href.split('#')[0]; } catch { /* bad link */ }
    return { text: clean($(a).text() || $(a).attr('aria-label') || $(a).attr('title')).slice(0, 80), href };
  }).filter((l) => /^https?:/.test(l.href) && l.text);
}

/**
 * @returns {{ summary, requirements[], documents[], deadlines[], scholarship[], howToApply[], dates[], applyLinks[{text,href}], pages[], error? }}
 */
async function fetchDetails(startUrl) {
  const result = { summary: '', requirements: [], documents: [], deadlines: [], scholarship: [], howToApply: [], dates: [], applyLinks: [], pages: [] };
  let first;
  try {
    first = await getPage(startUrl);
  } catch (err) {
    return { ...result, error: `Could not read the programme website (${err.message}).` };
  }

  const queue = [first];
  const seen = new Set([first.url]);
  const host = new URL(first.url).hostname.replace(/^www\./, '');

  for (let i = 0; i < queue.length && i < 4; i++) {
    const { url, html } = queue[i];
    const $ = cheerio.load(html);
    $('script, style, noscript, nav, footer, header').remove();
    result.pages.push(url);
    if (i === 0) result.summary = summaryOf($);

    const s = sectionsOf($);
    for (const k of Object.keys(s)) result[k] = [...new Set([...result[k], ...s[k]])].slice(0, 8);
    result.dates.push(...(clean($('body').text()).match(DATE) || []));

    const $all = cheerio.load(html); // links also live in the navigation
    const links = linksOf($all, url);
    for (const l of links.filter((l) => APPLY_LINK.test(`${l.text} ${l.href}`))) {
      if (!result.applyLinks.some((a) => a.href === l.href)) result.applyLinks.push(l);
    }
    // follow up to 3 relevant pages on the same website
    if (i === 0) {
      for (const l of links) {
        if (queue.length >= 4) break;
        const sameSite = new URL(l.href).hostname.replace(/^www\./, '') === host;
        if (sameSite && RELEVANT_LINK.test(l.text) && !seen.has(l.href) && !/\.(pdf|docx?|zip)$/i.test(l.href)) {
          seen.add(l.href);
          await new Promise((r) => setTimeout(r, 400)); // be polite
          try { queue.push(await getPage(l.href)); } catch { /* skip pages that fail */ }
        }
      }
    }
  }
  result.dates = [...new Set(result.dates.map(clean))].slice(0, 6);
  result.applyLinks = result.applyLinks.slice(0, 6);
  return result;
}

module.exports = { fetchDetails };
