// erasmus.js — Erasmus Mundus Joint Master's programmes, live from the official EU catalogue
// (EACEA). The catalogue publishes an RSS feed; each programme has a "Studies" category
// such as "Information Science and Engineering (ENG)", which we match to the user's field.

const { XMLParser } = require('fast-xml-parser');

const FEED = 'https://www.eacea.ec.europa.eu/node/253/rss_en';
const CATALOGUE = 'https://www.eacea.ec.europa.eu/scholarships/erasmus-mundus-catalogue_en';

function parseFeed(xml) {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
  let items = parser.parse(xml)?.rss?.channel?.item || [];
  if (!Array.isArray(items)) items = [items];

  return items
    .map((it) => {
      const cats = [].concat(it.category || []).map((c) =>
        typeof c === 'object' ? { domain: c.domain || '', text: String(c['#text'] || '') } : { domain: '', text: String(c) }
      );
      const byDomain = (re) => cats.filter((c) => re.test(c.domain)).map((c) => c.text.trim()).filter(Boolean);
      const studies = byDomain(/^studies$/i);
      const themes = byDomain(/thematic/i);
      const duration = byDomain(/ects|duration/i)[0] || '';
      const universities = byDomain(/universit/i).slice(0, 4);
      // Intra-Africa scholarships are only for African nationals: not relevant for Pakistani users
      const intraAfrica = cats.some((c) => /intra-africa/i.test(`${c.domain} ${c.text}`));
      const link = String(it.link || it.guid?.['#text'] || it.guid || '').trim();
      const title = String(it.title || '').trim();

      return {
        type: 'scholarship',
        source: 'erasmus',
        title,
        org: universities.length ? universities.join(', ') : 'Erasmus Mundus consortium',
        url: link,
        applyUrl: link,
        location: 'Europe (2+ countries)',
        level: 'Masters',
        levels: ['Masters'],
        deadline: 'Set by each programme (usually Oct – Jan)',
        status: 'varies',
        statusNote: 'Check the programme website for this year’s deadline',
        fieldNote: studies.join(', ') || themes.join(', '),
        description: [studies.join(', '), themes.join(', '), duration].filter(Boolean).join(' · '),
        tags: [...studies, ...themes].slice(0, 6),
        intraAfrica,
      };
    })
    // keep Erasmus Mundus programmes only (the feed also has a few Intra-Africa legacy items)
    .filter((o) => o.title && o.url && !o.intraAfrica && !/intra-africa/i.test(o.title))
    .map(({ intraAfrica, ...o }) => o);
}

async function scrapeErasmus() {
  const res = await fetch(FEED, {
    headers: { 'User-Agent': 'Mozilla/5.0 ApplyMate-FYP/0.3 (student project)' },
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`EACEA catalogue returned HTTP ${res.status}`);
  return parseFeed(await res.text());
}

module.exports = { scrapeErasmus, parseFeed, CATALOGUE };
