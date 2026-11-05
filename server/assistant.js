// assistant.js — makes sure the offline AI (Ollama) is running before the agent starts,
// and turns errors from a run into messages anyone can understand.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const LLM_URL = process.env.LLM_URL || 'http://localhost:11434'; // same default as agent/llm.js

const isUp = () =>
  fetch(`${LLM_URL}/api/tags`, { signal: AbortSignal.timeout(2000) }).then((r) => r.ok, () => false);

// where the Windows / macOS / Linux installers put Ollama
function ollamaPaths() {
  const list = ['ollama'];
  if (process.env.LOCALAPPDATA) list.unshift(path.join(process.env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe'));
  list.push('/usr/local/bin/ollama', '/opt/homebrew/bin/ollama');
  return list.filter((p) => p === 'ollama' || fs.existsSync(p));
}

function tryStart(cmd) {
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true });
      child.once('error', () => resolve(false));
      child.once('spawn', () => { child.unref(); resolve(true); });
    } catch {
      resolve(false);
    }
  });
}

/** true when the offline AI answers; starts it on this computer if it is installed but not running. */
async function ensureAssistant(log = () => {}) {
  if (await isUp()) return true;
  if (!/localhost|127\.0\.0\.1/.test(LLM_URL)) return false; // a remote AI server can't be started from here
  log('Starting the offline AI (Ollama)…');
  for (const cmd of ollamaPaths()) {
    if (!(await tryStart(cmd))) continue;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (await isUp()) return true;
    }
  }
  return false;
}

// error text from the agent / browser -> what the student reads
const FRIENDLY = [
  [/assistant-unavailable/,
    'ApplyMate’s assistant could not be started on this computer, so the agent did not begin. Please close ApplyMate, open it again, and press “Try again”.'],
  [/LLM failed: timeout|LLM failed.*abort/i,
    'ApplyMate’s assistant took too long to get ready. This can happen the first time on a slower computer. Please press “Try again”.'],
  [/LLM|fetch failed|ECONNREFUSED/i,
    'ApplyMate’s assistant stopped responding, so the agent could not continue. Please press “Try again”. If it happens again, close ApplyMate and open it again.'],
  [/net::ERR_|ENOTFOUND|NAME_NOT_RESOLVED|Navigation timeout|Timeout \d+ms exceeded|ETIMEDOUT/i,
    'The scholarship’s website did not open. Please check your internet connection and press “Try again”. The website may also be down for a short time.'],
  [/already in use|ProcessSingleton|user data dir/i,
    'Another ApplyMate browser window is still open. Close it, then press “Try again”.'],
  [/Executable doesn't exist|browserType\.launch|launchPersistentContext|msedge|chrome/i,
    'ApplyMate could not open the browser window. Please make sure Microsoft Edge is installed, then press “Try again”.'],
  [/has been closed|Target closed|browser.*closed/i,
    'The browser window was closed, so the agent stopped. Press “Try again” when you are ready.'],
];

const friendlyError = (message = '') =>
  (FRIENDLY.find(([re]) => re.test(message)) || [null,
    'Something went wrong and the agent stopped. Please press “Try again”. If it keeps happening, let the ApplyMate team know which scholarship it was.'])[1];

module.exports = { ensureAssistant, friendlyError };
