// browser.js — opens Edge with Playwright (no extensions, no stealth)
const { chromium } = require('playwright');
const path = require('path');

// Fresh browser data for the agent, kept inside the project (and ignored by git)
const USER_DATA_DIR = path.join(__dirname, '.browser-data');

async function openBrowser(url) {
  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: process.env.AGENT_HEADLESS === 'true',
    // Edge by default; set AGENT_BROWSER_CHANNEL=chrome to use Chrome instead
    ...(process.env.AGENT_BROWSER_PATH
      ? { executablePath: process.env.AGENT_BROWSER_PATH }
      : { channel: process.env.AGENT_BROWSER_CHANNEL || 'msedge' }),
    viewport: null,
    // keep the browser's normal security sandbox on Windows/macOS (no "--no-sandbox" warning bar)
    chromiumSandbox: process.platform !== 'linux',
    args: ['--start-maximized'],
  });

  context.setDefaultTimeout(30000);
  context.setDefaultNavigationTimeout(60000);

  const page = context.pages()[0] || (await context.newPage());
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  return { browser: context, page };
}

module.exports = openBrowser;
