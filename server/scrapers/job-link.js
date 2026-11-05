// job-link.js — add a job from a link the user copied from Rozee.pk (or any job site).
//
// Why: Rozee.pk protects its pages with Cloudflare bot protection, so ApplyMate does not
// scrape it. The user browses Rozee normally in their own browser and pastes the job link.
// Rozee links look like  https://www.rozee.pk/<company>-<job-title>-<city>-jobs-<number>
// so the title and city can be read from the link itself, without loading the page.

const { CITIES } = require('./rozee-cities');

const titleCase = (s) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

function jobFromLink(rawUrl, { title, org } = {}) {
  let url;
  try {
    url = new URL(String(rawUrl).trim());
  } catch {
    throw new Error('That is not a valid link. Copy the full address of the job page (starting with https://).');
  }
  if (!/^https?:$/.test(url.protocol)) throw new Error('Only http(s) links are supported.');
  const clean = `${url.origin}${url.pathname}`.replace(/\/$/, '');

  const isRozee = /(^|\.)rozee\.pk$/i.test(url.hostname);
  const m = url.pathname.match(/\/([a-z0-9-]+)-jobs-(\d+)\/?$/i);
  if (isRozee && !m) {
    throw new Error('This Rozee link is not a job page. Open a single job on Rozee and copy that address (it ends in "-jobs-<number>").');
  }

  let guessTitle = '';
  let location = '';
  if (m) {
    const words = m[1].split('-');
    // a city at the end of the slug: "...-react-developer-karachi"
    const last = words[words.length - 1];
    const city = CITIES.find((c) => c.toLowerCase() === last.toLowerCase());
    if (city) {
      location = city;
      words.pop();
    }
    guessTitle = titleCase(words.join(' '));
  } else {
    guessTitle = titleCase(decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || url.hostname).replace(/[-_]+/g, ' '));
  }

  return {
    type: 'job',
    source: isRozee ? 'rozee' : 'link',
    title: (title || '').trim() || guessTitle,
    org: (org || '').trim(),
    url: clean,
    applyUrl: clean,
    location,
    description: (title || '').trim() ? '' : 'Title read from the link (it may include the company name). You can open the job page for full details.',
    tags: ['added by you'],
  };
}

module.exports = { jobFromLink };
