// rozee.js — NOT USED by the app at the moment.
// Rozee.pk protects its pages with Cloudflare bot protection, which blocks automated browsers
// (tested Oct 2026: "Performing security verification" loops). ApplyMate respects that and
// does not try to get around it; users add Rozee jobs by link instead (see job-link.js).
// This file is kept for reference and for the evaluation chapter ("why live scraping failed").
//
// Original description: job listings from Rozee.pk, searched with the user's job keywords.
// Rozee loads its results with JavaScript, so the page is opened in a real (headless)
// browser with Playwright. Job cards are recognised by Rozee's job link pattern
//   https://www.rozee.pk/<company>-<job-title>-jobs-<number>
// so small design changes on the site don't break the scraper.
// Fetched only on demand (when the user clicks "Find new jobs"), a few pages at most.

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const DEBUG_DIR = path.join(__dirname, 'debug');

const BASE = 'https://www.rozee.pk';
const { CITIES } = require('./rozee-cities');

// "web developer, react, mern" -> search pages for the first 2 keyword phrases
function searchUrls(profile) {
  const phrases = `${profile?.preferences?.jobKeywords || ''}`.split(',').map((s) => s.trim()).filter(Boolean);
  const terms = phrases.length ? phrases.slice(0, 2) : [profile?.job?.currentTitle || profile?.preferences?.studyField || 'developer'];
  return terms.map((t) => `${BASE}/job/jsearch/q/${encodeURIComponent(t)}`);
}

// Runs INSIDE the page
function extractJobsInPage(cities) {
  const JOB = /rozee\.pk\/(?!jobs-in-|job\/|company\/|industry\/|channel\/)[a-z0-9-]+-jobs-\d+\/?$/i;
  const clean = (t) => (t || '').replace(/\s+/g, ' ').trim();
  const abs = (a) => {
    const href = a.getAttribute('href');
    return new URL(href.startsWith('//') ? `https:${href}` : href, location.href).href.split(/[?#]/)[0];
  };

  const byUrl = new Map();
  for (const a of document.querySelectorAll('a[href]')) {
    let url;
    try { url = abs(a); } catch { continue; }
    if (!JOB.test(url)) continue;
    if (!byUrl.has(url)) byUrl.set(url, []);
    byUrl.get(url).push(a);
  }

  const jobs = [];
  for (const [url, anchors] of byUrl) {
    // the card = the largest box around the link that contains no OTHER job link
    let card = anchors[0];
    while (card.parentElement && card.parentElement !== document.body) {
      const other = [...card.parentElement.querySelectorAll('a[href]')].some((a) => {
        try { const u = abs(a); return JOB.test(u) && u !== url; } catch { return false; }
      });
      if (other) break;
      card = card.parentElement;
    }

    const title = anchors.map((a) => clean(a.innerText || a.getAttribute('title'))).filter((t) => t && t.length < 120)
      .sort((x, y) => y.length - x.length)[0] || '';
    const lines = (card.innerText || '').split('\n').map(clean).filter(Boolean);
    const all = lines.join('  ');
    const company = clean(card.querySelector('a[href*="/company/"], [class*="company" i]')?.innerText) ||
      lines.find((l) => l !== title && l.length < 60 && !/\d/.test(l) && !cities.some((c) => l === c)) || '';
    const city = cities.filter((c) => lines.some((l) => new RegExp(`\\b${c}\\b`, 'i').test(l))).slice(0, 3).join(', ');

    jobs.push({
      title,
      url,
      applyUrl: url,
      org: company,
      location: city,
      salary: (all.match(/(PKR|Rs\.?)\s?\d{1,3}(,\d{3})+(\s?-\s?\d{1,3}(,\d{3})+)?/i) || [''])[0],
      posted: (all.match(/\d+\s+(minute|hour|day|week|month)s?\s+ago|today|yesterday|[A-Z][a-z]{2} \d{1,2}, \d{4}/) || [''])[0],
      description: lines.filter((l) => l !== title).join(' | ').slice(0, 500),
    });
  }
  return jobs.filter((j) => j.title);
}

function browserOptions() {
  return {
    headless: process.env.SCRAPER_SHOW !== 'true',
    ...(process.env.AGENT_BROWSER_PATH
      ? { executablePath: process.env.AGENT_BROWSER_PATH }
      : { channel: process.env.AGENT_BROWSER_CHANNEL || 'msedge' }),
  };
}

// When no jobs are found: save what the browser saw, so we can see why
async function diagnose(page, url) {
  try {
    fs.mkdirSync(DEBUG_DIR, { recursive: true });
    const stamp = Date.now();
    await page.screenshot({ path: path.join(DEBUG_DIR, `rozee-${stamp}.png`), fullPage: true });
    fs.writeFileSync(path.join(DEBUG_DIR, `rozee-${stamp}.html`), await page.content());
    const info = await page.evaluate(() => ({
      title: document.title,
      finalUrl: location.href,
      links: document.querySelectorAll('a[href]').length,
      jobLinks: [...document.querySelectorAll('a[href]')].map((a) => a.href).filter((h) => /job/i.test(h)).slice(0, 8),
      text: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 200),
    }));
    return `${url}: no job cards. Page title "${info.title}", ${info.links} links, now at ${info.finalUrl}. ` +
      `Links with "job": ${info.jobLinks.join(' , ') || 'none'}. Text: "${info.text}". ` +
      `Saved screenshot + HTML in server/scrapers/debug/rozee-${stamp}.*`;
  } catch (err) {
    return `${url}: no job cards (could not save debug files: ${err.message})`;
  }
}

async function scrapeRozee(profile, { pages } = {}) {
  const browser = await chromium.launch(browserOptions());
  const found = new Map();
  const errors = [];
  try {
    const page = await browser.newPage({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0',
    });
    for (const url of pages || searchUrls(profile)) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        // results arrive by JavaScript: wait until at least one job link exists
        await page.waitForFunction(
          () => [...document.querySelectorAll('a[href]')].some((a) => /-jobs-\d+\/?$/.test(a.href.split(/[?#]/)[0])),
          null,
          { timeout: 20000 }
        ).catch(() => {});
        const jobs = await page.evaluate(extractJobsInPage, CITIES);
        for (const j of jobs) {
          if (!found.has(j.url)) found.set(j.url, { type: 'job', source: 'rozee', tags: [], ...j });
        }
        if (!jobs.length) errors.push(await diagnose(page, url));
        await page.waitForTimeout(1500); // be polite between pages
      } catch (err) {
        errors.push(`${url}: ${err.message.split('\n')[0]}`);
      }
    }
  } finally {
    await browser.close();
  }
  if (!found.size) {
    throw new Error(errors.length ? errors.join('\n     ') : 'no job links found on the Rozee search page');
  }
  return [...found.values()];
}

module.exports = { scrapeRozee, searchUrls, extractJobsInPage, CITIES };
